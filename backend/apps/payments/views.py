"""Customer-facing payment endpoints: methods, provider webhooks, sandbox flow and return-page sync."""

from __future__ import annotations

import logging

from django.conf import settings
from django.http import Http404
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from apps.core.errors import Conflict, DomainError
from apps.orders.models import Order

from . import services
from .models import Payment
from .providers import demo as demo_provider
from .providers.base import InvalidWebhook
from .registry import describe_methods, describe_payment, get_provider
from .serializers import (
    DemoCompleteRequestSerializer,
    DemoCompleteResponseSerializer,
    DemoPaymentSerializer,
    PaymentMethodSerializer,
    PaymentSyncResponseSerializer,
    WebhookAckSerializer,
)

log = logging.getLogger(__name__)


class _SettingsRateThrottle(UserRateThrottle):
    """Rate from REST_FRAMEWORK['DEFAULT_THROTTLE_RATES'][scope] when configured, else a safe built-in default."""

    default_rate = "30/min"

    def get_rate(self):
        return self.THROTTLE_RATES.get(self.scope, self.default_rate)


class DemoCompleteThrottle(_SettingsRateThrottle):
    scope = "payment_demo"


class PaymentSyncThrottle(_SettingsRateThrottle):
    scope = "payment_sync"
    default_rate = "60/min"


class PaymentMethodsView(APIView):
    authentication_classes: list = []
    permission_classes = [permissions.AllowAny]
    throttle_classes: list = []

    @extend_schema(
        responses=PaymentMethodSerializer(many=True), summary="Payment methods currently available at checkout"
    )
    def get(self, request):
        return Response(describe_methods())


# ── webhooks ─────────────────────────────────────────────────────────────────
class _DemoOnlyMixin:
    """Every sandbox endpoint is a plain 404 (even before authentication) while demo payments are switched off."""

    def initial(self, request, *args, **kwargs):
        if not settings.PAYMENT_DEMO_ENABLED:
            raise Http404
        super().initial(request, *args, **kwargs)


class _WebhookView(APIView):
    """Unauthenticated by design: authenticity comes solely from the provider signature over the RAW body."""

    authentication_classes: list = []
    permission_classes = [permissions.AllowAny]
    throttle_classes: list = []
    parser_classes: list = []
    provider_key = ""

    @extend_schema(request=None, responses={200: WebhookAckSerializer}, summary="Provider webhook (signature verified)")
    def post(self, request):
        raw = request.body  # must be read before anything parses it
        provider = get_provider(self.provider_key)
        try:
            event = provider.verify_webhook(raw, request.headers)
        except InvalidWebhook as exc:
            log.warning("rejected %s webhook: %s", self.provider_key, exc)
            raise DomainError("Invalid webhook signature.", code="invalid_signature", status_code=400) from exc
        stored = services.handle_provider_event(self.provider_key, event)
        return Response({"received": True, "outcome": stored.outcome})


class StripeWebhookView(_WebhookView):
    provider_key = "stripe"


class DemoWebhookView(_DemoOnlyMixin, _WebhookView):
    provider_key = "demo"


# ── sandbox flow ─────────────────────────────────────────────────────────────
def _demo_payment_for(request, reference: str) -> Payment:
    if not settings.PAYMENT_DEMO_ENABLED:
        raise Http404
    try:
        return Payment.objects.select_related("order").get(
            provider="demo", reference=reference, order__customer=request.user
        )
    except Payment.DoesNotExist:
        raise Http404 from None


class DemoPaymentView(_DemoOnlyMixin, APIView):
    permission_classes = [permissions.IsAuthenticated]

    @extend_schema(
        responses=DemoPaymentSerializer,
        summary="Sandbox payment page data (owner only; 404 when demo payments are off)",
    )
    def get(self, request, reference):
        payment = _demo_payment_for(request, reference)
        order = payment.order
        items = [
            {"name": i.product_name, "quantity": i.quantity, "line_total": i.line_total} for i in order.items.all()
        ]
        return Response(
            DemoPaymentSerializer(
                {
                    "reference": payment.reference,
                    "order_number": order.number,
                    "total": payment.amount,
                    "currency": payment.currency,
                    "items": items,
                    "status": payment.status,
                    "order_status": order.status,
                    "can_complete": payment.status in services.LIVE,
                    "sandbox": True,
                    "notice": demo_provider.SANDBOX_NOTICE,
                }
            ).data
        )


_SETTLED_FOR = {
    "success": ("PAID", "PARTIALLY_REFUNDED", "REFUNDED"),
    "decline": ("FAILED",),
    "cancel": ("CANCELLED",),
}


class DemoCompleteView(_DemoOnlyMixin, APIView):
    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [DemoCompleteThrottle]

    @extend_schema(
        request=DemoCompleteRequestSerializer,
        responses=DemoCompleteResponseSerializer,
        summary="Finish a sandbox payment (success | decline | cancel); goes through the real webhook pipeline",
    )
    def post(self, request, reference):
        payment = _demo_payment_for(request, reference)
        body = DemoCompleteRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        outcome = body.validated_data["outcome"]

        event_outcome = ""
        if payment.status in services.LIVE:
            raw, headers = demo_provider.build_signed_event(payment, outcome)
            event = get_provider("demo").verify_webhook(raw, headers)  # same verification a real webhook gets
            event_outcome = services.handle_provider_event("demo", event).outcome
        elif payment.status not in _SETTLED_FOR[outcome]:
            raise Conflict(
                f"This sandbox payment is already {payment.get_status_display().lower()}.", code="payment_not_pending"
            )
        # else: idempotent repeat of an outcome that was already applied
        payment.refresh_from_db()
        order = Order.objects.prefetch_related("payments").get(pk=payment.order_id)
        summary = describe_payment(order)
        return Response(
            DemoCompleteResponseSerializer(
                {
                    "outcome": outcome,
                    "payment_status": payment.status,
                    "order_number": order.number,
                    "order_status": order.status,
                    "order_payment_status": order.payment_status,
                    "can_retry": summary["can_retry"],
                    "sandbox": True,
                    "event_outcome": event_outcome,
                }
            ).data
        )


class PaymentSyncView(APIView):
    """Return-page helper: asks the provider (not the browser) what happened, via the normal event pipeline."""

    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [PaymentSyncThrottle]

    @extend_schema(
        request=None,
        responses=PaymentSyncResponseSerializer,
        summary="Confirm the latest payment attempt with the provider (owner only)",
    )
    def post(self, request, number):
        try:
            order = Order.objects.get(number=number, customer=request.user)
        except Order.DoesNotExist:
            raise Http404 from None
        services.sync_order_payment(order)
        order = Order.objects.prefetch_related("payments").get(pk=order.pk)
        return Response(
            PaymentSyncResponseSerializer(
                {"order_number": order.number, "order_status": order.status, "payment": describe_payment(order)}
            ).data,
            status=status.HTTP_200_OK,
        )

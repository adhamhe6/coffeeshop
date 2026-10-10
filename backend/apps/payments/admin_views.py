"""Staff payments API: list/inspect payments and refund them. Scoped to the staff member's branches."""

from __future__ import annotations

import django_filters as df
from django.db.models import F, Q
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import generics, status
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import HasCapability, scope_queryset_by_branch
from apps.core.errors import DomainError

from . import services
from .admin_serializers import (
    AdminPaymentDetailSerializer,
    AdminPaymentSerializer,
    RefundRequestSerializer,
    RefundResultSerializer,
)
from .models import Payment

DUPLICATE = services.DUPLICATE_CHARGE


def _payments_for(user):
    qs = Payment.objects.select_related("order", "order__branch").prefetch_related("refunds", "events")
    return scope_queryset_by_branch(qs, user, "order__branch_id")


class PaymentFilter(df.FilterSet):
    provider = df.ChoiceFilter(choices=Payment.Provider.choices)
    status = df.MultipleChoiceFilter(choices=Payment.Status.choices)
    is_sandbox = df.BooleanFilter()
    branch = df.NumberFilter(field_name="order__branch_id")
    date_from = df.DateFilter(field_name="created_at", lookup_expr="date__gte")
    date_to = df.DateFilter(field_name="created_at", lookup_expr="date__lte")
    q = df.CharFilter(method="filter_q", help_text="Order number, customer email or payment reference.")
    failed = df.BooleanFilter(method="filter_failed", help_text="true = FAILED attempts only")
    needs_refund = df.BooleanFilter(
        method="filter_needs_refund",
        help_text="true = cancelled order with money still held, or a flagged duplicate charge.",
    )
    flagged = df.BooleanFilter(method="filter_flagged", help_text="true = attempts staff must review.")

    class Meta:
        model = Payment
        fields: list[str] = []

    def filter_q(self, qs, name, value):
        value = value.strip()
        return (
            qs.filter(
                Q(order__number__icontains=value)
                | Q(order__customer_email__icontains=value)
                | Q(reference__icontains=value)
            )
            if value
            else qs
        )

    def filter_failed(self, qs, name, value):
        return qs.filter(status=Payment.Status.FAILED) if value else qs.exclude(status=Payment.Status.FAILED)

    def filter_needs_refund(self, qs, name, value):
        cond = Q(order__status="CANCELLED", status__in=["PAID", "PARTIALLY_REFUNDED"]) | Q(
            flagged_reason=DUPLICATE, refunded_total__lt=F("amount")
        )
        return qs.filter(cond) if value else qs.exclude(cond)

    def filter_flagged(self, qs, name, value):
        return qs.exclude(flagged_reason="") if value else qs.filter(flagged_reason="")


class AdminPaymentListView(generics.ListAPIView):
    permission_classes = [HasCapability.require("payments.view")]
    serializer_class = AdminPaymentSerializer
    filterset_class = PaymentFilter
    ordering_fields = ["created_at", "amount", "paid_at", "status"]
    ordering = ["-created_at", "-id"]

    def get_queryset(self):
        return _payments_for(self.request.user)


class AdminPaymentDetailView(generics.RetrieveAPIView):
    permission_classes = [HasCapability.require("payments.view")]
    serializer_class = AdminPaymentDetailSerializer

    def get_queryset(self):
        return _payments_for(self.request.user)


class AdminPaymentRefundView(APIView):
    permission_classes = [HasCapability.require("payments.refund")]

    @extend_schema(
        request=RefundRequestSerializer,
        parameters=[
            OpenApiParameter(
                "Idempotency-Key",
                str,
                OpenApiParameter.HEADER,
                required=False,
                description="Repeat a request safely: the same key returns the original refund (max 64 chars).",
            )
        ],
        responses={200: RefundResultSerializer},
        summary="Refund a payment (full remaining amount by default). Optional Idempotency-Key header.",
    )
    def post(self, request, pk):
        try:
            payment = _payments_for(request.user).get(pk=pk)
        except (Payment.DoesNotExist, ValueError):
            raise DomainError("Payment not found.", code="not_found", status_code=404) from None
        body = RefundRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        key = request.headers.get("Idempotency-Key", "").strip() or None
        if key and len(key) > 64:
            raise ValidationError({"Idempotency-Key": ["Must be at most 64 characters."]})
        amount = body.validated_data.get("amount")
        if amount is None:
            amount = services.refundable_amount(payment)
            if amount <= 0:
                raise DomainError(
                    "There is nothing left to refund on this payment.", code="nothing_to_refund", status_code=409
                )
        refund = services.refund_payment(
            payment, amount, body.validated_data["reason"], request.user, idempotency_key=key
        )
        payment = _payments_for(request.user).get(pk=payment.pk)
        result = RefundResultSerializer({"refund": refund, "payment": payment}, context={"request": request}).data
        if refund.status == "FAILED":
            raise DomainError(
                refund.failure_message or "The refund could not be completed.",
                code="refund_failed",
                status_code=status.HTTP_502_BAD_GATEWAY,
                extra={"refund": result["refund"]},
            )
        return Response(result)

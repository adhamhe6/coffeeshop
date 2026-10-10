"""Staff order operations API (`/admin/orders/...`). Capability + branch scope are enforced on every endpoint."""

from __future__ import annotations

import logging

from django.db.models import Prefetch
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import generics, status
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import HasCapability, branch_scope, has_capability
from apps.core.errors import DomainError
from apps.payments import services as payment_services
from apps.payments.models import Payment

from . import admin_filters as f
from . import services as order_services
from . import state
from .admin_serializers import (
    AdminCancelRequestSerializer,
    AdminCancelResponseSerializer,
    AdminNoteRequestSerializer,
    AdminNoteSerializer,
    AdminOrderDetailSerializer,
    AdminOrderRowSerializer,
    AdminQueueSerializer,
    AdminRefundOutcomeSerializer,
    AdminTransitionRequestSerializer,
)
from .models import Order, OrderItem, OrderNote

log = logging.getLogger(__name__)
S = Order.Status


def _detail_queryset(user):
    return f.admin_orders(user).prefetch_related(
        Prefetch("items", queryset=OrderItem.objects.prefetch_related("options")),
        Prefetch(
            "payments",
            queryset=Payment.objects.select_related("order", "order__branch").prefetch_related("refunds", "events"),
        ),
        "history",
        "staff_notes__author",
    )


def _order_or_404(user, number: str) -> Order:
    """Out-of-scope orders are indistinguishable from missing ones."""
    order = _detail_queryset(user).filter(number=number).first()
    if order is None:
        raise NotFound("Order not found.")
    return order


def _detail(request, number: str) -> dict:
    return AdminOrderDetailSerializer(_order_or_404(request.user, number), context={"request": request}).data


class AdminOrderListView(generics.ListAPIView):
    permission_classes = [HasCapability.require("orders.view")]
    serializer_class = AdminOrderRowSerializer
    filterset_class = f.AdminOrderFilter
    ordering_fields = ["placed_at", "total", "number", "status", "payment_status", "updated_at"]
    ordering = ["-placed_at", "-id"]

    def get_queryset(self):
        return f.admin_orders(self.request.user)


class AdminOrderQueueView(APIView):
    permission_classes = [HasCapability.require("orders.view")]

    @extend_schema(
        parameters=[OpenApiParameter("branch", int, description="Limit the board to one branch (must be in scope).")],
        responses=AdminQueueSerializer,
        summary="Live board: counts and oldest age per active status for the staff's branches",
    )
    def get(self, request):
        now = timezone.now()
        qs = f.admin_orders(request.user)
        branch = request.query_params.get("branch")
        if branch:
            if not branch.isdigit():
                raise DomainError("branch must be a branch id.", code="validation_error", status_code=400)
            qs = qs.filter(branch_id=int(branch))
        stats = f.queue_stats(qs, now)
        rows = []
        for st in f.ACTIVE_STATUSES:
            row = stats.get(st)
            rows.append(
                {
                    "status": str(st),
                    "label": state.STATUS_LABELS[st],
                    "count": row["count"] if row else 0,
                    "stuck_count": row["stuck"] if row else 0,
                    "oldest_age_minutes": f.minutes_since(row["oldest"], now) if row else None,
                }
            )
        scope = branch_scope(request.user)
        return Response(
            AdminQueueSerializer(
                {
                    "generated_at": now,
                    "branch_ids": None if scope is None else sorted(scope),
                    "statuses": rows,
                    "totals": {"active": sum(r["count"] for r in rows), "stuck": sum(r["stuck_count"] for r in rows)},
                    "stuck_rules_minutes": f.STUCK_RULES,
                }
            ).data
        )


class AdminOrderDetailView(APIView):
    permission_classes = [HasCapability.require("orders.view")]

    @extend_schema(
        responses=AdminOrderDetailSerializer, summary="Everything about one order, with actions the caller may take"
    )
    def get(self, request, number):
        return Response(_detail(request, number))


def _reraise_invalid_transition(exc: DomainError):
    allowed = exc.extra.get("allowed") if getattr(exc, "extra", None) else None
    message = str(exc.detail)
    if allowed is not None and "Allowed" not in message:
        message += f" Allowed next steps: {', '.join(allowed) if allowed else 'none (final status)'}."
    raise DomainError(message, code="invalid_transition", status_code=409, extra=exc.extra) from exc


class AdminOrderTransitionView(APIView):
    permission_classes = [HasCapability.require("orders.manage")]

    @extend_schema(
        request=AdminTransitionRequestSerializer,
        responses=AdminOrderDetailSerializer,
        summary="Move an order to the next status",
    )
    def post(self, request, number):
        order = _order_or_404(request.user, number)
        body = AdminTransitionRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        to_status, note = body.validated_data["to_status"], body.validated_data["note"]
        try:
            if to_status == S.CANCELLED:
                if not has_capability(request.user, "orders.cancel"):
                    raise PermissionDenied("You do not have permission to cancel orders.")
                if not note.strip():
                    raise DomainError(
                        "A reason is required to cancel an order.",
                        code="validation_error",
                        status_code=400,
                        fields={"note": ["A reason is required."]},
                    )
                order_services.cancel_order(order.pk, actor=request.user, reason=note)
            else:
                order_services.transition_order(order.pk, to_status, actor=request.user, note=note)
        except DomainError as exc:
            if exc.detail.code == "invalid_transition":
                _reraise_invalid_transition(exc)
            raise
        return Response(_detail(request, number))


class AdminOrderCancelView(APIView):
    permission_classes = [HasCapability.require("orders.cancel")]

    @extend_schema(
        request=AdminCancelRequestSerializer,
        responses=AdminCancelResponseSerializer,
        summary="Cancel an order; with refund=true also refunds and reports the real refund outcome",
    )
    def post(self, request, number):
        order = _order_or_404(request.user, number)
        body = AdminCancelRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        reason, want_refund = body.validated_data["reason"], body.validated_data["refund"]
        if want_refund and not has_capability(request.user, "payments.refund"):
            raise PermissionDenied("You do not have permission to refund payments.")
        try:
            order_services.cancel_order(order.pk, actor=request.user, reason=reason)
        except DomainError as exc:
            if exc.detail.code == "invalid_transition":
                _reraise_invalid_transition(exc)
            raise
        refund = (
            self._refund(order, reason, request.user)
            if want_refund
            else {
                "status": "NOT_REQUESTED",
                "message": "No refund was requested. The payment, if any, is unchanged.",
                "amount": None,
                "refund_id": None,
                "payment_id": None,
            }
        )
        return Response({"order": _detail(request, number), "refund": AdminRefundOutcomeSerializer(refund).data})

    @staticmethod
    def _refund(order: Order, reason: str, actor) -> dict:
        """Refund the settled payment after cancelling and report what really happened (never raises)."""

        def outcome(status_, message, payment=None, amount=None, refund=None):
            return {
                "status": status_,
                "message": message,
                "amount": amount,
                "refund_id": refund.pk if refund else None,
                "payment_id": payment.pk if payment else None,
            }

        payment = next(
            (
                p
                for p in Payment.objects.filter(order=order).order_by("-created_at")
                if p.status in payment_services.REFUNDABLE
            ),
            None,
        )
        if payment is None:
            return outcome("NOT_APPLICABLE", "There was no completed payment to refund. Nothing was refunded.")
        remaining = payment_services.refundable_amount(payment)
        if remaining <= 0:
            return outcome("ALREADY_REFUNDED", "This payment has already been refunded in full.", payment)
        try:
            refund = payment_services.refund_payment(payment, remaining, f"Order cancelled: {reason}"[:200], actor)
        except DomainError as exc:
            return outcome("FAILED", f"The refund was not made: {exc.detail}", payment, remaining)
        cur = payment.currency
        if refund.status == "SUCCEEDED":
            if payment.provider == "cash":
                msg = f"Recorded a manual cash hand-back of {refund.amount} {cur}. Give the cash back to the customer."
            else:
                msg = f"Refunded {refund.amount} {cur} through {payment.get_provider_display()}."
            return outcome("SUCCEEDED", msg, payment, refund.amount, refund)
        if refund.status == "PENDING":
            return outcome(
                "PENDING",
                f"Refund of {refund.amount} {cur} was submitted and is waiting for the payment provider to confirm.",
                payment,
                refund.amount,
                refund,
            )
        return outcome(
            "FAILED",
            f"The order is cancelled, but the refund of {refund.amount} {cur} failed: {refund.failure_message or 'unknown error'} Retry it from Payments.",
            payment,
            refund.amount,
            refund,
        )


class AdminOrderNoteView(APIView):
    permission_classes = [HasCapability.require("orders.note")]

    @extend_schema(
        request=AdminNoteRequestSerializer,
        responses={201: AdminNoteSerializer},
        summary="Add an internal note (never visible to the customer)",
    )
    def post(self, request, number):
        order = _order_or_404(request.user, number)
        body = AdminNoteRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        note = OrderNote.objects.create(order=order, author=request.user, body=body.validated_data["body"])
        log.info("order note added order=%s author=%s", order.number, request.user.pk)
        return Response(AdminNoteSerializer(note).data, status=status.HTTP_201_CREATED)


class AdminOrderCollectCashView(APIView):
    permission_classes = [HasCapability.require("payments.collect")]

    @extend_schema(
        request=None,
        responses=AdminOrderDetailSerializer,
        summary="Mark the cash for a cash order as collected (idempotent)",
    )
    def post(self, request, number):
        order = _order_or_404(request.user, number)
        payment_services.mark_cash_collected(order, request.user)
        return Response(_detail(request, number))

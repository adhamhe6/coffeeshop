import django_filters
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import generics, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.cart import services as cart_services
from apps.cart.views import cart_response
from apps.core.errors import DomainError

from . import selectors, services
from .models import Order
from .serializers import (
    CancelRequestSerializer,
    CancelResponseSerializer,
    CheckoutResponseSerializer,
    CheckoutSerializer,
    OrderDetailSerializer,
    OrderListSerializer,
    OrderPaymentSerializer,
    PayRequestSerializer,
    ReorderResponseSerializer,
)

IDEMPOTENCY_PARAM = OpenApiParameter(
    "Idempotency-Key",
    OpenApiTypes.STR,
    OpenApiParameter.HEADER,
    required=True,
    description="Unique per checkout attempt (8-64 chars). Replaying the same key returns the original order (HTTP 200).",
)


class CheckoutView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = "checkout"

    @extend_schema(
        operation_id="checkout_create",
        summary="Place an order from the cart",
        parameters=[IDEMPOTENCY_PARAM],
        request=CheckoutSerializer,
        responses={201: CheckoutResponseSerializer, 200: CheckoutResponseSerializer},
        tags=["checkout"],
    )
    def post(self, request):
        key = request.headers.get("Idempotency-Key", "").strip()
        if not key:
            raise DomainError(
                "The Idempotency-Key header is required.", code="idempotency_key_required", status_code=400
            )
        body = CheckoutSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        placed = services.place_order(request.user, payload=body.validated_data, idempotency_key=key)
        if placed.created:
            payment = services.begin_payment(placed.order)
        else:
            from apps.payments.registry import describe_payment

            payment = {**describe_payment(placed.order), "error": None}
        order = selectors.get_customer_order(request.user, placed.order.number)
        data = CheckoutResponseSerializer(
            {"order": order, "payment": payment}, context={"payment": payment, "request": request}
        ).data
        response = Response(data, status=status.HTTP_201_CREATED if placed.created else status.HTTP_200_OK)
        if cart_services.cookie_token(request):
            cart_services.clear_cart_cookie(response)
        return response


class OrderFilter(django_filters.FilterSet):
    status = django_filters.BaseInFilter(field_name="status", lookup_expr="in", help_text="Comma-separated statuses")
    order_type = django_filters.ChoiceFilter(choices=Order.Type.choices)

    class Meta:
        model = Order
        fields = ["status", "order_type"]


class OrderListView(generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = OrderListSerializer
    filterset_class = OrderFilter
    ordering_fields = ["placed_at", "total"]
    ordering = ["-placed_at", "-id"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Order.objects.none()
        return selectors.customer_orders(self.request.user)

    @extend_schema(operation_id="orders_list", tags=["orders"])
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)


class OrderDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(operation_id="orders_retrieve", responses=OrderDetailSerializer, tags=["orders"])
    def get(self, request, number):
        order = selectors.get_customer_order(request.user, number)
        return Response(OrderDetailSerializer(order, context={"request": request}).data)


class OrderCancelView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="orders_cancel",
        summary="Cancel an order (customers: only while PENDING)",
        request=CancelRequestSerializer,
        responses=CancelResponseSerializer,
        tags=["orders"],
    )
    def post(self, request, number):
        order = selectors.get_customer_order(request.user, number)
        body = CancelRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        services.customer_cancel(order, body.validated_data["reason"])
        order = selectors.get_customer_order(request.user, number)
        data = {"order": order, **services.refund_hint(order)}
        return Response(CancelResponseSerializer(data, context={"request": request}).data)


class OrderReorderView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        operation_id="orders_reorder",
        summary="Add the still-valid lines of a past order to the cart",
        request=None,
        responses=ReorderResponseSerializer,
        tags=["orders"],
    )
    def post(self, request, number):
        order = selectors.get_customer_order(request.user, number)
        cart, skipped = services.reorder(request.user, order)
        response = cart_response(request, cart)
        response.data = ReorderResponseSerializer({"cart": response.data, "skipped": skipped}).data
        return response


class OrderPayView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = "checkout"

    @extend_schema(
        operation_id="orders_pay",
        summary="Start (or retry) payment for an unpaid order",
        request=PayRequestSerializer,
        responses=OrderPaymentSerializer,
        tags=["orders"],
    )
    def post(self, request, number):
        order = selectors.get_customer_order(request.user, number)
        body = PayRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        payment = services.pay_order(order, body.validated_data.get("payment_method") or None)
        return Response(OrderPaymentSerializer(payment).data)

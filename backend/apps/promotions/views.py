from drf_spectacular.utils import extend_schema
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.cart import services as cart_services
from apps.cart.pricing import price_cart
from apps.core.errors import DomainError

from .serializers import CouponValidateRequestSerializer, CouponValidationSerializer


class CouponValidateView(APIView):
    """Preview what a promo code would take off the current cart. Anonymous is fine, except for per-customer and
    first-order codes (those answer 401 `login_required`)."""

    permission_classes = [AllowAny]
    throttle_scope = "coupon"

    @extend_schema(
        operation_id="coupons_validate",
        summary="Validate a promo code against the current cart",
        request=CouponValidateRequestSerializer,
        responses=CouponValidationSerializer,
        tags=["cart"],
    )
    def post(self, request):
        body = CouponValidateRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        code = body.validated_data["code"]
        cart = cart_services.get_cart(request)
        lines = cart_services.lines_from_items(cart_services.load_items(cart))
        if not lines:
            raise DomainError("Add something to your cart before applying a promo code.", code="cart_empty")
        # Coupon rules do not depend on the order type or branch, so validation prices the cart as a plain pickup order.
        breakdown = price_cart(lines, coupon_code=code, user=request.user, check_availability=False, automatic=[])
        error = breakdown.coupon_error
        if error is not None or breakdown.applied_coupon is None:
            error = error or None
            raise DomainError(
                error.message if error else "That promo code is not valid.",
                code=error.code if error else "not_found",
                status_code=401 if error and error.code == "login_required" else 400,
                fields={"code": [error.message if error else "That promo code is not valid."]},
                extra=dict(error.data) if error else {},
            )
        coupon = breakdown.applied_coupon
        payload = {
            "valid": True,
            "code": coupon.code,
            "name": coupon.name,
            "description": coupon.description,
            "discount_type": coupon.discount_type,
            "value": coupon.value,
            "discount": breakdown.discount_total,
            "subtotal": breakdown.subtotal,
            "min_order_total": coupon.min_order_total,
            "max_discount": coupon.max_discount,
        }
        return Response(CouponValidationSerializer(payload).data)

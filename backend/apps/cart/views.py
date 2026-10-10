from django.utils import timezone
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.exceptions import NotAuthenticated, NotFound, Throttled
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from . import services
from .evaluation import evaluate_checkout
from .selectors import cart_payload, preview_payload, quote_payload
from .serializers import (
    CartItemCreateSerializer,
    CartItemUpdateSerializer,
    CartPreviewRequestSerializer,
    CartPreviewSerializer,
    CartSerializer,
    QuoteRequestSerializer,
    QuoteSerializer,
)


def cart_response(request, cart, http_status=status.HTTP_200_OK) -> Response:
    """Serialise the cart; (re)issue the guest cookie, or drop a stale guest cookie once the user is signed in."""
    response = Response(CartSerializer(cart_payload(cart)).data, status=http_status)
    if cart is not None:
        if request.user.is_authenticated:
            if services.cookie_token(request):
                services.clear_cart_cookie(response)
        else:
            services.set_cart_cookie(response, cart)
    return response


def load_branch(branch_id):
    from apps.branches.models import Branch

    branch = Branch.objects.prefetch_related("hours", "closures").filter(pk=branch_id).first()
    if branch is None:
        raise NotFound("Branch not found.")
    return branch


class PublicAPIView(APIView):
    permission_classes = [AllowAny]


class ProductQuoteView(PublicAPIView):
    @extend_schema(
        operation_id="products_quote",
        summary="Server-side price for a product configuration",
        request=QuoteRequestSerializer,
        responses=QuoteSerializer,
        tags=["cart"],
    )
    def post(self, request, slug):
        from apps.catalog.models import Product

        body = QuoteRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        product = (
            Product.objects.select_related("category")
            .prefetch_related("modifier_links__group")
            .filter(slug=slug, is_active=True)
            .first()
        )
        if product is None:
            raise NotFound("Product not found.")
        branch = load_branch(data["branch_id"]) if data.get("branch_id") else None
        line, issues = services.evaluate_selection(product, data["option_ids"], data["quantity"], branch=branch)
        return Response(QuoteSerializer(quote_payload(product, line, issues)).data)


class CartView(PublicAPIView):
    @extend_schema(operation_id="cart_retrieve", responses=CartSerializer, tags=["cart"])
    def get(self, request):
        return cart_response(request, services.get_cart(request))

    @extend_schema(operation_id="cart_clear", responses={200: CartSerializer}, tags=["cart"])
    def delete(self, request):
        cart = services.get_cart(request)
        if cart is not None:
            services.clear_cart(cart)
        return cart_response(request, cart)


class GuestCartCreateThrottle(SimpleRateThrottle):
    """Each anonymous add-to-cart without a valid guest cookie inserts a persistent Cart row (kept 90 days), so bots
    that discard the cookie could grow the table without bound. Limits how many guest carts one address can create."""

    scope = "cart_create"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class CartItemsView(PublicAPIView):
    @extend_schema(
        operation_id="cart_items_add",
        summary="Add a line (identical selections merge)",
        request=CartItemCreateSerializer,
        responses={201: CartSerializer},
        tags=["cart"],
    )
    def post(self, request):
        body = CartItemCreateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        product = services.get_product(data["product_id"])
        if not request.user.is_authenticated and services.get_cart(request) is None:
            throttle = GuestCartCreateThrottle()
            if not throttle.allow_request(request, self):
                raise Throttled(wait=throttle.wait())
        cart = services.get_cart(request, create=True)
        services.add_item(cart, product, data["option_ids"], data["quantity"], data["note"])
        return cart_response(request, cart, status.HTTP_201_CREATED)


class CartItemDetailView(PublicAPIView):
    @extend_schema(
        operation_id="cart_items_update",
        request=CartItemUpdateSerializer,
        responses=CartSerializer,
        tags=["cart"],
    )
    def patch(self, request, pk):
        cart = services.get_cart(request)
        if cart is None:
            raise NotFound("Cart item not found.")
        body = CartItemUpdateSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        services.update_item(
            cart, pk, quantity=data.get("quantity"), option_ids=data.get("option_ids"), note=data.get("note")
        )
        return cart_response(request, cart)

    @extend_schema(operation_id="cart_items_remove", responses={200: CartSerializer}, tags=["cart"])
    def delete(self, request, pk):
        cart = services.get_cart(request)
        if cart is None:
            raise NotFound("Cart item not found.")
        services.remove_item(cart, pk)
        return cart_response(request, cart)


class AcknowledgePricesView(PublicAPIView):
    @extend_schema(
        operation_id="cart_acknowledge_prices",
        summary="Accept the current prices of all lines",
        request=None,
        responses=CartSerializer,
        tags=["cart"],
    )
    def post(self, request):
        cart = services.get_cart(request)
        if cart is not None:
            services.acknowledge_prices(cart)
        return cart_response(request, cart)


def resolve_address(request, address_id):
    """The signed-in customer's own, non-deleted address - anything else is a 404 (never reveals others' ids)."""
    from apps.accounts.models import Address

    if not request.user.is_authenticated:
        raise NotAuthenticated()
    address = Address.objects.select_related("zone").filter(pk=address_id, user=request.user, is_deleted=False).first()
    if address is None:
        raise NotFound("Address not found.")
    return address


class CartPreviewView(PublicAPIView):
    @extend_schema(
        operation_id="cart_preview",
        summary="Full priced breakdown for the checkout page (what checkout will recompute)",
        request=CartPreviewRequestSerializer,
        responses={200: CartPreviewSerializer, 404: OpenApiResponse(description="Address or branch not found")},
        tags=["cart"],
    )
    def post(self, request):
        body = CartPreviewRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        data = body.validated_data
        cart = services.get_cart(request)
        branch_id = data.get("branch_id") or (cart.branch_id if cart else None)
        branch = load_branch(branch_id) if branch_id else None
        address = resolve_address(request, data["address_id"]) if data.get("address_id") else None
        items = services.load_items(cart)
        evaluation = evaluate_checkout(
            user=request.user,
            lines=services.lines_from_items(items),
            branch=branch,
            order_type=data["order_type"],
            address=address,
            coupon_code=data.get("coupon_code", ""),
            requested_for=data.get("requested_for"),
            now=timezone.now(),
        )
        if data.get("branch_id"):
            services.remember_branch(cart, branch)
        return Response(CartPreviewSerializer(preview_payload(evaluation)).data)

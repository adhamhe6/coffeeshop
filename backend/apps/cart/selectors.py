"""Read side of the cart: payload builders shared by the cart, preview, coupon and reorder endpoints."""

from __future__ import annotations

from apps.core.money import ZERO

from .evaluation import CheckoutEvaluation
from .models import Cart
from .pricing import PricedLine, price_lines
from .selection import Issue, option_snapshot
from .services import is_line_available, lines_from_items, load_items


def product_ref(product, *, available: bool) -> dict:
    return {
        "id": product.id,
        "slug": product.slug,
        "name": product.name,
        "image": product.image.url if product.image else None,
        "is_available": available,
    }


def line_payload(line: PricedLine, *, with_discount: bool = False) -> dict:
    data = {
        "id": line.key,
        "product": product_ref(line.product, available=is_line_available(line)),
        "options": option_snapshot(line.options),
        "quantity": line.quantity,
        "unit_price": line.unit_price,
        "line_total": line.line_total,
        "note": line.note,
        "price_changed": line.price_changed,
        "issues": [i.as_dict() for i in line.issues],
    }
    if with_discount:
        data["discount"] = line.discount
    return data


def cart_payload(cart: Cart | None) -> dict:
    from apps.core.models import StoreSettings

    items = load_items(cart)
    branch = cart.branch if cart is not None else None
    priced, issues = price_lines(lines_from_items(items), branch=branch)
    subtotal = sum((ln.line_total for ln in priced), ZERO)
    return {
        "items": [line_payload(ln) for ln in priced],
        "item_count": sum(ln.quantity for ln in priced),
        "subtotal": subtotal,
        "currency": StoreSettings.load().currency,
        "issues": [i.as_dict() for i in issues],
        "branch_id": cart.branch_id if cart is not None else None,
    }


def _issue_list(issues) -> list[dict]:
    return [i.as_dict() for i in issues]


def preview_payload(ev: CheckoutEvaluation) -> dict:
    b = ev.breakdown
    coupon = None
    if b.applied_coupon is not None:
        c = b.applied_coupon
        coupon = {
            "code": c.code,
            "name": c.name,
            "description": c.description,
            "discount_type": c.discount_type,
            "discount": b.discount_total,
            "is_automatic": c.is_automatic,
        }
    delivery = None
    if b.delivery is not None:
        delivery = {
            "fee": b.delivery.fee,
            "min_order_total": b.delivery.min_order_total,
            "eta_minutes": b.delivery.eta_minutes,
            "zone": ev.zone.name if ev.zone is not None else None,
        }
    error = b.coupon_error
    return {
        "order_type": ev.order_type,
        "branch_id": ev.branch.id if ev.branch is not None else None,
        "currency": b.currency,
        "items": [line_payload(ln, with_discount=True) for ln in b.lines],
        "item_count": b.item_count,
        "subtotal": b.subtotal,
        "discount_total": b.discount_total,
        "delivery_fee": b.delivery_fee,
        "tax_total": b.tax_total,
        "tax_rate": b.tax_rate,
        "tax_label": ev.tax_label,
        "prices_include_tax": b.prices_include_tax,
        "total": b.total,
        "coupon": coupon,
        "coupon_error": {"code": error.code, "message": error.message} if error else None,
        "delivery": delivery,
        "requested_for": ev.requested_for,
        "estimated_ready_at": ev.estimated_ready_at,
        "issues": _issue_list(b.issues),
        "checkout_blockers": _issue_list(ev.blockers),
        "can_checkout": ev.can_checkout,
    }


def quote_payload(product, line: PricedLine, issues: list[Issue]) -> dict:
    return {
        "unit_price": line.unit_price,
        "base_price": line.base_price,
        "quantity": line.quantity,
        "options": option_snapshot(line.options),
        "line_total": line.line_total,
        "currency": _currency(),
        "valid": not issues,
        "errors": [{"code": i.code, "message": i.message, **({"group": i.group} if i.group else {})} for i in issues],
    }


def _currency() -> str:
    from apps.core.models import StoreSettings

    return StoreSettings.load().currency

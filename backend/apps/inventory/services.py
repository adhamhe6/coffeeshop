"""Inventory rules: availability, deducting/restoring stock for orders, manual adjustments.

`StockItem.quantity` is only ever changed here, always inside a transaction with the row locked
(`select_for_update`, rows locked in ascending id order so concurrent orders cannot deadlock), and every change writes an
`InventoryMovement` carrying the resulting quantity. The DB check constraint additionally forbids negative stock.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from collections.abc import Iterable

from django.db import transaction
from django.db.models import Sum

from apps.core.audit import audit
from apps.core.errors import DomainError

from .models import BranchProduct, InventoryMovement, StockItem

log = logging.getLogger(__name__)

STOCKED = "STOCKED"
MANUAL_TYPES = {
    InventoryMovement.Type.RECEIPT,
    InventoryMovement.Type.ADJUSTMENT,
    InventoryMovement.Type.WASTE,
    InventoryMovement.Type.INITIAL,
}
REASON_REQUIRED = {InventoryMovement.Type.ADJUSTMENT, InventoryMovement.Type.WASTE}


class StockShortage(DomainError):
    """Raised when one or more STOCKED lines cannot be fulfilled. `extra["items"]` lists every short product."""

    status_code = 409
    default_code = "out_of_stock"

    def __init__(self, items: list[dict]):
        names = ", ".join(i["name"] for i in items)
        super().__init__(
            f"Not enough stock for: {names}." if names else "Not enough stock.",
            code="out_of_stock",
            status_code=409,
            extra={"items": items},
        )
        self.items = items


# ── availability ─────────────────────────────────────────────────────────────────────────────────────────────────────


def _evaluate(product, *, branch_unavailable: bool, stock_quantity: int | None, quantity: int, branch_given: bool):
    """Pure decision shared by `availability` and `availability_map`. Returns (available, reason)."""
    category = getattr(product, "category", None)
    if not product.is_active or (category is not None and not category.is_active):
        return False, "inactive"
    if product.is_sold_out:
        return False, "sold_out"
    if not branch_given:
        return True, None
    if product.stock_mode == STOCKED:
        if (stock_quantity or 0) < quantity:
            return False, "out_of_stock"
    elif branch_unavailable:
        return False, "branch_unavailable"
    return True, None


def availability(product, branch, quantity: int = 1) -> tuple[bool, str | None]:
    """Is `quantity` of `product` purchasable at `branch`? Reason codes: inactive|sold_out|branch_unavailable|out_of_stock.

    With ``branch=None`` only the global flags (active, category active, sold-out) are considered.
    """
    branch_unavailable = False
    stock_quantity = None
    if branch is not None:
        if product.stock_mode == STOCKED:
            stock_quantity = (
                StockItem.objects.filter(branch=branch, product=product).values_list("quantity", flat=True).first()
            )
        else:
            branch_unavailable = BranchProduct.objects.filter(
                branch=branch, product=product, is_available=False
            ).exists()
    return _evaluate(
        product,
        branch_unavailable=branch_unavailable,
        stock_quantity=stock_quantity,
        quantity=quantity,
        branch_given=branch is not None,
    )


def availability_map(products: Iterable, branch) -> dict[int, tuple[bool, str | None]]:
    """Bulk `availability(product, branch)` for many products in at most two queries (no N+1)."""
    products = list(products)
    ids = [p.id for p in products]
    unavailable: set[int] = set()
    stock: dict[int, int] = {}
    if branch is not None and ids:
        unavailable = set(
            BranchProduct.objects.filter(branch=branch, product_id__in=ids, is_available=False).values_list(
                "product_id", flat=True
            )
        )
        stock = dict(StockItem.objects.filter(branch=branch, product_id__in=ids).values_list("product_id", "quantity"))
    return {
        p.id: _evaluate(
            p,
            branch_unavailable=p.id in unavailable,
            stock_quantity=stock.get(p.id),
            quantity=1,
            branch_given=branch is not None,
        )
        for p in products
    }


def apply_branch_availability(items: list[dict], branch) -> list[dict]:
    """Overlay branch availability onto serialized product dicts (keys: id, stock_mode, is_available, unavailable_reason).

    Used for responses whose product payload is cached without branch data: items already unavailable for global
    reasons are left alone; the rest are checked against the branch in two queries. Mutates and returns `items`.
    """
    if branch is None:
        return items
    candidates = [i for i in items if i["is_available"]]
    prepared = [i["id"] for i in candidates if i["stock_mode"] != STOCKED]
    stocked = [i["id"] for i in candidates if i["stock_mode"] == STOCKED]
    unavailable = (
        set(
            BranchProduct.objects.filter(branch=branch, product_id__in=prepared, is_available=False).values_list(
                "product_id", flat=True
            )
        )
        if prepared
        else set()
    )
    stock = (
        dict(StockItem.objects.filter(branch=branch, product_id__in=stocked).values_list("product_id", "quantity"))
        if stocked
        else {}
    )
    for item in candidates:
        if item["stock_mode"] == STOCKED:
            if stock.get(item["id"], 0) < 1:
                item["is_available"], item["unavailable_reason"] = False, "out_of_stock"
        elif item["id"] in unavailable:
            item["is_available"], item["unavailable_reason"] = False, "branch_unavailable"
    return items


# ── order stock movements ────────────────────────────────────────────────────────────────────────────────────────────


def _stocked_quantities(order) -> dict[int, tuple[int, str]]:
    """product_id → (total quantity, product name) for the order's STOCKED lines (same product on many lines summed)."""
    totals: dict[int, int] = defaultdict(int)
    names: dict[int, str] = {}
    for item in order.items.select_related("product"):
        product = item.product
        if product is None or product.stock_mode != STOCKED:
            continue
        totals[product.id] += item.quantity
        names[product.id] = product.name
    return {pid: (qty, names[pid]) for pid, qty in totals.items()}


def deduct_stock_for_order(order) -> None:
    """Deduct STOCKED lines of `order` from its branch (SALE movements). All-or-nothing.

    Must be called inside the transaction that creates the order. Raises `StockShortage` (409 out_of_stock) listing every
    short product. Calling it again for an order that already has SALE movements is a no-op.
    """
    wanted = _stocked_quantities(order)
    if not wanted:
        return
    with transaction.atomic():
        items = list(
            StockItem.objects.select_for_update()
            .filter(branch_id=order.branch_id, product_id__in=wanted.keys())
            .order_by("id")
        )
        if InventoryMovement.objects.filter(
            stock_item__in=items, movement_type=InventoryMovement.Type.SALE, reference=order.number
        ).exists():
            return
        by_product = {i.product_id: i for i in items}
        short = []
        for product_id, (qty, name) in sorted(wanted.items()):
            have = by_product[product_id].quantity if product_id in by_product else 0
            if have < qty:
                short.append({"product_id": product_id, "name": name, "requested": qty, "available": max(have, 0)})
        if short:
            raise StockShortage(short)
        movements = []
        for item in items:
            qty = wanted[item.product_id][0]
            item.quantity -= qty
            item.save(update_fields=["quantity", "updated_at"])
            movements.append(
                InventoryMovement(
                    stock_item=item,
                    movement_type=InventoryMovement.Type.SALE,
                    quantity_delta=-qty,
                    quantity_after=item.quantity,
                    reference=order.number,
                    reason="Order placed",
                )
            )
        InventoryMovement.objects.bulk_create(movements)


def restore_stock_for_order(order, *, reason: str) -> None:
    """Return the stock sold by `order` (one RETURN movement per SALE movement). Idempotent and concurrency-safe."""
    sale_item_ids = list(
        InventoryMovement.objects.filter(movement_type=InventoryMovement.Type.SALE, reference=order.number)
        .values_list("stock_item_id", flat=True)
        .distinct()
    )
    if not sale_item_ids:
        return
    with transaction.atomic():
        items = list(StockItem.objects.select_for_update().filter(id__in=sale_item_ids).order_by("id"))
        # Totals are read after the locks so a concurrent restore that finished first is seen.
        sold = _sum_by_item(items, order.number, InventoryMovement.Type.SALE)
        returned = _sum_by_item(items, order.number, InventoryMovement.Type.RETURN)
        movements = []
        for item in items:
            outstanding = -sold.get(item.id, 0) - returned.get(item.id, 0)
            if outstanding <= 0:
                continue
            item.quantity += outstanding
            item.save(update_fields=["quantity", "updated_at"])
            movements.append(
                InventoryMovement(
                    stock_item=item,
                    movement_type=InventoryMovement.Type.RETURN,
                    quantity_delta=outstanding,
                    quantity_after=item.quantity,
                    reference=order.number,
                    reason=(reason or "Order stock restored")[:200],
                )
            )
        if movements:
            InventoryMovement.objects.bulk_create(movements)
            log.info("Stock restored for order %s (%s lines)", order.number, len(movements))


def _sum_by_item(items, reference: str, movement_type: str) -> dict[int, int]:
    rows = (
        InventoryMovement.objects.filter(stock_item__in=items, reference=reference, movement_type=movement_type)
        .values("stock_item_id")
        .annotate(total=Sum("quantity_delta"))
    )
    return {r["stock_item_id"]: r["total"] or 0 for r in rows}


# ── manual adjustments ───────────────────────────────────────────────────────────────────────────────────────────────


def adjust_stock(
    branch,
    product,
    *,
    delta: int | None = None,
    set_to: int | None = None,
    movement_type: str,
    reason: str = "",
    actor=None,
    reference: str = "",
) -> StockItem:
    """Apply a manual stock change and return the locked, updated StockItem (created when missing).

    Exactly one of `delta` / `set_to`. Directions: RECEIPT and INITIAL must add stock, WASTE must remove it,
    ADJUSTMENT may do either. ADJUSTMENT and WASTE require a reason. PREPARED products are not stock-managed, and a
    result below zero is refused (409 insufficient_stock). The change is audited.
    """
    if (delta is None) == (set_to is None):
        raise DomainError("Provide either delta or set_to.", code="invalid_adjustment", fields={"delta": ["Required."]})
    if movement_type not in MANUAL_TYPES:
        raise DomainError(
            "Movement type must be RECEIPT, ADJUSTMENT, WASTE or INITIAL.",
            code="invalid_movement_type",
            fields={"movement_type": ["Invalid choice."]},
        )
    reason = (reason or "").strip()
    if movement_type in REASON_REQUIRED and not reason:
        raise DomainError(
            "A reason is required.", code="reason_required", fields={"reason": ["This field is required."]}
        )
    if product.stock_mode != STOCKED:
        raise DomainError(
            "This product is prepared to order and has no stock quantity. Use the availability toggle instead.",
            code="not_stock_managed",
            status_code=409,
        )
    if set_to is not None and set_to < 0:
        raise DomainError("Quantity cannot be negative.", code="insufficient_stock", status_code=409)

    with transaction.atomic():
        StockItem.objects.get_or_create(branch=branch, product=product)
        item = StockItem.objects.select_for_update().get(branch=branch, product=product)
        before = item.quantity
        change = (set_to - before) if set_to is not None else delta
        if change == 0:
            raise DomainError("That does not change the stock level.", code="no_change", fields={"delta": ["Zero."]})
        if movement_type in (InventoryMovement.Type.RECEIPT, InventoryMovement.Type.INITIAL) and change < 0:
            raise DomainError(
                "Receipts and initial stock must add units.",
                code="invalid_adjustment",
                fields={"delta": ["Must be positive."]},
            )
        if movement_type == InventoryMovement.Type.WASTE and change > 0:
            raise DomainError(
                "Waste must remove units.", code="invalid_adjustment", fields={"delta": ["Must be negative."]}
            )
        after = before + change
        if after < 0:
            raise DomainError(
                f"Only {before} in stock; cannot remove {-change}.",
                code="insufficient_stock",
                status_code=409,
                extra={"available": before},
            )
        item.quantity = after
        item.save(update_fields=["quantity", "updated_at"])
        item.last_movement = InventoryMovement.objects.create(
            stock_item=item,
            movement_type=movement_type,
            quantity_delta=change,
            quantity_after=after,
            reference=(reference or "")[:60],
            reason=reason[:200],
            actor=actor if getattr(actor, "is_authenticated", False) else None,
        )
        audit(
            actor,
            "inventory.adjust",
            item,
            summary=f"{movement_type} {change:+d} · {product.name} @ {branch.name}",
            changes={
                "branch": branch.name,
                "product": product.sku,
                "movement_type": movement_type,
                "before": before,
                "after": after,
                "reason": reason,
                "reference": reference,
            },
        )
    return item

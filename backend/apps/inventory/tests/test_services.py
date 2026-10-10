import threading

import pytest
from django.db import connection

from apps.core.errors import DomainError
from apps.core.models import AuditLog
from apps.inventory import services
from apps.inventory.models import BranchProduct, InventoryMovement, StockItem
from apps.inventory.services import StockShortage
from tests.factories import make_branch, make_category, make_product, make_staff, make_stock

from .helpers import make_order

pytestmark = pytest.mark.django_db


# ── availability ────────────────────────────────────────────────────────────────────────────────────────────────────


def test_availability_global_flags_without_branch():
    product = make_product()
    assert services.availability(product, None) == (True, None)
    product.is_sold_out = True
    assert services.availability(product, None) == (False, "sold_out")
    product.is_sold_out = False
    product.is_active = False
    assert services.availability(product, None) == (False, "inactive")


def test_availability_inactive_category_is_inactive():
    category = make_category(is_active=False)
    product = make_product(category=category)
    assert services.availability(product, None) == (False, "inactive")


def test_availability_prepared_branch_toggle():
    branch, other = make_branch(), make_branch()
    product = make_product()
    BranchProduct.objects.create(branch=branch, product=product, is_available=False)
    assert services.availability(product, branch) == (False, "branch_unavailable")
    assert services.availability(product, other) == (True, None)
    BranchProduct.objects.filter(branch=branch).update(is_available=True)
    assert services.availability(product, branch) == (True, None)


def test_availability_stocked_quantity():
    branch = make_branch()
    product = make_product(stocked=True)
    assert services.availability(product, branch) == (False, "out_of_stock")  # no row = no stock
    make_stock(branch, product, quantity=3)
    assert services.availability(product, branch, 3) == (True, None)
    assert services.availability(product, branch, 4) == (False, "out_of_stock")


def test_availability_map_matches_single_calls(django_assert_num_queries):
    branch = make_branch()
    prepared = make_product()
    hidden = make_product()
    BranchProduct.objects.create(branch=branch, product=hidden, is_available=False)
    stocked = make_product(stocked=True)
    make_stock(branch, stocked, quantity=1)
    empty = make_product(stocked=True)
    products = [prepared, hidden, stocked, empty]
    for p in products:
        p.category  # warm
    with django_assert_num_queries(2):
        result = services.availability_map(products, branch)
    for p in products:
        assert result[p.id] == services.availability(p, branch)
    assert result[hidden.id] == (False, "branch_unavailable")
    assert result[empty.id] == (False, "out_of_stock")


# ── deduct / restore ────────────────────────────────────────────────────────────────────────────────────────────────


def test_deduct_writes_sale_movements_with_balance():
    branch = make_branch()
    beans, mug = make_product(stocked=True), make_product(stocked=True)
    make_stock(branch, beans, 10)
    make_stock(branch, mug, 4)
    order = make_order(branch, [(beans, 3), (mug, 1), (beans, 2)])  # same product on two lines is summed
    services.deduct_stock_for_order(order)
    assert StockItem.objects.get(product=beans).quantity == 5
    assert StockItem.objects.get(product=mug).quantity == 3
    sale = InventoryMovement.objects.get(stock_item__product=beans)
    assert (sale.movement_type, sale.quantity_delta, sale.quantity_after, sale.reference) == (
        "SALE",
        -5,
        5,
        order.number,
    )


def test_deduct_ignores_prepared_products_and_other_branches():
    branch, other = make_branch(), make_branch()
    latte = make_product()
    beans = make_product(stocked=True)
    make_stock(branch, beans, 5)
    make_stock(other, beans, 5)
    services.deduct_stock_for_order(make_order(branch, [(latte, 2), (beans, 1)]))
    assert StockItem.objects.get(branch=branch, product=beans).quantity == 4
    assert StockItem.objects.get(branch=other, product=beans).quantity == 5
    assert InventoryMovement.objects.count() == 1


def test_deduct_is_noop_for_orders_without_stocked_lines():
    branch = make_branch()
    services.deduct_stock_for_order(make_order(branch, [(make_product(), 1)]))
    assert InventoryMovement.objects.count() == 0


def test_deduct_twice_does_not_double_deduct():
    branch = make_branch()
    beans = make_product(stocked=True)
    make_stock(branch, beans, 10)
    order = make_order(branch, [(beans, 4)])
    services.deduct_stock_for_order(order)
    services.deduct_stock_for_order(order)
    assert StockItem.objects.get(product=beans).quantity == 6


def test_shortage_lists_every_short_item_and_changes_nothing():
    branch = make_branch()
    a, b, c = (make_product(stocked=True, name=n) for n in ("Aaa", "Bbb", "Ccc"))
    make_stock(branch, a, 1)
    make_stock(branch, b, 10)  # fine
    # c has no stock row at all
    order = make_order(branch, [(a, 2), (b, 1), (c, 1)])
    with pytest.raises(StockShortage) as exc:
        services.deduct_stock_for_order(order)
    assert exc.value.status_code == 409 and exc.value.detail.code == "out_of_stock"
    items = {i["product_id"]: i for i in exc.value.extra["items"]}
    assert set(items) == {a.id, c.id}
    assert items[a.id] == {"product_id": a.id, "name": "Aaa", "requested": 2, "available": 1}
    assert items[c.id]["available"] == 0
    assert StockItem.objects.get(product=b).quantity == 10
    assert InventoryMovement.objects.count() == 0


def test_shortage_is_a_domain_error_with_envelope(api, db):
    # the envelope merges `extra`, so clients get {"error": {"code": "out_of_stock", "items": [...]}}
    err = StockShortage([{"product_id": 1, "name": "X", "requested": 2, "available": 0}])
    assert isinstance(err, DomainError)
    assert err.extra["items"][0]["name"] == "X"


def test_restore_returns_stock_once():
    branch = make_branch()
    beans, mug = make_product(stocked=True), make_product(stocked=True)
    make_stock(branch, beans, 10)
    make_stock(branch, mug, 4)
    order = make_order(branch, [(beans, 3), (mug, 4)])
    services.deduct_stock_for_order(order)
    services.restore_stock_for_order(order, reason="Order cancelled")
    services.restore_stock_for_order(order, reason="Order cancelled")  # idempotent
    services.restore_stock_for_order(order, reason="Expired")
    assert StockItem.objects.get(product=beans).quantity == 10
    assert StockItem.objects.get(product=mug).quantity == 4
    returns = InventoryMovement.objects.filter(movement_type="RETURN")
    assert returns.count() == 2
    ret = returns.get(stock_item__product=beans)
    assert (ret.quantity_delta, ret.quantity_after, ret.reference, ret.reason) == (
        3,
        10,
        order.number,
        "Order cancelled",
    )


def test_restore_without_prior_deduction_is_noop():
    branch = make_branch()
    beans = make_product(stocked=True)
    make_stock(branch, beans, 5)
    services.restore_stock_for_order(make_order(branch, [(beans, 2)]), reason="x")
    assert StockItem.objects.get(product=beans).quantity == 5
    assert InventoryMovement.objects.count() == 0


def test_restore_only_affects_that_order():
    branch = make_branch()
    beans = make_product(stocked=True)
    make_stock(branch, beans, 10)
    one, two = make_order(branch, [(beans, 2)]), make_order(branch, [(beans, 3)])
    services.deduct_stock_for_order(one)
    services.deduct_stock_for_order(two)
    services.restore_stock_for_order(one, reason="cancel")
    assert StockItem.objects.get(product=beans).quantity == 7


@pytest.mark.django_db(transaction=True)
def test_concurrent_deduct_of_last_unit_exactly_one_wins():
    branch = make_branch()
    beans = make_product(stocked=True)
    make_stock(branch, beans, 1)
    orders = [make_order(branch, [(beans, 1)]) for _ in range(2)]
    barrier = threading.Barrier(2)
    results: list[str] = []

    def worker(order):
        try:
            barrier.wait()
            services.deduct_stock_for_order(order)
            results.append("ok")
        except StockShortage:
            results.append("short")
        finally:
            connection.close()

    threads = [threading.Thread(target=worker, args=(o,)) for o in orders]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(results) == ["ok", "short"]
    assert StockItem.objects.get(product=beans).quantity == 0
    assert InventoryMovement.objects.filter(movement_type="SALE").count() == 1


@pytest.mark.django_db(transaction=True)
def test_concurrent_multi_item_orders_do_not_deadlock():
    branch = make_branch()
    a, b = make_product(stocked=True), make_product(stocked=True)
    make_stock(branch, a, 20)
    make_stock(branch, b, 20)
    orders = [make_order(branch, [(a, 1), (b, 1)] if i % 2 else [(b, 1), (a, 1)]) for i in range(8)]
    barrier = threading.Barrier(len(orders))
    errors: list[Exception] = []

    def worker(order):
        try:
            barrier.wait()
            services.deduct_stock_for_order(order)
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)
        finally:
            connection.close()

    threads = [threading.Thread(target=worker, args=(o,)) for o in orders]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert not errors
    assert StockItem.objects.get(product=a).quantity == 12
    assert StockItem.objects.get(product=b).quantity == 12


@pytest.mark.django_db(transaction=True)
def test_concurrent_restore_returns_stock_once():
    branch = make_branch()
    beans = make_product(stocked=True)
    make_stock(branch, beans, 5)
    order = make_order(branch, [(beans, 5)])
    services.deduct_stock_for_order(order)
    barrier = threading.Barrier(4)

    def worker():
        try:
            barrier.wait()
            services.restore_stock_for_order(order, reason="cancel")
        finally:
            connection.close()

    threads = [threading.Thread(target=worker) for _ in range(4)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert StockItem.objects.get(product=beans).quantity == 5
    assert InventoryMovement.objects.filter(movement_type="RETURN").count() == 1


# ── adjust_stock ────────────────────────────────────────────────────────────────────────────────────────────────────


def test_adjust_creates_missing_stock_item_and_audits():
    branch, actor = make_branch(), make_staff("ADMIN")
    beans = make_product(stocked=True)
    item = services.adjust_stock(
        branch, beans, delta=12, movement_type="RECEIPT", reason="", actor=actor, reference="PO-1"
    )
    assert item.quantity == 12
    move = InventoryMovement.objects.get()
    assert (move.movement_type, move.quantity_delta, move.quantity_after, move.reference, move.actor) == (
        "RECEIPT",
        12,
        12,
        "PO-1",
        actor,
    )
    log = AuditLog.objects.get(action="inventory.adjust")
    assert log.actor == actor and log.changes["before"] == 0 and log.changes["after"] == 12


def test_adjust_set_to_computes_delta():
    branch = make_branch()
    beans = make_product(stocked=True)
    make_stock(branch, beans, 10)
    item = services.adjust_stock(branch, beans, set_to=7, movement_type="ADJUSTMENT", reason="Recount", actor=None)
    assert item.quantity == 7
    assert InventoryMovement.objects.get().quantity_delta == -3


@pytest.mark.parametrize(
    ("kwargs", "code"),
    [
        ({"movement_type": "ADJUSTMENT", "delta": 1}, "reason_required"),
        ({"movement_type": "WASTE", "delta": -1}, "reason_required"),
        ({"movement_type": "SALE", "delta": -1, "reason": "x"}, "invalid_movement_type"),
        ({"movement_type": "RETURN", "delta": 1, "reason": "x"}, "invalid_movement_type"),
        ({"movement_type": "RECEIPT"}, "invalid_adjustment"),
        ({"movement_type": "RECEIPT", "delta": 1, "set_to": 3}, "invalid_adjustment"),
        ({"movement_type": "RECEIPT", "delta": -2}, "invalid_adjustment"),
        ({"movement_type": "WASTE", "delta": 2, "reason": "x"}, "invalid_adjustment"),
        ({"movement_type": "ADJUSTMENT", "delta": 0, "reason": "x"}, "no_change"),
        ({"movement_type": "ADJUSTMENT", "set_to": 5, "reason": "x"}, "no_change"),
        ({"movement_type": "ADJUSTMENT", "delta": -6, "reason": "x"}, "insufficient_stock"),
        ({"movement_type": "ADJUSTMENT", "set_to": -1, "reason": "x"}, "insufficient_stock"),
    ],
)
def test_adjust_rules(kwargs, code):
    branch = make_branch()
    beans = make_product(stocked=True)
    make_stock(branch, beans, 5)
    with pytest.raises(DomainError) as exc:
        services.adjust_stock(branch, beans, actor=None, **kwargs)
    assert exc.value.detail.code == code
    assert StockItem.objects.get().quantity == 5
    assert not InventoryMovement.objects.exists()
    assert not AuditLog.objects.filter(action="inventory.adjust").exists()


def test_adjust_refuses_prepared_products():
    with pytest.raises(DomainError) as exc:
        services.adjust_stock(make_branch(), make_product(), delta=1, movement_type="RECEIPT", actor=None)
    assert exc.value.detail.code == "not_stock_managed" and exc.value.status_code == 409


def test_failed_adjust_does_not_leave_a_stock_row_behind():
    branch = make_branch()
    beans = make_product(stocked=True)
    with pytest.raises(DomainError):
        services.adjust_stock(branch, beans, delta=-1, movement_type="ADJUSTMENT", reason="x", actor=None)
    assert not StockItem.objects.exists()


@pytest.mark.django_db(transaction=True)
def test_concurrent_adjustments_never_go_negative():
    branch = make_branch()
    beans = make_product(stocked=True)
    make_stock(branch, beans, 3)
    barrier = threading.Barrier(6)
    outcomes: list[str] = []

    def worker():
        try:
            barrier.wait()
            services.adjust_stock(branch, beans, delta=-1, movement_type="WASTE", reason="spill", actor=None)
            outcomes.append("ok")
        except DomainError as exc:
            outcomes.append(exc.detail.code)
        finally:
            connection.close()

    threads = [threading.Thread(target=worker) for _ in range(6)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert outcomes.count("ok") == 3 and outcomes.count("insufficient_stock") == 3
    assert StockItem.objects.get(product=beans).quantity == 0

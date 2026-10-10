"""CSV export: content, streaming, Content-Disposition and spreadsheet-injection guard."""

import csv
import io
from decimal import Decimal as D

import pytest

from apps.orders.models import OrderItem
from apps.reports.csv_export import sanitize_cell

from .conftest import D_FROM, D_TO

pytestmark = pytest.mark.django_db

PARAMS = {"date_from": D_FROM.isoformat(), "date_to": D_TO.isoformat()}
REPORTS = [
    "sales",
    "orders-by-status",
    "products",
    "categories",
    "branches",
    "promotions",
    "payments",
    "refunds",
    "inventory",
    "customers",
]


def fetch(get, user, name, **params):
    r = get(user, f"admin/reports/{name}/", format="csv", **{**PARAMS, **params})
    assert r.status_code == 200, getattr(r, "content", b"")
    assert r.streaming
    body = b"".join(r.streaming_content).decode("utf-8")
    return r, body


def rows_of(body):
    assert body.startswith("﻿")
    return list(csv.reader(io.StringIO(body.lstrip("﻿"))))


def test_sales_csv_content_and_headers(world, get):
    r, body = fetch(get, world.users.admin, "sales")
    assert r["Content-Type"] == "text/csv; charset=utf-8"
    assert r["Content-Disposition"] == 'attachment; filename="sales_2026-09-01_to_2026-09-30.csv"'
    assert r["Cache-Control"] == "no-store"
    rows = rows_of(body)
    assert rows[0] == [
        "Date",
        "Orders",
        "Gross sales",
        "Discounts",
        "Delivery fees",
        "Tax",
        "Refunds",
        "Net sales",
        "Revenue collected",
        "Average order value",
    ]
    assert len(rows) == 1 + 30 + 1  # header, one per day (zero filled), total
    assert rows[1][0] == "2026-09-01" and rows[1][1] == "3"
    total = rows[-1]
    assert total[0] == "Total" and total[1] == "11" and total[2] == "154.25" and total[7] == "135.15"
    json_totals = get(world.users.admin, "admin/reports/sales/", **PARAMS).json()["totals"]
    assert total[7] == json_totals["net_sales"]


def test_filename_includes_branch_and_dates(world, get):
    r, _ = fetch(get, world.users.admin, "products", branch=world.b.pk, date_from="2026-09-05", date_to="2026-09-09")
    assert (
        r["Content-Disposition"] == f'attachment; filename="products_branch-{world.b.pk}_2026-09-05_to_2026-09-09.csv"'
    )


@pytest.mark.parametrize("name", REPORTS)
def test_every_report_exports(world, get, name):
    r, body = fetch(get, world.users.admin, name)
    rows = rows_of(body)
    assert len(rows) >= 2 and any(len(row) >= 3 for row in rows)
    assert name in r["Content-Disposition"] and "2026-09-01_to_2026-09-30" in r["Content-Disposition"]


def test_csv_export_is_not_paginated(world, get):
    _, body = fetch(get, world.users.admin, "products", page_size=1)
    rows = rows_of(body)
    assert len(rows) == 1 + 3 + 1  # header + all three products + total
    assert rows[-1][0] == "Total"


def test_formula_injection_is_neutralised(world, get):
    OrderItem.objects.filter(sku="COF-1").update(product_name='=HYPERLINK("http://evil","x")', category_name="@SUM(A1)")
    OrderItem.objects.filter(sku="BEA-1").update(product_name="+1+1", category_name="-2+3")
    OrderItem.objects.filter(sku="CAK-1").update(product_name="\t=cmd", category_name="Normal")
    _, body = fetch(get, world.users.admin, "products")
    cells = [c for row in rows_of(body) for c in row]
    assert '\'=HYPERLINK("http://evil","x")' in cells
    assert "'@SUM(A1)" in cells and "'+1+1" in cells and "'-2+3" in cells and "'\t=cmd" in cells
    assert not [c for c in cells if c.startswith(("=", "@", "+"))], "no cell may start like a formula"
    assert "Normal" in cells  # ordinary text untouched
    _, cat = fetch(get, world.users.admin, "categories")
    assert "'@SUM(A1)" in [c for row in rows_of(cat) for c in row]


def test_numbers_are_not_prefixed_but_text_with_minus_is(world, get):
    # inventory movement summary has a negative net (-21 for sales): a real number, written unprefixed
    _, body = fetch(get, world.users.admin, "inventory")
    cells = [c for row in rows_of(body) for c in row]
    assert "-21" in cells and "'-21" not in cells
    assert sanitize_cell("-5") == "'-5" and sanitize_cell(D("-5.00")) == "-5.00" and sanitize_cell(-5) == "-5"
    assert sanitize_cell(None) == "" and sanitize_cell(True) == "yes"


def test_customer_csv_only_contains_masked_contact_details(world, get):
    _, body = fetch(get, world.users.admin, "customers")
    assert "cust1@example.com" not in body and "c***@example.com" in body
    assert "+15550101111" not in body and "***11" in body
    rows = rows_of(body)
    assert ["Order frequency"] in rows and ["New vs returning"] in rows and ["Top customers by spend"] in rows


def test_csv_streams_in_chunks_not_one_string(world, get):
    r = get(world.users.admin, "admin/reports/sales/", format="csv", **PARAMS)
    chunks = list(r.streaming_content)
    assert len(chunks) > 10 and chunks[0].startswith("﻿".encode())


def test_refunds_csv_lists_both_sections(world, get):
    _, body = fetch(get, world.users.admin, "refunds")
    rows = rows_of(body)
    assert ["Refunds"] in rows and ["Cancelled orders"] in rows
    numbers = {row[0] for row in rows if row and row[0].startswith("T-")}
    assert len(numbers) == 3


def test_csv_export_is_logged_without_pii(world, get, caplog):
    import logging

    with caplog.at_level(logging.INFO, logger="apps.reports.views"):
        fetch(get, world.users.admin, "sales")
    rec = [r for r in caplog.records if r.getMessage() == "report export"]
    assert rec and rec[0].report == "sales" and rec[0].user_id == world.users.admin.pk

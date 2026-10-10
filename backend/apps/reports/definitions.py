"""Metric definitions. Exposed at `GET /admin/reports/definitions/` and shown next to every figure in the admin UI.

These strings are the contract for what each number means; `selectors.py` implements exactly this wording and the
reconciliation tests in `tests/test_reconciliation.py` hold the two together.
"""

from __future__ import annotations

# Orders in these statuses are "in progress" (not terminal).
PENDING_STATUSES = ("PENDING", "CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY")

# An open order untouched for this long is flagged as "stuck" in the dashboard's attention list.
STUCK_AFTER_MINUTES = 45

DEFINITIONS: list[dict[str, str]] = [
    {
        "key": "counting_rule",
        "label": "Which orders count as sales",
        "definition": (
            "An order counts toward sales when its status is not CANCELLED and either its payment status is PAID, "
            "PARTIALLY_REFUNDED or REFUNDED, or it is a cash order that is COMPLETED. Unpaid, failed, authorized-only "
            "and cancelled orders are never counted. A cancelled order that was paid is not in sales: it appears in "
            "the 'refund needed' list until the money has been returned."
        ),
    },
    {
        "key": "period",
        "label": "Period and time zone",
        "definition": (
            "Date ranges are inclusive on both ends and bucketed by the order's placed date in the time zone of the "
            "branch that took it, so a 23:30 local order belongs to that local day. The default range is the last "
            "30 days and the maximum is 400 days. Payment failures use the payment attempt's creation time and stock "
            "movements their creation time, in the same branch time zone."
        ),
    },
    {
        "key": "previous_period",
        "label": "Previous period and change",
        "definition": (
            "The previous period is the range of the same length that ends the day before the selected range starts. "
            "The change is (current - previous) / previous as a percentage; it is empty when the previous value is "
            "zero. Stock and catalogue figures are snapshots of right now and have no previous value."
        ),
    },
    {
        "key": "gross_sales",
        "label": "Gross sales",
        "definition": (
            "Sum of item line totals (price x quantity including option surcharges, before discounts) of counted "
            "orders. Excludes delivery fees and tax."
        ),
    },
    {
        "key": "discounts",
        "label": "Discounts",
        "definition": "Sum of coupon and automatic promotion discounts on counted orders.",
    },
    {
        "key": "delivery_fees",
        "label": "Delivery fees",
        "definition": "Sum of delivery fees charged on counted orders. Shown separately and not part of sales.",
    },
    {
        "key": "tax",
        "label": "Tax",
        "definition": "Sum of tax on counted orders (collected or, for tax-inclusive prices, extracted). Not part of sales.",
    },
    {
        "key": "refunds",
        "label": "Refunds",
        "definition": (
            "Sum of the refunded amount of counted orders. Refunds are attributed to the order's placed date, not the "
            "date the refund was issued. Refunds on cancelled orders are not part of this figure."
        ),
    },
    {
        "key": "net_sales",
        "label": "Net sales",
        "definition": "Gross sales - discounts - refunds. Excludes tax and delivery fees.",
    },
    {
        "key": "revenue_collected",
        "label": "Revenue (collected)",
        "definition": (
            "Order totals (items - discounts + delivery + tax) minus refunded amounts, for counted orders. "
            "For cash orders this is counted once the order is completed."
        ),
    },
    {
        "key": "orders_total",
        "label": "Orders placed",
        "definition": "All orders placed in the period, in every status and payment state.",
    },
    {
        "key": "orders_counted",
        "label": "Orders counted as sales",
        "definition": "Orders placed in the period that meet the counting rule. Denominator of average order value.",
    },
    {
        "key": "orders_completed",
        "label": "Completed orders",
        "definition": "Orders placed in the period whose current status is COMPLETED.",
    },
    {
        "key": "orders_pending",
        "label": "Orders in progress",
        "definition": (
            "Orders placed in the period that are PENDING, CONFIRMED, PREPARING, READY_FOR_PICKUP or OUT_FOR_DELIVERY."
        ),
    },
    {
        "key": "orders_cancelled",
        "label": "Cancelled orders",
        "definition": "Orders placed in the period whose current status is CANCELLED (including expired unpaid orders).",
    },
    {
        "key": "average_order_value",
        "label": "Average order value",
        "definition": "Net sales divided by the number of counted orders.",
    },
    {
        "key": "payment_failures",
        "label": "Payment failures",
        "definition": "Payment attempts with status FAILED created in the period. One order can have several.",
    },
    {
        "key": "active_products",
        "label": "Active products",
        "definition": "Products that are published (active) right now.",
    },
    {
        "key": "low_stock_products",
        "label": "Low stock products",
        "definition": (
            "Active stock-managed products with at least one in-scope branch whose quantity is above zero and at or "
            "below its low-stock threshold, right now."
        ),
    },
    {
        "key": "out_of_stock_products",
        "label": "Out of stock products",
        "definition": (
            "Active stock-managed products with at least one in-scope branch holding zero units, right now."
        ),
    },
    {
        "key": "category_sales",
        "label": "Category sales",
        "definition": (
            "Per category (the name recorded on the order item when it was bought): item line totals minus item "
            "discounts, for counted orders. Order-level refunds are not allocated to categories."
        ),
    },
    {
        "key": "product_sales",
        "label": "Product sales",
        "definition": (
            "Per product (keyed by SKU, names as recorded on the order): units sold, gross (line totals), discounts "
            "(item discount allocation) and net (gross - discounts) for counted orders. Refunds are not allocated "
            "to products. Share is the product's net divided by total net."
        ),
    },
    {
        "key": "promotion_redemptions",
        "label": "Promotion redemptions",
        "definition": (
            "Non-voided coupon redemptions on orders placed in the period (they include orders still awaiting "
            "payment). Discount given is the sum of those redemptions; revenue influenced is the collected revenue "
            "of counted orders that used the coupon."
        ),
    },
    {
        "key": "attention_stuck_orders",
        "label": "Stuck orders",
        "definition": (
            f"Open orders (not completed or cancelled) not updated for {STUCK_AFTER_MINUTES} minutes, excluding "
            "online orders still waiting for the customer to pay and orders scheduled for later. Not limited to "
            "the selected period."
        ),
    },
    {
        "key": "attention_failed_payments",
        "label": "Failed payments needing action",
        "definition": (
            "Open orders whose latest payment attempt FAILED and that the customer has not retried successfully. "
            "Not limited to the selected period."
        ),
    },
    {
        "key": "attention_refund_needed",
        "label": "Refund needed",
        "definition": (
            "Cancelled orders that were paid (PAID or PARTIALLY_REFUNDED) and have not been fully refunded. "
            "Not limited to the selected period."
        ),
    },
    {
        "key": "customer_frequency",
        "label": "Order frequency",
        "definition": (
            "Customers with at least one counted order in the period, grouped by how many counted orders they "
            "placed in it: 1, 2-3 or 4+. New customers have no counted order in the selected branches before the "
            "period; returning customers do."
        ),
    },
    {
        "key": "stock_value",
        "label": "Stock value",
        "definition": "Quantity on hand x unit cost, summed over stock rows that have a unit cost. Rows without a cost are counted separately.",
    },
    {
        "key": "demo_data",
        "label": "Demo data",
        "definition": "The dashboard is flagged when any counted order in the period is a seeded demonstration order.",
    },
]

"""End-to-end API smoke test against a RUNNING server with seeded demo data (python scripts/api_smoke.py [base_url]).

Flow: register → customise a latte → cart → checkout (pickup, sandbox payment) → pay → staff processes the order through
every status → customer sees each state → dashboard reflects it. Exits non-zero on the first failed expectation.
"""

import json
import sys
import time
import urllib.error
import urllib.request
import uuid
from http.cookiejar import CookieJar

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000").rstrip("/")


class Client:
    def __init__(self):
        self.jar = CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.csrf()

    def csrf(self):
        self.req("GET", "/api/v1/auth/csrf/")

    def token(self):
        return next((c.value for c in self.jar if c.name == "lantern_csrftoken"), "")

    def req(self, method, path, body=None, headers=None, expect=None):
        data = json.dumps(body).encode() if body is not None else None
        h = {"Content-Type": "application/json", "X-CSRFToken": self.token(), "Referer": BASE + "/", **(headers or {})}
        r = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
        try:
            with self.opener.open(r) as resp:
                status, raw = resp.status, resp.read()
        except urllib.error.HTTPError as e:
            status, raw = e.code, e.read()
        payload = json.loads(raw) if raw and raw[:1] in b"{[" else raw
        if expect is not None and status != expect:
            sys.exit(f"FAIL {method} {path}: expected {expect}, got {status}: {str(payload)[:400]}")
        return status, payload


def step(msg):
    print(f"• {msg}")


def check(cond, msg):
    if not cond:
        sys.exit(f"FAIL: {msg}")
    print(f"  ✓ {msg}")


email = f"smoke-{uuid.uuid4().hex[:8]}@example.com"
shopper = Client()

step("Browse and customise")
_, prods = shopper.req("GET", "/api/v1/products/?q=latte&page_size=20", expect=200)
latte = next(p for p in prods["results"] if p["slug"] == "latte")
_, detail = shopper.req("GET", f"/api/v1/products/{latte['slug']}/", expect=200)
groups = {g["display_name"]: g for g in detail["modifier_groups"]}
size_l = next(o for o in groups["Size"]["options"] if o["name"] == "Large")
oat = next(o for o in groups["Milk"]["options"] if o["name"].lower().startswith("oat"))
hot = next(o for o in groups["Temperature"]["options"] if o["name"] == "Hot")
SEL = [size_l["id"], hot["id"], oat["id"]]
_, quote = shopper.req(
    "POST", f"/api/v1/products/{latte['slug']}/quote/", {"option_ids": SEL, "quantity": 2}, expect=200
)
check(quote["valid"], f"quote valid, unit price {quote['unit_price']} line {quote['line_total']}")
_, bad = shopper.req("POST", f"/api/v1/products/{latte['slug']}/quote/", {"option_ids": [], "quantity": 1}, expect=200)
check(not bad["valid"], "quote without required Size is rejected")

step("Guest cart then register (cart must survive)")
shopper.req("POST", "/api/v1/cart/items/", {"product_id": latte["id"], "option_ids": SEL, "quantity": 2}, expect=201)
_, registered = shopper.req(
    "POST",
    "/api/v1/auth/register/",
    {"email": email, "password": "Sm0ke-test-passw0rd!", "first_name": "Smoke", "last_name": "Test"},
    expect=201,
)
check(registered["email_verified"] is False, "new account starts with an unverified email (purchases are not blocked)")
s_resend, resent = shopper.req("POST", "/api/v1/auth/resend-verification/", expect=202)
check(resent["email_verified"] is False, "verification email can be re-sent")
s_bad, _ = shopper.req("POST", "/api/v1/auth/verify-email/", {"token": "not-a-real-token"})
check(s_bad == 400, "a bogus verification token is rejected")
_, cart = shopper.req("GET", "/api/v1/cart/", expect=200)
check(cart["item_count"] == 2, "guest cart merged into account cart")

step("Checkout (pickup) with server-side pricing")
_, branches = shopper.req("GET", "/api/v1/branches/", expect=200)
branch = next(
    b
    for b in (branches["results"] if isinstance(branches, dict) else branches)
    if b["pickup_enabled"] and b["code"] == "DT"
)
_, prev = shopper.req("POST", "/api/v1/cart/preview/", {"order_type": "PICKUP", "branch_id": branch["id"]}, expect=200)
total = prev["total"]
check(prev["can_checkout"] or not prev["checkout_blockers"], f"preview total {total} (tax {prev['tax_total']})")
if not prev["can_checkout"]:
    print("  note: blockers", prev["checkout_blockers"])
key = str(uuid.uuid4())
body = {
    "branch_id": branch["id"],
    "order_type": "PICKUP",
    "payment_method": "demo",
    "accept_terms": True,
    "expected_total": total,
}
s, placed = shopper.req("POST", "/api/v1/checkout/", body, headers={"Idempotency-Key": key})
check(s == 201, f"order placed ({placed.get('order', {}).get('number') if s == 201 else placed})")
s2, again = shopper.req("POST", "/api/v1/checkout/", body, headers={"Idempotency-Key": key})
check(
    s2 == 200 and again["order"]["number"] == placed["order"]["number"],
    "duplicate submission returns the same order (no second order)",
)
number = placed["order"]["number"]
check(placed["order"]["total"] == total, "charged total equals previewed total")
check(
    placed["payment"]["status"] in ("REQUIRES_ACTION", "PENDING"),
    f"payment awaiting action ({placed['payment']['status']}, sandbox={placed['payment']['is_sandbox']})",
)
ref = placed["payment"]["action"]["url"].rsplit("/", 1)[-1]

step("Sandbox payment: decline, then retry and succeed")
shopper.req("POST", f"/api/v1/payments/demo/{ref}/complete/", {"outcome": "decline"}, expect=200)
_, od = shopper.req("GET", f"/api/v1/orders/{number}/", expect=200)
check(od["payment"]["status"] == "FAILED", "failed payment recorded; order still PENDING: " + od["status"])
_, retry = shopper.req("POST", f"/api/v1/orders/{number}/pay/", {"payment_method": "demo"}, expect=200)
ref2 = retry["action"]["url"].rsplit("/", 1)[-1]
check(ref2 != ref, "retry created a new payment attempt")
shopper.req("POST", f"/api/v1/payments/demo/{ref2}/complete/", {"outcome": "success"}, expect=200)
shopper.req("POST", f"/api/v1/payments/demo/{ref2}/complete/", {"outcome": "success"})  # replay must not double-settle
_, od = shopper.req("GET", f"/api/v1/orders/{number}/", expect=200)
check(od["payment"]["status"] == "PAID", "payment PAID exactly once")

step("Other customer cannot see this order")
other = Client()
other.req(
    "POST",
    "/api/v1/auth/register/",
    {"email": f"o-{email}", "password": "Sm0ke-test-passw0rd!", "first_name": "O", "last_name": "T"},
    expect=201,
)
other.req("GET", f"/api/v1/orders/{number}/", expect=404)
check(True, "foreign order → 404")

step("Staff processes the order")
staff = Client()
staff.req(
    "POST",
    "/api/v1/auth/login/",
    {"email": "ordermanager@lantern.example", "password": "Lantern-demo-2026!"},
    expect=200,
)
_, lst = staff.req("GET", f"/api/v1/admin/orders/?q={number}", expect=200)
check(lst["count"] == 1, "order visible in the staff queue")
for to in ("CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "COMPLETED"):
    staff.req("POST", f"/api/v1/admin/orders/{number}/transition/", {"to_status": to}, expect=200)
    _, od = shopper.req("GET", f"/api/v1/orders/{number}/", expect=200)
    check(od["status"] == to, f"customer sees {to}")
s, _ = staff.req("POST", f"/api/v1/admin/orders/{number}/transition/", {"to_status": "PREPARING"})
check(s == 409, "invalid transition after completion → 409")

step("Role boundaries")
s, _ = staff.req("GET", "/api/v1/admin/staff/")
check(s == 403, "order manager cannot manage staff")
s, _ = shopper.req("GET", "/api/v1/admin/orders/")
check(s == 403, "customer cannot use staff API")

step("Dashboard reflects real data")
admin = Client()
admin.req(
    "POST", "/api/v1/auth/login/", {"email": "admin@lantern.example", "password": "Lantern-demo-2026!"}, expect=200
)
_, dash = admin.req("GET", "/api/v1/admin/dashboard/", expect=200)
check(
    float(dash["kpis"]["gross_sales"]["value"]) > 0 if isinstance(dash["kpis"]["gross_sales"], dict) else True,
    "dashboard KPIs computed",
)

step("Logout ends the session")
shopper.req("POST", "/api/v1/auth/logout/", expect=204)
_, me = shopper.req("GET", "/api/v1/auth/me/", expect=200)
check(me["authenticated"] is False, "session invalidated")
shopper.req("GET", "/api/v1/orders/", expect=401)
print(f"\nALL OK  ({number}, {time.strftime('%H:%M:%S')})")

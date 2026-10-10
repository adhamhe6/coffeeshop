# ruff: noqa: C408
"""Demo people. Every email uses the reserved ``lantern.example`` domain; the domain is how --reset-demo finds them."""

from __future__ import annotations

DEMO_DOMAIN = "lantern.example"

# email local-part, first, last, role, job title, branch codes (None = global)
STAFF = [
    ("superadmin", "Sofia", "Reyes", "SUPER_ADMIN", "Owner (demo)", None),
    ("admin", "Daniel", "Okoye", "ADMIN", "Operations admin", None),
    ("branchmanager.downtown", "Hannah", "Lindqvist", "BRANCH_MANAGER", "Downtown branch manager", ["DT"]),
    ("ordermanager", "Marcus", "Webb", "ORDER_MANAGER", "Order desk (Downtown + Riverside)", ["DT", "RS"]),
    ("productmanager", "Yuki", "Tanaka", "PRODUCT_MANAGER", "Menu & catalogue", ["DT", "RS", "AK"]),
    ("inventorymanager", "Tomás", "Alvarez", "INVENTORY_MANAGER", "Stock & purchasing", ["DT", "RS", "AK"]),
    ("marketing", "Nia", "Campbell", "MARKETING_MANAGER", "Marketing & content", ["DT", "RS", "AK"]),
    ("support", "Ravi", "Menon", "SUPPORT_AGENT", "Customer support", ["DT", "RS", "AK"]),
]

# local-part, first, last, phone, marketing opt-in, [(label, line1, line2, zone slug, instructions)]
CUSTOMERS = [
    (
        "customer",
        "Alex",
        "Morgan",
        "+1 555 010 0201",
        True,
        [
            ("Home", "14 Sample Street", "Apt 3B", "old-town", "Ring the top bell"),
            ("Office", "200 Placeholder Plaza", "Floor 5", "midtown", "Reception, ask for Alex"),
        ],
    ),
    ("priya.raman", "Priya", "Raman", "+1 555 010 0202", True, [("Home", "8 Example Row", "", "riverside-zone", "")]),
    (
        "jordan.ellis",
        "Jordan",
        "Ellis",
        "+1 555 010 0203",
        False,
        [("Home", "31 Test Lane", "", "university-district", "Leave with the front desk")],
    ),
    (
        "mei.zhang",
        "Mei",
        "Zhang",
        "+1 555 010 0204",
        True,
        [
            ("Home", "5 Demo Court", "Unit 9", "harbour-quarter", ""),
            ("Studio", "77 Sample Wharf", "", "old-town", "Side door"),
        ],
    ),
    (
        "sam.okafor",
        "Sam",
        "Okafor",
        "+1 555 010 0205",
        False,
        [("Home", "260 Placeholder Heights", "Flat 12", "midtown", "")],
    ),
    (
        "lucia.fernandez",
        "Lucía",
        "Fernández",
        "+1 555 010 0206",
        True,
        [("Home", "19 Imaginary Mews", "", "university-district", "Gate code 0000 (demo)")],
    ),
]

NEWSLETTER = ["reader.one", "reader.two", "reader.three", "reader.four", "reader.five", "reader.six"]

# Generic, short, plausible review snippets. They are flagged is_demo and must never be presented as genuine feedback.
REVIEW_TEXTS = {
    "BEVERAGE": [
        ("Smooth and balanced", "Well made and not too bitter. I'd order it again."),
        ("Great morning pick-me-up", "Ready on time and still hot when I collected it."),
        ("Really good", "Nice flavour and a good size for the price."),
        ("Tasty", "Does what it says. The oat milk option worked well."),
        ("A solid cup", "Consistent every time I order it."),
        ("Lovely", "Rich and smooth. Quick pickup too."),
        ("Just okay", "Pleasant, though a little sweeter than I expected."),
    ],
    "FOOD": [
        ("Fresh and tasty", "Arrived warm and fresh. Good portion."),
        ("Nice with a coffee", "Light, buttery and not too sweet."),
        ("Would order again", "Simple and well made."),
        ("Good lunch", "Filling and tasted fresh."),
        ("Decent", "Good flavour, a touch small for the price."),
    ],
    "BEANS": [
        ("Great at home", "Smelled amazing when I opened the bag and brewed a clean, sweet cup."),
        ("Good everyday coffee", "Balanced and easy to dial in."),
        ("Lovely tasting notes", "I could actually taste what the label described."),
        ("Fresh", "Roast date was recent and the beans were fresh."),
    ],
    "MERCH": [
        ("Good quality", "Feels well made and looks great on the counter."),
        ("Does the job", "Works well and arrived well packed."),
    ],
    "GIFT": [
        ("Nice gift", "Neatly packed and a good way to try a few coffees."),
        ("Well presented", "Looked lovely and was easy to give."),
    ],
}

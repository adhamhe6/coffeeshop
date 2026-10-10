# ruff: noqa: C408
"""Storefront content seeded for the demo: store settings, social links, pages, homepage blocks, announcement.

Legal pages are TEMPLATES (clearly marked) — they must be replaced with text reviewed by counsel before launch.
"""

from __future__ import annotations

STORE = dict(
    brand_name="Lantern Coffee Roasters",
    tagline="Slow-roasted. Carefully poured.",
    legal_name="[Legal entity name — placeholder]",
    currency="USD",
    support_email="hello@lantern.example",
    support_phone="+1 555 010 0100",
    business_address="100 Placeholder Avenue, Harbour City (replace with the registered business address)",
    # PLACEHOLDER: the owner must confirm the legally correct rate (and whether prices include tax) before launch.
    tax_rate="8.00",
    tax_label="Sales tax (demo rate)",
    prices_include_tax=False,
    enable_reviews=True,
    ordering_enabled=True,
    allowed_checkout_methods=["stripe", "demo", "cash"],
)

# https://social.example/... — obviously placeholder; flagged is_placeholder=True so the admin shows "replace before launch".
SOCIAL = [
    ("instagram", "https://social.example/lantern-instagram", "@your-instagram-handle", 10),
    ("tiktok", "https://social.example/lantern-tiktok", "@your-tiktok-handle", 20),
    ("facebook", "https://social.example/lantern-facebook", "Lantern Coffee Roasters", 30),
    ("youtube", "https://social.example/lantern-youtube", "@your-youtube-channel", 40),
    ("pinterest", "https://social.example/lantern-pinterest", "your-pinterest-board", 50),
]

ANNOUNCEMENT = dict(
    message="New here? Use code WELCOME10 for 10% off your first order (min $8).",
    link_url="/menu",
)

ABOUT = """\
## Coffee worth slowing down for

Lantern Coffee Roasters is a small roastery and café group built around one idea: good coffee should feel unhurried.
We buy carefully, roast in small batches and pour every cup by hand.

### What we do

- **Roast** — Every coffee on the shelf is roasted in small batches and bagged to order.
- **Brew** — Our bars serve espresso, filter and cold brew made from the same beans you can take home.
- **Bake** — Pastries, cakes and savoury bites arrive fresh each morning.

### How we buy

We work with importers and producers across Ethiopia, Colombia, Kenya and Brazil and describe each coffee honestly:
origin, process, roast level and tasting notes are printed on every bag. We don't make claims we can't back up — if a
detail matters to you, ask us and we'll tell you what we know.

### Visit us

Find your nearest café on the [Locations](/locations) page. Order ahead for pickup, or have your order delivered where
we deliver. Questions? See the [FAQ](/faq) or [contact us](/contact).

> *This page is editable from the admin dashboard (Content → Pages). Replace it with your own story.*
"""

FAQ = """\
## Ordering

**Do I need an account to order?**
You can browse the menu and build a basket without an account. You'll be asked to sign in or create one at checkout so
we can save your order history and send updates.

**Can I customise my drink?**
Yes. Choose a size, milk, syrups, extra shots and more on each product page. The price updates as you choose, and the
final price is always confirmed at checkout.

**Can I order for later?**
Yes. Pick a time slot (in 15-minute steps, up to seven days ahead) when you check out, or choose *As soon as possible*.

**How do coupon codes work?**
Enter a code at checkout. One code applies per order, and codes can have a minimum spend, an expiry date or a usage
limit. Some offers apply automatically when your basket qualifies.

## Pickup and delivery

**How does pickup work?**
Choose a café, pick a time and we'll start preparing your order. You'll get a notification when it's ready.

**Where do you deliver?**
Delivery is available from selected cafés to selected neighbourhoods. Enter or choose an address at checkout to see the
delivery fee, minimum order and estimated time for your area. Some areas qualify for free delivery over a set amount.

**Can I change or cancel my order?**
You can cancel an order yourself while it is still *Pending*. After we've accepted it we've started work, so please
contact the café. Cancelling does not automatically refund a payment — see *Refunds* below.

## Allergens and dietary needs

**Where can I find allergen information?**
Every product page lists the main allergens it contains (such as milk, gluten, egg, nuts or sesame). Our kitchens handle
all of these, so we can't guarantee any item is free from traces. If you have a severe allergy, please speak to us before
ordering.

**Do you have dairy-free options?**
Most milk drinks can be made with oat, almond or soy milk. Look for the *oat-friendly* tag.

## Payments

**How can I pay?**
Depending on the café you can pay by card (through a secure hosted payment page from our payment provider — we never see
or store your card details), or choose *pay at pickup / on delivery* where available. In this demo environment card and
sandbox payments run in test mode and no real money moves.

**Why was my payment declined?**
Your bank may have declined the transaction. You can try again from your order page or choose another payment method.

## Refunds

**How do refunds work?**
If something isn't right, contact us with your order number. Approved refunds go back to the original payment method.
See our [Refund policy](/refund-policy).

## Still stuck?

Email [hello@lantern.example](mailto:hello@lantern.example) or visit the [Contact](/contact) page.
"""

PRIVACY = """\
## Privacy policy

> **[Template — replace with legal text reviewed by counsel]**
> This page is a placeholder. It describes, in plain language, what a typical storefront like this does with data. It is
> **not** legal advice and must be replaced with a policy that matches your business, your jurisdiction and your actual
> processing before you launch.

### What we collect (plain-language summary)

- **Account details** — name, email address, optional phone number and delivery addresses.
- **Order details** — items, times, totals, payment method and status.
- **Technical data** — basic logs needed to keep the service secure and working.

Card details are entered on our payment provider's hosted page and are **not** stored on our servers.

### Why we use it

To take and fulfil orders, send order updates, provide support, prevent fraud and meet legal obligations. Marketing
emails are sent only if you opt in.

### [Template — replace with legal text reviewed by counsel]

- Legal bases for processing
- Retention periods
- Your rights and how to exercise them
- International transfers and processors
- Contact details of the data controller
"""

TERMS = """\
## Terms of service

> **[Template — replace with legal text reviewed by counsel]**
> This page is a placeholder and not legal advice.

### Using this site (plain-language summary)

- Prices are shown in the store currency and the final total, including any tax and delivery fee, is confirmed at checkout.
- We may decline or cancel an order we can't fulfil (for example if an item is unavailable). If we do, you won't be charged,
  or you'll be refunded.
- Please give accurate contact and delivery details.
- Product images are illustrations and may differ slightly from the item you receive.

### [Template — replace with legal text reviewed by counsel]

- Contract formation and acceptance of orders
- Limitation of liability
- Intellectual property
- Governing law and disputes
- Changes to these terms
"""

REFUND = """\
## Refund and cancellation policy

> **[Template — replace with legal text reviewed by counsel]**
> The summary below describes how the platform behaves; the binding wording must come from your own reviewed policy.

### Cancelling an order

- You can cancel an order yourself while its status is **Pending**.
- Once an order is accepted and being prepared, please contact the café — we'll do our best but can't promise to stop it.
- Cancelling an order does **not** by itself return money. A refund is a separate step we make once we've verified the payment.

### Refunds

- Approved refunds are returned to the original payment method. Partial refunds are possible (for example for a missing
  or incorrect item).
- Orders paid in cash at pickup or on delivery are refunded at the café.

### [Template — replace with legal text reviewed by counsel]

- Statutory consumer rights
- Time limits for requests
- Expected processing times for card refunds
- Perishable goods and hygiene exceptions
"""

CONTACT = """\
## Get in touch

- **Email:** [hello@lantern.example](mailto:hello@lantern.example)
- **Phone:** +1 555 010 0100
- **Address:** 100 Placeholder Avenue, Harbour City *(placeholder — replace)*

For order questions please include your order number (it looks like `DT-261010-0042`) so we can find it quickly.

Looking for opening hours or a delivery area? See the [Locations](/locations) page, or the [FAQ](/faq).

> *Contact details on this page are demo placeholders and are editable from the admin dashboard.*
"""

PAGES = [
    dict(
        slug="about", title="About Lantern", summary="Small-batch roasters and café-bars pouring carefully.", body=ABOUT
    ),
    dict(
        slug="faq",
        title="Frequently asked questions",
        summary="Ordering, pickup, delivery, allergens, payments and refunds.",
        body=FAQ,
    ),
    dict(
        slug="privacy",
        title="Privacy policy",
        summary="Template — to be replaced with a counsel-reviewed policy.",
        body=PRIVACY,
    ),
    dict(
        slug="terms",
        title="Terms of service",
        summary="Template — to be replaced with counsel-reviewed terms.",
        body=TERMS,
    ),
    dict(
        slug="refund-policy",
        title="Refund & cancellation policy",
        summary="Template — to be replaced with a counsel-reviewed policy.",
        body=REFUND,
    ),
    dict(slug="contact", title="Contact us", summary="How to reach the Lantern team.", body=CONTACT),
]

BLOCKS = [
    dict(
        key="home.hero",
        eyebrow="Small-batch roasters",
        title="Slow-roasted. Carefully poured.",
        body="Single origins and house blends roasted in small batches, poured by hand and ready for pickup or delivery.",
        cta_label="Order from the menu",
        cta_url="/menu",
        image="hero",
    ),
    dict(
        key="home.story",
        eyebrow="Our story",
        title="Coffee worth slowing down for",
        body="We started with a simple idea: a good cup is a small pause in a busy day. So we roast in small batches, brew with care and keep the menu honest.",
        cta_label="Read our story",
        cta_url="/about",
        image="story",
    ),
    dict(
        key="home.sourcing",
        eyebrow="Sourcing",
        title="Single origins, honestly described",
        body="Every bag lists the origin, process, roast level and tasting notes — so you know what you're buying and what to expect in the cup.",
        cta_label="Shop coffee beans",
        cta_url="/menu/coffee-beans",
        image="sourcing",
    ),
    dict(
        key="home.craft",
        eyebrow="Roasting",
        title="Roasted in small batches",
        body="Smaller batches mean closer attention. We roast, rest and bag to order so your beans arrive at their best.",
        cta_label="Find a café",
        cta_url="/locations",
        image="craft",
    ),
    dict(
        key="home.loyalty",
        eyebrow="For regulars",
        title="Make it yours, every time",
        body="Create a free account to save your favourites and delivery addresses and to reorder in a couple of taps. Keep an eye on the announcement bar and our newsletter for coupon codes.",
        cta_label="Create an account",
        cta_url="/register",
        image=None,
    ),
    dict(
        key="home.newsletter",
        eyebrow="Newsletter",
        title="New roasts, first",
        body="A short note when a new coffee lands or a seasonal drink arrives. No spam, unsubscribe any time.",
        cta_label="",
        cta_url="",
        image=None,
    ),
]

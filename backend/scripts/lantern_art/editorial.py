# ruff: noqa: C408, S311  (illustration code: dict() keyword style and seeded, non-cryptographic randomness are intentional)
"""Wide editorial images: category covers, collection banners, homepage hero, brand story / sourcing / roasting, OG card, logo."""

from __future__ import annotations

import math
import random

from PIL import Image

from .canvas import Canvas, Grad, bez, darken, grain, hexc, lighten, mix, vignette
from .gear import txt
from .palette import COFFEE, COPPER, CREAM, ESPRESSO, PARCHMENT, SAGE
from .props import backdrop, bean, lantern
from .scenes import render_subject


def _arts():
    from apps.core.seed.catalog_data import PRODUCTS

    return {p["name"]: p["art"] for p in PRODUCTS}


CATEGORY_ITEMS = {
    "espresso": ["Doppio", "Espresso", "Espresso Macchiato"],
    "milk-coffee": ["Cappuccino", "Latte", "Flat White"],
    "filter-cold-brew": ["Cold Brew", "V60 Pour-Over", "Nitro Cold Brew"],
    "iced-blended": ["Iced Latte", "Mocha Frappe", "Iced Americano"],
    "tea-matcha": ["Earl Grey", "Matcha Latte", "Iced Matcha Latte"],
    "hot-chocolate-chai": ["Spiced Chai Latte", "Classic Hot Chocolate", "Salted Caramel Hot Chocolate"],
    "seasonal": ["Spiced Orange Mocha", "Maple Cinnamon Latte", "Pumpkin Brûlée Latte"],
    "pastries": ["Almond Croissant", "Butter Croissant", "Cinnamon Swirl"],
    "cakes-desserts": ["Carrot Cake", "Basque Cheesecake", "Chocolate Torte"],
    "savoury-bites": ["Avocado Sourdough Toast", "Egg & Cheddar Brioche", "Caprese Ciabatta"],
    "coffee-beans": ["Ethiopia Guji", "Lantern House Blend", "Colombia Huila"],
    "equipment-merch": ["Gooseneck Kettle", "Ceramic Pour-Over Dripper", "Canvas Tote Bag"],
    "gift-sets-bundles": ["Discovery Trio"],
}

COLLECTION_ITEMS = {
    "bestsellers": ["Butter Croissant", "Cold Brew", "Latte", "Cappuccino", "Lantern House Blend"],
    "new-arrivals": ["Ristretto", "Cold Brew Tonic", "V60 Pour-Over", "Cardamom Knot", "Kenya Nyeri"],
    "seasonal-menu": [
        "Spiced Apple Cider",
        "Maple Cinnamon Latte",
        "Pumpkin Brûlée Latte",
        "Spiced Orange Mocha",
        "Carrot Cake",
    ],
    "signature-drinks": ["Matcha Latte", "Nitro Cold Brew", "Flat White", "Cold Brew Tonic", "Spiced Orange Mocha"],
    "for-the-coffee-lover": [
        "Gooseneck Kettle",
        "Ethiopia Guji",
        "Ceramic Pour-Over Dripper",
        "Kenya Nyeri",
        "Hand Burr Grinder",
    ],
}


def category_image(slug: str, tint: str, seed: int) -> Image.Image:
    c = Canvas(1200, 800, 2)
    backdrop(c, tint, 0.74, True, seed)
    arts = _arts()
    names = CATEGORY_ITEMS[slug]
    if len(names) == 1:
        render_subject(c, arts[names[0]], 600, 706, 0.95, seed)
    else:
        layout = [(255, 640, 0.46), (945, 640, 0.46), (600, 706, 0.62)]
        order = [0, 2, 1]  # sides first, hero last
        for i in order:
            x, by, m = layout[i]
            render_subject(c, arts[names[i]], x, by, m, seed + i)
    return grain(c.render(), seed + 7)


def collection_image(slug: str, tint: str, seed: int) -> Image.Image:
    c = Canvas(1600, 700, 2)
    backdrop(c, tint, 0.76, False, seed)
    # string of lanterns across the top
    pts = bez((0, 40), (500, 130), (1100, 130), (1600, 40), 60)
    c.fill(c.line(pts, 3), ESPRESSO, 0.7)
    for k in range(7):
        t = (k + 0.5) / 7
        x, y = pts[int(t * 60)]
        c.fill(c.line([(x, y), (x, y + 24)], 2), ESPRESSO, 0.7)
        lantern(c, x, y + 20, 0.2, frame=ESPRESSO, glass="#F6C26A", glow=True, lit=0.8)
    arts = _arts()
    names = COLLECTION_ITEMS[slug]
    layout = [(215, 626, 0.4), (1385, 626, 0.4), (505, 640, 0.5), (1095, 640, 0.5), (800, 668, 0.62)]
    for i, (x, by, m) in enumerate(layout):
        render_subject(c, arts[names[i]], x, by, m, seed + i)
    return grain(c.render(), seed + 9)


# ------------------------------------------------------------------------------------------------------ shared bits


def _bricks(c: Canvas, x0, y0, x1, y1, base="#3A2418", seed=1, alpha=0.5):
    rng = random.Random(seed)
    for row in range(int((y1 - y0) / 30)):
        y = y0 + row * 30
        off = 0 if row % 2 == 0 else 45
        for k in range(-1, int((x1 - x0) / 90) + 2):
            x = x0 + off + k * 90
            xa, xb = max(x + 3, x0), min(x + 87, x1)
            if xb > xa:
                c.fill(
                    c.rrect(xa, y + 3, xb, y + 27, 2),
                    lighten(base, rng.uniform(-0.05, 0.12))
                    if rng.random() < 0.6
                    else darken(base, rng.uniform(0, 0.15)),
                    alpha,
                )


def _sack(c: Canvas, x, by, s=1.0, tilt=0.0, seed=1):
    rng = random.Random(seed)
    W_, H_ = 210 * s, 250 * s
    pts_l, pts_r = [], []
    for i in range(25):
        t = i / 24
        y = by - H_ + H_ * t
        bulge = math.sin(math.pi * min(t * 1.1, 1.0)) ** 0.7 * 22 * s
        half = (0.55 + 0.45 * t) * W_ / 2 + bulge * 0.4
        pts_l.append((x - half + tilt * (1 - t) * 20, y))
        pts_r.append((x + half + tilt * (1 - t) * 20, y))
    body = c.poly(pts_l + pts_r[::-1])
    c.shadow(c.ellipse(x, by, W_ * 0.6, 18 * s), 0, 0, 12, ESPRESSO, 0.4)
    c.fill(body, Grad([(0, "#9C7B4C"), (0.4, "#C9A56E"), (1, "#8C6B3E")], 0))
    for k in range(18):
        yy = by - H_ + k * H_ / 18
        c.fill(c.inter(body, c.rrect(x - W_, yy, x + W_, yy + 1.4 * s, 0)), "#5C3F1E", 0.2)
    for k in range(14):
        xx = x - W_ / 2 + k * W_ / 13
        c.fill(c.inter(body, c.rrect(xx, by - H_, xx + 1.2 * s, by, 0)), "#5C3F1E", 0.14)
    neck = c.rrect(x - 40 * s + tilt * 14, by - H_ - 14 * s, x + 40 * s + tilt * 14, by - H_ + 24 * s, 8 * s)
    c.fill(neck, "#B08B58")
    c.fill(
        c.rrect(x - 44 * s + tilt * 14, by - H_ + 10 * s, x + 44 * s + tilt * 14, by - H_ + 20 * s, 4 * s), "#6B4A28"
    )
    txt(c, x, by - H_ * 0.45, "LANTERN", "serif", 26 * s, ESPRESSO, tracking=4 * s, alpha=0.8)
    txt(c, x, by - H_ * 0.45 + 24 * s, "COFFEE ROASTERS", "sans_regular", 8.5 * s, COPPER, tracking=2.4 * s, alpha=0.8)
    _ = rng


def _beans_pile(c: Canvas, cx, cy, rx, ry, n, seed, r=(11, 16)):
    rng = random.Random(seed)
    spots = []
    for _ in range(n):
        a = rng.uniform(0, math.tau)
        d = math.sqrt(rng.random())
        spots.append((cx + math.cos(a) * rx * d, cy + math.sin(a) * ry * d, rng.uniform(*r), rng.uniform(-80, 80)))
    for x, y, rr, ang in sorted(spots, key=lambda q: q[1]):
        bean(c, x, y, rr, ang, mix(COFFEE, "#7A4A2E", rng.uniform(0, 0.5)), shadow=False)


def _dial(c: Canvas, x, y, r, val=0.6, label=""):
    c.fill(c.ellipse(x, y, r + 4, r + 4), "#1B1410")
    c.fill(c.ellipse(x, y, r, r), Grad([(0, "#F7F0E3"), (1, "#D8C8A8")], 90))
    for k in range(11):
        a = math.radians(-210 + k * 24)
        c.fill(
            c.line(
                [
                    (x + math.cos(a) * r * 0.78, y + math.sin(a) * r * 0.78),
                    (x + math.cos(a) * r * 0.92, y + math.sin(a) * r * 0.92),
                ],
                1.6,
            ),
            ESPRESSO,
            0.8,
        )
    a = math.radians(-210 + val * 240)
    c.fill(c.line([(x, y), (x + math.cos(a) * r * 0.7, y + math.sin(a) * r * 0.7)], 2.6), "#B4602B")
    c.fill(c.ellipse(x, y, 4, 4), "#1B1410")
    c.fill(c.ellipse(x - r * 0.3, y - r * 0.4, r * 0.4, r * 0.18), "#FFFFFF", 0.4)
    _ = label


def _pendant(c: Canvas, x, cord_to, s, lit=1.0):
    c.fill(c.rrect(x - 1.5, 0, x + 1.5, cord_to + 4, 0), "#1B1410")
    lantern(c, x, cord_to, s, frame="#2A1C16", glass="#F6C26A", glow=True, lit=lit)


def _roaster(c: Canvas, cx, base_y, s=1.0):
    """Industrial drum roaster, front view."""
    bw, bh = 600 * s, 520 * s
    x0, x1 = cx - bw / 2, cx + bw / 2
    y1 = base_y - 40 * s
    y0 = y1 - bh
    # chimney
    pipe = c.rrect(x1 - 120 * s, -20, x1 - 70 * s, y0 + 30 * s, 6 * s)
    c.fill(pipe, Grad([(0, "#E1A06A"), (0.5, "#B4602B"), (1, "#6B3520")], 0))
    c.fill(c.rrect(x1 - 130 * s, y0 - 4 * s, x1 - 60 * s, y0 + 24 * s, 6 * s), "#8E4B2A")
    # hopper
    hop = c.poly(
        [
            (x0 + 30 * s, y0 - 150 * s),
            (x0 + 190 * s, y0 - 150 * s),
            (x0 + 150 * s, y0 + 6 * s),
            (x0 + 70 * s, y0 + 6 * s),
        ]
    )
    c.fill(hop, Grad([(0, "#C9CFD1"), (1, "#7C8A8E")], 0))
    c.fill(c.ellipse(x0 + 110 * s, y0 - 150 * s, 80 * s, 16 * s), "#2A1C16")
    c.fill(c.rrect(x0 + 40 * s, y0 - 100 * s, x0 + 54 * s, y0 - 10 * s, 4), "#FFFFFF", 0.25)
    # legs + shadow
    c.shadow(c.ellipse(cx, base_y, bw * 0.62, 30 * s), 0, 0, 24, "#000000", 0.5)
    for lx in (x0 + 30 * s, x1 - 80 * s):
        c.fill(c.rrect(lx, y1 - 10 * s, lx + 50 * s, base_y, 6 * s), "#1B1410")
    # body
    body = c.rrect(x0, y0, x1, y1, 26 * s)
    c.shadow(body, 0, 12 * s, 24 * s, "#000000", 0.45)
    c.fill(body, Grad([(0, "#7A4528"), (0.3, "#A5602F"), (0.6, "#7E4527"), (1, "#4A2A1A")], 0))
    c.fill(c.rrect(x0 + 10 * s, y0 + 10 * s, x0 + 24 * s, y1 - 10 * s, 6 * s), "#FFFFFF", 0.14)
    c.fill(
        c.rrect(x0 + 30 * s, y0 + 110 * s, x1 - 30 * s, y1 - 30 * s, 18 * s), Grad([(0, "#3A2418"), (1, "#241812")], 90)
    )
    # control panel
    c.fill(c.rrect(x0 + 40 * s, y0 + 26 * s, x1 - 40 * s, y0 + 94 * s, 10 * s), "#241812")
    for i, v in enumerate((0.7, 0.45, 0.62)):
        _dial(c, x0 + 100 * s + i * 100 * s, y0 + 60 * s, 24 * s, v)
    for i in range(4):
        c.fill(
            c.ellipse(x0 + 430 * s + i * 34 * s, y0 + 60 * s, 11 * s, 11 * s),
            Grad([(0, "#E9B27A"), (1, "#8E4B2A")], 90),
        )
    # drum door
    dcx, dcy, R = cx, y0 + 300 * s, 140 * s
    c.fill(c.ellipse(dcx, dcy, R + 22 * s, R + 22 * s), Grad([(0, "#E1A06A"), (1, "#6B3520")], 60))
    c.fill(c.ellipse(dcx, dcy, R + 8 * s, R + 8 * s), "#1B1410")
    glass = c.ellipse(dcx, dcy, R, R)
    c.fill(glass, Grad([(0, "#FFC46A"), (0.5, "#C9742B"), (1, "#3A1E10")], 90, "radial", (0.5, 0.65), 1.0))
    lay = c.sublayer(dcx - R, dcy - R, dcx + R, dcy + R)
    _beans_pile(lay, dcx, dcy + R * 0.42, R * 0.92, R * 0.5, 150, 3, r=(6 * s, 10 * s))
    c.paste(lay, clip=glass)
    c.fill(c.rot_ellipse(dcx - R * 0.35, dcy - R * 0.45, R * 0.4, R * 0.1, -35), "#FFFFFF", 0.3)
    c.glow(c.ellipse(dcx, dcy, R * 1.4, R * 1.4), 60 * s, "#F6A94A", 0.22)
    for k in range(8):
        a = math.tau * k / 8
        c.fill(c.ellipse(dcx + (R + 15 * s) * math.cos(a), dcy + (R + 15 * s) * math.sin(a), 5 * s, 5 * s), "#2A1C16")
    txt(c, cx, y1 - 52 * s, "LANTERN", "serif", 30 * s, "#E9B27A", tracking=10 * s, alpha=0.9)
    return dict(x0=x0, x1=x1, y0=y0, y1=y1, dcx=dcx, dcy=dcy, R=R)


# --------------------------------------------------------------------------------------------------------- hero


def hero() -> Image.Image:
    W_, H_ = 1920, 1080
    c = Canvas(W_, H_, 2)
    rng = random.Random(5)
    c.fill(c.rrect(0, 0, W_, H_, 0), Grad([(0, "#1B1410"), (0.55, "#33201A"), (1, "#2B1D16")], 90))
    _bricks(c, 0, 0, W_, 880, "#3A2418", 4, 0.28)
    # light shafts from a window top-left
    for pts, a in (
        ([(60, 0), (460, 0), (1080, 1080), (520, 1080)], 0.06),
        ([(520, 0), (700, 0), (1260, 1080), (980, 1080)], 0.045),
    ):
        c.fill(c.poly(pts), "#FFE0A0", a)
    # floor
    c.fill(c.rrect(0, 880, W_, H_, 0), Grad([(0, "#3A2418"), (1, "#16100C")], 90))
    for i in range(1, 10):
        c.fill(c.rrect(0, 880 + i**1.5 * 9, W_, 882 + i**1.5 * 9, 0), "#000000", 0.3)
    c.fill(c.rrect(0, 876, W_, 884, 0), "#6B3A22", 0.7)
    # warm ambient glows
    c.glow(c.ellipse(760, 260, 420, 300), 140, "#F6A94A", 0.22)
    c.glow(c.ellipse(1450, 640, 420, 300), 120, "#E9742B", 0.18)
    # pendant lanterns
    _pendant(c, 560, 230, 0.78, 0.95)
    _pendant(c, 800, 120, 1.05, 1.0)
    _pendant(c, 1020, 330, 0.62, 0.85)
    # roaster
    _roaster(c, 1450, 960, 1.0)
    # cooling tray
    tray = c.ellipse(1010, 920, 280, 62)
    c.shadow(tray, 0, 14, 16, "#000000", 0.5)
    c.fill(tray, Grad([(0, "#C9CFD1"), (1, "#6B787C")], 90))
    c.fill(c.ellipse(1010, 912, 262, 50), Grad([(0, "#3A2418"), (1, "#1B1410")], 90))
    lay = c.sublayer(740, 850, 1280, 960)
    _beans_pile(lay, 1010, 912, 252, 46, 150, 7, r=(10, 15))
    c.paste(lay, clip=c.ellipse(1010, 912, 262, 50))
    c.fill(c.line([(1010, 912), (1170, 880)], 8), "#9AA3A6")
    c.fill(c.ellipse(1010, 912, 14, 8), "#4A5558")
    # sacks
    _sack(c, 690, 975, 1.0, -0.4, 1)
    _sack(c, 870, 1000, 0.9, 0.3, 2)
    # copper scoop on a stool of beans near the tray
    c.fill(c.rrect(1215, 905, 1290, 925, 8), "#B4602B")
    c.fill(c.ellipse(1300, 915, 36, 22), Grad([(0, "#E1A06A"), (1, "#8E4B2A")], 90))
    # dust motes
    for _ in range(70):
        x, y = rng.uniform(300, 1300), rng.uniform(80, 700)
        c.fill(c.ellipse(x, y, rng.uniform(1.4, 3.2), rng.uniform(1.4, 3.2)), "#FFE0A0", rng.uniform(0.15, 0.45))
    img = vignette(c.render(), 0.35)
    return grain(img, 31, 4.0, 1.6)


# ---------------------------------------------------------------------------------------------- brand story images


def story() -> Image.Image:
    W_, H_ = 1400, 1000
    c = Canvas(W_, H_, 2)
    rng = random.Random(8)
    c.fill(c.rrect(0, 0, W_, H_, 0), Grad([(0, "#1B1410"), (1, "#33201A")], 90))
    _bricks(c, 0, 0, W_, 720, "#3A2418", 2, 0.25)
    c.glow(c.ellipse(700, 240, 520, 260), 120, "#F6A94A", 0.2)
    for x, to, s in ((300, 200, 0.7), (700, 130, 0.95), (1100, 220, 0.7)):
        _pendant(c, x, to, s, 0.95)
    # shelves with cups/bags
    for sy, items in ((330, "mugs"), (500, "bags")):
        c.fill(c.rrect(120, sy, 1280, sy + 14, 3), Grad([(0, "#9A6A44"), (1, "#5E3A24")], 90))
        c.shadow(c.rrect(120, sy, 1280, sy + 14, 3), 0, 10, 10, "#000000", 0.4)
        for k in range(11):
            x = 170 + k * 100
            if items == "mugs":
                col = ["#F3EBDC", "#6E8062", "#B4602B", "#3A2A22", "#D8C3A0"][k % 5]
                m = c.rrect(x - 26, sy - 46, x + 26, sy, 6)
                c.fill(m, Grad([(0, lighten(col, 0.18)), (1, darken(col, 0.18))], 0))
                c.fill(c.ellipse(x + 30, sy - 26, 12, 14), "#000000", 0.0)
                c.fill(c.sub(c.ellipse(x + 30, sy - 24, 14, 16), c.ellipse(x + 30, sy - 24, 8, 10)), col)
            else:
                col = ["#C9A26B", "#33241C", "#EFE4D0", "#5E6E55", "#B5573C"][k % 5]
                m = c.rrect(x - 30, sy - 108, x + 30, sy, 6)
                c.fill(m, Grad([(0, lighten(col, 0.15)), (1, darken(col, 0.2))], 0))
                c.fill(c.rrect(x - 20, sy - 76, x + 20, sy - 26, 3), "#F7F0E3", 0.9)
                c.fill(c.rrect(x - 30, sy - 108, x + 30, sy - 98, 3), darken(col, 0.2))
    # counter
    c.fill(c.rrect(0, 720, W_, H_, 0), Grad([(0, "#6B4430"), (0.12, "#4A2C1E"), (1, "#2A1A12")], 90))
    c.fill(c.rrect(0, 716, W_, 736, 0), Grad([(0, "#C9946A"), (1, "#8E5E3C")], 90))
    c.fill(c.rrect(0, 716, W_, 721, 0), "#FFFFFF", 0.25)
    for i in range(10):
        x = i * 150
        c.fill(c.rrect(x, 760, x + 4, H_, 0), "#000000", 0.15)
    arts = _arts()
    render_subject(c, arts["Gooseneck Kettle"], 300, 745, 0.5, 3)
    render_subject(c, arts["V60 Pour-Over"], 700, 745, 0.56, 4)
    render_subject(c, arts["Lantern Ceramic Mug"], 1010, 748, 0.44, 5)
    render_subject(c, arts["Espresso"], 1190, 752, 0.42, 6)
    for _ in range(50):
        x, y = rng.uniform(100, 1300), rng.uniform(80, 650)
        c.fill(c.ellipse(x, y, rng.uniform(1.4, 3), rng.uniform(1.4, 3)), "#FFE0A0", rng.uniform(0.15, 0.4))
    return grain(vignette(c.render(), 0.3), 32, 4.0, 1.6)


def sourcing() -> Image.Image:
    W_, H_ = 1400, 1000
    c = Canvas(W_, H_, 2)
    rng = random.Random(9)
    c.fill(c.rrect(0, 0, W_, H_, 0), Grad([(0, "#F3D9A6"), (0.45, "#F7E8C8"), (1, "#EFE4D0")], 90))
    c.glow(c.ellipse(980, 260, 200, 200), 70, "#FFE2A0", 0.8)
    c.fill(c.ellipse(980, 250, 86, 86), "#FFF0C4")
    for cx, cy, rx in ((260, 150, 170), (700, 90, 130), (1180, 130, 150)):
        c.glow(c.ellipse(cx, cy, rx, 24), 16, "#FFFFFF", 0.7)
    ridges = [("#B8C5A8", 430, 60), ("#9DB08C", 500, 50), ("#7F9672", 580, 44), ("#62785A", 670, 40)]
    for k, (col, base, amp) in enumerate(ridges):
        pts = [(0, H_)]
        for x in range(0, W_ + 30, 30):
            pts.append((x, base - amp * (0.5 + 0.5 * math.sin(x / (170 - k * 15) + k * 1.3)) - rng.uniform(0, 4)))
        pts.append((W_, H_))
        c.fill(c.poly(pts), col)
    # terraces with coffee shrubs on the nearest hill
    for row in range(8):
        y = 640 + row * 46
        t = row / 7
        c.fill(
            c.line(bez((-20, y + 16), (400, y - 24), (900, y + 30), (W_ + 20, y - 10), 40), 20 + 8 * t),
            mix("#48613F", "#2F4430", t),
            0.9,
        )
        c.fill(c.line(bez((-20, y + 6), (400, y - 34), (900, y + 20), (W_ + 20, y - 20), 40), 3), "#8E7B52", 0.5)
        n = int(16 + row * 3)
        for k in range(n):
            x = (k + 0.5) * W_ / n + rng.uniform(-14, 14)
            yy = y - 12 + 8 * math.sin(x / 140) - 6 * (1 - t) + rng.uniform(-3, 3)
            sc = 0.7 + 0.8 * t
            for dx, dy in ((-9, 0), (0, -4), (9, 0)):
                c.fill(
                    c.rot_ellipse(x + dx * sc, yy + dy * sc, 12 * sc, 6.5 * sc, -20 + dx * 4),
                    mix("#3F6A3A", "#7DA25A", rng.random()),
                )
            for _ in range(3):
                c.fill(
                    c.ellipse(x + rng.uniform(-9, 9) * sc, yy + rng.uniform(-2, 5) * sc, 2.4 * sc, 2.4 * sc), "#C23A32"
                )
    # foreground: basket of cherries
    c.fill(c.rrect(0, 900, W_, H_, 0), "#2F4430")
    bx, by = 300, 960
    c.shadow(c.ellipse(bx, by, 230, 40), 0, 6, 14, "#000000", 0.45)
    basket = c.union(
        c.poly([(bx - 200, by - 120), (bx + 200, by - 120), (bx + 160, by), (bx - 160, by)]), c.ellipse(bx, by, 160, 24)
    )
    c.fill(basket, Grad([(0, "#C9A26B"), (1, "#8C6B3E")], 0))
    for k in range(10):
        yy = by - 120 + k * 12
        c.fill(c.inter(basket, c.rrect(bx - 220, yy, bx + 220, yy + 3, 0)), "#5C3F1E", 0.35)
    for k in range(16):
        xx = bx - 190 + k * 25
        c.fill(c.inter(basket, c.line([(xx, by - 120), (xx - 30 + (k % 2) * 60, by)], 2.5)), "#5C3F1E", 0.25)
    c.fill(c.ellipse(bx, by - 120, 200, 40), "#8C6B3E")
    for _ in range(120):
        a = rng.uniform(0, math.tau)
        d = math.sqrt(rng.random())
        x, y = bx + math.cos(a) * 185 * d, by - 124 + math.sin(a) * 34 * d - (1 - d) * 26
        c.fill(c.ellipse(x, y, 12, 12), Grad([(0, "#E4554A"), (1, "#8E1F1F")], 60))
        c.fill(c.ellipse(x - 3, y - 4, 3.2, 2.2), "#FFFFFF", 0.55)
    return grain(c.render(), 33)


def craft() -> Image.Image:
    W_, H_ = 1400, 1000
    c = Canvas(W_, H_, 2)
    rng = random.Random(10)
    c.fill(c.rrect(0, 0, W_, H_, 0), Grad([(0, "#1B1410"), (1, "#2E1C14")], 90))
    _bricks(c, 0, 0, W_, 800, "#3A2418", 6, 0.22)
    c.glow(c.ellipse(560, 470, 480, 420), 130, "#E9742B", 0.25)
    # drum
    dcx, dcy, R = 560, 450, 330
    c.shadow(c.ellipse(dcx, dcy, R + 40, R + 40), 0, 24, 30, "#000000", 0.55)
    c.fill(c.ellipse(dcx, dcy, R + 60, R + 60), Grad([(0, "#E1A06A"), (0.5, "#A5602F"), (1, "#4A2A1A")], 50))
    c.fill(c.ellipse(dcx, dcy, R + 26, R + 26), "#1B1410")
    glass = c.ellipse(dcx, dcy, R, R)
    c.fill(glass, Grad([(0, "#FFC46A"), (0.55, "#C9742B"), (1, "#3A1E10")], 90, "radial", (0.5, 0.62), 1.0))
    lay = c.sublayer(dcx - R, dcy - R, dcx + R, dcy + R)
    _beans_pile(lay, dcx, dcy + R * 0.38, R * 0.95, R * 0.55, 330, 9, r=(12, 18))
    c.paste(lay, clip=glass)
    c.fill(c.rot_ellipse(dcx - R * 0.35, dcy - R * 0.45, R * 0.42, R * 0.1, -35), "#FFFFFF", 0.3)
    for k in range(12):
        a = math.tau * k / 12
        c.fill(c.ellipse(dcx + (R + 42) * math.cos(a), dcy + (R + 42) * math.sin(a), 8, 8), "#2A1C16")
    # chute + falling beans to tray
    c.fill(
        c.poly(
            [
                (dcx + R + 40, dcy + 120),
                (dcx + R + 210, dcy + 220),
                (dcx + R + 210, dcy + 290),
                (dcx + R + 40, dcy + 200),
            ]
        ),
        Grad([(0, "#C9CFD1"), (1, "#6B787C")], 90),
    )
    for _ in range(34):
        x = dcx + R + 190 + rng.uniform(-18, 18)
        y = dcy + 290 + rng.uniform(0, 230)
        bean(c, x, y, rng.uniform(12, 16), rng.uniform(-80, 80), COFFEE, shadow=False)
    tray = c.ellipse(1010, 830, 330, 74)
    c.shadow(tray, 0, 14, 16, "#000000", 0.5)
    c.fill(tray, Grad([(0, "#C9CFD1"), (1, "#6B787C")], 90))
    c.fill(c.ellipse(1010, 822, 312, 60), Grad([(0, "#3A2418"), (1, "#1B1410")], 90))
    lay2 = c.sublayer(680, 760, 1340, 900)
    _beans_pile(lay2, 1010, 820, 300, 54, 220, 11, r=(14, 20))
    c.paste(lay2, clip=c.ellipse(1010, 822, 312, 60))
    # thermometer dial
    _dial(c, 1120, 210, 84, 0.72)
    c.fill(c.rrect(1100, 292, 1140, 380, 6), "#2A1C16")
    # scoop
    c.fill(c.line([(820, 900), (980, 860)], 14), "#B4602B")
    c.fill(c.ellipse(1000, 856, 44, 26), Grad([(0, "#E1A06A"), (1, "#8E4B2A")], 90))
    c.fill(c.rrect(0, 920, W_, H_, 0), "#16100C")
    for _ in range(60):
        x, y = rng.uniform(100, 1300), rng.uniform(80, 700)
        c.fill(c.ellipse(x, y, rng.uniform(1.4, 3), rng.uniform(1.4, 3)), "#FFD79A", rng.uniform(0.15, 0.4))
    return grain(vignette(c.render(), 0.32), 34, 4.0, 1.6)


# ----------------------------------------------------------------------------------------------- OG card and logos


def og() -> Image.Image:
    W_, H_ = 1200, 630
    c = Canvas(W_, H_, 2)
    rng = random.Random(14)
    c.fill(c.rrect(0, 0, W_, H_, 0), Grad([(0, "#2B1D16"), (1, "#1B1410")], 90))
    for _ in range(26):
        bx_, by_ = rng.uniform(0, W_), rng.uniform(0, H_)
        if 520 < bx_ < 1100 and 100 < by_ < 560:
            continue
        bean(c, bx_, by_, rng.uniform(14, 30), rng.uniform(-80, 80), "#3A2418", shadow=False)
    c.glow(c.ellipse(300, 330, 330, 300), 100, "#F6A94A", 0.35)
    lantern(c, 300, 84, 1.75, frame="#8E5E3C", glass="#F6C26A", glow=True)
    c.fill(c.rrect(560, 150, 566, 480, 3), "#E9B27A", 0.35)
    txt(c, 610, 258, "Lantern", "serif", 112, CREAM, anchor="lm")
    txt(c, 612, 346, "COFFEE ROASTERS", "sans", 34, "#E9B27A", tracking=9, anchor="lm")
    txt(c, 612, 420, "Slow-roasted. Carefully poured.", "serif_italic", 36, CREAM, anchor="lm", alpha=0.85)
    txt(
        c, 612, 520, "Order ahead for pickup or delivery", "sans_regular", 24, CREAM, tracking=2, anchor="lm", alpha=0.6
    )
    return grain(vignette(c.render(), 0.3), 35, 3.5, 1.2)


def logo_mark(ink=ESPRESSO, size=512) -> Image.Image:
    c = Canvas(size, size, 2)
    lantern(c, size / 2, size * 0.06, size / 300, frame=ink, glass="#F3C66B", glow=False)
    return c.render()


def logo_wordmark(ink=ESPRESSO, accent=COPPER) -> Image.Image:
    c = Canvas(960, 240, 2)
    lantern(c, 110, 22, 0.62, frame=ink, glass="#F3C66B", glow=False)
    txt(c, 220, 96, "LANTERN", "serif", 96, ink, tracking=16, anchor="lm")
    txt(c, 224, 172, "COFFEE ROASTERS", "sans", 30, accent, tracking=11, anchor="lm")
    return c.render()


_ = (hexc, PARCHMENT, SAGE, mix)

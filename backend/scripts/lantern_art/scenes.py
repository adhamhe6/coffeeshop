# ruff: noqa: C408, S311  (illustration code: dict() keyword style and seeded, non-cryptographic randomness are intentional)
"""Scene composition: turns catalogue ``art`` specs into finished images (products, categories, collections, ...)."""

from __future__ import annotations

import math
import random

from PIL import Image

from . import food as F
from . import gear as G
from .canvas import Canvas, Grad, darken, grain, hexc, lighten
from .palette import COFFEE, CREAM, ESPRESSO, MILK
from .props import ELL, HORIZON, backdrop, bean, table_props
from .vessels import ceramic_cup, tall_glass, whipped_cream

SIZE = 1200

# ------------------------------------------------------------------------------------------------ cup garnishes


def _marshmallow(c, x, y, s):
    body = c.rrect(x - 26 * s, y - 34 * s, x + 26 * s, y, 12 * s)
    c.shadow(body, 0, 3 * s, 3 * s, ESPRESSO, 0.25)
    c.fill(body, Grad([(0, "#FFFFFF"), (1, "#EBDFC8")], 0))
    c.fill(c.ellipse(x, y - 34 * s, 26 * s, 10 * s), "#FFFFFF")
    c.fill(c.ellipse(x - 8 * s, y - 36 * s, 8 * s, 3 * s), "#FFFFFF", 0.0)
    c.fill(c.ellipse(x + 6 * s, y - 33 * s, 9 * s, 3 * s), "#EBDFC8", 0.7)


def cup_garnish(c: Canvas, info: dict, kind: str, s: float, seed: int, by: float) -> None:
    rng = random.Random(seed)
    cx, rx, lcy, lrx, yt = info["cx"], info["rx"], info["liq_cy"], info["liq_rx"], info["yt"]
    if kind in ("whip", "whip_caramel", "whip_sugar"):
        tip = whipped_cream(c, cx, lcy + 4 * s, lrx * 1.45, s * 0.95, tiers=3)
        if kind == "whip_caramel":
            from .props import caramel_drizzle

            caramel_drizzle(c, cx, tip + 70 * s, lrx * 0.95, s, col="#B9712B", seed=seed, n=4)
        if kind == "whip_sugar":
            for _ in range(46):
                px = cx + rng.uniform(-0.55, 0.55) * lrx
                py = tip + rng.uniform(10, 120) * s
                c.fill(c.rot_ellipse(px, py, 5 * s, 3 * s, rng.uniform(-40, 40)), "#C98A2B", 0.95)
        if kind == "whip":
            for _ in range(36):
                c.fill(
                    c.ellipse(cx + rng.uniform(-0.4, 0.4) * lrx, tip + rng.uniform(16, 110) * s, 1.8 * s, 1.4 * s),
                    "#3E2218",
                    0.75,
                )
    elif kind == "marshmallow":
        for dx, dy in [(-0.45, 0.02), (0.1, 0.12), (0.5, -0.02), (-0.1, -0.2), (0.25, -0.26)]:
            _marshmallow(c, cx + dx * lrx, lcy + dy * lrx * ELL * 1.3 + 14 * s, s * 1.2)
    elif kind in ("cinnamon", "cinnamon_stick"):
        x0, y0 = cx + lrx * 0.15, lcy
        x1, y1 = cx + rx * 0.62, yt - 160 * s
        st = c.line([(x0, y0), (x1, y1)], 17 * s)
        c.shadow(st, 3, 5, 4, ESPRESSO, 0.25)
        c.fill(st, Grad([(0, "#B77A46"), (0.5, "#8C5530"), (1, "#5E3519")], 0))
        c.fill(c.line([(x0 + 3 * s, y0 - 4 * s), (x1 + 3 * s, y1 + 4 * s)], 3 * s), "#D9A56E", 0.6)
        c.fill(c.ellipse(x1, y1, 8.5 * s, 8.5 * s), "#3B2012")
        for _ in range(26):
            c.fill(
                c.ellipse(
                    cx + rng.uniform(-0.8, 0.8) * lrx, lcy + rng.uniform(-0.8, 0.8) * lrx * ELL, 1.6 * s, 1.3 * s
                ),
                "#8A4A22",
                0.7,
            )
    elif kind in ("orange", "bergamot"):
        r = 52 * s if kind == "orange" else 44 * s
        gx, gy = cx - rx * 1.05, by - 24 * s
        col, pale, seg = ("#EE8F2E", "#FBC068", "#F7DFAE") if kind == "orange" else ("#E7B93E", "#F5DE8A", "#FBF0C4")
        e = c.ellipse(gx, gy, r, r * 0.8)
        c.shadow(e, 2, 5, 4, ESPRESSO, 0.28)
        c.fill(e, col)
        c.fill(c.ellipse(gx, gy, r * 0.9, r * 0.72), pale)
        for k in range(9):
            a = math.tau * k / 9
            c.fill(
                c.line(
                    [
                        (gx + 6 * math.cos(a), gy + 5 * math.sin(a)),
                        (gx + r * 0.78 * math.cos(a), gy + r * 0.62 * math.sin(a)),
                    ],
                    3 * s,
                ),
                seg,
                0.9,
            )
    elif kind == "mint":
        for dx, dy, ang in [(0, 0, -20), (-0.3, 0.1, 40), (0.3, 0.12, -70)]:
            c.fill(
                c.rot_ellipse(cx + dx * lrx, lcy + dy * lrx * ELL, 30 * s, 13 * s, ang),
                Grad([(0, "#9DB67A"), (1, "#4F7544")], 45),
            )
            c.fill(
                c.line(
                    [(cx + dx * lrx - 22 * s, lcy + dy * lrx * ELL), (cx + dx * lrx + 22 * s, lcy + dy * lrx * ELL)],
                    1.4 * s,
                ),
                "#2F5230",
                0.4,
            )


# ------------------------------------------------------------------------------------------------ subject renderers

CUP_SCALE = {"demi": 1.95, "cup": 1.42, "tea": 1.5, "mug": 1.2, "bowl": 1.3, "tall_mug": 1.15}


def draw_cup(c, spec, cx, by, m, seed):
    shape = spec.get("shape", "cup")
    s = CUP_SCALE[shape] * m
    info = ceramic_cup(
        c,
        cx,
        by,
        s,
        shape=shape,
        glaze=spec.get("glaze", "cream"),
        surface=spec.get("surface", "plain"),
        base=spec["base"],
        accent=spec["accent"],
        saucer=spec.get("saucer"),
        steam_on=spec.get("steam", True)
        and not spec.get("garnish", "").startswith("whip")
        and spec.get("garnish") != "marshmallow",
        seed=seed,
    )
    if spec.get("garnish"):
        cup_garnish(c, info, spec["garnish"], s, seed, by)
    return info


def draw_glass(c, spec, cx, by, m, seed):
    kind = spec.get("kind")
    if kind == "cortado":
        return tall_glass(
            c,
            cx,
            by,
            2.25 * m,
            H=215,
            top_w=200,
            bot_w=172,
            layers=[("#EADBC0", 0.55), ("#5A3622", 0.45)],
            fill=0.9,
            ice=0,
            straw=None,
            seed=seed,
            dew=False,
        )
    if kind == "nitro":
        return tall_glass(
            c,
            cx,
            by,
            1.2 * m,
            H=470,
            top_w=272,
            bot_w=196,
            layers=[("#33190E", 1.0)],
            fill=0.92,
            ice=0,
            straw=None,
            foam=0.30,
            seed=seed,
            dew=True,
        )
    if kind == "jasmine":
        info = tall_glass(
            c,
            cx,
            by,
            1.75 * m,
            H=235,
            top_w=230,
            bot_w=190,
            layers=[("#E7D27A", 1.0)],
            fill=0.78,
            ice=0,
            straw=None,
            flowers=8,
            seed=seed,
            dew=False,
        )
        from .props import steam

        steam(c, cx, info["yt"] - 20 * m, h=200 * m, n=3, spread=36 * m, width=16 * m, seed=seed)
        return info
    args = {k: v for k, v in spec.items() if k not in ("kind",)}
    return tall_glass(c, cx, by, 1.16 * m, seed=seed, **args)


def draw_food(c, spec, cx, by, m, seed):
    item = spec["item"]
    rx = 430 * m
    ys, _ = F.plate(c, cx, by, rx)
    if item == "croissant":
        F.croissant(c, cx, ys, 1.8 * m, almond=spec.get("almond", False), sugar=spec.get("almond", False), seed=seed)
    elif item == "pain":
        F.pain_au_chocolat(c, cx, ys, 1.7 * m)
    elif item == "bun":
        F.spiral_bun(c, cx, ys, 1.5 * m, kind=spec.get("kind", "cinnamon"), seed=seed)
    elif item == "muffin":
        F.muffin(c, cx, ys, 1.95 * m, flavour=spec.get("flavour", "blueberry"), seed=seed)
    elif item == "cookie":
        F.cookie(c, cx, ys, 1.7 * m, seed=seed)
    elif item == "cake":
        F.cake_slice(c, cx, ys, 1.4 * m, kind=spec["kind"], seed=seed)
    elif item == "toast":
        F.toast(c, cx, ys, 1.5 * m, seed=seed)
    elif item == "sandwich":
        sc = (1.1 if spec.get("bun") == "ciabatta" else 1.38) * m
        F.sandwich(
            c,
            cx,
            ys,
            sc,
            layers=tuple(spec["layers"]),
            bun=spec.get("bun", "brioche"),
            seed=seed,
            grill=spec.get("grill", False),
        )
    elif item == "quiche":
        F.quiche(c, cx, ys, 1.38 * m, seed=seed)
    return dict(ys=ys)


def draw_bag(c, spec, cx, by, m, seed):
    G.bag(
        c,
        cx,
        by,
        1.3 * m,
        color=spec["color"],
        origin=spec["origin"],
        sub=spec["sub"],
        notes=spec["notes"],
        roast=spec["roast"],
        seed=seed,
    )


def draw_gear(c, spec, cx, by, m, seed):
    item = spec["item"]
    if item == "kettle":
        G.kettle(c, cx - 10 * m, by, 1.4 * m, spec.get("color", "espresso"), seed)
    elif item == "mug":
        G.mug_simple(c, cx, by, 1.18 * m, spec.get("glaze", "cream"), seed=seed)
    elif item == "tote":
        G.tote(c, cx, by, 1.05 * m, spec.get("color", "cream"), seed)
    elif item == "grinder":
        G.grinder(c, cx - 30 * m, by, 1.95 * m, spec.get("color", "copper"), seed)
    elif item == "tumbler":
        G.tumbler(c, cx, by, 1.42 * m, spec.get("color", "sage"), seed)


def draw_pourover(c, spec, cx, by, m, seed):
    G.pourover(c, cx, by, 1.12 * m, glaze=spec.get("glaze", "white"), drink=spec.get("drink", True), seed=seed)
    if spec.get("drink", True):
        from .props import steam

        steam(c, cx, by - 300 * m, h=120 * m, n=2, spread=40 * m, width=14 * m, seed=seed)


def _mini_item(c, token, x, by, m, seed):
    parts = token.split(":")
    kind = parts[0]
    if kind == "bag":
        G.bag(
            c,
            x,
            by,
            0.64 * m,
            color=parts[1],
            origin=parts[2],
            sub=parts[3] if len(parts) > 3 else "",
            notes="",
            roast=3,
            seed=seed,
            beans=False,
        )
    elif kind == "mug":
        G.mug_simple(c, x, by, 0.74 * m, "cream", seed=seed)
    elif kind == "tote":
        G.tote(c, x, by, 0.62 * m, "cream", seed)
    elif kind == "kettle":
        G.kettle(c, x - 20 * m, by, 0.78 * m, "espresso", seed)
    elif kind == "pourover":
        G.pourover(c, x, by, 0.62 * m, glaze="white", drink=False, seed=seed)


def draw_gift(c, spec, cx, by, m, seed):
    items = spec["items"]
    n = len(items)
    xs = {1: [820], 2: [740, 990], 3: [600, 815, 1030]}[n]
    box_x = {1: 440, 2: 380, 3: 300}[n]
    # items first (behind), box in front
    for i, (tok, x) in enumerate(zip(items, xs, strict=False)):
        _mini_item(
            c, tok, cx - 600 + x if m == 1 else cx + (x - 600) * m, by - (0 if i % 2 == 0 else 26) * m, m, seed + i
        )
    G.gift_box(
        c,
        cx - 600 + box_x if m == 1 else cx + (box_x - 600) * m,
        by + 6 * m,
        (1.0 if n < 3 else 0.82) * m,
        spec.get("color", "kraft"),
        spec.get("ribbon", "copper"),
        seed=seed,
    )


RENDERERS = {
    "cup": draw_cup,
    "glass": draw_glass,
    "food": draw_food,
    "bag": draw_bag,
    "gear": draw_gear,
    "gift": draw_gift,
    "pourover": draw_pourover,
}


def render_subject(c: Canvas, art, cx, by, m=1.0, seed=1):
    kind, spec = art
    return RENDERERS[kind](c, spec, cx, by, m, seed)


# ------------------------------------------------------------------------------------------------ product images


def product_image(slug: str, art, tint: str, seed: int) -> Image.Image:
    c = Canvas(SIZE, SIZE, 2)
    hy = backdrop(c, tint, HORIZON, True, seed)
    kind = art[0]
    by = 905
    spread = {"cup": 340, "glass": 230, "food": 380, "bag": 260, "gear": 270, "gift": 480, "pourover": 220}[kind]
    if kind != "gift":
        table_props(c, hy, 600, by, spread, seed, n=5 if kind in ("bag", "gear") else 4)
    render_subject(c, art, 600, by, 1.0, seed)
    return grain(c.render(), seed + 101)


def _unused():  # keep names referenced for linters
    return (COFFEE, CREAM, MILK, bean, darken, hexc, lighten)

# ruff: noqa: C408, S311  (illustration code: dict() keyword style and seeded, non-cryptographic randomness are intentional)
"""Coffee bags, brewing gear, merchandise and gift boxes."""

from __future__ import annotations

import math
import random

from .canvas import Canvas, Grad, bez, darken, hexc, lighten, mix
from .palette import COFFEE, COPPER, CREAM, ESPRESSO, KRAFT, PARCHMENT, SAGE
from .props import ELL, bean, contact_shadow, lantern
from .vessels import GLAZES, ceramic_cup, tall_glass

BAG_COLORS = {
    "kraft": KRAFT,
    "dark": "#33241C",
    "cream": "#EFE4D0",
    "sage": "#5E6E55",
    "copper": "#B4602B",
    "terracotta": "#B5573C",
    "slate": "#58707A",
    "plum": "#6D4B5C",
    "ochre": "#C38F2E",
}


def txt(c: Canvas, x, y, string, font, size, color, tracking=0.0, anchor="mm", alpha=1.0, rotate=0.0, max_w=None):
    if max_w:
        m = c.text_mask(x, y, string, font, size, tracking, anchor, rotate)
        w = m.img.width / c.ss
        if w > max_w:
            size = size * max_w / w
            tracking = tracking * max_w / w
    c.fill(c.text_mask(x, y, string, font, size, tracking, anchor, rotate), color, alpha)


def label_panel(c: Canvas, cx, y0, y1, w, k, origin, sub, notes, roast, panel, foot="250 g", foot2="WHOLE BEAN"):
    """Printed front label shared by bags and tins. ``k`` is the drawing scale."""
    ink = ESPRESSO if hexc(panel)[0] > 150 else CREAM
    accent = COPPER if ink == ESPRESSO else "#E9B27A"
    lab = c.rrect(cx - w / 2, y0, cx + w / 2, y1, 10 * k)
    c.shadow(lab, 0, 2 * k, 3 * k, ESPRESSO, 0.18)
    c.fill(lab, panel)
    c.stroke_outline(c.rrect(cx - w / 2 + 7 * k, y0 + 7 * k, cx + w / 2 - 7 * k, y1 - 7 * k, 6 * k), 1.4 * k, ink, 0.55)
    h = y1 - y0
    lantern(c, cx, y0 + 18 * k, 0.15 * k, frame=ink, glass="#F3C66B", glow=False, flame=True)
    ty = y0 + h * 0.36
    txt(c, cx, ty, "LANTERN", "serif", 31 * k, ink, tracking=6.5 * k, max_w=w * 0.8)
    txt(c, cx, ty + 22 * k, "COFFEE ROASTERS", "sans_regular", 9.5 * k, accent, tracking=3.2 * k, max_w=w * 0.7)
    c.fill(c.rrect(cx - 26 * k, ty + 38 * k, cx + 26 * k, ty + 39.4 * k, 1), ink, 0.55)
    oy = ty + h * 0.2
    txt(c, cx, oy, origin.upper(), "serif", 36 * k, ink, tracking=0.6 * k, max_w=w * 0.78)
    txt(c, cx, oy + 30 * k, sub, "serif_italic", 15 * k, ink, max_w=w * 0.78, alpha=0.9)
    if notes:
        txt(c, cx, oy + 52 * k, notes.upper(), "sans_regular", 8.6 * k, accent, tracking=1.3 * k, max_w=w * 0.78)
    for i in range(5):
        dx = (i - 2) * 17 * k
        c.fill(c.ellipse(cx + dx, y1 - 42 * k, 5 * k, 5 * k), accent if i < roast else ink, 1.0 if i < roast else 0.22)
    txt(
        c,
        cx - w / 2 + 20 * k,
        y1 - 20 * k,
        foot,
        "sans_regular",
        9.5 * k,
        ink,
        tracking=1.6 * k,
        anchor="lm",
        alpha=0.85,
    )
    txt(
        c,
        cx + w / 2 - 20 * k,
        y1 - 20 * k,
        foot2,
        "sans_regular",
        8.5 * k,
        ink,
        tracking=1.4 * k,
        anchor="rm",
        alpha=0.85,
    )


def bag(
    c: Canvas,
    cx,
    by,
    s=1.0,
    color="kraft",
    origin="ETHIOPIA",
    sub="Guji · Light roast",
    notes="",
    roast=2,
    seed=1,
    beans=True,
    size_label="250 g",
):
    rng = random.Random(seed)
    col = hexc(BAG_COLORS.get(color, color))
    W, H = 330 * s, 500 * s
    yt, yb = by - H, by - 10 * s
    contact_shadow(c, cx, by, W * 0.58, alpha=0.32, dx=0.2)
    top_w = W * 0.96
    pts_l, pts_r = [], []
    for i in range(41):
        t = i / 40
        y = yt + (yb - yt) * t
        bulge = math.sin(math.pi * t) ** 0.8 * 13 * s
        half = top_w / 2 + (W / 2 - top_w / 2) * t + bulge
        pts_l.append((cx - half, y))
        pts_r.append((cx + half, y))
    body = c.union(c.poly(pts_l + pts_r[::-1]), c.ellipse(cx, yb, W / 2 * 0.99, W / 2 * ELL * 0.42))
    c.shadow(body, 0, 4 * s, 4 * s, ESPRESSO, 0.12)
    c.fill(
        body,
        Grad(
            [
                (0, darken(col, 0.18)),
                (0.18, lighten(col, 0.1)),
                (0.45, lighten(col, 0.03)),
                (0.8, darken(col, 0.1)),
                (1, darken(col, 0.3)),
            ],
            0,
        ),
    )
    c.fill(body, Grad([(0, (255, 255, 255, 38)), (0.3, (255, 255, 255, 0)), (1, (30, 16, 10, 40))], 90))
    # crinkles
    for _ in range(26):
        x = cx + rng.uniform(-0.95, 0.95) * W / 2
        y = rng.uniform(yt + 70 * s, yb - 20 * s)
        ang = rng.uniform(-30, 30)
        dx, dy = math.sin(math.radians(ang)) * 70 * s, math.cos(math.radians(ang)) * 70 * s
        c.fill(
            c.inter(body, c.line([(x, y), (x + dx * 0.6, y + dy * 0.6)], rng.uniform(1.2, 3) * s)),
            "#FFFFFF" if rng.random() < 0.55 else ESPRESSO,
            0.07,
        )
    # bottom gusset fold lines
    c.fill(
        c.inter(body, c.line([(cx - W / 2 * 0.96, yb - 24 * s), (cx - W * 0.2, yb - 2 * s)], 2.2 * s)), ESPRESSO, 0.12
    )
    c.fill(
        c.inter(body, c.line([(cx + W / 2 * 0.96, yb - 24 * s), (cx + W * 0.2, yb - 2 * s)], 2.2 * s)), ESPRESSO, 0.12
    )
    # sealed top
    top = c.rrect(cx - top_w / 2 - 2 * s, yt - 6 * s, cx + top_w / 2 + 2 * s, yt + 50 * s, 6 * s)
    c.fill(top, Grad([(0, lighten(col, 0.12)), (1, darken(col, 0.12))], 90))
    for i in range(34):
        x = cx - top_w / 2 + (i + 0.5) * top_w / 34
        c.fill(c.rrect(x - 1.1 * s, yt - 4 * s, x + 1.1 * s, yt + 44 * s, 1), ESPRESSO, 0.15)
    c.fill(c.rrect(cx - top_w / 2, yt + 50 * s, cx + top_w / 2, yt + 54 * s, 1), ESPRESSO, 0.18)
    # zip/tear notch
    c.fill(
        c.line([(cx - top_w / 2 + 10 * s, yt + 66 * s), (cx + top_w / 2 - 10 * s, yt + 66 * s)], 1.6 * s),
        ESPRESSO,
        0.16,
    )
    # label
    panel = "#FBF5E8" if (hexc(col)[0] > 150 or color == "cream") else CREAM
    label_panel(c, cx, yt + 96 * s, yb - 46 * s, W * 0.74, s, origin, sub, notes, roast, panel, foot=size_label)
    # edge highlight
    c.fill(
        c.inter(body, c.rrect(cx - W / 2 + 6 * s, yt + 60 * s, cx - W / 2 + 14 * s, yb - 30 * s, 4 * s)),
        "#FFFFFF",
        0.20,
    )
    c.stroke_outline(body, 1.6 * s, ESPRESSO, 0.16)
    if beans:
        for dx, dy, r, a in [
            (-W * 0.62, -8, 17, 20),
            (-W * 0.5, 22, 15, -50),
            (W * 0.58, 4, 17, -30),
            (W * 0.7, 30, 14, 60),
            (W * 0.45, 40, 16, 15),
        ]:
            bean(c, cx + dx, by + dy * s, r * s, a, mix(COFFEE, "#7A4A2E", rng.uniform(0, 0.4)))


def mug_simple(c: Canvas, cx, by, s=1.0, glaze="cream", decal=True, seed=1, liquid=False, steam_on=False):
    """A plain ceramic cup, optionally with the lantern printed on the front."""
    info = ceramic_cup(
        c,
        cx,
        by,
        s,
        shape="mug",
        glaze=glaze,
        surface="plain",
        base=COFFEE,
        accent=CREAM,
        saucer=False,
        level=0.0,
        steam_on=steam_on,
        seed=seed,
        empty=not liquid,
    )
    if decal:
        g = hexc(GLAZES.get(glaze, glaze))
        fr = ESPRESSO if hexc(g)[0] > 140 else CREAM
        lantern(c, cx - 8 * s, info["yt"] + 78 * s, 0.30 * s, frame=fr, glass="#F3C66B", glow=False)
    return info


def dripper(c: Canvas, cx, ytop_base, s=1.0, glaze="white", seed=1):
    """V60-style cone. ``ytop_base`` is the y where the flange sits on the vessel's rim."""
    g = hexc(GLAZES.get(glaze, glaze))
    rx_t = 150 * s
    rx_b = 52 * s
    h = 215 * s
    y_fl = ytop_base - 8 * s
    y_top = y_fl - h
    # flange ring at the base of the cone
    fl = c.ellipse(cx, y_fl, rx_t * 0.86, rx_t * 0.86 * ELL)
    c.shadow(fl, 0, 8 * s, 8 * s, ESPRESSO, 0.28)
    c.fill(fl, Grad([(0, lighten(g, 0.3)), (1, darken(g, 0.1))], 90))
    c.fill(c.ellipse(cx, y_fl - 3 * s, rx_t * 0.86, rx_t * 0.86 * ELL * 0.9), lighten(g, 0.2), 0.0)
    cone = c.union(
        c.poly([(cx - rx_t, y_top), (cx + rx_t, y_top), (cx + rx_b, y_fl), (cx - rx_b, y_fl)]),
        c.ellipse(cx, y_fl, rx_b, rx_b * ELL),
    )
    c.fill(cone, Grad([(0, lighten(g, 0.18)), (0.3, g), (0.75, darken(g, 0.1)), (1, darken(g, 0.28))], 0))
    for i in range(1, 7):  # spiral ribs
        t = i / 7
        xa = cx - rx_t + t * 2 * rx_t
        xb = cx - rx_b + t * 2 * rx_b
        c.fill(c.inter(cone, c.line([(xa, y_top), (xb + 12 * s, y_fl)], 4.0 * s)), darken(g, 0.25), 0.28)
        c.fill(c.inter(cone, c.line([(xa + 4 * s, y_top), (xb + 16 * s, y_fl)], 1.6 * s)), "#FFFFFF", 0.3)
    c.fill(c.rrect(cx - rx_t * 0.6, y_top + 30 * s, cx - rx_t * 0.6 + 10 * s, y_fl - 50 * s, 5 * s), "#FFFFFF", 0.0)
    rim = c.ellipse(cx, y_top, rx_t, rx_t * ELL)
    c.fill(rim, Grad([(0, lighten(g, 0.4)), (1, lighten(g, 0.12))], 90))
    inner = c.ellipse(cx, y_top + 2 * s, rx_t - 10 * s, (rx_t - 10 * s) * ELL)
    c.fill(inner, "#FFFFFF")
    c.fill(inner, Grad([(0, (120, 80, 50, 0)), (1, (120, 80, 50, 90))], 90))
    # coffee bed
    c.fill(
        c.ellipse(cx, y_top + 12 * s, rx_t - 34 * s, (rx_t - 34 * s) * ELL), Grad([(0, "#5A341F"), (1, "#3A2014")], 90)
    )
    for k in range(40):
        a = math.tau * k / 40
        c.fill(
            c.ellipse(
                cx + (rx_t - 44 * s) * 0.9 * math.cos(a) * (0.3 + 0.7 * ((k * 37) % 10) / 10),
                y_top + 12 * s + (rx_t - 44 * s) * ELL * math.sin(a) * (0.3 + 0.7 * ((k * 53) % 10) / 10),
                2.4 * s,
                1.6 * s,
            ),
            "#7B4B2D",
            0.8,
        )
    # paper filter lip
    lip = c.sub(
        c.ellipse(cx, y_top - 2 * s, rx_t - 4 * s, (rx_t - 4 * s) * ELL),
        c.ellipse(cx, y_top, rx_t - 14 * s, (rx_t - 14 * s) * ELL),
    )
    c.fill(lip, "#FBF8F0", 0.95)
    return y_top


def pourover(c: Canvas, cx, by, s=1.0, glaze="white", drink=True, seed=1):
    """Dripper over a glass server (equipment) — used for both the V60 drink and the dripper product."""
    H, top_w, bot_w = 300, 150, 270
    info = tall_glass(
        c,
        cx,
        by,
        s,
        H=H,
        top_w=top_w,
        bot_w=bot_w,
        layers=[("#6B3E26", 1.0)] if drink else [((255, 255, 255, 0), 1.0)],
        fill=0.42 if drink else 0.3,
        ice=0,
        straw=None,
        seed=seed,
        dew=False,
    )
    for k in range(3):
        c.fill(
            c.rrect(
                cx + 62 * s * 1.0 + k * 0,
                info["yt"] + (60 + k * 54) * s,
                cx + (62 + 20 - k * 4) * s,
                info["yt"] + (62 + k * 54) * s + 3 * s,
                2 * s,
            ),
            ESPRESSO,
            0.45,
        )
    yd = dripper(c, cx, info["yt"] + 4 * s, 1.15 * s, glaze, seed)
    if drink:  # a drip falling into the server
        c.fill(c.ellipse(cx, info["yt"] + 78 * s, 4.6 * s, 6.5 * s), "#4A2A1A")
        c.fill(c.ellipse(cx - 1.4 * s, info["yt"] + 75 * s, 1.4 * s, 2.0 * s), "#FFFFFF", 0.6)
    return yd


def kettle(c: Canvas, cx, by, s=1.0, color="espresso", seed=1):
    col = hexc(
        color
        if color.startswith("#")
        else {
            "espresso": "#34261E",
            "copper": "#B4602B",
            "sage": "#5E6E55",
            "steel": "#9AA3A6",
            "cream": "#EFE4D0",
        }.get(color, "#34261E")
    )
    rt, rb, Hs = 108 * s, 150 * s, 215 * s
    yb = by - rb * ELL
    yt = yb - Hs
    contact_shadow(c, cx, by, rb * 1.35, alpha=0.30, dx=0.25)
    # spout (gooseneck)
    p = bez(
        (cx + rb * 0.7, yb - 30 * s),
        (cx + rb * 1.3, yb - 40 * s),
        (cx + rb * 1.15, yt - 70 * s),
        (cx + rb * 1.85, yt - 90 * s),
        40,
    )
    widths = [(44 - 28 * (i / 40)) * s for i in range(41)]
    sp = c.varline(p, widths)
    c.fill(sp, Grad([(0, lighten(col, 0.12)), (1, darken(col, 0.25))], 90))
    c.fill(c.line([(x, y - 6 * s) for x, y in p[8:36]], 3 * s), "#FFFFFF", 0.22)
    # handle (behind body)
    hx = cx - rt * 1.0
    hy = yt + Hs * 0.35
    ring = c.sub(
        c.ellipse(hx - 14 * s, hy, 78 * s, Hs * 0.5), c.ellipse(hx - 14 * s, hy, 78 * s - 22 * s, Hs * 0.5 - 22 * s)
    )
    c.fill(ring, Grad([(0, "#B98A58"), (1, "#7B5230")], 0))
    c.fill(
        c.line(
            bez(
                (hx - 120 * s, hy - 60 * s),
                (hx - 150 * s, hy),
                (hx - 140 * s, hy + 50 * s),
                (hx - 100 * s, hy + 80 * s),
                16,
            ),
            5 * s,
        ),
        "#FFFFFF",
        0.18,
    )
    body = c.union(
        c.poly([(cx - rt, yt), (cx + rt, yt), (cx + rb, yb), (cx - rb, yb)]),
        c.ellipse(cx, yb, rb, rb * ELL),
        c.ellipse(cx, yt, rt, rt * ELL),
    )
    c.fill(
        body,
        Grad(
            [(0, lighten(col, 0.22)), (0.3, lighten(col, 0.04)), (0.75, darken(col, 0.12)), (1, darken(col, 0.38))], 0
        ),
    )
    c.fill(c.inter(body, c.rrect(cx - rt * 1.0, yt + 30 * s, cx - rt * 0.76, yb - 12 * s, 10 * s)), "#FFFFFF", 0.16)
    c.fill(c.rrect(cx - rb, yb - 52 * s, cx + rb, yb - 40 * s, 2), "#FFFFFF", 0.0)
    band = c.inter(body, c.rrect(cx - rb * 1.1, yt + Hs * 0.62, cx + rb * 1.1, yt + Hs * 0.62 + 12 * s, 0))
    c.fill(band, "#E9B27A" if color != "copper" else "#F1C9A0", 0.7)
    # lid
    c.fill(c.ellipse(cx, yt, rt, rt * ELL), Grad([(0, lighten(col, 0.3)), (1, lighten(col, 0.05))], 90))
    dome = c.inter(c.ellipse(cx, yt - 4 * s, rt * 0.92, 56 * s), c.rrect(cx - rt, yt - 80 * s, cx + rt, yt, 0))
    c.fill(dome, Grad([(0, lighten(col, 0.35)), (0.5, col), (1, darken(col, 0.18))], 0))
    c.fill(c.ellipse(cx - rt * 0.34, yt - 36 * s, rt * 0.28, 9 * s), "#FFFFFF", 0.28)
    c.shadow(c.ellipse(cx, yt - 62 * s, 17 * s, 17 * s), 2, 4, 3, ESPRESSO, 0.25)
    c.fill(c.ellipse(cx, yt - 62 * s, 17 * s, 17 * s), Grad([(0, "#C89B66"), (1, "#7B5230")], 60))
    c.fill(c.ellipse(cx - 5 * s, yt - 68 * s, 5 * s, 3 * s), "#FFFFFF", 0.4)
    _ = seed


def tote(c: Canvas, cx, by, s=1.0, color="cream", seed=1):
    col = hexc(
        color
        if color.startswith("#")
        else {"cream": "#EDE0C6", "sage": "#6E8062", "espresso": "#3A2A22", "copper": "#B4602B"}.get(color, "#EDE0C6")
    )
    ink = ESPRESSO if hexc(col)[0] > 150 else CREAM
    W, H = 400 * s, 440 * s
    yb = by - 10 * s
    yt = yb - H
    contact_shadow(c, cx, by, W * 0.55, alpha=0.28, dx=0.2)
    # straps: back strap then front strap
    for k, h_ in enumerate((290, 250)):
        pts = bez(
            (cx - W * 0.3, yt + 12 * s),
            (cx - W * 0.34, yt - h_ * s),
            (cx + W * 0.34, yt - h_ * s),
            (cx + W * 0.3, yt + 12 * s),
            40,
        )
        strap = c.line(pts, 30 * s, cap=False)
        c.fill(strap, darken(col, 0.18 if k == 0 else 0.0))
        c.fill(c.line([(x + 6 * s, y) for x, y in pts], 2.0 * s), darken(col, 0.4), 0.35)
    body = c.poly(
        [
            (cx - W / 2, yt),
            (cx + W / 2, yt),
            (cx + W / 2 + 6 * s, yb - 14 * s),
            (cx + W / 2 - 14 * s, yb),
            (cx - W / 2 + 14 * s, yb),
            (cx - W / 2 - 6 * s, yb - 14 * s),
        ]
    )
    c.shadow(body, 0, 3 * s, 4 * s, ESPRESSO, 0.14)
    c.fill(body, Grad([(0, darken(col, 0.06)), (0.2, lighten(col, 0.08)), (0.7, col), (1, darken(col, 0.18))], 0))
    c.fill(body, Grad([(0, (255, 255, 255, 30)), (0.5, (255, 255, 255, 0)), (1, (40, 20, 10, 36))], 90))
    rng = random.Random(seed)
    for i in range(0, int(H / (6 * s)), 1):  # weave
        y = yt + i * 6 * s
        c.fill(c.inter(body, c.rrect(cx - W / 2, y, cx + W / 2, y + 1.2 * s, 0)), ESPRESSO, 0.045)
    for i in range(0, int(W / (6 * s)), 1):
        x = cx - W / 2 + i * 6 * s
        c.fill(c.inter(body, c.rrect(x, yt, x + 1.2 * s, yb, 0)), ESPRESSO, 0.04)
    for _ in range(5):  # soft folds
        x = cx + rng.uniform(-0.8, 0.8) * W / 2
        c.fill(
            c.inter(body, c.line([(x, yt + 40 * s), (x + rng.uniform(-14, 14) * s, yb - 20 * s)], 10 * s)),
            ESPRESSO if rng.random() < 0.5 else "#FFFFFF",
            0.05,
        )
    for yy in (yt + 16 * s, yb - 16 * s):  # stitched hem
        for i in range(24):
            x = cx - W / 2 + 24 * s + i * (W - 48 * s) / 23
            c.fill(c.rrect(x - 7 * s, yy - 1.2 * s, x + 7 * s, yy + 1.2 * s, 1), darken(col, 0.45), 0.55)
    lantern(c, cx, yt + 82 * s, 0.50 * s, frame=ink, glass="#E9A74A", glow=False)
    txt(c, cx, yt + 82 * s + 175 * s, "LANTERN", "serif", 44 * s, ink, tracking=8 * s, max_w=W * 0.72)
    txt(
        c,
        cx,
        yt + 82 * s + 208 * s,
        "COFFEE ROASTERS",
        "sans_regular",
        13 * s,
        COPPER if ink == ESPRESSO else "#E9B27A",
        tracking=4.5 * s,
    )


def grinder(c: Canvas, cx, by, s=1.0, color="copper", seed=1):
    col = hexc({"copper": "#B4602B", "steel": "#A3ABAD", "sage": "#6E8062", "espresso": "#3A2A22"}.get(color, color))
    contact_shadow(c, cx, by, 190 * s, alpha=0.30, dx=0.2)
    # wooden base with drawer
    bw, bh = 300 * s, 120 * s
    yb0 = by - 8 * s
    base_front = c.rrect(cx - bw / 2, yb0 - bh, cx + bw / 2, yb0, 6 * s)
    top_face = c.poly(
        [
            (cx - bw / 2, yb0 - bh),
            (cx + bw / 2, yb0 - bh),
            (cx + bw / 2 - 24 * s, yb0 - bh - 34 * s),
            (cx - bw / 2 + 24 * s, yb0 - bh - 34 * s),
        ]
    )
    c.fill(base_front, Grad([(0, "#B98A58"), (1, "#8A5E36")], 90))
    rng = random.Random(seed)
    for _ in range(14):
        y = rng.uniform(yb0 - bh + 8 * s, yb0 - 6 * s)
        c.fill(
            c.line([(cx - bw / 2 + 8 * s, y), (cx + bw / 2 - 8 * s, y + rng.uniform(-3, 3) * s)], 1.4 * s),
            "#5A3A20",
            0.28,
        )
    c.fill(top_face, Grad([(0, "#D2A670"), (1, "#B98A58")], 90))
    c.fill(c.rrect(cx - 54 * s, yb0 - bh * 0.62, cx + 54 * s, yb0 - bh * 0.34, 5 * s), "#6B4426", 0.65)
    c.fill(c.ellipse(cx, yb0 - bh * 0.48, 9 * s, 6 * s), "#E3C193")
    # metal body
    yb1 = yb0 - bh - 14 * s
    rb, rt, h = 82 * s, 66 * s, 190 * s
    yt1 = yb1 - h
    body = c.union(
        c.poly([(cx - rb, yb1), (cx + rb, yb1), (cx + rt, yt1), (cx - rt, yt1)]), c.ellipse(cx, yb1, rb, rb * ELL)
    )
    c.fill(body, Grad([(0, lighten(col, 0.3)), (0.35, col), (1, darken(col, 0.4))], 0))
    c.fill(c.inter(body, c.rrect(cx - rb * 0.72, yt1 + 20 * s, cx - rb * 0.55, yb1 - 20 * s, 8 * s)), "#FFFFFF", 0.3)
    for i in range(3):
        c.fill(
            c.rrect(cx - rb, yb1 - 38 * s - i * 11 * s, cx + rb, yb1 - 36 * s - i * 11 * s, 1), darken(col, 0.4), 0.35
        )
    c.fill(c.ellipse(cx, yt1, rt, rt * ELL), Grad([(0, lighten(col, 0.45)), (1, lighten(col, 0.1))], 90))
    c.fill(c.ellipse(cx, yt1, rt * 0.2, rt * 0.2 * ELL), darken(col, 0.5))
    # crank
    ax, ay = cx + 6 * s, yt1 - 2 * s
    c.fill(
        c.line([(ax, ay), (ax + 128 * s, ay - 14 * s)], 12 * s),
        Grad([(0, lighten(col, 0.3)), (1, darken(col, 0.3))], 90),
    )
    c.fill(
        c.line([(ax + 128 * s, ay - 14 * s), (ax + 128 * s, ay - 78 * s)], 22 * s),
        Grad([(0, "#D2A670"), (1, "#8A5E36")], 0),
    )
    c.fill(c.ellipse(ax + 128 * s, ay - 14 * s, 11 * s, 11 * s), darken(col, 0.3))
    c.fill(c.ellipse(ax + 123 * s, ay - 60 * s, 3.5 * s, 14 * s), "#FFFFFF", 0.3)
    # lantern emblem
    lantern(c, cx, yt1 + 38 * s, 0.17 * s, frame=ESPRESSO if color == "steel" else CREAM, glow=False, glass="#F3C66B")


def tumbler(c: Canvas, cx, by, s=1.0, color="sage", seed=1):
    col = hexc({"sage": "#5E6E55", "cream": "#EFE4D0", "espresso": "#3A2A22", "copper": "#B4602B"}.get(color, color))
    ink = ESPRESSO if hexc(col)[0] > 150 else CREAM
    rt, rb, H = 100 * s, 78 * s, 420 * s
    yb = by - rb * ELL
    yt = yb - H
    contact_shadow(c, cx, by, rb * 1.4, alpha=0.3, dx=0.22)
    body = c.union(
        c.poly([(cx - rt, yt), (cx + rt, yt), (cx + rb, yb), (cx - rb, yb)]), c.ellipse(cx, yb, rb, rb * ELL)
    )
    c.fill(
        body,
        Grad([(0, lighten(col, 0.28)), (0.3, lighten(col, 0.06)), (0.75, darken(col, 0.1)), (1, darken(col, 0.35))], 0),
    )
    c.fill(
        c.inter(body, c.rrect(cx - rt * 0.8, yt + 40 * s, cx - rt * 0.8 + 11 * s, yb - 20 * s, 5 * s)), "#FFFFFF", 0.32
    )
    c.fill(c.inter(body, c.rrect(cx - rt, yb - 60 * s, cx + rt, yb - 14 * s, 0)), darken(col, 0.18), 0.55)
    lantern(c, cx, yt + 120 * s, 0.34 * s, frame=ink, glow=False, glass="#F3C66B")
    txt(c, cx, yt + 120 * s + 120 * s, "LANTERN", "serif", 20 * s, ink, tracking=4 * s)
    lid = c.rrect(cx - rt - 8 * s, yt - 40 * s, cx + rt + 8 * s, yt + 12 * s, 14 * s)
    c.fill(lid, Grad([(0, "#4A382C"), (1, "#2B1D16")], 0))
    c.fill(c.ellipse(cx, yt - 40 * s, rt + 6 * s, (rt + 6 * s) * ELL), Grad([(0, "#6A5242"), (1, "#3A2A22")], 90))
    c.fill(c.ellipse(cx + 22 * s, yt - 40 * s, 30 * s, 9 * s), "#1B1410")
    c.fill(c.rrect(cx - rt - 8 * s, yt - 40 * s, cx - rt + 4 * s, yt + 10 * s, 6 * s), "#FFFFFF", 0.1)
    c.fill(
        c.sub(
            c.ellipse(cx, yt - 40 * s, rt + 6 * s, (rt + 6 * s) * ELL),
            c.ellipse(cx, yt - 40 * s, rt + 3 * s, (rt + 3 * s) * ELL),
        ),
        "#FFFFFF",
        0.3,
    )
    _ = seed


def gift_box(c: Canvas, cx, by, s=1.0, color="kraft", ribbon="copper", tag="LANTERN", seed=1):
    col = hexc(BAG_COLORS.get(color, color))
    rib = hexc(BAG_COLORS.get(ribbon, ribbon))
    W, Hh, lid_h = 430 * s, 230 * s, 76 * s
    yb = by - 8 * s
    contact_shadow(c, cx, by, W * 0.62, alpha=0.30, dx=0.2)
    front = c.rrect(cx - W / 2, yb - Hh, cx + W / 2, yb, 4 * s)
    c.fill(front, Grad([(0, lighten(col, 0.1)), (0.5, col), (1, darken(col, 0.22))], 0))
    c.fill(c.rrect(cx - W / 2, yb - Hh, cx - W / 2 + 10 * s, yb, 3), "#FFFFFF", 0.14)
    c.fill(c.rrect(cx - W / 2, yb - 8 * s, cx + W / 2, yb, 0), ESPRESSO, 0.12)
    lid = c.rrect(cx - W / 2 - 14 * s, yb - Hh - lid_h * 0.6, cx + W / 2 + 14 * s, yb - Hh + lid_h * 0.4, 5 * s)
    c.shadow(lid, 0, 7 * s, 8 * s, ESPRESSO, 0.28)
    c.fill(lid, Grad([(0, lighten(col, 0.22)), (1, darken(col, 0.06))], 90))
    c.fill(
        c.rrect(cx - W / 2 - 14 * s, yb - Hh - lid_h * 0.6, cx + W / 2 + 14 * s, yb - Hh - lid_h * 0.6 + 5 * s, 2),
        "#FFFFFF",
        0.4,
    )
    # ribbons
    c.fill(
        c.rrect(cx - 30 * s, yb - Hh - lid_h * 0.6, cx + 30 * s, yb, 0),
        Grad([(0, lighten(rib, 0.12)), (1, darken(rib, 0.2))], 0),
    )
    c.fill(c.rrect(cx - 30 * s, yb - Hh - lid_h * 0.6, cx - 24 * s, yb, 0), "#FFFFFF", 0.18)
    c.fill(
        c.rrect(cx - W / 2 - 14 * s, yb - Hh - lid_h * 0.18, cx + W / 2 + 14 * s, yb - Hh - lid_h * 0.18 + 22 * s, 0),
        Grad([(0, lighten(rib, 0.1)), (1, darken(rib, 0.2))], 90),
        0.0,
    )
    # bow
    by0 = yb - Hh - lid_h * 0.6
    for sgn in (-1, 1):
        loop = c.rot_ellipse(cx + sgn * 56 * s, by0 - 20 * s, 64 * s, 30 * s, sgn * -22)
        c.shadow(loop, 0, 4 * s, 4 * s, ESPRESSO, 0.25)
        c.fill(loop, Grad([(0, lighten(rib, 0.2)), (1, darken(rib, 0.25))], 90))
        c.fill(c.rot_ellipse(cx + sgn * 56 * s, by0 - 18 * s, 38 * s, 12 * s, sgn * -22), darken(rib, 0.28), 0.5)
        tail = c.poly(
            [
                (cx + sgn * 8 * s, by0 + 6 * s),
                (cx + sgn * 62 * s, by0 + 64 * s),
                (cx + sgn * 40 * s, by0 + 74 * s),
                (cx + sgn * 2 * s, by0 + 20 * s),
            ]
        )
        c.fill(tail, Grad([(0, lighten(rib, 0.1)), (1, darken(rib, 0.2))], 90))
    c.fill(
        c.rrect(cx - 21 * s, by0 - 28 * s, cx + 21 * s, by0 + 14 * s, 8 * s),
        Grad([(0, lighten(rib, 0.28)), (1, rib)], 90),
    )
    # tag
    tag_m = c.poly(
        [
            (cx + 80 * s, yb - 74 * s),
            (cx + 170 * s, yb - 74 * s),
            (cx + 170 * s, yb - 18 * s),
            (cx + 80 * s, yb - 18 * s),
            (cx + 66 * s, yb - 46 * s),
        ]
    )
    c.shadow(tag_m, 2, 4, 4, ESPRESSO, 0.25)
    c.fill(tag_m, "#FBF5E8")
    c.fill(c.ellipse(cx + 82 * s, yb - 46 * s, 4.5 * s, 4.5 * s), darken(col, 0.3))
    txt(c, cx + 128 * s, yb - 46 * s, tag, "serif", 15 * s, ESPRESSO, tracking=2.6 * s)
    _ = (seed, PARCHMENT, SAGE)

# ruff: noqa: C408, S311  (illustration code: dict() keyword style and seeded, non-cryptographic randomness are intentional)
"""Stylised food: plates, pastries, cakes, cookies, toast, sandwiches and quiche (all on the shared camera angle)."""

from __future__ import annotations

import math
import random

from .canvas import Canvas, Grad, bez, darken, hexc, lighten, mix
from .palette import BREAD, BREAD_DARK, BUTTER, CHOCOLATE, COFFEE, CREAM, ESPRESSO, MILK, SAGE
from .props import ELL, contact_shadow
from .vessels import GLAZES

GOLD_A = "#E9B866"
GOLD_B = "#B8702F"


def plate(c: Canvas, cx, by, rx, glaze="cream", shadow=True) -> tuple[float, float]:
    """A shallow plate. Returns (surface centre y, surface ry)."""
    g = hexc(GLAZES.get(glaze, glaze))
    ry = rx * ELL
    h = 14
    ys = by - h - 0.86 * ry
    if shadow:
        contact_shadow(c, cx, by, rx, alpha=0.30)
    side = c.union(
        c.poly([(cx - rx, ys), (cx + rx, ys), (cx + rx * 0.86, ys + h), (cx - rx * 0.86, ys + h)]),
        c.ellipse(cx, ys + h, rx * 0.86, ry * 0.86),
    )
    c.fill(side, Grad([(0, lighten(g, 0.05)), (0.5, g), (1, darken(g, 0.24))], 0))
    c.fill(c.ellipse(cx, ys, rx, ry), Grad([(0, lighten(g, 0.4)), (1, lighten(g, 0.1))], 90))
    c.fill(c.sub(c.ellipse(cx, ys, rx, ry), c.ellipse(cx, ys, rx - 2.6, ry - 2.6)), lighten(g, 0.6), 0.55)
    c.fill(c.ellipse(cx, ys + 2, rx * 0.72, ry * 0.7), Grad([(0, darken(g, 0.12)), (1, lighten(g, 0.02))], 90), 0.8)
    return ys, ry


def food_shadow(c: Canvas, mask, d=8, a=0.30):
    c.shadow(mask, d * 0.6, d, d * 1.3, ESPRESSO, a)


def _glossy(c: Canvas, mask, base, light=0.28, dark=0.28, angle=90):
    c.fill(mask, Grad([(0, lighten(base, light)), (0.55, base), (1, darken(base, dark))], angle))


def _arc_pts(cx, cy, rx, ry, t0, t1, n):
    return [
        (
            cx + rx * math.cos(math.radians(t0 + (t1 - t0) * i / (n - 1))),
            cy - ry * math.sin(math.radians(t0 + (t1 - t0) * i / (n - 1))),
        )
        for i in range(n)
    ]


def croissant(c: Canvas, cx, ys, s=1.0, almond=False, sugar=False, seed=1):
    rng = random.Random(seed)
    n = 7
    R, Ry = 170 * s, 74 * s
    cy = ys + 18 * s
    pts = _arc_pts(cx, cy, R, Ry, 168, 12, n)
    segs = []
    for i, (x, y) in enumerate(pts):
        t = i / (n - 1)
        k = 1 - abs(t - 0.5) * 2  # 0 at ends, 1 in the middle
        wid = (44 + 44 * k**0.8) * s  # extent along the arc
        hgt = (50 + 92 * k**0.7) * s  # extent across the arc
        tang = 0.0
        # tangent angle of the arc
        if i < n - 1:
            dx, dy = pts[i + 1][0] - x, pts[i + 1][1] - y
        else:
            dx, dy = x - pts[i - 1][0], y - pts[i - 1][1]
        tang = math.degrees(math.atan2(dy, dx))
        segs.append((x, y - 6 * s * k, wid, hgt, tang + 90 if False else tang + 90, k))
    order = sorted(range(n), key=lambda i: -abs(i - (n - 1) / 2))  # draw ends first, centre last
    allm = []
    for i in order:
        x, y, wid, hgt, ang, k = segs[i]
        m = c.rot_ellipse(x, y, wid * 0.62, hgt * 0.5, ang)
        allm.append(m)
    c.shadow(c.union(*allm), 6 * s, 12 * s, 14 * s, ESPRESSO, 0.30)
    for i in order:
        x, y, wid, hgt, ang, k = segs[i]
        m = c.rot_ellipse(x, y, wid * 0.62, hgt * 0.5, ang)
        col_a = mix(GOLD_A, GOLD_B, 0.15 + 0.25 * (1 - k) + rng.uniform(0, 0.1))
        col_b = mix(GOLD_B, ESPRESSO, 0.12 + 0.1 * (1 - k))
        c.fill(m, Grad([(0, lighten(col_a, 0.28)), (0.5, col_a), (1, col_b)], 80))
        c.stroke_outline(m, 2.6 * s, darken(col_b, 0.3), 0.38)
        c.fill(
            c.rot_ellipse(x - wid * 0.05, y - hgt * 0.18, wid * 0.14, hgt * 0.26, ang), "#FFF3D0", 0.30
        )  # glaze sheen
        for _ in range(2):  # lamination flecks
            c.fill(
                c.rot_ellipse(
                    x + rng.uniform(-0.2, 0.2) * wid, y + rng.uniform(-0.3, 0.3) * hgt, 2.0 * s, hgt * 0.1, ang
                ),
                darken(col_b, 0.2),
                0.35,
            )
    if almond:
        for _ in range(34):
            t = rng.uniform(0.1, 0.9)
            x, y = pts[int(t * (n - 1))]
            x += rng.uniform(-50, 50) * s
            y += rng.uniform(-60, 5) * s
            fl = c.rot_ellipse(x, y, 12 * s, 6 * s, rng.uniform(-60, 60))
            c.fill(fl, mix("#F2E2C0", "#C79A5E", rng.uniform(0, 0.4)), 0.95)
    if sugar:
        for _ in range(110):
            t = rng.uniform(0.05, 0.95)
            x, y = pts[int(t * (n - 1))]
            x += rng.uniform(-55, 55) * s
            y += rng.uniform(-70, 6) * s
            c.fill(c.ellipse(x, y, 2.2 * s, 2.0 * s), "#FFFFFF", rng.uniform(0.6, 0.95))


def pain_au_chocolat(c: Canvas, cx, ys, s=1.0):
    w, h = 400 * s, 150 * s
    body = c.rrect(cx - w / 2, ys - h * 0.55, cx + w / 2, ys + h * 0.45, 46 * s)
    food_shadow(c, body, 10 * s)
    c.fill(body, Grad([(0, lighten(GOLD_A, 0.22)), (0.45, GOLD_A), (1, mix(GOLD_B, ESPRESSO, 0.15))], 90))
    for i in range(6):  # laminated folds
        yy = ys - h * 0.42 + i * h * 0.15
        c.fill(
            c.inter(body, c.line([(cx - w / 2 + 30 * s, yy), (cx + w / 2 - 30 * s, yy + 6 * s)], 4 * s)),
            darken(GOLD_B, 0.2),
            0.32,
        )
    for side in (-1, 1):
        e = c.ellipse(cx + side * w / 2 * 0.9, ys - h * 0.05, 30 * s, 52 * s)
        c.fill(c.inter(e, body), Grad([(0, "#5A3426"), (1, "#2A170F")], 90))
        c.fill(c.ellipse(cx + side * w / 2 * 0.9 - 8 * s, ys - h * 0.2, 6 * s, 16 * s), "#FFFFFF", 0.2)
    c.fill(c.inter(body, c.rrect(cx - w * 0.38, ys - h * 0.5, cx + w * 0.3, ys - h * 0.33, 8 * s)), "#FFF1C8", 0.3)
    c.fill(c.inter(body, c.rrect(cx - w * 0.2, ys - h * 0.2, cx + w * 0.34, ys - h * 0.14, 3 * s)), "#FFFFFF", 0.16)


def spiral_bun(c: Canvas, cx, ys, s=1.0, kind="cinnamon", seed=1):
    rng = random.Random(seed)
    rx = 190 * s
    ry = rx * ELL
    hh = 112 * s
    top_y = ys - hh
    body = c.union(
        c.rrect(cx - rx, top_y, cx + rx, ys, 22 * s), c.ellipse(cx, ys, rx, ry), c.ellipse(cx, top_y, rx, ry)
    )
    food_shadow(c, body, 10 * s)
    base_a = "#D9A05C" if kind == "cinnamon" else "#C08040"
    c.fill(
        c.union(c.rrect(cx - rx, top_y, cx + rx, ys, 0), c.ellipse(cx, ys, rx, ry)),
        Grad([(0, lighten(base_a, 0.15)), (0.5, base_a), (1, darken(base_a, 0.3))], 0),
    )
    for k in range(4):  # swirl bands on the side
        yy = top_y + (k + 0.6) * hh / 4.4
        c.fill(
            c.inter(
                c.rrect(cx - rx, top_y, cx + rx, ys, 0),
                c.line(
                    [(cx - rx, yy), (cx - rx * 0.4, yy + 10 * s), (cx + rx * 0.3, yy - 6 * s), (cx + rx, yy + 6 * s)],
                    7 * s,
                ),
            ),
            "#8A4A22",
            0.45,
        )
    top = c.ellipse(cx, top_y, rx, ry)
    c.fill(top, Grad([(0, lighten(base_a, 0.28)), (1, base_a)], 90))
    pts = []
    for i in range(190):
        t = i / 189
        ang = t * math.tau * 3.3
        rr = 0.06 + 0.92 * t
        pts.append((cx + rx * 0.95 * rr * math.cos(ang), top_y + ry * 0.95 * rr * math.sin(ang)))
    c.fill(c.line(pts, 9 * s), "#7A3E1E", 0.78)
    c.fill(c.line([(x, y - 2.5 * s) for x, y in pts], 3.4 * s), "#F0C27D", 0.5)
    if kind == "cinnamon":
        ic = c.union(
            c.ellipse(cx - 30 * s, top_y - 6 * s, rx * 0.56, ry * 0.52),
            c.ellipse(cx + 60 * s, top_y + 6 * s, rx * 0.4, ry * 0.42),
            c.ellipse(cx + 5 * s, top_y + 10 * s, rx * 0.46, ry * 0.46),
        )
        c.shadow(ic, 0, 3 * s, 4 * s, ESPRESSO, 0.25)
        c.fill(ic, Grad([(0, "#FFFFFF"), (1, "#EFE4D0")], 90), 0.96)
    else:
        for _ in range(60):  # pearl sugar
            ang = rng.uniform(0, math.tau)
            rr = math.sqrt(rng.random()) * 0.82
            c.fill(
                c.ellipse(cx + rx * rr * math.cos(ang), top_y + ry * rr * math.sin(ang), 4 * s, 3.4 * s),
                "#FFF8E6",
                0.92,
            )


def muffin(c: Canvas, cx, ys, s=1.0, flavour="blueberry", seed=2):
    rng = random.Random(seed)
    w_t, w_b, h = 290 * s, 210 * s, 125 * s
    liner = c.poly([(cx - w_t / 2, ys - h), (cx + w_t / 2, ys - h), (cx + w_b / 2, ys), (cx - w_b / 2, ys)])
    liner = c.union(liner, c.ellipse(cx, ys, w_b / 2, w_b / 2 * ELL))
    food_shadow(c, liner, 8 * s)
    c.fill(liner, Grad([(0, "#EDE0C4"), (0.5, "#F7F0E3"), (1, "#CDB98F")], 0))
    for i in range(15):
        t = i / 14
        x0 = cx - w_t / 2 + t * w_t
        x1 = cx - w_b / 2 + t * w_b
        c.fill(c.inter(liner, c.line([(x0, ys - h + 4 * s), (x1, ys - 4 * s)], 2.0 * s)), "#B79F72", 0.35)
    dome = c.union(
        c.ellipse(cx, ys - h - 28 * s, w_t / 2 * 1.04, 100 * s),
        c.rrect(cx - w_t / 2, ys - h - 30 * s, cx + w_t / 2, ys - h + 4 * s, 4 * s),
    )
    dome = c.inter(dome, c.rrect(cx - w_t, ys - h - 140 * s, cx + w_t, ys - h + 6 * s, 0))
    top_col = "#C58A44" if flavour != "chocolate" else "#6B3A24"
    c.fill(dome, Grad([(0, lighten(top_col, 0.3)), (0.55, top_col), (1, darken(top_col, 0.3))], 70))
    c.fill(c.rot_ellipse(cx - 55 * s, ys - h - 70 * s, 50 * s, 15 * s, -22), "#FFF1C8", 0.30)
    for _ in range(11):
        x = cx + rng.uniform(-0.8, 0.8) * w_t / 2
        y = ys - h - rng.uniform(20, 80) * s
        if flavour == "blueberry":
            c.fill(c.ellipse(x, y, 12 * s, 10 * s), Grad([(0, "#6A6FB3"), (1, "#2F2F62")], 90))
            c.fill(c.ellipse(x - 3 * s, y - 3 * s, 3.5 * s, 2.5 * s), "#FFFFFF", 0.45)
        else:
            c.fill(c.ellipse(x, y, 7 * s, 5 * s), "#3A2218")
    if flavour == "blueberry":
        for _ in range(40):
            c.fill(
                c.ellipse(cx + rng.uniform(-0.9, 0.9) * w_t * 0.45, ys - h - rng.uniform(8, 90) * s, 2 * s, 2 * s),
                "#FFFFFF",
                0.8,
            )


def cookie(c: Canvas, cx, ys, s=1.0, seed=3, kind="choc"):
    rng = random.Random(seed)
    base = "#C8924D" if kind == "choc" else "#B07F46"
    for i, (dx, dy, rr) in enumerate([(24, 0, 175), (-10, -34, 180)]):
        rx = rr * s
        ry = rx * ELL * 1.05
        x, y = cx + dx * s, ys + dy * s
        th = 30 * s
        edge = c.union(c.ellipse(x, y + th, rx, ry), c.rrect(x - rx, y, x + rx, y + th, 0))
        if i == 0:
            food_shadow(c, edge, 9 * s)
        c.fill(edge, Grad([(0, base), (1, darken(base, 0.4))], 90))
        top = c.ellipse(x, y, rx, ry)
        c.fill(
            top, Grad([(0, lighten(base, 0.3)), (0.7, base), (1, darken(base, 0.12))], 90, "radial", (0.4, 0.4), 1.0)
        )
        c.fill(c.sub(top, c.ellipse(x, y, rx * 0.93, ry * 0.9)), darken(base, 0.28), 0.4)
        n = 12 if i else 10
        for _ in range(n):
            ang = rng.uniform(0, math.tau)
            rr_ = math.sqrt(rng.random()) * 0.8
            px, py = x + rx * rr_ * math.cos(ang), y + ry * rr_ * math.sin(ang)
            chip = c.rot_ellipse(px, py, rng.uniform(17, 26) * s, rng.uniform(9, 13) * s, rng.uniform(-30, 30))
            c.fill(chip, Grad([(0, "#6A3A28"), (1, "#2A170F")], 70))
            c.fill(c.ellipse(px - 5 * s, py - 3 * s, 5 * s, 2 * s), "#FFFFFF", 0.25)
        for _ in range(14):
            ang = rng.uniform(0, math.tau)
            rr_ = math.sqrt(rng.random()) * 0.9
            c.fill(
                c.ellipse(x + rx * rr_ * math.cos(ang), y + ry * rr_ * math.sin(ang), 2.2 * s, 1.5 * s), "#FFF0CC", 0.7
            )


def slab(c: Canvas, x0, yb, w, h, dx, dy):
    """Oblique box. Returns (front, top, right) masks. Front face spans x0..x0+w, yb-h..yb; depth goes up-right."""
    front = c.rrect(x0, yb - h, x0 + w, yb, 4)
    top = c.poly([(x0, yb - h), (x0 + w, yb - h), (x0 + w + dx, yb - h - dy), (x0 + dx, yb - h - dy)])
    right = c.poly([(x0 + w, yb - h), (x0 + w + dx, yb - h - dy), (x0 + w + dx, yb - dy), (x0 + w, yb)])
    return front, top, right


def cake_slice(c: Canvas, cx, ys, s=1.0, kind="carrot", seed=4):
    rng = random.Random(seed)
    w, h, dx, dy = 330 * s, 210 * s, 96 * s, 74 * s
    x0 = cx - (w + dx) / 2
    yb = ys + 8 * s
    front, top, right = slab(c, x0, yb, w, h, dx, dy)
    whole = c.union(front, top, right)
    food_shadow(c, whole, 10 * s)
    if kind == "carrot":
        sponge, cream, frosting = "#B8692E", "#F3E6C8", "#F6EEDC"
        bands = [
            (0.0, 0.26, sponge),
            (0.26, 0.38, cream),
            (0.38, 0.64, sponge),
            (0.64, 0.76, cream),
            (0.76, 1.0, sponge),
        ]
    elif kind == "cheesecake":
        sponge, cream, frosting = "#EAD08A", "#F1DFA6", "#3F2418"
        bands = [(0.0, 0.18, "#8A5530"), (0.18, 1.0, "#F2DDA0")]
    elif kind == "torte":
        sponge, cream, frosting = "#3A1F15", "#5A3426", "#1F100B"
        bands = [
            (0.0, 0.34, "#3A1F15"),
            (0.34, 0.42, "#6A3B2A"),
            (0.42, 0.74, "#3A1F15"),
            (0.74, 0.82, "#6A3B2A"),
            (0.82, 1.0, "#3A1F15"),
        ]
    else:  # lemon loaf
        sponge, cream, frosting = "#F0D56C", "#F7E7A0", "#FFFFFF"
        bands = [(0.0, 1.0, "#F0D878")]
    for f0, f1, col in sorted(bands, key=lambda b: -b[0]):
        yy0 = yb - h + h * f0
        yy1 = yb - h + h * f1
        fr = c.inter(front, c.rrect(x0, yy0, x0 + w, yy1 + 1, 0))
        c.fill(fr, Grad([(0, lighten(col, 0.1)), (1, darken(col, 0.12))], 90))
        ri = c.inter(right, c.poly([(x0 + w, yy0), (x0 + w + dx, yy0 - dy), (x0 + w + dx, yy1 - dy), (x0 + w, yy1)]))
        c.fill(ri, darken(col, 0.22))
    # texture in the sponge
    for _ in range(54):
        px = rng.uniform(x0 + 10 * s, x0 + w - 10 * s)
        py = rng.uniform(yb - h + 14 * s, yb - 14 * s)
        c.fill(
            c.ellipse(px, py, rng.uniform(2, 5) * s, rng.uniform(1.4, 3) * s),
            "#FFFFFF" if kind != "torte" else "#7A4A36",
            0.22,
        )
    if kind == "carrot":
        for _ in range(18):
            px = rng.uniform(x0 + 20 * s, x0 + w - 20 * s)
            py = rng.uniform(yb - h + 14 * s, yb - 10 * s)
            c.fill(c.rot_ellipse(px, py, 11 * s, 6 * s, rng.uniform(-40, 40)), "#8B5A32", 0.8)
    if kind == "cheesecake":
        for i in range(5):
            c.fill(c.rrect(x0 + 10 * s, yb - 14 * s - i * 0, x0 + w - 10 * s, yb - 2 * s, 3 * s), "#D4B070", 0.0)
    # top face
    top_col = {"carrot": frosting, "cheesecake": "#4A2A1A", "torte": "#2A140D", "lemon": "#FFFFFF"}[kind]
    c.fill(top, Grad([(0, lighten(top_col, 0.12)), (1, darken(top_col, 0.1))], 90))
    if kind == "carrot":
        for i in range(6):
            c.fill(
                c.line(
                    [
                        (x0 + 22 * s + i * 52 * s, yb - h - 8 * s),
                        (x0 + 50 * s + i * 52 * s + dx * 0.6, yb - h - dy * 0.7),
                    ],
                    5 * s,
                ),
                "#FFFFFF",
                0.7,
            )
        for k in range(3):
            c.fill(
                c.rot_ellipse(x0 + w * (0.25 + 0.25 * k) + dx * 0.4, yb - h - dy * 0.5, 14 * s, 8 * s, 20 * k),
                "#8B5A32",
            )
        # little carrot
        cx2, cy2 = x0 + w * 0.55 + dx * 0.5, yb - h - dy * 0.55
        c.fill(
            c.poly([(cx2 - 26 * s, cy2 - 14 * s), (cx2 + 26 * s, cy2 - 6 * s), (cx2 - 30 * s, cy2 + 6 * s)]), "#E8822B"
        )
        c.fill(c.rot_ellipse(cx2 + 34 * s, cy2 - 9 * s, 9 * s, 4 * s, -10), "#6F8F4B")
    elif kind == "cheesecake":
        c.fill(top, Grad([(0, (110, 62, 36, 0)), (0.5, (110, 62, 36, 80)), (1, (30, 14, 8, 120))], 60))
        for _ in range(30):
            c.fill(
                c.ellipse(
                    rng.uniform(x0 + 20 * s, x0 + w),
                    rng.uniform(yb - h - dy + 12 * s, yb - h - 6 * s),
                    rng.uniform(4, 12) * s,
                    rng.uniform(2, 4) * s,
                ),
                "#1F100B",
                0.4,
            )
    elif kind == "torte":
        c.fill(c.rot_ellipse(x0 + w * 0.4 + dx * 0.5, yb - h - dy * 0.55, 90 * s, 12 * s, -8), "#FFFFFF", 0.14)
        for k in range(3):
            rx0, ry0 = x0 + w * (0.25 + 0.22 * k) + dx * 0.5, yb - h - dy * (0.42 + 0.15 * (k % 2))
            c.fill(c.ellipse(rx0, ry0, 17 * s, 15 * s), Grad([(0, "#E0455F"), (1, "#8E1B35")], 70))
            c.fill(c.ellipse(rx0 - 5 * s, ry0 - 5 * s, 4 * s, 3 * s), "#FFFFFF", 0.55)
        c.fill(c.rrect(x0 + 6 * s, yb - h - 4 * s, x0 + w - 6 * s, yb - h + 10 * s, 5 * s), "#2A140D", 0.0)
    else:  # lemon
        for k in range(7):
            c.fill(
                c.rrect(
                    x0 + 30 * s + k * 44 * s,
                    yb - h - 6 * s,
                    x0 + 52 * s + k * 44 * s,
                    yb - h + (26 + 14 * (k % 3)) * s,
                    8 * s,
                ),
                "#FFFFFF",
                0.95,
            )
        for k in range(3):
            lx, ly = x0 + w * (0.28 + 0.24 * k) + dx * 0.45, yb - h - dy * 0.5
            c.fill(c.ellipse(lx, ly, 26 * s, 12 * s), "#F2C94C")
            c.fill(c.ellipse(lx, ly, 20 * s, 8 * s), "#FFF2A6")
    # highlight edges
    c.fill(c.rrect(x0, yb - h - 1, x0 + w, yb - h + 3 * s, 2), "#FFFFFF", 0.35)
    c.stroke_outline(whole, 2.0 * s, darken(sponge, 0.45), 0.25)


def toast(c: Canvas, cx, ys, s=1.0, seed=5):
    rng = random.Random(seed)
    w, d, th = 400 * s, 250 * s, 44 * s
    x0, y0 = cx - w / 2, ys - d * 0.5
    slab_front = c.union(c.rrect(x0 + 4 * s, ys - 6 * s, x0 + w - 4 * s, ys + th * 0.6, 18 * s))
    top = c.rrect(x0, y0, x0 + w, y0 + d * 0.62, 56 * s)
    food_shadow(c, c.union(top, slab_front), 12 * s)
    c.fill(
        c.union(top, c.rrect(x0 + 2 * s, y0 + 20 * s, x0 + w - 2 * s, y0 + d * 0.62 + 24 * s, 56 * s)),
        Grad([(0, BREAD_DARK), (1, darken(BREAD_DARK, 0.3))], 90),
    )
    c.fill(top, Grad([(0, lighten(BREAD, 0.22)), (1, BREAD)], 90))
    crumb = c.rrect(x0 + 18 * s, y0 + 12 * s, x0 + w - 18 * s, y0 + d * 0.62 - 12 * s, 40 * s)
    c.fill(crumb, Grad([(0, "#F1D9A2"), (1, "#E3BF7C")], 90))
    # avocado
    av = c.poly(
        bez(
            (x0 + 40 * s, y0 + 90 * s),
            (x0 + 80 * s, y0 + 20 * s),
            (x0 + 200 * s, y0 + 10 * s),
            (x0 + w / 2, y0 + 34 * s),
            20,
        )
        + bez(
            (x0 + w / 2, y0 + 34 * s),
            (x0 + w * 0.7, y0 + 8 * s),
            (x0 + w - 70 * s, y0 + 25 * s),
            (x0 + w - 36 * s, y0 + 92 * s),
            20,
        )
        + bez(
            (x0 + w - 36 * s, y0 + 92 * s),
            (x0 + w - 44 * s, y0 + 168 * s),
            (x0 + w - 120 * s, y0 + 156 * s),
            (x0 + w / 2, y0 + 150 * s),
            20,
        )
        + bez(
            (x0 + w / 2, y0 + 150 * s),
            (x0 + 130 * s, y0 + 160 * s),
            (x0 + 36 * s, y0 + 160 * s),
            (x0 + 40 * s, y0 + 90 * s),
            20,
        )
    )
    c.shadow(av, 0, 5 * s, 6 * s, ESPRESSO, 0.28)
    c.fill(av, Grad([(0, "#B4CB7A"), (0.6, "#8FAE55"), (1, "#6E8F3F")], 80))
    for _ in range(26):
        ax = rng.uniform(x0 + 60 * s, x0 + w - 60 * s)
        ay = rng.uniform(y0 + 40 * s, y0 + 130 * s)
        c.fill(c.rot_ellipse(ax, ay, rng.uniform(12, 30) * s, 3 * s, rng.uniform(-20, 20)), "#CDE29A", 0.4)
    for k in range(4):  # tomato
        tx, ty = x0 + w * (0.22 + 0.19 * k), y0 + 92 * s + (k % 2) * 16 * s
        c.shadow(c.ellipse(tx, ty, 28 * s, 22 * s), 0, 3 * s, 3 * s, ESPRESSO, 0.3)
        c.fill(c.ellipse(tx, ty, 28 * s, 22 * s), Grad([(0, "#E4553E"), (1, "#B22E22")], 90))
        c.fill(c.ellipse(tx, ty, 17 * s, 13 * s), "#F07F66", 0.8)
        c.fill(c.ellipse(tx - 8 * s, ty - 8 * s, 6 * s, 3 * s), "#FFFFFF", 0.5)
    for _ in range(45):  # chilli flakes + seeds
        c.fill(
            c.ellipse(
                rng.uniform(x0 + 60 * s, x0 + w - 60 * s), rng.uniform(y0 + 30 * s, y0 + 140 * s), 2.6 * s, 1.7 * s
            ),
            "#C4361E" if rng.random() < 0.6 else "#FFF3D6",
            0.9,
        )


def sandwich(c: Canvas, cx, ys, s=1.0, layers=("egg", "cheese"), bun="brioche", seed=6, grill=False):
    rng = random.Random(seed)
    w = 420 * s if bun != "ciabatta" else 520 * s
    bot_h, top_h = 54 * s, 96 * s
    lay_h = {"egg": 34, "cheese": 14, "lettuce": 26, "ham": 22, "tomato": 18, "mozz": 22, "basil": 12, "bacon": 14}
    stack_h = sum(lay_h[k] * s for k in layers) + 10 * s
    y_bot_top = ys - bot_h
    shadow_shape = c.rrect(cx - w / 2, ys - bot_h - stack_h - top_h, cx + w / 2, ys, 36 * s)
    food_shadow(c, shadow_shape, 12 * s)
    bun_a = "#D89A4C" if bun != "ciabatta" else "#DDB57A"
    # bottom bun
    bb = c.rrect(cx - w / 2 + 6 * s, y_bot_top, cx + w / 2 - 6 * s, ys, 22 * s)
    c.fill(bb, Grad([(0, lighten(bun_a, 0.1)), (1, darken(bun_a, 0.32))], 90))
    y = y_bot_top
    for k in layers:
        h = lay_h[k] * s
        y -= h
        x0, x1 = cx - w / 2 + 2 * s, cx + w / 2 - 2 * s
        if k == "egg":
            m = c.rrect(x0 + 12 * s, y, x1 - 12 * s, y + h + 6 * s, 14 * s)
            c.fill(m, Grad([(0, "#FFFFFF"), (1, "#EDE4D0")], 90))
            c.fill(c.ellipse(cx + 30 * s, y + h * 0.5, 74 * s, h * 0.55), Grad([(0, "#FFC83A"), (1, "#E69A12")], 90))
            c.fill(c.ellipse(cx + 10 * s, y + h * 0.3, 20 * s, 5 * s), "#FFFFFF", 0.5)
        elif k == "cheese":
            cm = c.poly(
                [
                    (x0 - 6 * s, y),
                    (x1 + 6 * s, y),
                    (x1 + 20 * s, y + h + 22 * s),
                    (x1 - 40 * s, y + h + 6 * s),
                    (cx + 40 * s, y + h + 26 * s),
                    (cx - 70 * s, y + h + 4 * s),
                    (x0 - 12 * s, y + h + 18 * s),
                ]
            )
            c.fill(cm, Grad([(0, "#F6A83B"), (1, "#E0862A")], 90))
        elif k == "lettuce":
            pts = [(x0 - 10 * s, y + h)]
            for i in range(16):
                pts.append((x0 - 10 * s + (w + 20 * s) * (i + 0.5) / 16, y + (3 if i % 2 else h * 0.2) * s))
            pts.append((x1 + 10 * s, y + h))
            c.fill(c.poly(pts), Grad([(0, "#A8C26B"), (1, "#6E8F3F")], 90))
        elif k == "ham":
            c.fill(
                c.rrect(x0 - 8 * s, y, x1 + 8 * s, y + h + 10 * s, 12 * s), Grad([(0, "#F0A9A0"), (1, "#D77E78")], 90)
            )
            c.fill(c.line([(x0, y + h * 0.4), (x1, y + h * 0.5)], 3 * s), "#F7C9C2", 0.5)
        elif k == "tomato":
            for i in range(4):
                tx = x0 + 40 * s + i * (w - 80 * s) / 3
                c.fill(c.ellipse(tx, y + h * 0.55, 44 * s, h * 0.62), Grad([(0, "#E4553E"), (1, "#B22E22")], 90))
        elif k == "mozz":
            for i in range(3):
                tx = x0 + 60 * s + i * (w - 120 * s) / 2
                c.fill(c.ellipse(tx, y + h * 0.5, 60 * s, h * 0.7), Grad([(0, "#FFFFFF"), (1, "#EBE1CC")], 90))
        elif k == "basil":
            for i in range(5):
                tx = x0 + 30 * s + i * (w - 60) / 4 * 1.0
                c.fill(
                    c.rot_ellipse(tx, y + h * 0.5, 26 * s, 10 * s, rng.uniform(-30, 30)),
                    Grad([(0, "#7FA25A"), (1, "#3F6A34")], 90),
                )
        elif k == "bacon":
            c.fill(c.rrect(x0 + 4 * s, y, x1 - 4 * s, y + h, 6 * s), "#A93B2C")
            for i in range(9):
                c.fill(
                    c.line([(x0 + 30 * s + i * 42 * s, y + 2 * s), (x0 + 50 * s + i * 42 * s, y + h - 2 * s)], 6 * s),
                    "#E9A087",
                    0.6,
                )
    # top bun / bread
    if bun == "ciabatta":
        tb = c.rrect(cx - w / 2, y - top_h, cx + w / 2, y + 12 * s, 56 * s)
    else:
        tb = c.union(
            c.ellipse(cx, y - top_h * 0.28, w / 2, top_h * 0.78),
            c.rrect(cx - w / 2, y - top_h * 0.3, cx + w / 2, y + 12 * s, 14 * s),
        )
        tb = c.inter(tb, c.rrect(cx - w / 2 - 4, y - top_h * 1.2, cx + w / 2 + 4, y + 12 * s, 0))
    c.shadow(tb, 0, -2 * s, 5 * s, ESPRESSO, 0.15)
    c.fill(tb, Grad([(0, lighten(bun_a, 0.35)), (0.5, bun_a), (1, darken(bun_a, 0.28))], 80))
    c.fill(c.rot_ellipse(cx - w * 0.2, y - top_h * 0.62, w * 0.14, top_h * 0.09, -8), "#FFF1C8", 0.35)
    if bun == "brioche":
        for _ in range(36):
            c.fill(
                c.rot_ellipse(
                    cx + rng.uniform(-0.38, 0.38) * w,
                    y - top_h * rng.uniform(0.15, 0.7),
                    4.2 * s,
                    2.2 * s,
                    rng.uniform(-70, 70),
                ),
                "#FFF4D6",
                0.92,
            )
    elif bun == "ciabatta":
        for _ in range(60):
            c.fill(
                c.ellipse(
                    cx + rng.uniform(-0.45, 0.45) * w,
                    y - top_h * rng.uniform(0.05, 0.85),
                    rng.uniform(1.6, 3.4) * s,
                    1.4 * s,
                ),
                "#FFFFFF",
                0.5,
            )
        for k in range(3):
            c.fill(
                c.line(
                    [(cx - w * 0.3 + k * w * 0.3, y - top_h * 0.78), (cx - w * 0.2 + k * w * 0.3, y - top_h * 0.2)],
                    3 * s,
                ),
                darken(bun_a, 0.3),
                0.35,
            )
    if grill:
        for k in range(5):
            gx = cx - w * 0.36 + k * w * 0.18
            c.fill(
                c.inter(tb, c.line([(gx, y - top_h * 0.9), (gx + 50 * s, y - top_h * 0.1)], 11 * s)), "#6A3A1F", 0.55
            )


def quiche(c: Canvas, cx, ys, s=1.0, seed=7):
    rng = random.Random(seed)
    w, h, dx, dy = 340 * s, 150 * s, 100 * s, 80 * s
    x0 = cx - (w + dx) / 2
    yb = ys + 6 * s
    front, top, right = slab(c, x0, yb, w, h, dx, dy)
    food_shadow(c, c.union(front, top, right), 10 * s)
    c.fill(right, Grad([(0, "#B9772F"), (1, "#8C5420")], 90))
    c.fill(front, Grad([(0, "#E7B96C"), (1, "#B9772F")], 90))
    # fluted crust marks
    for i in range(12):
        xx = x0 + 14 * s + i * (w - 28 * s) / 11
        c.fill(c.rrect(xx - 4 * s, yb - h * 0.9, xx + 4 * s, yb - 6 * s, 3 * s), "#8C5420", 0.35)
    # filling visible at the cut face (inset)
    cut = c.rrect(x0 + 18 * s, yb - h * 0.92, x0 + w - 18 * s, yb - 22 * s, 6 * s)
    c.fill(cut, Grad([(0, "#FBE79A"), (1, "#F0CE62")], 90))
    for _ in range(26):
        c.fill(
            c.rot_ellipse(
                rng.uniform(x0 + 30 * s, x0 + w - 30 * s),
                rng.uniform(yb - h * 0.85, yb - 30 * s),
                rng.uniform(5, 11) * s,
                3.4 * s,
                rng.uniform(0, 90),
            ),
            "#5E8A3C",
            0.8,
        )
    for _ in range(8):
        c.fill(
            c.rrect(
                *(lambda a, b: (a, b, a + 16 * s, b + 11 * s))(
                    rng.uniform(x0 + 30 * s, x0 + w - 50 * s), rng.uniform(yb - h * 0.8, yb - 40 * s)
                ),
                2 * s,
            ),
            "#FFFFFF",
            0.95,
        )
    c.fill(top, Grad([(0, "#F2D77C"), (1, "#E3B24F")], 90))
    c.fill(
        c.poly(
            [
                (x0 + 10 * s, yb - h),
                (x0 + w - 10 * s, yb - h),
                (x0 + w + dx - 12 * s, yb - h - dy + 8 * s),
                (x0 + dx + 12 * s, yb - h - dy + 8 * s),
            ]
        ),
        "#F6E08C",
        0.0,
    )
    for _ in range(18):
        px, py = rng.uniform(x0 + dx * 0.4, x0 + w + dx * 0.6), rng.uniform(yb - h - dy * 0.8, yb - h - 6 * s)
        c.fill(c.rot_ellipse(px, py, rng.uniform(6, 12) * s, 3.6 * s, rng.uniform(0, 90)), "#5E8A3C", 0.85)
    for _ in range(4):
        px, py = rng.uniform(x0 + dx * 0.5, x0 + w + dx * 0.4), rng.uniform(yb - h - dy * 0.7, yb - h - 10 * s)
        c.fill(c.rrect(px, py, px + 16 * s, py + 9 * s, 2 * s), "#FFFFFF", 0.95)
    c.fill(
        c.poly([(x0, yb - h), (x0 + dx, yb - h - dy), (x0 + dx + 10 * s, yb - h - dy), (x0 + 10 * s, yb - h)]),
        "#C58A44",
        0.0,
    )
    c.fill(c.rrect(x0, yb - h - 3 * s, x0 + w, yb - h + 4 * s, 3), "#F2C77C", 0.8)
    _ = (BUTTER, CHOCOLATE, COFFEE, CREAM, MILK, SAGE)

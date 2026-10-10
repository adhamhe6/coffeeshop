# ruff: noqa: C408, S311  (illustration code: dict() keyword style and seeded, non-cryptographic randomness are intentional)
"""Drink vessels: ceramic cups/mugs/bowls with latte art and tall glasses with ice, layers and toppings."""

from __future__ import annotations

import math
import random

from PIL import Image

from .canvas import Canvas, Grad, darken, hexc, lighten, mix
from .palette import (
    COFFEE,
    CREMA,
    ESPRESSO,
    FOAM,
    MILK,
    SAGE,
)
from .props import ELL, contact_shadow, steam

# ----------------------------------------------------------------------------- liquid surface art (flat, top view)


def _heart_pts(cx, cy, size, squash=1.0):
    pts = []
    for i in range(72):
        t = math.tau * i / 72
        x = 16 * math.sin(t) ** 3
        y = -(13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t))
        pts.append((cx + x * size / 17, cy + y * size / 17 * squash))
    return pts


def surface_art(kind: str, base, accent, d: int = 240, seed: int = 1) -> Image.Image:
    """Return an RGBA square (supersampled x2) of the liquid surface seen from straight above; caller squashes it."""
    a = Canvas(d, d, 2)
    cx = cy = d / 2
    R = d / 2
    rng = random.Random(seed)
    base, accent = hexc(base), hexc(accent)
    disc = a.ellipse(cx, cy, R, R)
    if kind == "crema":
        a.fill(
            disc, Grad([(0, lighten(base, 0.25)), (0.55, base), (1, darken(base, 0.42))], 0, "radial", (0.5, 0.5), 1.0)
        )
        for _ in range(26):  # tiger-stripe mottling
            ang = rng.uniform(0, math.tau)
            rr = rng.uniform(0.15, 0.85) * R
            x, y = cx + rr * math.cos(ang), cy + rr * math.sin(ang)
            a.fill(
                a.rot_ellipse(x, y, rng.uniform(14, 34), rng.uniform(4, 8), math.degrees(ang) + 90),
                lighten(base, 0.3),
                0.30,
            )
        for _ in range(18):
            ang = rng.uniform(0, math.tau)
            rr = rng.uniform(0.3, 0.95) * R
            x, y = cx + rr * math.cos(ang), cy + rr * math.sin(ang)
            a.fill(
                a.rot_ellipse(x, y, rng.uniform(10, 26), rng.uniform(3, 6), math.degrees(ang) + 90),
                darken(base, 0.4),
                0.30,
            )
        a.fill(a.rot_ellipse(cx - R * 0.3, cy - R * 0.35, R * 0.36, R * 0.1, -35), "#FFFFFF", 0.20)
    elif kind in ("heart", "tulip", "rosetta", "dot", "swirl", "leaf"):
        a.fill(
            disc, Grad([(0, lighten(base, 0.12)), (0.72, base), (1, darken(base, 0.3))], 0, "radial", (0.5, 0.5), 1.0)
        )
        ring = a.sub(disc, a.ellipse(cx, cy, R * 0.9, R * 0.9))
        a.fill(ring, darken(base, 0.28), 0.55)
        art = hexc(accent)
        edge = darken(base, 0.38)
        if kind == "heart":
            a.fill(a.poly(_heart_pts(cx, cy + 4, R * 1.34)), art)
            a.fill(a.poly(_heart_pts(cx, cy + 8, R * 0.95)), base, 0.55)
            a.fill(a.poly(_heart_pts(cx, cy + 10, R * 0.62)), art)
            a.fill(a.poly(_heart_pts(cx, cy + 12, R * 0.3)), base, 0.5)
        elif kind == "tulip":
            for i, (sz, dy) in enumerate([(1.05, 28), (0.82, 8), (0.58, -10), (0.34, -26)]):
                a.fill(a.poly(_heart_pts(cx, cy + dy, R * sz)), art if i % 2 == 0 else base, 1.0)
            a.fill(a.line([(cx, cy - 6), (cx, cy + R * 0.92)], 5), art)
        elif kind == "rosetta":
            n = 7
            for i in range(n):
                t = i / (n - 1)
                yy = cy + R * 0.58 - t * R * 1.24
                rw = R * (0.80 - 0.50 * t)
                rh = R * (0.20 - 0.05 * t)
                a.fill(a.ellipse(cx, yy, rw, rh), art)
                a.fill(
                    a.sub(
                        a.ellipse(cx, yy + rh * 0.35, rw * 0.97, rh * 0.92),
                        a.ellipse(cx, yy - rh * 0.3, rw * 0.93, rh * 0.92),
                    ),
                    base,
                    0.34,
                )
            a.fill(a.line([(cx, cy + R * 0.9), (cx + 1, cy - R * 0.78)], 4.0), edge, 0.82)
            a.fill(a.ellipse(cx, cy + R * 0.84, R * 0.09, R * 0.065), art)
        elif kind == "dot":
            a.fill(a.ellipse(cx, cy + 4, R * 0.43, R * 0.43), darken(art, 0.12))
            a.fill(
                a.ellipse(cx, cy, R * 0.4, R * 0.4),
                Grad([(0, lighten(art, 0.3)), (1, art)], 90, "radial", (0.4, 0.35), 1.0),
            )
            a.fill(a.ellipse(cx - R * 0.12, cy - R * 0.14, R * 0.1, R * 0.07), "#FFFFFF", 0.5)
        elif kind == "swirl":
            pts = []
            for i in range(160):
                t = i / 159
                ang = t * math.tau * 3.1
                rr = (0.08 + 0.78 * t) * R
                pts.append((cx + rr * math.cos(ang), cy + rr * math.sin(ang)))
            a.fill(a.line(pts, 9), art, 0.95)
            a.fill(a.line([(x - 1.5, y - 1.5) for x, y in pts], 2.4), "#FFFFFF", 0.25)
        elif kind == "leaf":
            for i in range(3):
                yy = cy + R * (0.45 - i * 0.38)
                a.fill(a.ellipse(cx, yy, R * (0.62 - i * 0.14), R * 0.2), art)
            a.fill(a.line([(cx, cy + R * 0.75), (cx, cy - R * 0.75)], 4.5), edge, 0.75)
    elif kind == "foam":
        a.fill(
            disc, Grad([(0, lighten(base, 0.22)), (0.8, base), (1, darken(base, 0.18))], 0, "radial", (0.5, 0.5), 1.0)
        )
        ring = a.sub(disc, a.ellipse(cx, cy, R * 0.84, R * 0.84))
        a.fill(ring, accent, 0.62)
        for _ in range(240):  # cocoa dusting
            ang = rng.uniform(0, math.tau)
            rr = math.sqrt(rng.random()) * R * 0.82
            x, y = cx + rr * math.cos(ang), cy + rr * math.sin(ang)
            r_ = rng.uniform(0.9, 2.6)
            a.fill(a.ellipse(x, y, r_, r_), accent, rng.uniform(0.35, 0.8))
        for k in range(3):
            a.fill(a.ellipse(cx - R * 0.22 + k * 6, cy - R * 0.28 + k * 3, R * 0.22, R * 0.08), "#FFFFFF", 0.25)
    elif kind == "plain":
        a.fill(
            disc, Grad([(0, lighten(base, 0.22)), (0.6, base), (1, darken(base, 0.3))], 0, "radial", (0.42, 0.4), 1.0)
        )
        a.fill(a.rot_ellipse(cx - R * 0.3, cy - R * 0.34, R * 0.42, R * 0.1, -30), "#FFFFFF", 0.20)
        a.fill(a.rot_ellipse(cx + R * 0.35, cy + R * 0.4, R * 0.26, R * 0.05, -30), "#FFFFFF", 0.1)
    elif kind == "choco":
        a.fill(
            disc, Grad([(0, lighten(base, 0.18)), (0.7, base), (1, darken(base, 0.35))], 0, "radial", (0.5, 0.5), 1.0)
        )
        a.fill(a.rot_ellipse(cx - R * 0.3, cy - R * 0.34, R * 0.42, R * 0.1, -30), "#FFFFFF", 0.17)
        for _ in range(7):
            ang = rng.uniform(0, math.tau)
            rr = rng.uniform(0.2, 0.75) * R
            a.fill(a.ellipse(cx + rr * math.cos(ang), cy + rr * math.sin(ang), 5, 5), lighten(base, 0.35), 0.5)
    elif kind == "matcha":
        a.fill(
            disc, Grad([(0, lighten(base, 0.2)), (0.7, base), (1, darken(base, 0.28))], 0, "radial", (0.5, 0.5), 1.0)
        )
        for _ in range(110):
            ang = rng.uniform(0, math.tau)
            rr = math.sqrt(rng.random()) * R * 0.9
            r_ = rng.uniform(1.4, 4.2)
            a.fill(a.ellipse(cx + rr * math.cos(ang), cy + rr * math.sin(ang), r_, r_), lighten(base, 0.5), 0.5)
        a.fill(a.rot_ellipse(cx - R * 0.28, cy - R * 0.34, R * 0.4, R * 0.1, -30), "#FFFFFF", 0.22)
    elif kind == "tea":
        a.fill(
            disc, Grad([(0, lighten(base, 0.35)), (0.6, base), (1, darken(base, 0.35))], 0, "radial", (0.42, 0.4), 1.0)
        )
        a.fill(a.rot_ellipse(cx - R * 0.3, cy - R * 0.34, R * 0.44, R * 0.1, -30), "#FFFFFF", 0.35)
        for k in range(2):
            a.fill(a.ellipse(cx + R * (0.28 - 0.5 * k), cy + R * 0.3, R * 0.25, R * 0.25), "#FFFFFF", 0.0)
    else:
        a.fill(disc, base)
    out = a.img
    mask = Image.new("L", out.size, 0)
    mask.paste(disc.img, (disc.x, disc.y))
    out.putalpha(Image.composite(out.getchannel("A"), Image.new("L", out.size, 0), mask))
    return out


def paste_surface(c: Canvas, cx, cy, rx, kind, base, accent, seed=1, ratio=ELL) -> None:
    """Squash a top-view surface into the cup/glass ellipse and composite with a clipped edge."""
    art = surface_art(kind, base, accent, seed=seed)
    ry = rx * ratio
    w, h = int(round(rx * 2 * c.ss)), int(round(ry * 2 * c.ss))
    art = art.resize((max(w, 2), max(h, 2)), Image.LANCZOS)
    mask = c.ellipse(cx, cy, rx, ry)
    lay = c.sublayer(cx - rx - 2, cy - ry - 2, cx + rx + 2, cy + ry + 2)
    lay.img.alpha_composite(
        art, (int(round(cx * c.ss - rx * c.ss)) - lay.ox, int(round(cy * c.ss - ry * c.ss)) - lay.oy)
    )
    c.paste(lay, clip=mask)


# ------------------------------------------------------------------------------------------------ ceramic cups

CUP_SHAPES = {
    #           width, height, foot ratio, curve, saucer ratio, handle size (0 = none)
    "demi": dict(W=250, Hc=150, F=0.60, curve=1.55, saucer=1.62, handle=0.62, lip=9),
    "cup": dict(W=380, Hc=236, F=0.52, curve=1.7, saucer=1.34, handle=0.92, lip=11),
    "tea": dict(W=340, Hc=214, F=0.50, curve=1.6, saucer=1.40, handle=0.82, lip=9),
    "mug": dict(W=330, Hc=300, F=0.90, curve=1.0, saucer=0, handle=1.0, lip=12),
    "bowl": dict(W=470, Hc=214, F=0.44, curve=1.25, saucer=0, handle=0, lip=12),
    "tall_mug": dict(W=300, Hc=330, F=0.86, curve=1.0, saucer=0, handle=1.05, lip=12),
}

GLAZES = {
    "cream": "#F3EBDC",
    "white": "#FAF6EE",
    "sage": "#6E8062",
    "copper": "#B4602B",
    "espresso": "#3A2A22",
    "sand": "#D8C3A0",
    "blue": "#5F7C88",
    "rose": "#D9A495",
    "mustard": "#D0A23C",
    "terracotta": "#C7745A",
}


def _cup_profile(cx, yt, yb, rx, rxf, curve, n=34):
    left, right = [], []
    for i in range(n + 1):
        t = i / n
        y = yt + (yb - yt) * t
        x = rxf + (rx - rxf) * (1 - t**curve)
        left.append((cx - x, y))
        right.append((cx + x, y))
    return left, right


def ceramic_cup(
    c: Canvas,
    cx,
    by,
    s=1.0,
    *,
    shape="cup",
    glaze="cream",
    surface="crema",
    base=CREMA,
    accent=MILK,
    saucer=None,
    level=0.0,
    steam_on=True,
    seed=1,
    foam_dome=False,
    interior=None,
    shadow=True,
    empty=False,
):
    """Draw a cup on its saucer. Returns a dict of useful anchor points (rim centre y, rx, liquid ellipse)."""
    p = CUP_SHAPES[shape]
    glaze_c = hexc(GLAZES.get(glaze, glaze))
    W, Hc, F = p["W"] * s, p["Hc"] * s, p["F"]
    rx = W / 2
    ry = rx * ELL
    rxf = rx * F
    ryf = rxf * ELL
    use_saucer = p["saucer"] > 0 if saucer is None else saucer
    sau_rx = rx * p["saucer"] if use_saucer else 0
    sau_ry = sau_rx * ELL
    sau_h = 15 * s if use_saucer else 0
    ys = by - sau_h - 0.84 * sau_ry  # saucer rim ellipse centre
    yb = (ys + sau_ry * 0.30 - ryf) if use_saucer else by - ryf  # foot ellipse centre
    yt = yb - Hc  # rim ellipse centre
    if shadow:
        contact_shadow(c, cx, by, (sau_rx or rx) * 1.0, alpha=0.30)
    if use_saucer:
        side = c.union(
            c.poly(
                [
                    (cx - sau_rx, ys),
                    (cx + sau_rx, ys),
                    (cx + sau_rx * 0.84, ys + sau_h),
                    (cx - sau_rx * 0.84, ys + sau_h),
                ]
            ),
            c.ellipse(cx, ys + sau_h, sau_rx * 0.84, sau_ry * 0.84),
        )
        c.fill(side, Grad([(0, lighten(glaze_c, 0.04)), (0.5, glaze_c), (1, darken(glaze_c, 0.24))], 0))
        c.fill(c.ellipse(cx, ys, sau_rx, sau_ry), Grad([(0, lighten(glaze_c, 0.38)), (1, lighten(glaze_c, 0.08))], 90))
        c.fill(
            c.sub(c.ellipse(cx, ys, sau_rx, sau_ry), c.ellipse(cx, ys, sau_rx - 2.4 * s, sau_ry - 2.4 * s)),
            lighten(glaze_c, 0.6),
            0.55,
        )
        c.fill(
            c.ellipse(cx, ys + 2 * s, sau_rx * 0.64, sau_ry * 0.64),
            Grad([(0, darken(glaze_c, 0.14)), (1, lighten(glaze_c, 0.02))], 90),
            0.85,
        )
    # handle (behind body)
    if p["handle"]:
        hs = p["handle"]
        left, right = _cup_profile(cx, yt, yb, rx, rxf, p["curve"])
        xm = right[int(len(right) * 0.42)][0]
        hw = 78 * hs * s
        hh = Hc * (0.62 if shape != "mug" else 0.66)
        hy = yt + Hc * 0.46
        th = 17 * s * (1.0 if shape != "demi" else 0.85)
        if shape in ("mug", "tall_mug"):
            outer = c.rrect(xm - 14 * s, hy - hh / 2, xm + hw, hy + hh / 2, hh * 0.46)
            inner = c.rrect(xm - 14 * s + th, hy - hh / 2 + th, xm + hw - th, hy + hh / 2 - th, hh * 0.3)
        else:
            outer = c.ellipse(xm + hw * 0.15, hy, hw * 0.88, hh / 2)
            inner = c.ellipse(xm + hw * 0.15, hy, hw * 0.88 - th, hh / 2 - th * 1.05)
        ring = c.sub(outer, inner)
        c.shadow(ring, 4, 6, 6, ESPRESSO, 0.22)
        c.fill(ring, Grad([(0, lighten(glaze_c, 0.12)), (1, darken(glaze_c, 0.22))], 40))
    # body
    left, right = _cup_profile(cx, yt, yb, rx, rxf, p["curve"])
    # a lower bowl bulge so the bottom is round rather than a flat-cut ellipse
    bowl = c.poly(left + right[::-1])
    bowl = c.union(bowl, c.ellipse(cx, yb, rxf, ryf))
    c.fill(
        bowl,
        Grad(
            [
                (0, lighten(glaze_c, 0.22)),
                (0.3, lighten(glaze_c, 0.06)),
                (0.75, darken(glaze_c, 0.05)),
                (1, darken(glaze_c, 0.2)),
            ],
            0,
        ),
    )
    # soft vertical shade near the foot
    c.fill(bowl, Grad([(0, (0, 0, 0, 0)), (0.72, (0, 0, 0, 0)), (1, (60, 36, 24, 46))], 90))
    # specular strip + thin glaze line
    sx = cx - rx * 0.62
    c.fill(c.inter(bowl, c.rrect(sx, yt + ry * 0.7, sx + 16 * s, yb - 8 * s, 8 * s)), "#FFFFFF", 0.35)
    c.fill(c.inter(bowl, c.rrect(sx + 24 * s, yt + ry * 0.9, sx + 30 * s, yb - 30 * s, 3 * s)), "#FFFFFF", 0.18)
    # rim: outer ellipse (top face of rim), inner wall, liquid
    rim = c.ellipse(cx, yt, rx, ry)
    c.fill(rim, Grad([(0, lighten(glaze_c, 0.45)), (1, lighten(glaze_c, 0.12))], 90))
    lip = p["lip"] * s
    inner_rx, inner_ry = rx - lip, ry - lip * ELL * 1.05
    inner = c.ellipse(cx, yt + 1.5 * s, inner_rx, inner_ry)
    wall = interior or mix(glaze_c, "#6B4A3A", 0.22)
    c.fill(inner, Grad([(0, darken(wall, 0.08)), (1, lighten(wall, 0.05))], 90))
    liq_rx = inner_rx - 3.5 * s
    liq_ry = liq_rx * ELL
    liq_cy = yt + 3 * s + 16 * s * (1 - level) * (1.0 if shape != "bowl" else 0.7)
    if empty:
        c.fill(
            c.ellipse(cx, yt + 12 * s, inner_rx - 6 * s, (inner_rx - 6 * s) * ELL),
            Grad([(0, darken(wall, 0.2)), (1, lighten(wall, 0.1))], 90),
            0.7,
        )
    else:
        c.fill(
            c.ellipse(cx, liq_cy + 3 * s, liq_rx + 2 * s, liq_ry + 2 * s), darken(base, 0.45), 0.55
        )  # meniscus shade
        paste_surface(c, cx, liq_cy, liq_rx, surface, base, accent, seed=seed)
    if foam_dome:
        pass
    # rim highlight line
    c.fill(c.sub(c.ellipse(cx, yt, rx, ry), c.ellipse(cx, yt, rx - 2.2 * s, ry - 2 * s)), lighten(glaze_c, 0.65), 0.7)
    if steam_on:
        steam(c, cx - rx * 0.05, yt - ry * 0.4, h=210 * s, n=3, spread=40 * s, width=17 * s, seed=seed)
    return dict(cx=cx, yt=yt, yb=yb, rx=rx, ry=ry, liq_cy=liq_cy, liq_rx=liq_rx, top=yt - ry)


# ---------------------------------------------------------------------------------------------------- tall glass


def _superellipse(cx, cy, r, ang, n=4.0, k=40):
    pts = []
    for i in range(k):
        t = math.tau * i / k
        ct, st = math.cos(t), math.sin(t)
        x = r * math.copysign(abs(ct) ** (2 / n), ct)
        y = r * math.copysign(abs(st) ** (2 / n), st)
        pts.append((cx + x, cy + y))
    a = math.radians(ang)
    return [
        (cx + (x - cx) * math.cos(a) - (y - cy) * math.sin(a), cy + (x - cx) * math.sin(a) + (y - cy) * math.cos(a))
        for x, y in pts
    ]


def ice_cube(c: Canvas, x, y, r, ang, tint=(215, 236, 245), alpha=0.55) -> None:
    m = c.poly(_superellipse(x, y, r, ang, 4.2))
    c.fill(
        m,
        Grad(
            [(0, (*tint, int(255 * min(1, alpha + 0.18)))), (1, (*darken(tint, 0.2)[:3], int(255 * alpha * 0.8)))], 60
        ),
    )
    c.stroke_outline(m, 2.4, (255, 255, 255), 0.75)
    inner = c.poly(_superellipse(x - r * 0.06, y - r * 0.06, r * 0.62, ang, 4.2))
    c.fill(inner, (255, 255, 255), 0.18)
    c.stroke_outline(inner, 1.4, (255, 255, 255), 0.45)
    c.fill(c.rot_ellipse(x - r * 0.42, y - r * 0.5, r * 0.22, r * 0.07, ang - 35), (255, 255, 255), 0.85)


def _draw_straw(c: Canvas, x0, y0, x1, y1, w, c1, c2, clip: Canvas | None = None) -> None:
    dx, dy = x1 - x0, y1 - y0
    ln = math.hypot(dx, dy)
    ux, uy = dx / ln, dy / ln
    nx, ny = -uy, ux
    quad = c.poly(
        [
            (x0 + nx * w / 2, y0 + ny * w / 2),
            (x1 + nx * w / 2, y1 + ny * w / 2),
            (x1 - nx * w / 2, y1 - ny * w / 2),
            (x0 - nx * w / 2, y0 - ny * w / 2),
        ]
    )
    c.fill(quad, c1)
    n = int(ln / (w * 1.6))
    for i in range(n):
        t0 = (i * 2) * w * 0.8
        a = (x0 + ux * t0, y0 + uy * t0)
        b = (x0 + ux * (t0 + w * 0.8), y0 + uy * (t0 + w * 0.8))
        if (i * 2 + 1) * w * 0.8 > ln:
            break
        sq = c.poly(
            [
                (a[0] + nx * w / 2, a[1] + ny * w / 2),
                (b[0] + nx * w / 2, b[1] + ny * w / 2),
                (b[0] - nx * w / 2, b[1] - ny * w / 2),
                (a[0] - nx * w / 2, a[1] - ny * w / 2),
            ]
        )
        c.fill(c.inter(sq, quad), c2, 0.95)
    c.fill(
        c.inter(
            quad, c.line([(x0 + nx * w * 0.2, y0 + ny * w * 0.2), (x1 + nx * w * 0.2, y1 + ny * w * 0.2)], w * 0.22)
        ),
        (255, 255, 255),
        0.35,
    )
    c.fill(c.ellipse(x1, y1, w / 2, w / 2 * 0.5), darken(c1, 0.25))


def whipped_cream(c: Canvas, cx, y, w, s=1.0, tiers=3, col=MILK) -> float:
    """Piped swirl standing on a surface at y (its base). Returns top y."""
    cur = y
    ww = w
    for i in range(tiers):
        h = 52 * s * (1.0 - i * 0.05)
        blob = c.union(
            c.ellipse(cx, cur - h * 0.35, ww / 2, h * 0.62),
            c.rrect(cx - ww / 2 * 0.92, cur - h, cx + ww / 2 * 0.92, cur - h * 0.3, h * 0.4),
        )
        c.shadow(blob, 0, 4, 5, ESPRESSO, 0.25)
        c.fill(blob, Grad([(0, lighten(col, 0.35)), (0.5, col), (1, darken(col, 0.13))], 90))
        for k in range(3):  # piping ridges
            xr = cx - ww * 0.3 + k * ww * 0.3
            c.fill(
                c.line([(xr - ww * 0.07, cur - h * 0.2), (xr + ww * 0.12, cur - h * 0.88)], 2.2 * s),
                darken(col, 0.18),
                0.5,
            )
        cur -= h * 0.72
        ww *= 0.72
    tip = c.poly([(cx - ww * 0.55, cur + 8 * s), (cx + ww * 0.5, cur + 8 * s), (cx + ww * 0.12, cur - 44 * s)])
    c.fill(tip, Grad([(0, lighten(col, 0.3)), (1, darken(col, 0.08))], 90))
    return cur - 44 * s


def tall_glass(
    c: Canvas,
    cx,
    by,
    s=1.0,
    *,
    H=540,
    top_w=270,
    bot_w=206,
    layers=(("#6B3E26", 1.0),),
    fill=0.84,
    ice=4,
    straw=("#B4602B", "#F7F0E3"),
    topping=None,
    garnish=None,
    seed=1,
    dew=True,
    foam=None,
    surface=None,
    glass_tint=(255, 255, 255),
    flowers=0,
    shadow=True,
):
    rng = random.Random(seed)
    rx_t, rx_b = top_w / 2 * s, bot_w / 2 * s
    ry_t, ry_b = rx_t * ELL, rx_b * ELL
    Hs = H * s
    yb = by - ry_b
    yt = yb - Hs

    def half_w(y):
        return rx_b + (rx_t - rx_b) * (yb - y) / Hs

    if shadow:
        contact_shadow(c, cx, by, rx_b * 1.25, alpha=0.30, dx=0.22)
    body_poly = c.poly([(cx - rx_t, yt), (cx + rx_t, yt), (cx + rx_b, yb), (cx - rx_b, yb)])
    body = c.union(body_poly, c.ellipse(cx, yb, rx_b, ry_b), c.ellipse(cx, yt, rx_t, ry_t))
    # glass body tint (edges slightly denser)
    c.fill(
        body,
        Grad([(0, (*glass_tint, 82)), (0.14, (*glass_tint, 26)), (0.86, (*glass_tint, 22)), (1, (*glass_tint, 74))], 0),
    )
    # liquid
    wt, bt = 9 * s, 24 * s
    in_bot = yb - bt
    in_h = in_bot - yt
    y_l = in_bot - fill * in_h
    rx_in_b = rx_b - wt
    liq_poly = c.poly(
        [(cx - (half_w(y_l) - wt), y_l), (cx + (half_w(y_l) - wt), y_l), (cx + rx_in_b, in_bot), (cx - rx_in_b, in_bot)]
    )
    liquid = c.union(
        liq_poly,
        c.ellipse(cx, in_bot, rx_in_b, rx_in_b * ELL),
        c.ellipse(cx, y_l, half_w(y_l) - wt, (half_w(y_l) - wt) * ELL),
    )
    x0, y0, x1, y1 = (
        liquid.x / c.ss,
        liquid.y / c.ss,
        (liquid.x + liquid.img.width) / c.ss,
        (liquid.y + liquid.img.height) / c.ss,
    )
    lay = c.sublayer(x0, y0, x1, y1)
    top_col = layers[0][0]
    lay.fill(lay.rrect(x0, y0, x1, y1, 0), top_col)
    total = sum(f for _, f in layers)
    acc = 0.0
    for i in range(1, len(layers)):
        acc += layers[i - 1][1] / total
        yy = y_l + (in_bot - y_l) * acc
        rr = half_w(yy) - wt
        arc = lay.arc_poly(cx, yy, rr, rr * ELL, 180, 0, 28)
        region = lay.poly(
            [
                (cx - rr - 6, yy),
                *arc,
                (cx + rr + 6, yy),
                (cx + rx_in_b + 30, in_bot + 40),
                (cx - rx_in_b - 30, in_bot + 40),
            ]
        )
        lay.fill(region, layers[i][0])
    c.paste(lay, clip=liquid, blur=2.2)
    # liquid surface
    r_l = half_w(y_l) - wt
    if surface:
        paste_surface(c, cx, y_l, r_l, *surface[:3], seed=seed)
    else:
        c.fill(c.ellipse(cx, y_l, r_l, r_l * ELL), Grad([(0, lighten(top_col, 0.28)), (1, top_col)], 60), 0.95)
    if foam:  # nitro head: creamy band at top of the liquid
        fh = foam * (in_bot - y_l)
        fm = c.union(c.rrect(cx - r_l, y_l, cx + r_l, y_l + fh, 0), c.ellipse(cx, y_l, r_l, r_l * ELL))
        fm = c.inter(fm, liquid)
        edge_poly = c.poly(
            [(cx - r_l - 4, y_l), *c.arc_poly(cx, y_l + fh, r_l + 4, (r_l + 4) * ELL, 180, 0, 28), (cx + r_l + 4, y_l)]
        )
        fm = c.inter(c.union(edge_poly, c.ellipse(cx, y_l, r_l, r_l * ELL)), liquid)
        c.fill(fm, Grad([(0, lighten(FOAM, 0.2)), (0.7, FOAM), (1, mix(FOAM, COFFEE, 0.35))], 90))
        c.fill(c.ellipse(cx, y_l, r_l, r_l * ELL), Grad([(0, "#FFF8EA"), (1, FOAM)], 60))
        for _ in range(30):
            c.fill(
                c.ellipse(
                    cx + rng.uniform(-r_l * 0.9, r_l * 0.9), y_l + rng.uniform(-2, 1.0) * r_l * ELL * 0.5, 2.0, 2.0
                ),
                "#FFFFFF",
                0.5,
            )
    # ice
    cubes = []
    for i in range(ice):
        fx = (i + 0.5) / max(ice, 1)
        x = cx + (fx - 0.5) * r_l * 1.55 + rng.uniform(-14, 14) * s
        y = y_l + rng.uniform(-0.2, 0.9) * 62 * s + (i % 2) * 38 * s
        cubes.append((x, y, rng.uniform(34, 42) * s, rng.uniform(-28, 28)))
    cube_layer = c.sublayer(cx - rx_t - 20, yt - 140 * s, cx + rx_t + 20, yb + 20)
    for x, y, r, ang in sorted(cubes, key=lambda q: q[1]):
        ice_cube(cube_layer, x, y, r, ang)
    c.paste(cube_layer, clip=c.union(liquid, c.rrect(cx - r_l - 2, yt - 150 * s, cx + r_l + 2, y_l + 6 * s, 0)))
    # straw
    if straw:
        sx0, sy0 = cx - r_l * 0.1, in_bot - 16 * s
        sx1, sy1 = cx + rx_t * 0.42, yt - 95 * s
        slayer = c.sublayer(cx - rx_t - 30, sy1 - 40, cx + rx_t + 60, yb)
        _draw_straw(slayer, sx0, sy0, sx1, sy1, 17 * s, straw[0], straw[1])
        # the part under the liquid line is tinted by the drink
        c.paste(
            slayer,
            clip=c.union(
                c.rrect(cx - rx_t - 30, sy1 - 40, cx + rx_t + 60, y_l, 0),
                c.rrect(cx - rx_t - 30, y_l - 160 * s, cx + rx_t + 60, y_l, 0),
            ),
        )
        liquid_part = slayer.sublayer(cx - rx_t - 30, y_l, cx + rx_t + 60, yb)
        liquid_part.img.paste(
            slayer.img.crop(
                (
                    liquid_part.ox - slayer.ox,
                    liquid_part.oy - slayer.oy,
                    liquid_part.ox - slayer.ox + liquid_part.img.width,
                    liquid_part.oy - slayer.oy + liquid_part.img.height,
                )
            ),
            (0, 0),
        )
        c.paste(liquid_part, clip=liquid, alpha=0.55)
        c.fill(c.inter(liquid, c.rrect(cx - rx_t, y_l, cx + rx_t, yb, 0)), darken(top_col, 0.1), 0.0)
    # toppings above the rim
    if topping:
        kind = topping.get("kind")
        if kind == "whip":
            tip = whipped_cream(
                c, cx, y_l + ry_t * 0.1, r_l * 1.75, s, tiers=topping.get("tiers", 3), col=topping.get("color", MILK)
            )
            if topping.get("drizzle"):
                dz = topping["drizzle"]
                from .props import caramel_drizzle

                caramel_drizzle(c, cx - 6 * s, tip + 62 * s, r_l * 1.05, s, col=dz, seed=seed, n=4)
            if topping.get("cocoa"):
                for _ in range(40):
                    c.fill(
                        c.ellipse(cx + rng.uniform(-30, 30) * s, tip + rng.uniform(15, 100) * s, 1.8, 1.8),
                        topping["cocoa"],
                        0.7,
                    )
        elif kind == "cocoa":
            for _ in range(180):
                ang = rng.uniform(0, math.tau)
                rr = math.sqrt(rng.random()) * r_l * 0.92
                c.fill(
                    c.ellipse(cx + rr * math.cos(ang), y_l + rr * math.sin(ang) * ELL, 1.7, 1.2), topping["color"], 0.7
                )
    # glass highlights / outline / rim
    left_hl = c.rrect(cx - rx_t * 0.80, yt + ry_t + 26 * s, cx - rx_t * 0.80 + 17 * s, yb - 38 * s, 8 * s)
    c.fill(left_hl, Grad([(0, (255, 255, 255, 150)), (0.5, (255, 255, 255, 90)), (1, (255, 255, 255, 20))], 90))
    c.fill(
        c.rrect(cx - rx_t * 0.80 + 26 * s, yt + ry_t + 60 * s, cx - rx_t * 0.80 + 31 * s, yt + ry_t + 190 * s, 3 * s),
        (255, 255, 255),
        0.35,
    )
    c.fill(
        c.rrect(cx + rx_t * 0.78, yt + ry_t + 40 * s, cx + rx_t * 0.78 + 9 * s, yb - 70 * s, 4 * s),
        (255, 255, 255),
        0.28,
    )
    c.fill(
        c.sub(c.ellipse(cx, yb, rx_b, ry_b), c.ellipse(cx, yb - 3 * s, rx_b - 4 * s, ry_b - 3 * s)),
        (255, 255, 255),
        0.4,
    )
    c.fill(
        c.sub(
            c.ellipse(cx, in_bot, rx_in_b, rx_in_b * ELL),
            c.ellipse(cx, in_bot + 4 * s, rx_in_b - 3 * s, rx_in_b * ELL - 2 * s),
        ),
        (255, 255, 255),
        0.20,
    )
    c.stroke_outline(c.union(body_poly, c.ellipse(cx, yb, rx_b, ry_b)), 2.4 * s, (255, 255, 255), 0.5)
    c.fill(c.sub(c.ellipse(cx, yt, rx_t, ry_t), c.ellipse(cx, yt, rx_t - 3.2 * s, ry_t - 3 * s)), (255, 255, 255), 0.85)
    c.fill(
        c.sub(c.ellipse(cx, yt, rx_t - 3.2 * s, ry_t - 3 * s), c.ellipse(cx, yt + 2 * s, rx_t - 10 * s, ry_t - 8 * s)),
        (255, 255, 255),
        0.12,
    )
    if dew:
        for _ in range(16):
            yy = rng.uniform(yt + ry_t + 40 * s, yb - 40 * s)
            xx = cx + rng.uniform(-1, 1) * (half_w(yy) - 18 * s)
            r_ = rng.uniform(2.4, 5.2) * s
            d = c.ellipse(xx, yy, r_, r_ * 1.25)
            c.fill(d, (255, 255, 255), 0.22)
            c.fill(c.ellipse(xx - r_ * 0.3, yy - r_ * 0.4, r_ * 0.35, r_ * 0.35), (255, 255, 255), 0.7)
    if flowers:
        for _ in range(flowers):
            fx = cx + rng.uniform(-0.8, 0.8) * r_l
            fy = y_l + rng.uniform(-0.3, 0.3) * r_l * ELL
            for k in range(5):
                a = math.tau * k / 5 + rng.uniform(0, 1)
                c.fill(
                    c.rot_ellipse(fx + 8 * math.cos(a), fy + 4 * math.sin(a), 8, 3.4, math.degrees(a)), "#FFFDF4", 0.95
                )
            c.fill(c.ellipse(fx, fy, 3, 2), "#E8C25B")
    if garnish:
        g = garnish.get("kind")
        if g == "orange":
            gx, gy = cx - rx_t * 0.78, yt - 4 * s
            slice_r = 56 * s
            c.shadow(c.ellipse(gx, gy, slice_r, slice_r), 3, 6, 5, ESPRESSO, 0.25)
            c.fill(c.ellipse(gx, gy, slice_r, slice_r), "#EE8F2E")
            c.fill(c.ellipse(gx, gy, slice_r * 0.9, slice_r * 0.9), "#FBC068")
            for k in range(9):
                a = math.tau * k / 9
                c.fill(
                    c.line(
                        [
                            (gx + 6 * math.cos(a), gy + 6 * math.sin(a)),
                            (gx + slice_r * 0.8 * math.cos(a), gy + slice_r * 0.8 * math.sin(a)),
                        ],
                        3.2 * s,
                    ),
                    "#F7DFAE",
                    0.9,
                )
            c.fill(c.ellipse(gx, gy, 7 * s, 7 * s), "#F7DFAE")
        elif g == "mint":
            for k, (dx, dy, ang) in enumerate([(0, 0, -70), (26, 8, -35), (-24, 10, -110)]):
                gx, gy = cx + rx_t * 0.2 + dx * s, yt - 6 * s + dy * s
                c.fill(
                    c.rot_ellipse(gx, gy - 24 * s, 17 * s, 34 * s, ang + 90 + k),
                    Grad([(0, lighten(SAGE, 0.35)), (1, darken(SAGE, 0.1))], 45),
                )
        elif g == "cinnamon":
            c.fill(
                c.line([(cx + 20 * s, yt + 10 * s), (cx + 120 * s, yt - 140 * s)], 18 * s),
                Grad([(0, "#A66A3A"), (1, "#6E3F22")], 0),
            )
            c.fill(c.ellipse(cx + 120 * s, yt - 140 * s, 9 * s, 9 * s), "#2B1D16", 0.7)
    return dict(cx=cx, yt=yt, yb=yb, y_l=y_l, rx_t=rx_t, top=yt - ry_t)

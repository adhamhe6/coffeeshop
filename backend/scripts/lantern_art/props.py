# ruff: noqa: C408, S311  (illustration code: dict() keyword style and seeded, non-cryptographic randomness are intentional)
"""Shared scene pieces: backdrops, table, beans, steam wisps, the lantern mark, sprigs and contact shadows."""

from __future__ import annotations

import math
import random

from PIL import ImageChops

from .canvas import Canvas, Grad, bez, darken, hexc, lighten, mix, rot, with_alpha
from .palette import (
    CARAMEL,
    COFFEE,
    CREAM,
    ESPRESSO,
    PARCHMENT,
    SAGE,
    TINTS,
)

ELL = 0.34  # ellipse height / width for every horizontal circle -> one consistent camera angle
HORIZON = 0.665  # table edge as a fraction of the picture height for square product shots


def tint_color(name_or_hex: str):
    return hexc(TINTS.get(name_or_hex, name_or_hex))


def backdrop(c: Canvas, tint: str = "sage", horizon: float = HORIZON, disc: bool = True, seed: int = 0) -> int:
    """Paper-toned wall + soft disc + table surface. Returns the table-edge y."""
    w, h = c.w, c.h
    t = tint_color(tint)
    wall = mix(PARCHMENT, t, 0.26)
    c.fill(c.rrect(0, 0, w, h, 0), Grad([(0, lighten(wall, 0.38)), (0.75, wall), (1, darken(wall, 0.06))], 90))
    hy = int(h * horizon)
    if disc:
        r = min(w, h) * 0.34
        dcx, dcy = w / 2, hy - r * 0.72
        d = c.ellipse(dcx, dcy, r, r)
        c.shadow(d, 0, 10, 26, ESPRESSO, 0.10)
        c.fill(d, Grad([(0, lighten(mix(wall, t, 0.34), 0.18)), (1, mix(wall, t, 0.5))], 120))
        ring = c.sub(c.ellipse(dcx, dcy, r * 1.07, r * 1.07), c.ellipse(dcx, dcy, r * 1.03, r * 1.03))
        c.fill(ring, lighten(wall, 0.4), 0.55)
    table = mix(wall, ESPRESSO, 0.13)
    c.fill(c.rrect(0, hy, w, h, 0), Grad([(0, lighten(table, 0.1)), (0.18, table), (1, darken(table, 0.16))], 90))
    c.fill(c.rrect(0, hy - 2, w, hy + 3, 0), lighten(wall, 0.55), 0.8)
    c.fill(c.rrect(0, hy + 3, w, hy + 30, 0), Grad([(0, (43, 29, 22, 46)), (1, (43, 29, 22, 0))], 90))
    # a few long, soft grain highlights on the tabletop (keeps the surface from feeling empty)
    rng = random.Random(seed * 7 + 3)
    for _ in range(5):
        y = hy + rng.uniform(40, h - hy - 10)
        x = rng.uniform(-100, w * 0.7)
        c.fill(c.rrect(x, y, x + rng.uniform(220, 520), y + rng.uniform(2, 5), 2), lighten(table, 0.6), 0.09)
    return hy


def contact_shadow(c: Canvas, cx, by, rx, ry=None, alpha=0.30, dx=0.12) -> None:
    ry = ry or rx * ELL * 0.9
    c.shadow(c.ellipse(cx + rx * dx, by - ry * 0.25, rx * 1.12, ry), 0, 0, max(6, rx * 0.07), ESPRESSO, alpha)
    c.shadow(c.ellipse(cx, by - ry * 0.35, rx * 0.9, ry * 0.65), 0, 0, max(3, rx * 0.025), ESPRESSO, alpha * 0.9)


def bean(c: Canvas, x, y, r, ang=0, col=COFFEE, shadow=True) -> None:
    body = c.rot_ellipse(x, y, r, r * 0.7, ang)
    if shadow:
        c.shadow(body, r * 0.12, r * 0.22, r * 0.2, ESPRESSO, 0.35)
    c.fill(body, Grad([(0, lighten(col, 0.26)), (0.55, col), (1, darken(col, 0.35))], 55))
    # crease: gentle S curve along the long axis
    p = bez((-r * 0.82, 0), (-r * 0.3, -r * 0.35), (r * 0.3, r * 0.35), (r * 0.82, 0), 20)
    pts = rot([(x + px, y + py) for px, py in p], x, y, ang)
    c.fill(c.line(pts, max(1.4, r * 0.11)), darken(col, 0.65), 0.9)
    c.fill(c.rot_ellipse(x - r * 0.28, y - r * 0.3, r * 0.3, r * 0.1, ang - 25), (255, 255, 255, 255), 0.22)


def beans_scatter(c: Canvas, spots, col=COFFEE, rng=None) -> None:
    rng = rng or random.Random(5)
    for x, y, r in spots:
        shade = mix(col, "#7A4A2E", rng.uniform(0, 0.4))
        bean(c, x, y, r, rng.uniform(-70, 70), shade)


def steam(c: Canvas, cx, y, h=190, n=3, spread=34, width=16, color=CREAM, alpha=0.5, seed=1) -> None:
    """Soft rising wisps that fade out towards the top."""
    rng = random.Random(seed)
    x0, y0, x1, y1 = cx - spread * 3 - 70, y - h - 70, cx + spread * 3 + 70, y + 30
    layer = c.sublayer(x0, y0, x1, y1)
    ph = rng.uniform(0, math.tau)
    for i in range(n):
        xs = cx + (i - (n - 1) / 2) * spread
        amp = rng.uniform(12, 20)
        hh = h * rng.uniform(0.82, 1.0) * (1.0 if i % 2 == 0 else 0.86)
        pts, ws = [], []
        for k in range(70):
            t = k / 69
            pts.append((xs + amp * math.sin(t * 4.4 + ph + i * 0.9) * (0.25 + t * 0.9), y - t * hh))
            ws.append(width * (0.5 + 0.75 * math.sin(math.pi * min(t * 1.1, 1.0))))
        layer.fill(layer.varline(pts, ws), color, 1.0)
    fade = Grad([(0, (255, 255, 255, 0)), (0.45, (255, 255, 255, 255)), (1, (255, 255, 255, 255))], 90).render(
        layer.img.size
    )
    layer.img.putalpha(ImageChops.multiply(layer.img.getchannel("A"), fade.getchannel("A")))
    c.paste(layer, blur=6.5, alpha=alpha)


def lantern(c: Canvas, cx, top, s=1.0, frame=ESPRESSO, glass="#F3C66B", glow=True, flame=True, lit=1.0) -> float:
    """The brand mark: a classic hurricane lantern. ``top`` is the y of the ring's top; returns the bottom y."""
    fw = darken(frame, 0.0)
    bw, bh = 118 * s, 150 * s  # glass body
    ring_r = 34 * s
    cap_h = 34 * s
    ry0 = top + ring_r * 1.0
    cap_top = ry0 + ring_r * 0.55
    body_top = cap_top + cap_h
    body_bot = body_top + bh
    base_h = 26 * s
    cxx = cx
    if glow:
        c.glow(c.ellipse(cxx, (body_top + body_bot) / 2, bw * 1.5, bh * 0.85), 46 * s, "#F6B04E", 0.40 * lit)
        c.glow(c.ellipse(cxx, (body_top + body_bot) / 2, bw * 0.9, bh * 0.6), 20 * s, "#FFD98A", 0.55 * lit)
    # ring handle
    ring = c.sub(c.ellipse(cxx, ry0, ring_r, ring_r), c.ellipse(cxx, ry0, ring_r - 7 * s, ring_r - 7 * s))
    c.fill(ring, fw)
    # cap
    cap = c.poly(
        [
            (cxx - bw * 0.30, cap_top),
            (cxx + bw * 0.30, cap_top),
            (cxx + bw * 0.62, body_top),
            (cxx - bw * 0.62, body_top),
        ]
    )
    c.fill(cap, Grad([(0, lighten(fw, 0.12)), (1, darken(fw, 0.1))], 0))
    c.fill(c.rrect(cxx - bw * 0.38, cap_top - 9 * s, cxx + bw * 0.38, cap_top + 6 * s, 7 * s), lighten(fw, 0.08))
    # glass
    gl = c.rrect(cxx - bw / 2, body_top, cxx + bw / 2, body_bot, 18 * s)
    c.fill(gl, Grad([(0, mix(glass, "#E98E3A", 0.5)), (0.45, glass), (1, mix(glass, "#E98E3A", 0.55))], 0))
    c.fill(
        gl,
        Grad(
            [(0, (255, 244, 205, 0)), (0.5, (255, 244, 205, int(210 * lit))), (1, (255, 244, 205, 0))],
            90,
            "radial",
            (0.5, 0.58),
            0.8,
        ),
    )
    if flame:
        fl = c.poly(
            bez(
                (cxx, body_bot - 34 * s),
                (cxx - 30 * s, body_bot - 56 * s),
                (cxx - 6 * s, body_top + bh * 0.42),
                (cxx, body_top + bh * 0.24),
                18,
            )
            + bez(
                (cxx, body_top + bh * 0.24),
                (cxx + 6 * s, body_top + bh * 0.42),
                (cxx + 30 * s, body_bot - 56 * s),
                (cxx, body_bot - 34 * s),
                18,
            )
        )
        c.fill(fl, Grad([(0, "#FFF3C9"), (0.55, "#F7B94B"), (1, "#E1782B")], 90))
        c.fill(c.ellipse(cxx, body_bot - 42 * s, 7 * s, 11 * s), "#FFFFFF", 0.7)
    # frame bars + base
    for dx in (-bw * 0.26, bw * 0.26):
        c.fill(c.rrect(cxx + dx - 2.2 * s, body_top, cxx + dx + 2.2 * s, body_bot, 2 * s), fw, 0.9)
    c.fill(c.rrect(cxx - bw / 2 - 2.5 * s, body_top, cxx - bw / 2 + 2.5 * s, body_bot, 2 * s), fw)
    c.fill(c.rrect(cxx + bw / 2 - 2.5 * s, body_top, cxx + bw / 2 + 2.5 * s, body_bot, 2 * s), fw)
    base = c.rrect(cxx - bw * 0.58, body_bot - 4 * s, cxx + bw * 0.58, body_bot + base_h, 8 * s)
    c.fill(base, Grad([(0, lighten(fw, 0.1)), (1, darken(fw, 0.12))], 90))
    c.fill(
        c.rrect(cxx - bw * 0.4, body_bot + base_h - 2 * s, cxx + bw * 0.4, body_bot + base_h + 8 * s, 4 * s),
        darken(fw, 0.1),
    )
    return body_bot + base_h + 8 * s


def sprig(c: Canvas, x, y, ang=0, s=1.0, col=SAGE, leaves=5) -> None:
    """A small sage sprig lying on the table (organic filler in corners)."""
    stem = [(x + t * 120 * s, y - math.sin(t * 2.2) * 26 * s) for t in [i / 14 for i in range(15)]]
    stem = rot(stem, x, y, ang)
    c.fill(c.line(stem, 3.2 * s), darken(col, 0.2), 0.95)
    for i in range(leaves):
        px, py = stem[2 + i * 2]
        for side in (-1, 1):
            la = ang + side * 52 - 10
            lf = c.rot_ellipse(
                px + 20 * s * math.cos(math.radians(la)), py + 20 * s * math.sin(math.radians(la)), 24 * s, 9 * s, la
            )
            c.shadow(lf, 2, 4, 4, ESPRESSO, 0.18)
            c.fill(lf, Grad([(0, lighten(col, 0.25)), (1, darken(col, 0.1))], 50))


def table_props(c: Canvas, hy: int, cx: float, base_y: float, spread: float, seed: int, n: int = 6, col=COFFEE) -> None:
    """Scatter beans on the table around the subject (deterministic per seed)."""
    rng = random.Random(seed * 31 + 11)
    spots = []
    tries = 0
    while len(spots) < n and tries < 200:
        tries += 1
        side = rng.choice((-1, 1))
        x = cx + side * rng.uniform(spread * 0.75, spread * 1.45)
        y = rng.uniform(max(hy + 40, base_y - 30), min(c.h - 70, base_y + 120))
        if all(math.hypot(x - sx, (y - sy) * 1.6) > 46 for sx, sy, _ in spots) and 60 < x < c.w - 60:
            spots.append((x, y, rng.uniform(15, 22)))
    beans_scatter(c, sorted(spots, key=lambda s: s[1]), col, rng)


def accent(c: Canvas, tint: str) -> tuple:
    return tint_color(tint)


def caramel_drizzle(c: Canvas, cx, y, w, s=1.0, col=CARAMEL, seed=2, n=5) -> None:
    rng = random.Random(seed)
    pts = []
    for i in range(n * 2 + 1):
        t = i / (n * 2)
        pts.append((cx - w / 2 + t * w, y + (rng.uniform(8, 20) * s if i % 2 else -rng.uniform(4, 10) * s)))
    spline = []
    for a, b in zip(pts, pts[1:], strict=False):
        spline += bez(a, (a[0] + (b[0] - a[0]) * 0.5, a[1]), (a[0] + (b[0] - a[0]) * 0.5, b[1]), b, 8)
    c.fill(c.line(spline, 6 * s), col)
    c.fill(c.line([(x, y - 1.5 * s) for x, y in spline], 1.8 * s), lighten(col, 0.5), 0.5)


def crimp_marks(c: Canvas, x0, x1, y0, y1, col, n=26) -> None:
    for i in range(n):
        x = x0 + (x1 - x0) * (i + 0.5) / n
        c.fill(c.rrect(x - 1.2, y0, x + 1.2, y1, 1.2), col, 0.28)


def initial_fonts() -> None:  # pragma: no cover - placeholder to keep import surfaces stable
    return None


__all__ = [n for n in dir() if not n.startswith("_")]
_ = (CARAMEL, COFFEE, CREAM, SAGE, with_alpha)

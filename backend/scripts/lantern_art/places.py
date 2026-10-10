# ruff: noqa: C408, S311  (illustration code: dict() keyword style and seeded, non-cryptographic randomness are intentional)
"""Stylised branch scenes (1400 x 900): storefront, riverside terrace, airport kiosk."""

from __future__ import annotations

import math
import random

from PIL import Image

from .canvas import Canvas, Grad, bez, darken, grain, hexc, lighten, mix, vignette
from .gear import txt
from .palette import COPPER, CREAM, ESPRESSO, PARCHMENT, SAGE
from .props import lantern

W, H = 1400, 900


def _arch(c: Canvas, x0, y0, x1, y1):
    r = (x1 - x0) / 2
    return c.union(c.rrect(x0, y0 + r, x1, y1, 0), c.ellipse((x0 + x1) / 2, y0 + r, r, r))


def _plant(c: Canvas, x, y, s=1.0, seed=1, col=SAGE):
    rng = random.Random(seed)
    pot = c.poly([(x - 34 * s, y - 52 * s), (x + 34 * s, y - 52 * s), (x + 26 * s, y), (x - 26 * s, y)])
    for _ in range(14):
        a = math.radians(rng.uniform(-75, 75) - 90)
        ln = rng.uniform(60, 120) * s
        ex, ey = x + math.cos(a) * ln, y - 52 * s + math.sin(a) * ln
        lf = c.rot_ellipse((x + ex) / 2, (y - 52 * s + ey) / 2, ln / 2, 13 * s, math.degrees(a))
        c.fill(lf, mix(col, "#9DB67A", rng.uniform(0, 0.5)) if rng.random() < 0.7 else darken(col, 0.2))
    c.shadow(pot, 2, 4, 4, ESPRESSO, 0.25)
    c.fill(pot, Grad([(0, "#C7745A"), (1, "#8E4B34")], 0))
    c.fill(c.rrect(x - 38 * s, y - 60 * s, x + 38 * s, y - 46 * s, 4 * s), "#D98B6A")


def _awning(c: Canvas, x0, x1, y0, y1, c1, c2, n=14):
    w = (x1 - x0) / n
    c.shadow(c.rrect(x0, y0, x1, y1 + 14, 4), 0, 14, 12, ESPRESSO, 0.35)
    for i in range(n):
        col = c1 if i % 2 == 0 else c2
        quad = c.poly([(x0 + i * w, y0), (x0 + (i + 1) * w, y0), (x0 + (i + 1) * w + 4, y1), (x0 + i * w - 4, y1)])
        scal = c.ellipse(x0 + (i + 0.5) * w, y1, w / 2, 14)
        m = c.union(quad, scal)
        c.fill(m, Grad([(0, lighten(col, 0.12)), (1, darken(col, 0.18))], 90))
    c.fill(c.rrect(x0 - 6, y0 - 6, x1 + 6, y0 + 8, 3), darken(c1, 0.35))


def storefront() -> Image.Image:
    c = Canvas(W, H, 2)
    rng = random.Random(11)
    c.fill(c.rrect(0, 0, W, H, 0), Grad([(0, "#E9C79B"), (0.2, "#F2DDBB"), (1, "#E5D2B2")], 90))
    # facade
    fx0, fx1, fy0, fy1 = 70, 1330, 80, 700
    c.fill(c.rrect(fx0, fy0, fx1, fy1, 0), Grad([(0, "#9A5238"), (1, "#7C3F2B")], 90))
    for row in range(int((fy1 - fy0) / 22)):
        y = fy0 + row * 22
        off = 0 if row % 2 == 0 else 32
        for k in range(-1, int((fx1 - fx0) / 64) + 1):
            x = fx0 + off + k * 64
            if x < fx0 - 60 or x > fx1:
                continue
            shade = rng.uniform(-0.1, 0.12)
            x0_, x1_ = max(x + 2, fx0), min(x + 62, fx1)
            if x1_ <= x0_:
                continue
            c.fill(
                c.rrect(x0_, y + 2, x1_, y + 20, 2),
                lighten("#8E4B34", shade) if shade > 0 else darken("#8E4B34", -shade),
                0.55,
            )
    c.fill(c.rrect(fx0 - 14, fy0 - 20, fx1 + 14, fy0 + 14, 4), Grad([(0, "#5A2F22"), (1, "#3A2018")], 90))
    c.fill(c.rrect(fx0 - 14, fy0 - 20, fx1 + 14, fy0 - 14, 2), "#FFFFFF", 0.2)
    # upper arched windows
    for i in range(4):
        x0 = 190 + i * 285
        a = _arch(c, x0, 150, x0 + 150, 340)
        c.fill(_arch(c, x0 - 12, 138, x0 + 162, 348), "#F4E8D0")
        c.fill(a, Grad([(0, "#F6D493"), (1, "#D99A4A")], 90))
        c.fill(c.rrect(x0 + 72, 150, x0 + 78, 340, 0), "#F4E8D0")
        c.fill(c.rrect(x0, 232, x0 + 150, 238, 0), "#F4E8D0")
        c.fill(c.rrect(x0 - 18, 346, x0 + 168, 362, 3), "#EADBBE")
        c.fill(c.ellipse(x0 + 38, 196, 5, 12), "#FFFFFF", 0.35)
    # sign board
    board = c.rrect(300, 396, 1100, 470, 6)
    c.shadow(board, 0, 6, 8, ESPRESSO, 0.3)
    c.fill(board, Grad([(0, "#3A2A22"), (1, "#241812")], 90))
    c.stroke_outline(c.rrect(310, 404, 1090, 462, 3), 1.6, "#E9B27A", 0.7)
    txt(c, 725, 430, "LANTERN  COFFEE  ROASTERS", "serif", 38, CREAM, tracking=9)
    lantern(c, 338, 405, 0.16, frame=CREAM, glass="#F6C26A", glow=False)
    # awning
    _awning(c, 150, 1250, 480, 538, SAGE, CREAM)
    # shop windows and door
    for x0, x1 in ((190, 580), (820, 1210)):
        c.fill(c.rrect(x0 - 12, 560, x1 + 12, 700, 3), "#2A1C16")
        glass = c.rrect(x0, 556, x1, 690, 2)
        c.fill(glass, Grad([(0, "#F7D58E"), (0.6, "#E3A854"), (1, "#B97A35")], 90))
        c.glow(c.ellipse((x0 + x1) / 2, 600, 120, 60), 40, "#FFE9B0", 0.45)
        for px in (x0 + 90, x0 + 280) if x0 < 500 else (x0 + 110, x0 + 300):
            c.fill(c.rrect(px - 1.5, 556, px + 1.5, 600, 0), "#2A1C16", 0.8)
            lantern(c, px, 596, 0.14, frame=ESPRESSO, glow=True, lit=0.7)
        # counter silhouettes + cups
        c.fill(c.rrect(x0, 640, x1, 690, 0), "#4A2C1C", 0.85)
        for k in range(4):
            cx = x0 + 50 + k * 90
            c.fill(c.rrect(cx - 12, 622, cx + 12, 642, 4), "#F7F0E3", 0.9)
        c.fill(c.rrect(x0 + 10, 560, x0 + 38, 680, 0), "#FFFFFF", 0.12)
        c.fill(c.rrect(x0 - 6, 686, x1 + 6, 700, 2), "#1B1410")
    door = c.rrect(600, 548, 800, 700, 4)
    c.fill(c.rrect(588, 540, 812, 700, 5), "#2A1C16")
    c.fill(door, Grad([(0, "#5E6E55"), (1, "#445139")], 90))
    c.fill(c.rrect(620, 568, 780, 668, 3), Grad([(0, "#F7D58E"), (1, "#D99A4A")], 90))
    c.fill(c.rrect(618, 566, 782, 570, 0), "#2A1C16")
    c.fill(c.ellipse(784, 640, 6, 6), "#E9B27A")
    txt(c, 700, 606, "OPEN", "sans", 22, "#2A1C16", tracking=6, alpha=0.78)
    # sidewalk
    c.fill(c.rrect(0, 700, W, H, 0), Grad([(0, "#C8B697"), (1, "#A89578")], 90))
    c.fill(c.rrect(0, 700, W, 716, 0), "#8E7B60")
    for i in range(1, 9):
        y = 716 + (i**1.6) * 6
        c.fill(c.rrect(0, y, W, y + 2, 0), "#8E7B60", 0.35)
    for x in range(-200, W + 200, 160):
        c.fill(
            c.poly([(x + 700 - 700, 716), (x + 3, 716), (x + (x - 700) * 0.7 + 3, H), (x + (x - 700) * 0.7, H)]),
            "#8E7B60",
            0.0,
        )
    c.shadow(c.ellipse(700, 760, 600, 30), 0, 0, 22, ESPRESSO, 0.15)
    _plant(c, 150, 760, 1.15, 3)
    _plant(c, 1255, 765, 1.1, 5, col="#6E8062")
    # street lamp (left, foreground)
    c.fill(c.rrect(34, 330, 46, 880, 4), "#2A1C16")
    lantern(c, 40, 250, 0.4, frame="#2A1C16", glass="#F6C26A", glow=True)
    # blade sign
    c.fill(c.rrect(1280, 320, 1330, 326, 2), "#2A1C16")
    c.fill(c.rrect(1318, 322, 1324, 340, 2), "#2A1C16")
    lantern(c, 1318, 336, 0.36, frame="#2A1C16", glass="#F6C26A", glow=True, lit=0.9)
    # bunting-free soft vignette + warm light spill on the pavement
    c.glow(c.ellipse(385, 740, 260, 40), 24, "#F6C26A", 0.22)
    c.glow(c.ellipse(1015, 740, 260, 40), 24, "#F6C26A", 0.22)
    return grain(vignette(c.render(), 0.16), 21)


def riverside() -> Image.Image:
    c = Canvas(W, H, 2)
    rng = random.Random(12)
    c.fill(c.rrect(0, 0, W, 520, 0), Grad([(0, "#B9D0CF"), (0.6, "#F0E4CC"), (1, "#F6DDB2")], 90))
    c.glow(c.ellipse(930, 470, 260, 110), 60, "#FFE1A8", 0.7)
    c.fill(c.ellipse(930, 440, 70, 70), "#FFF1CC", 0.85)
    for cx, cy, rx in ((260, 120, 170), (760, 90, 130), (1180, 160, 190)):
        c.glow(c.ellipse(cx, cy, rx, 28), 18, "#FFFFFF", 0.55)
    # distant hills
    for k, (col, base, amp) in enumerate([("#A9BBA2", 470, 40), ("#8FA586", 490, 30)]):
        pts = [(0, 520)]
        for x in range(0, W + 40, 40):
            pts.append((x, base - amp * (0.5 + 0.5 * math.sin(x / 160 + k * 1.6)) - rng.uniform(0, 6)))
        pts.append((W, 520))
        c.fill(c.poly(pts), col, 0.9)
    # bridge
    c.fill(c.rrect(560, 462, 1240, 476, 0), "#6F7F78")
    for i in range(8):
        x = 580 + i * 84
        c.fill(c.ellipse(x + 40, 478, 36, 30), "#B7C7C0")
        c.fill(c.rrect(x - 3, 464, x + 3, 500, 0), "#6F7F78")
    # river
    c.fill(c.rrect(0, 500, W, 700, 0), Grad([(0, "#7FA3A0"), (1, "#4F7B7A")], 90))
    for _ in range(90):
        y = rng.uniform(510, 690)
        x = rng.uniform(0, W)
        ln = rng.uniform(40, 160) * (0.6 + (y - 500) / 200)
        c.fill(
            c.rrect(x, y, x + ln, y + rng.uniform(1.5, 3.5), 2),
            "#E8F2EE" if rng.random() < 0.7 else "#2F5A5A",
            rng.uniform(0.12, 0.35),
        )
    c.glow(c.rrect(900, 505, 960, 700, 8), 14, "#FFE1A8", 0.45)
    # far bank / promenade
    c.fill(c.rrect(0, 680, W, 720, 0), "#B6A488")
    c.fill(c.rrect(0, 676, W, 684, 0), "#8E7B60")
    # terrace
    c.fill(c.rrect(0, 720, W, H, 0), Grad([(0, "#D8C6A4"), (1, "#B7A27F")], 90))
    for i in range(1, 8):
        y = 720 + i**1.7 * 5
        c.fill(c.rrect(0, y, W, y + 2, 0), "#8E7B60", 0.3)
    # cafe building
    c.fill(c.rrect(50, 270, 640, 700, 0), Grad([(0, "#F4E8D2"), (1, "#E3D2B2")], 90))
    roof = c.poly([(30, 270), (660, 270), (610, 200), (80, 200)])
    c.shadow(roof, 0, 8, 10, ESPRESSO, 0.25)
    c.fill(roof, Grad([(0, "#C7743F"), (1, "#8E4B2A")], 90))
    for i in range(20):
        c.fill(c.line([(80 + i * 29, 200), (30 + i * 31.5, 270)], 1.6), "#6B3520", 0.35)
    c.fill(c.rrect(30, 270, 660, 282, 2), "#5A2F22")
    for x0, x1 in ((90, 330), (370, 610)):
        c.fill(c.rrect(x0 - 10, 340, x1 + 10, 640, 4), "#3A2A22")
        c.fill(c.rrect(x0, 350, x1, 630, 2), Grad([(0, "#F7D58E"), (1, "#C98A3A")], 90))
        for k in range(2):
            lantern(c, x0 + 70 + k * 110, 352, 0.14, frame=ESPRESSO, glow=True, lit=0.6)
        c.fill(c.rrect(x0 + (x1 - x0) / 2 - 2, 350, x0 + (x1 - x0) / 2 + 2, 630, 0), "#3A2A22")
        c.fill(c.rrect(x0, 560, x1, 630, 0), "#4A2C1C", 0.8)
        c.fill(c.rrect(x0 + 10, 355, x0 + 32, 500, 0), "#FFFFFF", 0.14)
    board = c.rrect(160, 290, 540, 330, 4)
    c.fill(board, "#2A1C16")
    txt(c, 350, 310, "LANTERN · RIVERSIDE", "serif", 22, CREAM, tracking=5)
    c.fill(c.rrect(50, 640, 640, 700, 0), "#8E7B60", 0.3)
    # tables with parasols
    for tx, ty, sc, col in ((830, 770, 1.0, COPPER), (1060, 800, 1.12, SAGE), (1270, 760, 0.92, "#C9A26B")):
        c.shadow(c.ellipse(tx, ty + 8, 60 * sc, 14 * sc), 0, 0, 10, ESPRESSO, 0.25)
        c.fill(c.rrect(tx - 3, ty - 190 * sc, tx + 3, ty, 0), "#3A2A22")
        pts_top = [(tx - 120 * sc, ty - 160 * sc), (tx, ty - 240 * sc), (tx + 120 * sc, ty - 160 * sc)]
        canopy = c.union(c.poly(pts_top), c.ellipse(tx, ty - 160 * sc, 120 * sc, 18 * sc))
        c.shadow(canopy, 0, 10, 12, ESPRESSO, 0.2)
        c.fill(canopy, Grad([(0, lighten(col, 0.2)), (1, darken(col, 0.15))], 90))
        for k in range(1, 6):
            c.fill(c.line([(tx, ty - 240 * sc), (tx - 120 * sc + k * 40 * sc, ty - 160 * sc)], 1.6), "#FFFFFF", 0.25)
        c.fill(c.ellipse(tx, ty - 70 * sc, 54 * sc, 14 * sc), Grad([(0, "#F7F0E3"), (1, "#D8C8A8")], 90))
        c.fill(c.rrect(tx - 4 * sc, ty - 70 * sc, tx + 4 * sc, ty, 0), "#3A2A22")
        c.fill(c.ellipse(tx, ty, 34 * sc, 8 * sc), "#3A2A22")
        c.fill(c.rrect(tx - 18 * sc, ty - 88 * sc, tx - 4 * sc, ty - 72 * sc, 3), "#F7F0E3")
        c.fill(c.rrect(tx + 8 * sc, ty - 86 * sc, tx + 20 * sc, ty - 72 * sc, 3), "#B4602B")
        for sgn in (-1, 1):
            c.fill(
                c.rrect(tx + sgn * 82 * sc - 14 * sc, ty - 54 * sc, tx + sgn * 82 * sc + 14 * sc, ty - 44 * sc, 3),
                "#3A2A22",
            )
            c.fill(c.rrect(tx + sgn * 82 * sc - 3, ty - 44 * sc, tx + sgn * 82 * sc + 3, ty + 6 * sc, 0), "#3A2A22")
    # trees
    for tx, ty, r in ((1330, 560, 120), (1180, 590, 90), (700, 640, 0)):
        if not r:
            continue
        c.fill(c.rrect(tx - 8, ty, tx + 8, ty + 120, 2), "#5A3A28")
        for _ in range(9):
            c.fill(
                c.ellipse(tx + rng.uniform(-r * 0.6, r * 0.6), ty + rng.uniform(-r * 0.5, r * 0.3), r * 0.5, r * 0.42),
                mix(SAGE, "#9DB67A", rng.uniform(0, 0.6)),
                0.95,
            )
    _plant(c, 700, 800, 1.1, 8)
    return grain(vignette(c.render(), 0.12), 22)


def airport_kiosk() -> Image.Image:
    c = Canvas(W, H, 2)
    rng = random.Random(13)
    c.fill(c.rrect(0, 0, W, 640, 0), Grad([(0, "#CFE0E6"), (0.7, "#F3E8D2"), (1, "#F6E4C0")], 90))
    # runway view: plane
    c.fill(c.rrect(0, 520, W, 600, 0), Grad([(0, "#B9C4B0"), (1, "#8FA088")], 90))
    px, py = 1010, 170
    fus = c.ellipse(px, py, 150, 22)
    c.fill(fus, Grad([(0, "#FFFFFF"), (1, "#D5DDE0")], 90))
    c.fill(c.poly([(px - 20, py), (px + 60, py + 90), (px + 100, py + 90), (px + 20, py)]), "#C4CED2")
    c.fill(c.poly([(px + 120, py - 8), (px + 160, py - 70), (px + 178, py - 70), (px + 150, py + 6)]), "#B4602B")
    for k in range(9):
        c.fill(c.ellipse(px - 100 + k * 22, py - 4, 4, 4), "#7A8C94", 0.8)
    # glass wall mullions
    for x in range(0, W + 1, 175):
        c.fill(c.rrect(x - 4, 0, x + 4, 640, 0), "#3A2A22", 0.85)
    c.fill(c.rrect(0, 0, W, 14, 0), "#3A2A22")
    c.fill(c.rrect(0, 330, W, 336, 0), "#3A2A22", 0.6)
    # floor
    c.fill(c.rrect(0, 640, W, H, 0), Grad([(0, "#D9CDB6"), (1, "#B8A98C")], 90))
    for i in range(1, 9):
        c.fill(c.rrect(0, 640 + i**1.7 * 5, W, 642 + i**1.7 * 5, 0), "#9B8C70", 0.3)
    for _ in range(60):
        x, y = rng.uniform(0, W), rng.uniform(650, 890)
        c.fill(c.ellipse(x, y, rng.uniform(6, 20), rng.uniform(2, 4)), "#8E7F63", 0.12)
    c.glow(c.rrect(250, 650, 1150, 740, 20), 38, "#FFE1A8", 0.25)
    # departures board
    bd = c.rrect(90, 60, 440, 200, 6)
    c.fill(bd, "#1B1410")
    txt(c, 130, 82, "DEPARTURES", "sans", 15, "#F6C26A", tracking=3, anchor="lm")
    for i in range(4):
        y = 112 + i * 20
        c.fill(c.rrect(130, y, 190, y + 8, 2), "#F6C26A", 0.9)
        c.fill(c.rrect(215, y, 340 + (i % 2) * 40, y + 8, 2), "#F6C26A", 0.55)
        c.fill(c.rrect(380, y, 410, y + 8, 2), "#F6C26A", 0.9 if i != 1 else 0.4)
    # kiosk
    cx0, cx1 = 330, 1070
    c.shadow(c.ellipse(700, 748, 440, 28), 0, 0, 20, ESPRESSO, 0.3)
    body = c.rrect(cx0, 470, cx1, 735, 6)
    c.fill(body, Grad([(0, "#5C3A28"), (1, "#3A2418")], 90))
    for i in range(36):
        x = cx0 + 10 + i * (cx1 - cx0 - 20) / 35
        c.fill(c.rrect(x - 4, 490, x + 4, 722, 2), Grad([(0, "#9A6A44"), (1, "#6B4430")], 0), 0.92)
    c.fill(c.rrect(cx0 - 14, 456, cx1 + 14, 484, 5), Grad([(0, "#F7F0E3"), (1, "#DCCCAE")], 90))
    c.fill(c.rrect(cx0 - 14, 456, cx1 + 14, 462, 3), "#FFFFFF", 0.7)
    # pastry case
    case = c.rrect(380, 380, 640, 456, 6)
    c.fill(case, Grad([(0, (255, 255, 255, 120)), (1, (255, 255, 255, 40))], 90))
    c.stroke_outline(case, 2, "#FFFFFF", 0.7)
    for k in range(5):
        x = 410 + k * 46
        c.fill(c.ellipse(x, 440, 20, 10), "#D9A05C")
        c.fill(c.ellipse(x - 5, 436, 7, 3), "#F6D8A0", 0.8)
    # espresso machine
    em = c.rrect(700, 360, 950, 456, 8)
    c.fill(em, Grad([(0, "#C0C7C9"), (1, "#7C8A8E")], 90))
    c.fill(c.rrect(700, 360, 950, 380, 8), "#E2E7E8")
    for k in range(3):
        c.fill(c.rrect(730 + k * 70, 430, 760 + k * 70, 450, 3), "#2A1C16")
        c.fill(c.rrect(738 + k * 70, 450, 752 + k * 70, 456, 1), "#2A1C16")
    c.fill(c.ellipse(920, 400, 10, 10), "#B4602B")
    for k in range(3):
        c.fill(c.rrect(980 + k * 22, 428, 996 + k * 22, 456, 4), "#F7F0E3")
    # canopy
    c.fill(c.rrect(cx0 + 30, 220, cx0 + 38, 380, 0), "#3A2A22")
    c.fill(c.rrect(cx1 - 38, 220, cx1 - 30, 380, 0), "#3A2A22")
    canopy = c.poly([(cx0 - 30, 250), (cx1 + 30, 250), (cx1 + 70, 306), (cx0 - 70, 306)])
    c.shadow(canopy, 0, 12, 14, ESPRESSO, 0.3)
    c.fill(canopy, Grad([(0, "#C77A45"), (1, "#8E4B2A")], 90))
    c.fill(c.rrect(cx0 - 30, 246, cx1 + 30, 254, 2), "#E9B27A", 0.7)
    txt(c, 700, 282, "LANTERN  COFFEE  ROASTERS", "serif", 34, CREAM, tracking=8)
    for x in (480, 700, 920):
        c.fill(c.rrect(x - 1.5, 306, x + 1.5, 352, 0), "#2A1C16")
        lantern(c, x, 350, 0.16, frame=ESPRESSO, glow=True, lit=0.85)
    # menu board
    c.fill(c.rrect(1090, 330, 1250, 470, 5), "#2A1C16")
    for i in range(6):
        c.fill(c.rrect(1108, 352 + i * 18, 1170 - (i % 3) * 14, 358 + i * 18, 2), "#EFE4D0", 0.8)
        c.fill(c.rrect(1210, 352 + i * 18, 1232, 358 + i * 18, 2), "#E9B27A", 0.8)
    # pickup sign
    c.fill(c.rrect(470, 600, 930, 650, 6), "#F7F0E3")
    txt(c, 700, 625, "PICKUP ONLY  ·  ORDER AHEAD", "sans", 17, ESPRESSO, tracking=3)
    # suitcase + plant
    sx, sy = 190, 760
    c.shadow(c.ellipse(sx, sy, 80, 14), 0, 0, 10, ESPRESSO, 0.25)
    c.fill(c.rrect(sx - 62, sy - 210, sx + 62, sy - 10, 14), Grad([(0, "#5E6E55"), (1, "#3F4C39")], 0))
    for k in range(4):
        c.fill(c.rrect(sx - 54 + k * 34, sy - 196, sx - 50 + k * 34, sy - 24, 2), "#FFFFFF", 0.1)
    c.fill(c.rrect(sx - 4, sy - 260, sx + 4, sy - 210, 2), "#2A1C16")
    c.fill(c.rrect(sx - 28, sy - 268, sx + 28, sy - 256, 5), "#2A1C16")
    c.fill(c.ellipse(sx - 40, sy - 6, 8, 8), "#1B1410")
    c.fill(c.ellipse(sx + 40, sy - 6, 8, 8), "#1B1410")
    _plant(c, 1250, 820, 1.5, 4)
    return grain(vignette(c.render(), 0.12), 23)


SCENES = {"downtown-flagship": storefront, "riverside": riverside, "airport-kiosk": airport_kiosk}
_ = (bez, hexc, PARCHMENT)

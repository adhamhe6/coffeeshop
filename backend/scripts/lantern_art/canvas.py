# ruff: noqa: C408, S311  (illustration code: dict() keyword style and seeded, non-cryptographic randomness are intentional)
"""Tiny vector-ish illustration engine on top of Pillow.

Everything is drawn at ``ss`` x supersampling into RGBA layers through *masks* (8-bit coverage maps) so shapes can be
filled with flat colours or gradients, shadowed, blurred, clipped and composited. Coordinates are in *design pixels*
(the size of the final image); the engine converts to supersampled pixels internally. Pure Pillow, no system libraries.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps

Color = tuple[int, int, int, int]


def hexc(value, alpha: int | float | None = None) -> Color:
    """'#rrggbb' / (r,g,b[,a]) -> RGBA tuple. ``alpha`` accepts 0-1 floats or 0-255 ints."""
    if isinstance(value, str):
        v = value.lstrip("#")
        rgb = (int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16))
        a = int(v[6:8], 16) if len(v) == 8 else 255
    else:
        rgb = tuple(int(x) for x in value[:3])
        a = int(value[3]) if len(value) > 3 else 255
    if alpha is not None:
        a = int(round(alpha * 255)) if isinstance(alpha, float) and alpha <= 1.0 else int(alpha)
    return (*rgb, a)


def mix(a, b, t: float) -> Color:
    a, b = hexc(a), hexc(b)
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(4))  # type: ignore[return-value]


def lighten(c, t: float) -> Color:
    return mix(c, (255, 255, 255, hexc(c)[3]), t)


def darken(c, t: float) -> Color:
    return mix(c, (24, 14, 10, hexc(c)[3]), t)


def with_alpha(c, alpha: float) -> Color:
    r, g, b, _ = hexc(c)
    return (r, g, b, int(round(alpha * 255)))


def bez(p0, p1, p2, p3, n: int = 32) -> list[tuple[float, float]]:
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        pts.append(
            (
                u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
                u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1],
            )
        )
    return pts


def rot(pts, cx, cy, deg):
    a = math.radians(deg)
    ca, sa = math.cos(a), math.sin(a)
    return [(cx + (x - cx) * ca - (y - cy) * sa, cy + (x - cx) * sa + (y - cy) * ca) for x, y in pts]


_FONT_CANDIDATES = {
    "serif": [
        "/usr/share/fonts/truetype/crosextra/Caladea-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
    ],
    "serif_regular": [
        "/usr/share/fonts/truetype/crosextra/Caladea-Regular.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
    ],
    "serif_italic": [
        "/usr/share/fonts/truetype/crosextra/Caladea-Italic.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
    ],
    "sans": [
        "/usr/share/fonts/opentype/inter/Inter-SemiBold.otf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ],
    "sans_regular": [
        "/usr/share/fonts/opentype/inter/Inter-Medium.otf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ],
}


def font_path(name: str) -> str | None:
    for p in _FONT_CANDIDATES[name]:
        if Path(p).exists():
            return p
    return None


@dataclass
class Mask:
    img: Image.Image  # mode "L"
    x: int  # position in global supersampled px
    y: int

    @property
    def box(self):
        return (self.x, self.y, self.x + self.img.width, self.y + self.img.height)


class Grad:
    """Gradient paint evaluated over a mask's bounding box. ``stops`` = [(pos0-1, colour), ...].

    kind="linear": ``angle`` is the direction of increasing t in degrees (90 = top->bottom, 0 = left->right).
    kind="radial": centred on the bbox (or ``center`` as 0-1 fractions) with ``radius`` as a fraction of the half-size.
    """

    def __init__(self, stops, angle: float = 90, kind: str = "linear", center=(0.5, 0.5), radius: float = 1.0):
        self.stops = [(p, hexc(c)) for p, c in stops]
        self.angle = angle
        self.kind = kind
        self.center = center
        self.radius = radius

    def _luts(self):
        luts = [[0] * 256 for _ in range(4)]
        for i in range(256):
            t = i / 255
            s = self.stops
            if t <= s[0][0]:
                col = s[0][1]
            elif t >= s[-1][0]:
                col = s[-1][1]
            else:
                col = s[-1][1]
                for (p0, c0), (p1, c1) in zip(s, s[1:], strict=False):
                    if p0 <= t <= p1:
                        k = 0 if p1 == p0 else (t - p0) / (p1 - p0)
                        col = tuple(c0[j] + (c1[j] - c0[j]) * k for j in range(4))
                        break
            for ch in range(4):
                luts[ch][i] = int(round(col[ch]))
        return luts

    def render(self, size: tuple[int, int]) -> Image.Image:
        w, h = size
        w, h = max(w, 1), max(h, 1)
        if self.kind == "radial":
            src = ImageOps.expand(Image.radial_gradient("L"), border=128, fill=255)  # 512x512, centre at 256
            cx, cy = self.center[0] * w, self.center[1] * h
            rx = max(w / 2, 1) * self.radius
            ry = max(h / 2, 1) * self.radius
            data = (128 / rx, 0, 256 - cx * 128 / rx, 0, 128 / ry, 256 - cy * 128 / ry)
            g = src.transform((w, h), Image.AFFINE, data, resample=Image.BILINEAR)
        else:
            src = Image.linear_gradient("L")  # 256x256, black at top
            a = math.radians(self.angle)
            dx, dy = math.cos(a), math.sin(a)
            length = abs(w * dx) + abs(h * dy) or 1
            cx, cy = w / 2, h / 2
            data = (0, 0, 128, 255 * dx / length, 255 * dy / length, 255 * (0.5 - (cx * dx + cy * dy) / length))
            g = src.transform((w, h), Image.AFFINE, data, resample=Image.BILINEAR)
        luts = self._luts()
        return Image.merge("RGBA", [g.point(luts[i]) for i in range(4)])


class Canvas:
    """A drawing surface (or a clipped sub-layer of one) at ``ss``-times supersampling."""

    def __init__(self, w: int, h: int, ss: int = 2, bg=None, origin=(0, 0), size_ss=None):
        self.w, self.h, self.ss = w, h, ss
        self.ox, self.oy = origin  # origin of this layer in global SS px
        size = size_ss or (w * ss, h * ss)
        self.img = Image.new("RGBA", size, hexc(bg) if bg is not None else (0, 0, 0, 0))

    # ---------------------------------------------------------------- masks
    def _px(self, v: float) -> float:
        return v * self.ss

    def _mask_from(self, bbox, painter, pad: float = 1.5) -> Mask:
        x0, y0, x1, y1 = bbox
        gx0, gy0 = math.floor(self._px(x0 - pad)), math.floor(self._px(y0 - pad))
        gx1, gy1 = math.ceil(self._px(x1 + pad)), math.ceil(self._px(y1 + pad))
        im = Image.new("L", (max(gx1 - gx0, 1), max(gy1 - gy0, 1)), 0)
        d = ImageDraw.Draw(im)

        def to(pt):
            return (pt[0] * self.ss - gx0, pt[1] * self.ss - gy0)

        painter(d, to)
        return Mask(im, gx0, gy0)

    def ellipse(self, cx, cy, rx, ry) -> Mask:
        return self._mask_from(
            (cx - rx, cy - ry, cx + rx, cy + ry),
            lambda d, to: d.ellipse([*to((cx - rx, cy - ry)), *to((cx + rx, cy + ry))], fill=255),
        )

    def rrect(self, x0, y0, x1, y1, r=0) -> Mask:
        r = max(0.0, min(r, (x1 - x0) / 2, (y1 - y0) / 2))
        return self._mask_from(
            (x0, y0, x1, y1),
            lambda d, to: d.rounded_rectangle([*to((x0, y0)), *to((x1, y1))], radius=r * self.ss, fill=255),
        )

    def poly(self, pts) -> Mask:
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        return self._mask_from(
            (min(xs), min(ys), max(xs), max(ys)), lambda d, to: d.polygon([to(p) for p in pts], fill=255)
        )

    def rot_ellipse(self, cx, cy, rx, ry, deg, n=48) -> Mask:
        pts = [(cx + rx * math.cos(2 * math.pi * i / n), cy + ry * math.sin(2 * math.pi * i / n)) for i in range(n)]
        return self.poly(rot(pts, cx, cy, deg))

    def line(self, pts, width, cap=True) -> Mask:
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        m = width / 2 + 2

        def paint(d, to):
            tp = [to(p) for p in pts]
            d.line(tp, fill=255, width=max(1, int(round(width * self.ss))), joint="curve")
            if cap:
                r = width * self.ss / 2
                for p in (tp[0], tp[-1]):
                    d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=255)

        return self._mask_from((min(xs) - m, min(ys) - m, max(xs) + m, max(ys) + m), paint)

    def varline(self, pts, widths) -> Mask:
        """Stroke with per-point widths (steam, drips, tapered spouts). Points should be reasonably dense."""
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        m = max(widths) / 2 + 2

        def paint(d, to):
            for (x, y), w in zip(pts, widths, strict=False):
                px, py = to((x, y))
                r = w * self.ss / 2
                d.ellipse([px - r, py - r, px + r, py + r], fill=255)

        return self._mask_from((min(xs) - m, min(ys) - m, max(xs) + m, max(ys) + m), paint)

    def arc_poly(self, cx, cy, rx, ry, a0, a1, n=40):
        return [
            (
                cx + rx * math.cos(math.radians(a0 + (a1 - a0) * i / n)),
                cy + ry * math.sin(math.radians(a0 + (a1 - a0) * i / n)),
            )
            for i in range(n + 1)
        ]

    def text_mask(
        self, x, y, s, font: str, size: float, tracking: float = 0, anchor: str = "mm", rotate: float = 0
    ) -> Mask:
        path = font_path(font)
        f = ImageFont.truetype(path, int(round(size * self.ss))) if path else ImageFont.load_default()
        chars = list(s)
        widths = [f.getlength(ch) for ch in chars]
        total = sum(widths) + tracking * self.ss * (len(chars) - 1)
        asc, desc = f.getmetrics()
        pad = 6
        im = Image.new("L", (int(total) + pad * 2, asc + desc + pad * 2), 0)
        d = ImageDraw.Draw(im)
        cur = pad
        for ch, wch in zip(chars, widths, strict=False):
            d.text((cur, pad), ch, font=f, fill=255)
            cur += wch + tracking * self.ss
        if rotate:
            im = im.rotate(rotate, resample=Image.BICUBIC, expand=True)
        # anchor horizontally/vertically (m = middle, l/r/t/b)
        ax = {"l": 0.0, "m": 0.5, "r": 1.0}[anchor[0]]
        ay = {"t": 0.0, "m": 0.5, "b": 1.0}[anchor[1]]
        gx = int(round(x * self.ss - im.width * ax))
        gy = int(round(y * self.ss - im.height * ay))
        return Mask(im, gx, gy)

    # ------------------------------------------------------- mask algebra
    @staticmethod
    def _union_box(ms):
        return (
            min(m.x for m in ms),
            min(m.y for m in ms),
            max(m.x + m.img.width for m in ms),
            max(m.y + m.img.height for m in ms),
        )

    def _on_box(self, m: Mask, box) -> Image.Image:
        im = Image.new("L", (box[2] - box[0], box[3] - box[1]), 0)
        im.paste(m.img, (m.x - box[0], m.y - box[1]))
        return im

    def union(self, *ms: Mask) -> Mask:
        box = self._union_box(ms)
        out = self._on_box(ms[0], box)
        for m in ms[1:]:
            out = ImageChops.lighter(out, self._on_box(m, box))
        return Mask(out, box[0], box[1])

    def inter(self, a: Mask, b: Mask) -> Mask:
        box = self._union_box([a, b])
        return Mask(ImageChops.multiply(self._on_box(a, box), self._on_box(b, box)), box[0], box[1])

    def sub(self, a: Mask, b: Mask) -> Mask:
        box = self._union_box([a, b])
        return Mask(ImageChops.subtract(self._on_box(a, box), self._on_box(b, box)), box[0], box[1])

    def shift(self, m: Mask, dx, dy) -> Mask:
        return Mask(m.img, m.x + int(round(dx * self.ss)), m.y + int(round(dy * self.ss)))

    def blur_mask(self, m: Mask, radius) -> Mask:
        pad = int(radius * self.ss * 3) + 2
        im = Image.new("L", (m.img.width + 2 * pad, m.img.height + 2 * pad), 0)
        im.paste(m.img, (pad, pad))
        return Mask(im.filter(ImageFilter.GaussianBlur(radius * self.ss)), m.x - pad, m.y - pad)

    @staticmethod
    def scale_mask(m: Mask, alpha: float) -> Mask:
        if alpha >= 0.999:
            return m
        lut = [int(round(i * alpha)) for i in range(256)]
        return Mask(m.img.point(lut), m.x, m.y)

    # ----------------------------------------------------------- painting
    def fill(self, mask: Mask, paint, alpha: float = 1.0) -> None:
        m = self.scale_mask(mask, alpha)
        w, h = m.img.size
        if isinstance(paint, Grad):
            src = paint.render((w, h))
        else:
            src = Image.new("RGBA", (w, h), hexc(paint))
        src_a = src.getchannel("A")
        src.putalpha(ImageChops.multiply(src_a, m.img))
        # global -> local
        lx, ly = m.x - self.ox, m.y - self.oy
        x0, y0 = max(lx, 0), max(ly, 0)
        x1, y1 = min(lx + w, self.img.width), min(ly + h, self.img.height)
        if x1 <= x0 or y1 <= y0:
            return
        crop = src.crop((x0 - lx, y0 - ly, x1 - lx, y1 - ly))
        self.img.alpha_composite(crop, (x0, y0))

    def shadow(self, mask: Mask, dx=0, dy=0, blur=10, color=(43, 29, 22), alpha=0.25, grow=0) -> None:
        m = self.blur_mask(self.shift(mask, dx, dy), blur)
        self.fill(m, color, alpha)

    def glow(self, mask: Mask, blur, color, alpha=0.5) -> None:
        self.fill(self.blur_mask(mask, blur), color, alpha)

    def stroke_outline(self, mask: Mask, width, color, alpha=1.0) -> None:
        """Outline just inside the mask edge."""
        k = int(max(1, round(width * self.ss)))
        eroded = mask.img.filter(ImageFilter.MinFilter(k * 2 + 1)) if k < 12 else mask.img
        ring = ImageChops.subtract(mask.img, eroded)
        self.fill(Mask(ring, mask.x, mask.y), color, alpha)

    def sublayer(self, x0, y0, x1, y1) -> Canvas:
        gx0, gy0 = math.floor(self._px(x0)), math.floor(self._px(y0))
        gx1, gy1 = math.ceil(self._px(x1)), math.ceil(self._px(y1))
        return Canvas(self.w, self.h, self.ss, None, origin=(gx0, gy0), size_ss=(gx1 - gx0, gy1 - gy0))

    def paste(self, layer: Canvas, clip: Mask | None = None, alpha: float = 1.0, blur: float = 0) -> None:
        img = layer.img
        if blur:
            img = img.filter(ImageFilter.GaussianBlur(blur * self.ss))
        if clip is not None:
            m = self.scale_mask(clip, alpha)
            lm = Image.new("L", img.size, 0)
            lm.paste(m.img, (m.x - layer.ox, m.y - layer.oy))
            a = ImageChops.multiply(img.getchannel("A"), lm)
            img = img.copy()
            img.putalpha(a)
        elif alpha < 0.999:
            img = img.copy()
            img.putalpha(img.getchannel("A").point([int(i * alpha) for i in range(256)]))
        lx, ly = layer.ox - self.ox, layer.oy - self.oy
        x0, y0 = max(lx, 0), max(ly, 0)
        x1, y1 = min(lx + img.width, self.img.width), min(ly + img.height, self.img.height)
        if x1 <= x0 or y1 <= y0:
            return
        self.img.alpha_composite(img.crop((x0 - lx, y0 - ly, x1 - lx, y1 - ly)), (x0, y0))

    def paste_image(self, im: Image.Image, x, y, alpha=1.0) -> None:
        """Paste a ready RGBA image (already in SS px) at design coords (x, y)."""
        if alpha < 0.999:
            im = im.copy()
            im.putalpha(im.getchannel("A").point([int(i * alpha) for i in range(256)]))
        self.img.alpha_composite(im, (int(x * self.ss) - self.ox, int(y * self.ss) - self.oy))

    # -------------------------------------------------------------- output
    def render(self) -> Image.Image:
        out = self.img.resize((self.w, self.h), Image.LANCZOS)
        return out


def grain(img: Image.Image, seed: int, amount: float = 5.0, fibres: float = 2.2) -> Image.Image:
    """Deterministic fine paper grain (+/- ``amount`` levels) with a whisper of low-frequency fibre mottling."""
    w, h = img.size
    rng = random.Random(seed)
    fine = Image.frombytes("L", (w // 2 + 1, h // 2 + 1), rng.randbytes((w // 2 + 1) * (h // 2 + 1)))
    fine = fine.resize((w, h), Image.BILINEAR).point([int(128 + (v - 128) * amount / 128) for v in range(256)])
    coarse = Image.frombytes("L", (w // 9 + 1, h // 9 + 1), rng.randbytes((w // 9 + 1) * (h // 9 + 1)))
    coarse = coarse.resize((w, h), Image.BICUBIC).point([int(128 + (v - 128) * fibres / 128) for v in range(256)])
    rgb = img.convert("RGB")
    for layer in (fine, coarse):
        n3 = Image.merge("RGB", [layer, layer, layer])
        rgb = ImageChops.add(rgb, n3, 1.0, -128)
    return rgb


def vignette(img: Image.Image, strength: float = 0.18, tint=(43, 29, 22)) -> Image.Image:
    w, h = img.size
    g = Image.radial_gradient("L").resize((w, h), Image.BICUBIC)  # 0 centre -> 255 edge
    g = g.point([int(max(0, (i - 110)) / 145 * 255 * strength) for i in range(256)])
    dark = Image.new("RGB", (w, h), tuple(tint))
    return Image.composite(dark, img.convert("RGB"), g)

#!/usr/bin/env python
"""Generate the demo imagery for Lantern Coffee Roasters (editorial flat illustration style, Pillow only).

    cd backend && python scripts/generate_assets.py            # everything -> apps/core/seed_assets/
    python scripts/generate_assets.py --only products --slug latte
    python scripts/generate_assets.py --quality 80 --out /tmp/preview

* No stock photos, no remote images, no network: every pixel is drawn by ``scripts/lantern_art`` (see that package).
* Deterministic: per-image seeds derive from the slug (``zlib.crc32``). The only external inputs are the system fonts
  Caladea (serif) and Inter (sans) — if they are missing the renderer falls back to Liberation/DejaVu, which changes the
  lettering on bags/signs but nothing else.
* Per-product art specs live in ``apps/core/seed/catalog_data.py`` so adding a product there and re-running this script
  produces its image.
"""

from __future__ import annotations

import argparse
import sys
import time
import zlib
from multiprocessing import Pool
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(BACKEND))

DEFAULT_OUT = BACKEND / "apps" / "core" / "seed_assets"
GROUPS = ("products", "categories", "collections", "branches", "content", "brand")


def seed_for(slug: str) -> int:
    return zlib.crc32(slug.encode()) % 100000


def jobs(only: set[str], slug: str | None):
    from lantern_art import places

    from apps.core.seed.catalog_data import CATEGORIES, COLLECTIONS, PRODUCTS, slugify

    out = []

    def add(group, name):
        if group in only and (slug is None or slug == name):
            out.append((group, name))

    for p in PRODUCTS:
        add("products", slugify(p["name"]))
    for cat in CATEGORIES:
        add("categories", cat["slug"])
    for col in COLLECTIONS:
        add("collections", col["slug"])
    for b in places.SCENES:
        add("branches", b)
    for n in ("hero", "story", "sourcing", "craft"):
        add("content", n)
    for n in ("og-default", "logo", "logo-light", "logo-mark"):
        add("brand", n)
    return out


def render(job):
    group, name = job
    from lantern_art import editorial, places
    from lantern_art.scenes import product_image

    from apps.core.seed.catalog_data import CATEGORIES, COLLECTIONS, PRODUCTS, slugify

    seed = seed_for(f"{group}/{name}")
    if group == "products":
        p = next(p for p in PRODUCTS if slugify(p["name"]) == name)
        return job, product_image(name, p["art"], p["tint"] or "sage", seed), 82
    if group == "categories":
        cat = next(c for c in CATEGORIES if c["slug"] == name)
        return job, editorial.category_image(name, cat["tint"], seed), 82
    if group == "collections":
        col = next(c for c in COLLECTIONS if c["slug"] == name)
        return job, editorial.collection_image(name, col["tint"], seed), 82
    if group == "branches":
        return job, places.SCENES[name](), 82
    if group == "content":
        fn = {
            "hero": editorial.hero,
            "story": editorial.story,
            "sourcing": editorial.sourcing,
            "craft": editorial.craft,
        }[name]
        return job, fn(), 84
    if name == "og-default":
        return job, editorial.og(), 86
    if name == "logo":
        return job, editorial.logo_wordmark(), 100
    if name == "logo-light":
        return job, editorial.logo_wordmark("#F7F0E3", "#E9B27A"), 100
    return job, editorial.logo_mark(), 100


def save(path: Path, im, quality: int) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    if quality >= 100:  # logos: lossless with alpha
        im.save(path, "WEBP", lossless=True, method=6)
    else:
        im.convert("RGB").save(path, "WEBP", quality=quality, method=6)
    return path.stat().st_size


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--only", choices=GROUPS, action="append", help="limit to a group (repeatable)")
    ap.add_argument("--slug", help="limit to one slug/name inside the selected group(s)")
    ap.add_argument("--quality", type=int, help="override WebP quality for lossy images")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args(argv)

    todo = jobs(set(args.only or GROUPS), args.slug)
    if not todo:
        print("nothing matched", file=sys.stderr)
        return 1
    started = time.time()
    total = 0
    with Pool(max(1, args.workers)) as pool:
        for (group, name), im, quality in pool.imap_unordered(render, todo):
            q = args.quality if args.quality and quality < 100 else quality
            size = save(args.out / group / f"{name}.webp", im, q)
            total += size
            print(f"{group}/{name}.webp  {im.width}x{im.height}  {size / 1024:.0f} KB")
    print(f"{len(todo)} images, {total / 1024 / 1024:.2f} MB, {time.time() - started:.0f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

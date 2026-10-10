"""Copy the generated illustrations (apps/core/seed_assets) into ImageFields — only when missing or changed."""

from __future__ import annotations

import contextlib
import hashlib
from pathlib import Path

from django.core.files.base import ContentFile

ASSET_ROOT = Path(__file__).resolve().parent.parent / "seed_assets"


def asset_path(group: str, name: str) -> Path:
    return ASSET_ROOT / group / f"{name}.webp"


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def stored_hash(field_file) -> str | None:
    """SHA-256 of the file currently stored for an ImageField, or None when there isn't one / it can't be read."""
    if not field_file or not field_file.name:
        return None
    try:
        with field_file.storage.open(field_file.name, "rb") as fh:
            return hashlib.sha256(fh.read()).hexdigest()
    except (FileNotFoundError, OSError, ValueError):
        return None


def attach_image(instance, field: str, group: str, name: str, *, replace: bool = True) -> str:
    """Store ``seed_assets/<group>/<name>.webp`` in ``instance.<field>``.

    Returns ``created`` | ``updated`` | ``unchanged`` | ``kept`` (existing different image, replace=False) | ``missing``
    (no generated asset — run scripts/generate_assets.py). Saves the instance field only when something changed.
    """
    src = asset_path(group, name)
    if not src.exists():
        return "missing"
    data = src.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    current = getattr(instance, field)
    had_file = bool(current and current.name)
    if had_file and stored_hash(current) == digest:
        return "unchanged"
    if had_file and not replace:
        return "kept"
    if had_file:
        with contextlib.suppress(OSError):
            current.storage.delete(current.name)
    current.save(f"{name}.webp", ContentFile(data), save=False)
    instance.save(update_fields=[field])
    return "updated" if had_file else "created"

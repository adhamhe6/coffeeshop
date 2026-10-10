"""Safe image uploads: validate, decode with Pillow, strip metadata, resize and store as WebP (plan rule 9)."""

from __future__ import annotations

import io
import logging
import uuid

from django.conf import settings
from django.core.files.base import ContentFile
from PIL import Image, ImageOps, UnidentifiedImageError

from apps.core.errors import DomainError

log = logging.getLogger(__name__)

ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}
MAX_EDGE = 1600
MAX_PIXELS = 40_000_000  # decompression-bomb guard


def _fail(message: str, code: str = "invalid_image") -> DomainError:
    return DomainError(message, code=code, fields={"image": [message]})


def process_image_upload(upload, *, max_edge: int = MAX_EDGE, quality: int = 85, name: str = "image") -> ContentFile:
    """Return a WebP `ContentFile` (<= `max_edge` px on the long side) for an uploaded JPEG/PNG/WebP, or raise a 400.

    The declared content type and file extension are never trusted: the bytes must decode as one of the allowed
    formats. Re-encoding drops EXIF/ICC metadata (including GPS) and any appended payload.
    """
    if upload is None:
        raise _fail("Choose an image file to upload.", "image_required")
    max_bytes = settings.MAX_IMAGE_UPLOAD_BYTES
    if upload.size > max_bytes:
        raise _fail(f"The image is too large (maximum {max_bytes // (1024 * 1024)} MB).", "image_too_large")
    try:
        upload.seek(0)
        probe = Image.open(upload)
        fmt = probe.format
        if fmt not in ALLOWED_FORMATS:
            raise _fail("Unsupported image type. Upload a JPEG, PNG or WebP file.", "unsupported_image_type")
        if probe.width * probe.height > MAX_PIXELS:
            raise _fail("The image dimensions are too large.", "image_too_large")
        probe.verify()
        upload.seek(0)
        image = Image.open(upload)
        image.load()
    except DomainError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError, Image.DecompressionBombError):
        raise _fail("The file is not a valid image. Upload a JPEG, PNG or WebP file.")
    image = ImageOps.exif_transpose(image)
    has_alpha = image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info)
    image = image.convert("RGBA" if has_alpha else "RGB")
    image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, format="WEBP", quality=quality, method=4)
    stem = "".join(c for c in name.lower() if c.isalnum() or c == "-")[:40] or "image"
    return ContentFile(buffer.getvalue(), name=f"{stem}-{uuid.uuid4().hex[:10]}.webp")


def replace_image(instance, field_name: str, upload, *, name: str = "image") -> None:
    """Process `upload` and store it on `instance.<field_name>`, removing the previous file once saved."""
    content = process_image_upload(upload, name=name)
    field = getattr(instance, field_name)
    old_name = field.name if field else None
    storage = field.storage if field else None
    field.save(content.name, content, save=False)
    instance.save(update_fields=[field_name] + (["updated_at"] if hasattr(instance, "updated_at") else []))
    if old_name and storage and old_name != getattr(instance, field_name).name:
        try:
            storage.delete(old_name)
        except Exception:  # noqa: BLE001 - never fail a request over orphan cleanup
            log.warning("Could not delete replaced image %s", old_name)


def remove_image(instance, field_name: str) -> None:
    field = getattr(instance, field_name)
    if not field:
        return
    old_name, storage = field.name, field.storage
    setattr(instance, field_name, "")
    instance.save(update_fields=[field_name] + (["updated_at"] if hasattr(instance, "updated_at") else []))
    try:
        storage.delete(old_name)
    except Exception:  # noqa: BLE001
        log.warning("Could not delete removed image %s", old_name)

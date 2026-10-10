"""Upload validation for images (cross-cutting rule 9): type, size, and a real Pillow decode."""

from __future__ import annotations

import contextlib

from django.conf import settings
from django.core.exceptions import ValidationError
from PIL import Image, UnidentifiedImageError

ALLOWED_FORMATS = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
MAX_PIXELS = 40_000_000


def validate_image_upload(upload) -> None:
    """Accept JPEG/PNG/WebP up to MAX_IMAGE_UPLOAD_BYTES that Pillow can fully decode. Raises ValidationError."""
    limit = getattr(settings, "MAX_IMAGE_UPLOAD_BYTES", 5 * 1024 * 1024)
    if upload.size > limit:
        raise ValidationError(f"Image is too large (max {limit // (1024 * 1024)} MB).")
    try:
        upload.seek(0)
        with Image.open(upload) as img:
            fmt = img.format
            if fmt not in ALLOWED_FORMATS:
                raise ValidationError("Unsupported image type. Upload a JPEG, PNG or WebP file.")
            if img.width * img.height > MAX_PIXELS:
                raise ValidationError("Image dimensions are too large.")
            img.load()  # full decode, not just header parsing
    except ValidationError:
        raise
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, Image.DecompressionBombError):
        raise ValidationError("The uploaded file is not a valid image.") from None
    finally:
        with contextlib.suppress(Exception):
            upload.seek(0)

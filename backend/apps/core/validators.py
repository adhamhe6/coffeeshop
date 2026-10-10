import re
from urllib.parse import urlparse

from django.core.exceptions import ValidationError

_ALLOWED_SCHEMES = {"http", "https"}


def validate_safe_link(value: str) -> None:
    """Allow internal absolute paths ('/menu') or http(s) URLs. Rejects javascript:, data:, protocol-relative, etc."""
    if not value:
        return
    if value.startswith("/") and not value.startswith("//"):
        return
    parsed = urlparse(value)
    if parsed.scheme in _ALLOWED_SCHEMES and parsed.netloc:
        return
    raise ValidationError("Enter an internal path starting with '/' or a full http(s) URL.")


_PHONE_RE = re.compile(r"^[+(]?[0-9(][0-9 ()\-.]{5,28}[0-9]$")


def validate_phone(value: str) -> None:
    """Loose international phone check: optional '+', digits, spaces, dots, dashes and parentheses; 7-30 chars."""
    if not value:
        return
    digits = sum(c.isdigit() for c in value)
    if not _PHONE_RE.match(value) or not 7 <= digits <= 15:
        raise ValidationError("Enter a valid phone number, e.g. +1 555 010 0100.")


def validate_http_url(value: str) -> None:
    """http(s) URLs only (social links etc.)."""
    parsed = urlparse(value or "")
    if parsed.scheme not in _ALLOWED_SCHEMES or not parsed.netloc:
        raise ValidationError("Enter a full http:// or https:// URL.")

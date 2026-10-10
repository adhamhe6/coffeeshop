"""CSV export helpers. Cells that a spreadsheet could interpret as a formula are neutralised (CSV injection)."""

from __future__ import annotations

import csv
from collections.abc import Iterable, Iterator

from django.http import StreamingHttpResponse
from rest_framework.renderers import BaseRenderer

_DANGEROUS_PREFIXES = ("=", "+", "-", "@", "\t", "\r", "\n")


def safe_cell(value):
    """Prefix text that starts with a formula trigger with an apostrophe so Excel/Sheets treat it as text."""
    if isinstance(value, str) and value:
        if value.startswith(_DANGEROUS_PREFIXES) or value.lstrip().startswith(_DANGEROUS_PREFIXES):
            return "'" + value
        return value
    if value is None:
        return ""
    return value


class _Echo:
    def write(self, value):
        return value


def csv_response(filename: str, header: list[str], rows: Iterable[Iterable]) -> StreamingHttpResponse:
    writer = csv.writer(_Echo())

    def stream() -> Iterator[str]:
        yield "﻿"  # BOM so Excel detects UTF-8
        yield writer.writerow([safe_cell(h) for h in header])
        for row in rows:
            yield writer.writerow([safe_cell(c) for c in row])

    response = StreamingHttpResponse(stream(), content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    response["Cache-Control"] = "no-store"
    return response


class CSVRenderer(BaseRenderer):
    """Registers `?format=csv` with DRF content negotiation. Views return `csv_response(...)` directly."""

    media_type = "text/csv"
    format = "csv"
    charset = "utf-8"

    def render(self, data, accepted_media_type=None, renderer_context=None):
        return b"" if data is None else str(data).encode(self.charset)

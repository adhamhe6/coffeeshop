"""Streaming, spreadsheet-injection-safe CSV.

Excel/Sheets/LibreOffice evaluate cells that start with `=`, `+`, `-`, `@` (and tab/CR variants) as formulas, so any
*text* cell beginning with one of them is prefixed with a single quote. Genuine numbers (Decimal/int/float) are written
as numbers and are never prefixed: a refund total of `-12.00` stays numeric.
"""

from __future__ import annotations

import csv
import datetime as dt
import re
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from decimal import Decimal

from django.http import StreamingHttpResponse

FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")
BOM = chr(0xFEFF)  # lets Excel open UTF-8 (accents, currency symbols) correctly


def sanitize_cell(value) -> str:
    """Convert a value to its CSV text, neutralising formula injection in text cells."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, dt.datetime):
        return value.isoformat()
    if isinstance(value, dt.date):
        return value.isoformat()
    text = str(value)
    return "'" + text if text.startswith(FORMULA_PREFIXES) else text


@dataclass
class Section:
    """One table in the file. `columns` is [(header, field)]; `totals` adds a final Total row."""

    title: str
    columns: list[tuple[str, str]]
    rows: Iterable[dict]
    totals: dict | None = None


class _Echo:
    def write(self, value):
        return value


def _rows(sections: list[Section]) -> Iterator[list]:
    multiple = len(sections) > 1
    for index, section in enumerate(sections):
        if index:
            yield []
        if multiple:
            yield [section.title]
        yield [header for header, _ in section.columns]
        for row in section.rows:
            yield [row.get(name) for _, name in section.columns]
        if section.totals is not None:
            cells = [section.totals.get(name) for _, name in section.columns]
            if section.columns[0][1] not in section.totals:
                cells[0] = "Total"
            yield cells


def _lines(sections: list[Section]) -> Iterator[str]:
    writer = csv.writer(_Echo(), lineterminator="\r\n")
    first = True
    for row in _rows(sections):
        line = writer.writerow([sanitize_cell(cell) for cell in row])
        yield BOM + line if first else line
        first = False


def safe_filename(*parts: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", "_".join(p for p in parts if p)).strip("-_") + ".csv"


def csv_response(filename: str, sections: list[Section]) -> StreamingHttpResponse:
    response = StreamingHttpResponse(_lines(sections), content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    response["Cache-Control"] = "no-store"
    return response

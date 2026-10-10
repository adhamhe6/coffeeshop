"""Query-parameter validation, branch scoping and the time window every report is computed over.

Time handling: a "day" is the *branch-local* day of an order's `placed_at`. When every branch in scope shares one time
zone the window is an exact, index-friendly `placed_at` range. When scope spans zones the query adds a per-row
`timezone(branch.timezone, placed_at)::date` check on top of a conservative UTC range (UTC-12 .. UTC+14).
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db.models import DateField, DateTimeField, F, Func, Q, Value
from django.db.models.functions import Cast
from django.db.models.lookups import GreaterThanOrEqual, LessThanOrEqual
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import NotFound

from apps.accounts.permissions import branch_scope
from apps.branches.models import Branch

MAX_SPAN_DAYS = 400
DEFAULT_SPAN_DAYS = 30
GRANULARITIES = ("day", "week", "month")

# Extremes of real-world UTC offsets, used to build a safe superset range before the exact local-date check.
_MIN_OFFSET = dt.timedelta(hours=-12)
_MAX_OFFSET = dt.timedelta(hours=14)


class ReportQuerySerializer(serializers.Serializer):
    """Common filters. Declared for validation and for the OpenAPI parameter list."""

    date_from = serializers.DateField(
        required=False, help_text="Inclusive, YYYY-MM-DD. Default: 29 days before date_to."
    )
    date_to = serializers.DateField(required=False, help_text="Inclusive, YYYY-MM-DD. Default: today.")
    branch = serializers.IntegerField(
        required=False, min_value=1, help_text="One branch id inside your branch scope. Default: all branches in scope."
    )
    granularity = serializers.ChoiceField(choices=GRANULARITIES, required=False, default="day")


@dataclass(frozen=True)
class BranchInfo:
    id: int
    name: str
    timezone: str


def local_ts(field_path: str, branch_path: str, tz_names: tuple[str, ...]):
    """`placed_at` as a naive timestamp in the branch's zone (literal zone when only one is in play)."""
    zone = Value(tz_names[0]) if len(tz_names) == 1 else F(f"{branch_path}__timezone" if branch_path else "timezone")
    return Func(zone, F(field_path), function="timezone", output_field=DateTimeField())


def local_date(field_path: str, branch_path: str, tz_names: tuple[str, ...]):
    return Cast(local_ts(field_path, branch_path, tz_names), DateField())


def bucket_expr(granularity: str, field_path: str, branch_path: str, tz_names: tuple[str, ...]):
    """Branch-local bucket start (day / ISO week Monday / first of month) as a date."""
    if granularity == "day":
        return local_date(field_path, branch_path, tz_names)
    unit = {"week": "week", "month": "month"}[granularity]  # whitelisted, safe to inline
    return Func(
        local_ts(field_path, branch_path, tz_names),
        function="date_trunc",
        template=f"(date_trunc('{unit}', %(expressions)s))::date",
        output_field=DateField(),
    )


@dataclass(frozen=True)
class Window:
    """Inclusive local-date range `[date_from, date_to]` evaluated over the zones in `tz_names`."""

    date_from: dt.date
    date_to: dt.date
    tz_names: tuple[str, ...]

    @property
    def days(self) -> int:
        return (self.date_to - self.date_from).days + 1

    def _exact_bounds(self) -> tuple[dt.datetime, dt.datetime]:
        tz = ZoneInfo(self.tz_names[0])
        start = dt.datetime.combine(self.date_from, dt.time.min, tzinfo=tz)
        end = dt.datetime.combine(self.date_to + dt.timedelta(days=1), dt.time.min, tzinfo=tz)
        return start, end

    def _coarse_bounds(self) -> tuple[dt.datetime, dt.datetime]:
        utc = dt.UTC
        start = dt.datetime.combine(self.date_from, dt.time.min, tzinfo=utc) - _MAX_OFFSET
        end = dt.datetime.combine(self.date_to + dt.timedelta(days=1), dt.time.min, tzinfo=utc) - _MIN_OFFSET
        return start, end

    def q(self, field_path: str = "placed_at", branch_path: str = "branch") -> Q:
        """Condition selecting rows whose `field_path` falls on a local date inside the window."""
        if len(self.tz_names) <= 1:
            start, end = self._exact_bounds()
            return Q(**{f"{field_path}__gte": start, f"{field_path}__lt": end})
        start, end = self._coarse_bounds()
        ldate = local_date(field_path, branch_path, self.tz_names)
        return (
            Q(**{f"{field_path}__gte": start, f"{field_path}__lt": end})
            & Q(GreaterThanOrEqual(ldate, Value(self.date_from, output_field=DateField())))
            & Q(LessThanOrEqual(ldate, Value(self.date_to, output_field=DateField())))
        )


@dataclass
class ReportContext:
    """Everything a selector needs: who is asking, which branches, which dates."""

    user: object
    branches: list[BranchInfo]
    branch_ids: frozenset[int] | None  # None = every branch (global role, no branch filter)
    selected_branch: int | None
    date_from: dt.date
    date_to: dt.date
    granularity: str = "day"
    tz_names: tuple[str, ...] = field(default=("UTC",))
    extra: dict = field(default_factory=dict)  # report-specific validated params (ordering, status…)

    @property
    def window(self) -> Window:
        return Window(self.date_from, self.date_to, self.tz_names)

    @property
    def previous_window(self) -> Window:
        span = self.window.days
        prev_to = self.date_from - dt.timedelta(days=1)
        return Window(prev_to - dt.timedelta(days=span - 1), prev_to, self.tz_names)

    @property
    def signature(self) -> str:
        """Stable identity of the *effective* branch scope. Part of every cache key."""
        return "all" if self.branch_ids is None else "b:" + ",".join(str(i) for i in sorted(self.branch_ids))

    def scope_q(self, path: str = "branch_id") -> Q:
        if self.branch_ids is None:
            return Q()
        return Q(**{f"{path}__in": sorted(self.branch_ids)})

    def period(self) -> dict:
        prev = self.previous_window
        return {
            "date_from": self.date_from,
            "date_to": self.date_to,
            "previous_date_from": prev.date_from,
            "previous_date_to": prev.date_to,
            "granularity": self.granularity,
            "branch": self.selected_branch,
            "timezones": list(self.tz_names),
        }


def _today(tz_names: tuple[str, ...]) -> dt.date:
    zone = ZoneInfo(tz_names[0]) if len(tz_names) == 1 else timezone.get_current_timezone()
    return timezone.now().astimezone(zone).date()


def build_context(request, serializer_class: type[serializers.Serializer] = ReportQuerySerializer) -> ReportContext:
    """Validate query params, enforce branch scope and resolve the time zone(s). Raises 400 / 404."""
    serializer = serializer_class(data=request.query_params)
    serializer.is_valid(raise_exception=True)
    params = serializer.validated_data

    user = request.user
    allowed = branch_scope(user)  # None = all
    selected = params.get("branch")
    if selected is not None and allowed is not None and selected not in allowed:
        raise NotFound("Branch not found.")  # same answer as a missing branch: no existence leak
    branch_qs = Branch.objects.all()
    if selected is not None:
        branch_qs = branch_qs.filter(pk=selected)
    elif allowed is not None:
        branch_qs = branch_qs.filter(pk__in=allowed)
    branches = [
        BranchInfo(b["id"], b["name"], b["timezone"])
        for b in branch_qs.order_by("sort_order", "name").values("id", "name", "timezone")
    ]
    if selected is not None and not branches:
        raise NotFound("Branch not found.")

    if selected is not None:
        branch_ids: frozenset[int] | None = frozenset({selected})
    elif allowed is None:
        branch_ids = None
    else:
        branch_ids = frozenset(allowed)

    tz_names = tuple(sorted({b.timezone for b in branches})) or (settings.TIME_ZONE,)

    date_to = params.get("date_to")
    date_from = params.get("date_from")
    if date_to is None:
        today = _today(tz_names)
        date_to = today if date_from is None else max(today, date_from)
    if date_from is None:
        date_from = date_to - dt.timedelta(days=DEFAULT_SPAN_DAYS - 1)
    if date_to < date_from:
        raise serializers.ValidationError({"date_to": ["date_to must be on or after date_from."]})
    if (date_to - date_from).days + 1 > MAX_SPAN_DAYS:
        raise serializers.ValidationError({"date_to": [f"The date range may span at most {MAX_SPAN_DAYS} days."]})
    return ReportContext(
        user=user,
        branches=branches,
        branch_ids=branch_ids,
        selected_branch=selected,
        date_from=date_from,
        date_to=date_to,
        granularity=params.get("granularity", "day"),
        tz_names=tz_names,
        extra={k: v for k, v in params.items() if k not in ReportQuerySerializer().fields},
    )


def bucket_starts(ctx: ReportContext) -> list[dt.date]:
    """Every bucket start (clipped to date_from) in the range, for zero-filling."""
    out: list[dt.date] = []
    day = ctx.date_from
    if ctx.granularity == "day":
        while day <= ctx.date_to:
            out.append(day)
            day += dt.timedelta(days=1)
        return out
    while day <= ctx.date_to:
        out.append(day)
        if ctx.granularity == "week":
            day = day + dt.timedelta(days=7 - day.weekday())
        else:
            day = (day.replace(day=1) + dt.timedelta(days=32)).replace(day=1)
    return out


def bucket_key(ctx: ReportContext, raw: dt.date) -> dt.date:
    """Clip an SQL bucket start to the requested range (the first week/month may start before date_from)."""
    return max(raw, ctx.date_from)

from datetime import time

from apps.branches.models import Branch, BranchHours


def set_hours(branch: Branch, spec: dict[int, tuple[time, time] | None]):
    """spec: weekday -> (opens, closes) or None for closed. Replaces all hours."""
    BranchHours.objects.filter(branch=branch).delete()
    for weekday in range(7):
        window = spec.get(weekday)
        if window is None:
            BranchHours.objects.create(branch=branch, weekday=weekday, is_closed=True)
        else:
            BranchHours.objects.create(branch=branch, weekday=weekday, opens=window[0], closes=window[1])

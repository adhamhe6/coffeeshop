from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.core.validators import MinValueValidator
from django.db import models
from django.db.models import F, Q
from django.utils import timezone


class Branch(models.Model):
    code = models.SlugField(max_length=12, unique=True, help_text="Short code used in order numbers, e.g. DT")
    name = models.CharField(max_length=100)
    slug = models.SlugField(unique=True)
    description = models.CharField(max_length=300, blank=True)
    image = models.ImageField(upload_to="branches/", blank=True)
    address_line = models.CharField(max_length=200)
    city = models.CharField(max_length=80)
    postal_code = models.CharField(max_length=20, blank=True)
    latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    phone = models.CharField(max_length=30, blank=True)
    email = models.EmailField(blank=True)
    timezone = models.CharField(max_length=64, default="UTC")
    is_active = models.BooleanField(default=True)
    is_placeholder_address = models.BooleanField(default=False, help_text="Demo address — replace before launch")
    pickup_enabled = models.BooleanField(default=True)
    delivery_enabled = models.BooleanField(default=False)
    accepting_orders = models.BooleanField(default=True, help_text="Pause switch for busy periods")
    prep_minutes = models.PositiveSmallIntegerField(default=10, help_text="Typical preparation time for pickup")
    sort_order = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "name"]
        verbose_name_plural = "branches"

    def __str__(self):
        return self.name

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)

    def local_now(self) -> datetime:
        return timezone.now().astimezone(self.tz)

    def hours_for(self, day: date) -> "BranchHours | None":
        return self.hours.filter(weekday=day.weekday()).first()

    def is_closed_on(self, day: date) -> bool:
        return self.closures.filter(start_date__lte=day, end_date__gte=day).exists()

    def is_open_at(self, moment: datetime | None = None) -> bool:
        """True if the branch's weekly hours (minus closure periods) cover `moment` (default: now), in branch time."""
        local = (moment or timezone.now()).astimezone(self.tz)
        if self.is_closed_on(local.date()):
            return False
        hours = self.hours_for(local.date())
        if not hours or hours.is_closed or not hours.opens or not hours.closes:
            return False
        return hours.opens <= local.time() < hours.closes


class BranchHours(models.Model):
    branch = models.ForeignKey(Branch, on_delete=models.CASCADE, related_name="hours")
    weekday = models.PositiveSmallIntegerField(help_text="0=Monday … 6=Sunday")
    opens = models.TimeField(null=True, blank=True)
    closes = models.TimeField(null=True, blank=True)
    is_closed = models.BooleanField(default=False)

    class Meta:
        ordering = ["branch", "weekday"]
        constraints = [
            models.UniqueConstraint(fields=["branch", "weekday"], name="branchhours_unique_day"),
            models.CheckConstraint(condition=Q(weekday__gte=0, weekday__lte=6), name="branchhours_weekday_range"),
            models.CheckConstraint(
                condition=Q(is_closed=True) | (Q(opens__isnull=False, closes__isnull=False, closes__gt=F("opens"))),
                name="branchhours_open_before_close",
            ),
        ]


class BranchClosure(models.Model):
    branch = models.ForeignKey(Branch, on_delete=models.CASCADE, related_name="closures")
    start_date = models.DateField()
    end_date = models.DateField()
    reason = models.CharField(max_length=160, blank=True)

    class Meta:
        ordering = ["start_date"]
        constraints = [models.CheckConstraint(condition=Q(end_date__gte=F("start_date")), name="closure_valid_range")]


class DeliveryZone(models.Model):
    """A named delivery area (e.g. 'Old Town'). Branches choose which zones they serve and at what fee."""

    name = models.CharField(max_length=80, unique=True)
    slug = models.SlugField(unique=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class BranchDeliveryZone(models.Model):
    branch = models.ForeignKey(Branch, on_delete=models.CASCADE, related_name="delivery_zones")
    zone = models.ForeignKey(DeliveryZone, on_delete=models.CASCADE, related_name="branch_links")
    fee = models.DecimalField(
        max_digits=6, decimal_places=2, default=Decimal("0.00"), validators=[MinValueValidator(0)]
    )
    min_order_total = models.DecimalField(
        max_digits=8, decimal_places=2, default=Decimal("0.00"), validators=[MinValueValidator(0)]
    )
    free_delivery_over = models.DecimalField(
        max_digits=8, decimal_places=2, null=True, blank=True, validators=[MinValueValidator(0)]
    )
    eta_minutes = models.PositiveSmallIntegerField(default=30)
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["branch", "zone"], name="branchzone_unique")]
        ordering = ["branch", "zone__name"]

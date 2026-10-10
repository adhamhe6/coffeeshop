from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator, URLValidator
from django.db import models
from django.db.models import Q
from django.utils import timezone


class TimestampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class StoreSettings(models.Model):
    """Singleton (pk=1) holding brand and commerce configuration editable from the dashboard."""

    brand_name = models.CharField(max_length=80, default="Lantern Coffee Roasters")
    tagline = models.CharField(max_length=160, default="Slow-roasted. Carefully poured.")
    legal_name = models.CharField(max_length=160, blank=True)
    currency = models.CharField(max_length=3, default="USD", help_text="ISO 4217 code")
    support_email = models.EmailField(default="hello@lantern.example")
    support_phone = models.CharField(max_length=40, blank=True, default="+1 555 010 0100")
    business_address = models.TextField(blank=True, default="1 Placeholder Street, Replace City")
    logo = models.ImageField(upload_to="brand/", blank=True)
    tax_rate = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal("0.00"),
        validators=[MinValueValidator(0), MaxValueValidator(100)],
        help_text="Percent. Legal rate must be confirmed by the store owner.",
    )
    tax_label = models.CharField(max_length=30, default="Tax")
    prices_include_tax = models.BooleanField(default=False)
    auto_confirm_paid_orders = models.BooleanField(
        default=False, help_text="Skip the manual 'accept' step once online payment is confirmed."
    )
    enable_reviews = models.BooleanField(default=True)
    ordering_enabled = models.BooleanField(default=True, help_text="Global kill switch for new orders.")
    allowed_checkout_methods = models.JSONField(default=list, blank=True, help_text="Subset of payment provider keys")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "store settings"

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):  # singleton
        raise ValidationError("Store settings cannot be deleted.")

    @classmethod
    def load(cls) -> "StoreSettings":
        obj, _ = cls.objects.get_or_create(
            pk=1,
            defaults={
                "brand_name": settings.STORE_DEFAULTS["brand_name"],
                "currency": settings.STORE_DEFAULTS["currency"],
            },
        )
        return obj

    def __str__(self):
        return self.brand_name


class SocialProfile(models.Model):
    class Platform(models.TextChoices):
        INSTAGRAM = "instagram", "Instagram"
        TIKTOK = "tiktok", "TikTok"
        FACEBOOK = "facebook", "Facebook"
        YOUTUBE = "youtube", "YouTube"
        PINTEREST = "pinterest", "Pinterest"
        X = "x", "X"

    platform = models.CharField(max_length=20, choices=Platform.choices, unique=True)
    url = models.URLField(validators=[URLValidator(schemes=["http", "https"])])
    handle = models.CharField(max_length=80, blank=True)
    is_active = models.BooleanField(default=True)
    is_placeholder = models.BooleanField(default=False, help_text="Demo link to replace before launch")
    sort_order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "platform"]

    def __str__(self):
        return self.platform


class ContentPage(TimestampedModel):
    """Long-form editable page (about, FAQ, privacy, terms, refund policy). Body is Markdown; raw HTML is never rendered."""

    slug = models.SlugField(unique=True)
    title = models.CharField(max_length=160)
    summary = models.CharField(max_length=300, blank=True)
    body_markdown = models.TextField(blank=True)
    is_published = models.BooleanField(default=True)

    class Meta:
        ordering = ["slug"]

    def __str__(self):
        return self.title


class ContentBlock(TimestampedModel):
    """Small editable homepage/brand blocks addressed by a stable key (e.g. 'home.hero', 'home.story')."""

    key = models.SlugField(max_length=60, unique=True)
    eyebrow = models.CharField(max_length=80, blank=True)
    title = models.CharField(max_length=160, blank=True)
    body = models.TextField(blank=True)
    image = models.ImageField(upload_to="content/", blank=True)
    cta_label = models.CharField(max_length=40, blank=True)
    cta_url = models.CharField(max_length=300, blank=True, help_text="Internal path (/menu) or https:// URL")
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["key"]

    def clean(self):
        from apps.core.validators import validate_safe_link

        if self.cta_url:
            validate_safe_link(self.cta_url)

    def __str__(self):
        return self.key


class Announcement(TimestampedModel):
    message = models.CharField(max_length=200)
    link_url = models.CharField(max_length=300, blank=True)
    is_active = models.BooleanField(default=True)
    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=Q(ends_at__isnull=True) | Q(starts_at__isnull=True) | Q(ends_at__gt=models.F("starts_at")),
                name="announcement_valid_window",
            )
        ]

    def clean(self):
        from apps.core.validators import validate_safe_link

        if self.link_url:
            validate_safe_link(self.link_url)

    @classmethod
    def current(cls):
        now = timezone.now()
        return (
            cls.objects.filter(is_active=True)
            .filter(Q(starts_at__isnull=True) | Q(starts_at__lte=now))
            .filter(Q(ends_at__isnull=True) | Q(ends_at__gt=now))
            .first()
        )

    def __str__(self):
        return self.message[:60]


class NewsletterSubscriber(models.Model):
    email = models.EmailField(unique=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)


class AuditLogQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise ValidationError("Audit log entries are immutable.")

    def delete(self):
        raise ValidationError("Audit log entries cannot be deleted.")


class AuditLog(models.Model):
    """Append-only record of important business actions. Never store secrets, passwords or card data here."""

    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    actor_label = models.CharField(max_length=254, blank=True)
    action = models.CharField(max_length=80, db_index=True)
    resource_type = models.CharField(max_length=60)
    resource_id = models.CharField(max_length=64, blank=True)
    summary = models.CharField(max_length=300, blank=True)
    changes = models.JSONField(default=dict, blank=True)
    request_id = models.CharField(max_length=64, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    objects = AuditLogQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["resource_type", "resource_id"])]

    def save(self, *args, **kwargs):
        if self.pk and not self._state.adding:
            raise ValidationError("Audit log entries are immutable.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError("Audit log entries cannot be deleted.")

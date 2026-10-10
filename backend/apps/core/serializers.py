from __future__ import annotations

from decimal import Decimal

from drf_spectacular.extensions import OpenApiSerializerExtension
from rest_framework import serializers

from .images import validate_image_upload
from .models import (
    Announcement,
    AuditLog,
    ContentBlock,
    ContentPage,
    NewsletterSubscriber,
    SocialProfile,
    StoreSettings,
)
from .services import available_provider_keys, media_url
from .validators import validate_http_url, validate_phone, validate_safe_link

# ── public ────────────────────────────────────────────────────────────────────


class PublicSocialSerializer(serializers.Serializer):
    platform = serializers.CharField()
    url = serializers.URLField()
    handle = serializers.CharField(allow_blank=True)
    is_placeholder = serializers.BooleanField()


class PublicAnnouncementSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    message = serializers.CharField()
    link_url = serializers.CharField(allow_blank=True)


class PublicStoreSerializer(serializers.Serializer):
    brand_name = serializers.CharField()
    tagline = serializers.CharField()
    currency = serializers.CharField()
    support_email = serializers.EmailField()
    support_phone = serializers.CharField(allow_blank=True)
    business_address = serializers.CharField(allow_blank=True)
    logo = serializers.CharField(allow_null=True, help_text="Root-relative image URL or null")
    tax_label = serializers.CharField()
    tax_rate = serializers.CharField(help_text="Percent as a decimal string")
    prices_include_tax = serializers.BooleanField()
    ordering_enabled = serializers.BooleanField()
    enable_reviews = serializers.BooleanField()
    checkout_methods = serializers.ListField(
        child=serializers.CharField(), help_text="Enabled payment provider keys (details: payments/methods/)"
    )
    social = PublicSocialSerializer(many=True)
    announcement = PublicAnnouncementSerializer(allow_null=True)


class PublicContentPageSerializer(serializers.Serializer):
    slug = serializers.CharField()
    title = serializers.CharField()
    summary = serializers.CharField(allow_blank=True)
    body_markdown = serializers.CharField(allow_blank=True, help_text="Markdown; raw HTML must never be rendered")
    updated_at = serializers.DateTimeField()


class PublicContentBlockSerializer(serializers.Serializer):
    key = serializers.CharField()
    eyebrow = serializers.CharField(allow_blank=True)
    title = serializers.CharField(allow_blank=True)
    body = serializers.CharField(allow_blank=True)
    image = serializers.CharField(allow_null=True, help_text="Root-relative image URL or null")
    cta_label = serializers.CharField(allow_blank=True)
    cta_url = serializers.CharField(allow_blank=True)


class ContentBlocksSerializer(serializers.Serializer):
    """Documentation-only: a JSON object mapping block key -> PublicContentBlock (see the schema extension below)."""


class ContentBlocksSchema(OpenApiSerializerExtension):
    target_class = "apps.core.serializers.ContentBlocksSerializer"

    def map_serializer(self, auto_schema, direction):
        component = auto_schema.resolve_serializer(PublicContentBlockSerializer, direction)
        return {"type": "object", "additionalProperties": component.ref}


class NewsletterSubscribeSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)


# ── admin ─────────────────────────────────────────────────────────────────────
class ImageUploadField(serializers.ImageField):
    """ImageField that applies the shared JPEG/PNG/WebP + size + Pillow decode checks."""

    def to_internal_value(self, data):
        from django.core.exceptions import ValidationError as DjangoValidationError

        try:
            validate_image_upload(data)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages[0]) from None
        return super().to_internal_value(data)


class AdminStoreSettingsSerializer(serializers.ModelSerializer):
    logo = ImageUploadField(write_only=True, required=False, help_text="Upload (multipart) to replace the logo")
    remove_logo = serializers.BooleanField(write_only=True, required=False, default=False)
    logo_url = serializers.SerializerMethodField()
    allowed_checkout_methods = serializers.ListField(child=serializers.CharField(max_length=20), required=False)
    available_checkout_methods = serializers.SerializerMethodField(
        help_text="Provider keys enabled in this deployment (valid values for allowed_checkout_methods)"
    )
    currency = serializers.CharField(min_length=3, max_length=3)
    support_phone = serializers.CharField(max_length=40, allow_blank=True, validators=[validate_phone], required=False)

    class Meta:
        model = StoreSettings
        fields = [
            "brand_name",
            "tagline",
            "legal_name",
            "currency",
            "support_email",
            "support_phone",
            "business_address",
            "logo",
            "remove_logo",
            "logo_url",
            "tax_rate",
            "tax_label",
            "prices_include_tax",
            "auto_confirm_paid_orders",
            "enable_reviews",
            "ordering_enabled",
            "allowed_checkout_methods",
            "available_checkout_methods",
            "updated_at",
        ]
        read_only_fields = ["updated_at"]

    def get_logo_url(self, obj) -> str | None:
        return media_url(obj.logo)

    def get_available_checkout_methods(self, obj) -> list[str]:
        return available_provider_keys()

    def validate_currency(self, value):
        value = value.strip().upper()
        if not (len(value) == 3 and value.isascii() and value.isalpha()):
            raise serializers.ValidationError("Use a 3-letter ISO 4217 currency code, e.g. USD.")
        return value

    def validate_tax_rate(self, value: Decimal):
        if value < 0 or value > 100:
            raise serializers.ValidationError("Tax rate must be between 0 and 100 percent.")
        return value

    def validate_allowed_checkout_methods(self, value):
        value = list(dict.fromkeys(value))
        unknown = [k for k in value if k not in available_provider_keys()]
        if unknown:
            raise serializers.ValidationError(f"Unknown or disabled payment method: {', '.join(unknown)}.")
        return value

    def update(self, instance, validated_data):
        remove = validated_data.pop("remove_logo", False)
        if remove and "logo" not in validated_data:
            validated_data["logo"] = ""
        return super().update(instance, validated_data)


class AdminSocialSerializer(serializers.ModelSerializer):
    url = serializers.CharField(max_length=200, validators=[validate_http_url])

    class Meta:
        model = SocialProfile
        fields = ["id", "platform", "url", "handle", "is_active", "is_placeholder", "sort_order"]
        read_only_fields = ["id"]


class AdminPageSerializer(serializers.ModelSerializer):
    body_markdown = serializers.CharField(max_length=50_000, allow_blank=True, required=False, trim_whitespace=False)

    class Meta:
        model = ContentPage
        fields = ["id", "slug", "title", "summary", "body_markdown", "is_published", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


class AdminBlockSerializer(serializers.ModelSerializer):
    image = ImageUploadField(write_only=True, required=False, help_text="Upload (multipart) to replace the image")
    remove_image = serializers.BooleanField(write_only=True, required=False, default=False)
    image_url = serializers.SerializerMethodField()
    cta_url = serializers.CharField(max_length=300, allow_blank=True, required=False, validators=[validate_safe_link])

    class Meta:
        model = ContentBlock
        fields = [
            "id",
            "key",
            "eyebrow",
            "title",
            "body",
            "image",
            "remove_image",
            "image_url",
            "cta_label",
            "cta_url",
            "is_active",
            "updated_at",
        ]
        read_only_fields = ["id", "updated_at"]

    def get_image_url(self, obj) -> str | None:
        return media_url(obj.image)

    def validate_key(self, value):
        if self.instance is not None and value != self.instance.key:
            raise serializers.ValidationError("A block key cannot be changed.")
        return value

    def update(self, instance, validated_data):
        remove = validated_data.pop("remove_image", False)
        if remove and "image" not in validated_data:
            validated_data["image"] = ""
        return super().update(instance, validated_data)

    def create(self, validated_data):
        validated_data.pop("remove_image", None)
        return super().create(validated_data)


class AdminAnnouncementSerializer(serializers.ModelSerializer):
    link_url = serializers.CharField(max_length=300, allow_blank=True, required=False, validators=[validate_safe_link])

    class Meta:
        model = Announcement
        fields = ["id", "message", "link_url", "is_active", "starts_at", "ends_at", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate(self, attrs):
        starts = attrs.get("starts_at", getattr(self.instance, "starts_at", None))
        ends = attrs.get("ends_at", getattr(self.instance, "ends_at", None))
        if starts and ends and ends <= starts:
            raise serializers.ValidationError({"ends_at": ["The end must be after the start."]})
        return attrs


class AdminNewsletterSerializer(serializers.ModelSerializer):
    class Meta:
        model = NewsletterSubscriber
        fields = ["id", "email", "is_active", "created_at"]
        read_only_fields = fields


class AuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditLog
        fields = [
            "id",
            "actor",
            "actor_label",
            "action",
            "resource_type",
            "resource_id",
            "summary",
            "changes",
            "request_id",
            "ip_address",
            "created_at",
        ]
        read_only_fields = fields

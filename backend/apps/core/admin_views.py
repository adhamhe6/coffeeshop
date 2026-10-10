"""Staff API: store settings, social links, content, announcements, newsletter list/export and the audit log."""

from __future__ import annotations

import logging

import django_filters
from django.db import transaction
from django.db.models.fields.files import FieldFile
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import extend_schema
from rest_framework import mixins
from rest_framework.filters import OrderingFilter, SearchFilter
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.renderers import JSONRenderer
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import GenericViewSet, ModelViewSet, ReadOnlyModelViewSet

from apps.accounts.permissions import HasCapability

from .audit import audit
from .csvutil import CSVRenderer, csv_response
from .models import (
    Announcement,
    AuditLog,
    ContentBlock,
    ContentPage,
    NewsletterSubscriber,
    SocialProfile,
    StoreSettings,
)
from .serializers import (
    AdminAnnouncementSerializer,
    AdminBlockSerializer,
    AdminNewsletterSerializer,
    AdminPageSerializer,
    AdminSocialSerializer,
    AdminStoreSettingsSerializer,
    AuditLogSerializer,
)
from .services import bump_settings_caches

log = logging.getLogger(__name__)

_FILE_FIELDS = {"logo", "image"}


def _plain(value):
    if isinstance(value, FieldFile):
        return value.name or ""
    if isinstance(value, (str, int, float, bool, type(None))):
        return value
    return str(value)


def diff_changes(instance, validated: dict, *, long_text: frozenset[str] = frozenset()) -> dict:
    """{field: {from, to}} for changed fields; files and long text only record that they changed."""
    changes = {}
    for field, new in validated.items():
        if field.startswith("remove_") or not hasattr(instance, field):
            continue
        old = getattr(instance, field)
        if field in _FILE_FIELDS:
            if new or (isinstance(old, FieldFile) and old):
                changes[field] = "changed" if new else "removed"
            continue
        if _plain(old) == _plain(new):
            continue
        changes[field] = "changed" if field in long_text else {"from": _plain(old), "to": _plain(new)}
    return changes


class AuditedModelViewSet(ModelViewSet):
    """ModelViewSet whose writes run in a transaction, are audited, and invalidate the settings/catalog caches."""

    audit_name = ""  # e.g. "social" -> social.create / social.update / social.delete
    audit_label = ""
    long_text_fields: frozenset[str] = frozenset()
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]

    def _summary(self, verb: str, obj) -> str:
        return f"{verb} {self.audit_label} {obj}"[:300]

    def perform_create(self, serializer):
        with transaction.atomic():
            obj = serializer.save()
            audit(
                self.request.user,
                f"{self.audit_name}.create",
                obj,
                summary=self._summary("Created", obj),
                changes={},
                request=self.request,
            )
        bump_settings_caches()

    def perform_update(self, serializer):
        with transaction.atomic():
            changes = diff_changes(serializer.instance, serializer.validated_data, long_text=self.long_text_fields)
            obj = serializer.save()
            audit(
                self.request.user,
                f"{self.audit_name}.update",
                obj,
                summary=self._summary("Updated", obj),
                changes=changes,
                request=self.request,
            )
        bump_settings_caches()

    def perform_destroy(self, instance):
        with transaction.atomic():
            summary = self._summary("Deleted", instance)
            audit(self.request.user, f"{self.audit_name}.delete", instance, summary=summary, request=self.request)
            instance.delete()
        bump_settings_caches()


# ── settings ──────────────────────────────────────────────────────────────────
@extend_schema(tags=["admin: settings"])
class StoreSettingsView(APIView):
    permission_classes = [HasCapability.require("settings.manage")]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    @extend_schema(summary="Store settings", responses={200: AdminStoreSettingsSerializer})
    def get(self, request):
        return Response(AdminStoreSettingsSerializer(StoreSettings.load()).data)

    @extend_schema(
        summary="Update store settings (JSON, or multipart to upload the logo)",
        request=AdminStoreSettingsSerializer,
        responses={200: AdminStoreSettingsSerializer},
    )
    def patch(self, request):
        with transaction.atomic():
            store = StoreSettings.objects.select_for_update().get(pk=StoreSettings.load().pk)
            serializer = AdminStoreSettingsSerializer(store, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            validated = dict(serializer.validated_data)
            if validated.get("remove_logo") and "logo" not in validated:
                validated["logo"] = ""
            changes = diff_changes(store, validated)
            store = serializer.save()
            if changes:
                audit(
                    request.user,
                    "settings.update",
                    store,
                    summary="Updated store settings: " + ", ".join(sorted(changes)),
                    changes=changes,
                    request=request,
                )
        bump_settings_caches()
        return Response(AdminStoreSettingsSerializer(store).data)


# ── content ───────────────────────────────────────────────────────────────────
class _ContentPermission:
    permission_classes = [HasCapability.require("content.manage")]


@extend_schema(tags=["admin: content"])
class SocialProfileViewSet(_ContentPermission, AuditedModelViewSet):
    queryset = SocialProfile.objects.all()
    serializer_class = AdminSocialSerializer
    filterset_fields = ["is_active", "platform"]
    search_fields = ["platform", "handle", "url"]
    ordering_fields = ["sort_order", "platform"]
    ordering = ["sort_order", "platform"]
    audit_name = "social"
    audit_label = "social profile"


class PageFilter(django_filters.FilterSet):
    class Meta:
        model = ContentPage
        fields = ["is_published"]


@extend_schema(tags=["admin: content"])
class ContentPageViewSet(_ContentPermission, AuditedModelViewSet):
    queryset = ContentPage.objects.all()
    serializer_class = AdminPageSerializer
    filterset_class = PageFilter
    search_fields = ["slug", "title"]
    ordering_fields = ["slug", "title", "updated_at"]
    ordering = ["slug"]
    audit_name = "content_page"
    audit_label = "page"
    long_text_fields = frozenset({"body_markdown"})


@extend_schema(tags=["admin: content"])
class ContentBlockViewSet(_ContentPermission, AuditedModelViewSet):
    """Blocks are addressed by their stable `key`; they can be created and edited but not deleted (deactivate instead)."""

    queryset = ContentBlock.objects.all()
    serializer_class = AdminBlockSerializer
    lookup_field = "key"
    lookup_value_regex = r"[-\w.]+"
    parser_classes = [JSONParser, MultiPartParser, FormParser]
    http_method_names = ["get", "post", "put", "patch", "head", "options"]
    filterset_fields = ["is_active"]
    search_fields = ["key", "title"]
    ordering_fields = ["key", "updated_at"]
    ordering = ["key"]
    audit_name = "content_block"
    audit_label = "block"
    long_text_fields = frozenset({"body"})


@extend_schema(tags=["admin: content"])
class AnnouncementViewSet(_ContentPermission, AuditedModelViewSet):
    queryset = Announcement.objects.all()
    serializer_class = AdminAnnouncementSerializer
    filterset_fields = ["is_active"]
    search_fields = ["message"]
    ordering_fields = ["created_at", "starts_at", "ends_at"]
    ordering = ["-created_at"]
    audit_name = "announcement"
    audit_label = "announcement"


# ── newsletter ────────────────────────────────────────────────────────────────
class NewsletterFilter(django_filters.FilterSet):
    class Meta:
        model = NewsletterSubscriber
        fields = ["is_active"]


@extend_schema(tags=["admin: content"])
class NewsletterViewSet(_ContentPermission, mixins.ListModelMixin, GenericViewSet):
    queryset = NewsletterSubscriber.objects.all()
    serializer_class = AdminNewsletterSerializer
    renderer_classes = [JSONRenderer, CSVRenderer]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_class = NewsletterFilter
    search_fields = ["email"]
    ordering_fields = ["created_at", "email"]
    ordering = ["-created_at", "-id"]

    @extend_schema(summary="Newsletter subscribers (add ?format=csv to download a CSV export)")
    def list(self, request, *args, **kwargs):
        if request.accepted_renderer.format != "csv":
            return super().list(request, *args, **kwargs)
        queryset = self.filter_queryset(self.get_queryset())
        count = queryset.count()
        audit(
            request.user,
            "newsletter.export",
            None,
            resource_type="newsletter",
            resource_id="",
            summary=f"Exported {count} newsletter subscribers",
            request=request,
        )
        rows = ((s.email, "yes" if s.is_active else "no", s.created_at.isoformat()) for s in queryset.iterator())
        return csv_response("newsletter-subscribers.csv", ["email", "active", "subscribed_at"], rows)


# ── audit log ─────────────────────────────────────────────────────────────────
class AuditLogFilter(django_filters.FilterSet):
    actor = django_filters.NumberFilter(field_name="actor_id")
    date_from = django_filters.DateFilter(field_name="created_at", lookup_expr="date__gte")
    date_to = django_filters.DateFilter(field_name="created_at", lookup_expr="date__lte")

    class Meta:
        model = AuditLog
        fields = ["actor", "action", "resource_type", "resource_id", "date_from", "date_to"]


@extend_schema(tags=["admin: audit"])
class AuditLogViewSet(ReadOnlyModelViewSet):
    """Read-only. There are deliberately no write endpoints for the audit trail."""

    permission_classes = [HasCapability.require("audit.view")]
    queryset = AuditLog.objects.all()
    serializer_class = AuditLogSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_class = AuditLogFilter
    search_fields = ["summary", "actor_label", "action", "resource_type", "resource_id"]
    ordering_fields = ["created_at", "id"]
    ordering = ["-created_at", "-id"]

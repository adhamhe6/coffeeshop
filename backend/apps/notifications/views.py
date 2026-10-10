"""In-app notification API for the signed-in user. Creation lives in apps.notifications.services (owned elsewhere)."""

from __future__ import annotations

from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.mixins import ListModelMixin, RetrieveModelMixin
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from .models import Notification
from .serializers import NotificationSerializer

CountSerializer = inline_serializer("UnreadCount", {"count": serializers.IntegerField()})
UpdatedSerializer = inline_serializer("NotificationsUpdated", {"updated": serializers.IntegerField()})


@extend_schema(tags=["notifications"])
class NotificationViewSet(ListModelMixin, RetrieveModelMixin, GenericViewSet):
    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]
    filter_backends: list = []

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Notification.objects.none()
        qs = Notification.objects.filter(user=self.request.user).select_related("order")
        if self.action == "list" and self.request.query_params.get("unread") in {"1", "true", "True"}:
            qs = qs.filter(is_read=False)
        return qs

    @extend_schema(
        summary="List my notifications (newest first)",
        parameters=[OpenApiParameter("unread", bool, description="Only unread notifications")],
    )
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    @extend_schema(summary="Number of unread notifications", responses={200: CountSerializer})
    @action(detail=False, methods=["get"], url_path="unread-count", pagination_class=None)
    def unread_count(self, request):
        return Response({"count": Notification.objects.filter(user=request.user, is_read=False).count()})

    @extend_schema(summary="Mark one notification as read", request=None, responses={200: NotificationSerializer})
    @action(detail=True, methods=["post"])
    def read(self, request, pk=None):
        notification = self.get_object()  # 404 for other users' notifications
        if not notification.is_read:
            notification.is_read = True
            notification.save(update_fields=["is_read"])
        return Response(self.get_serializer(notification).data)

    @extend_schema(summary="Mark all my notifications as read", request=None, responses={200: UpdatedSerializer})
    @action(detail=False, methods=["post"], url_path="read-all", pagination_class=None)
    def read_all(self, request):
        updated = Notification.objects.filter(user=request.user, is_read=False).update(is_read=True)
        return Response({"updated": updated})

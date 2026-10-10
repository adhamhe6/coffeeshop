"""Public storefront endpoints: store settings, content, newsletter and health probes."""

from __future__ import annotations

import contextlib
import logging

from django.db import IntegrityError
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from . import health, services
from .errors import DomainError
from .models import NewsletterSubscriber
from .serializers import (
    ContentBlocksSerializer,
    NewsletterSubscribeSerializer,
    PublicContentPageSerializer,
    PublicStoreSerializer,
)

log = logging.getLogger(__name__)

HealthSerializer = inline_serializer(
    "Health",
    {"status": serializers.CharField(), "checks": serializers.DictField(child=serializers.CharField(), required=False)},
)
SHORT_CACHE = {"Cache-Control": "public, max-age=30"}


@extend_schema(tags=["store"], summary="Public store settings", responses={200: PublicStoreSerializer})
class StoreView(APIView):
    permission_classes = [AllowAny]
    authentication_classes: list = []

    def get(self, request):
        return Response(services.store_payload(), headers=SHORT_CACHE)


@extend_schema(tags=["store"], summary="Published content page", responses={200: PublicContentPageSerializer})
class ContentPageView(APIView):
    permission_classes = [AllowAny]
    authentication_classes: list = []

    def get(self, request, slug):
        payload = services.content_page_payload(slug)
        if payload is None:
            raise DomainError("Page not found.", code="not_found", status_code=404)
        return Response(payload, headers=SHORT_CACHE)


@extend_schema(
    tags=["store"],
    summary="Active content blocks keyed by block key",
    responses={200: ContentBlocksSerializer},
)
class ContentBlocksView(APIView):
    permission_classes = [AllowAny]
    authentication_classes: list = []

    def get(self, request):
        return Response(services.content_blocks_payload(), headers=SHORT_CACHE)


@extend_schema(
    tags=["store"],
    summary="Subscribe to the newsletter",
    request=NewsletterSubscribeSerializer,
    responses={202: inline_serializer("NewsletterAccepted", {"detail": serializers.CharField()})},
)
class NewsletterSubscribeView(APIView):
    """Idempotent and identical for new and existing addresses, so it cannot be used to probe the list."""

    permission_classes = [AllowAny]
    throttle_scope = "newsletter"

    def post(self, request):
        serializer = NewsletterSubscribeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"].strip().lower()
        existing = NewsletterSubscriber.objects.filter(email__iexact=email).first()
        if existing is None:
            with contextlib.suppress(IntegrityError):  # a concurrent duplicate means already subscribed
                NewsletterSubscriber.objects.create(email=email)
        elif not existing.is_active:
            existing.is_active = True  # explicit re-subscription
            existing.save(update_fields=["is_active"])
        return Response(
            {"detail": "Thanks! You are on the list."},
            status=status.HTTP_202_ACCEPTED,
        )


@extend_schema(tags=["health"], summary="Liveness probe", responses={200: HealthSerializer})
class LiveView(APIView):
    permission_classes = [AllowAny]
    authentication_classes: list = []

    def get(self, request):
        return Response({"status": "ok"}, headers={"Cache-Control": "no-store"})


@extend_schema(
    tags=["health"],
    summary="Readiness probe (database critical, Redis degrades)",
    responses={200: HealthSerializer, 503: HealthSerializer},
)
class ReadyView(APIView):
    permission_classes = [AllowAny]
    authentication_classes: list = []

    def get(self, request):
        code, body = health.readiness()
        return Response(body, status=code, headers={"Cache-Control": "no-store"})

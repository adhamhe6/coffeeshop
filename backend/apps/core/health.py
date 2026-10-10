"""Liveness/readiness probes. Kept independent of sessions/auth so a probe never touches anything but DB and Redis."""

from __future__ import annotations

import logging

import redis
from django.conf import settings
from django.db import connection

log = logging.getLogger(__name__)


def check_database() -> bool:
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        return True
    except Exception:
        log.exception("readiness: database check failed")
        return False


def check_redis() -> bool:
    try:
        client = redis.Redis.from_url(settings.REDIS_URL, socket_connect_timeout=1, socket_timeout=1)
        try:
            return bool(client.ping())
        finally:
            client.close()
    except Exception:
        log.warning("readiness: redis check failed")
        return False


def readiness() -> tuple[int, dict]:
    """DB is critical (503). Redis is a cache/broker, so its loss only degrades the service (200 + degraded)."""
    db_ok = check_database()
    redis_ok = check_redis()
    checks = {"database": "ok" if db_ok else "error", "redis": "ok" if redis_ok else "error"}
    if not db_ok:
        return 503, {"status": "error", "checks": checks}
    return 200, {"status": "ok" if redis_ok else "degraded", "checks": checks}

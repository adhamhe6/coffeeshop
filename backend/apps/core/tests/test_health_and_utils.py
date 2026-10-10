import io

import pytest
import redis
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import OperationalError
from PIL import Image
from rest_framework.test import APIClient

from apps.core import health
from apps.core.csvutil import csv_response, safe_cell
from apps.core.images import validate_image_upload
from apps.core.validators import validate_http_url, validate_phone, validate_safe_link

pytestmark = pytest.mark.django_db


class TestHealth:
    def test_live_is_always_ok_and_touches_no_dependency(self, monkeypatch):
        monkeypatch.setattr(health, "check_database", lambda: pytest.fail("live must not check the DB"))
        res = APIClient().get("/api/v1/health/live/")
        assert res.status_code == 200 and res.json() == {"status": "ok"}

    @pytest.mark.parametrize("url", ["/api/v1/health/ready/", "/healthz"])
    def test_ready_ok(self, url):
        res = APIClient().get(url)
        assert res.status_code == 200
        assert res.json() == {"status": "ok", "checks": {"database": "ok", "redis": "ok"}}
        assert res["Cache-Control"] == "no-store"

    @pytest.mark.parametrize("url", ["/api/v1/health/ready/", "/healthz"])
    def test_database_failure_is_503(self, monkeypatch, url):
        class BrokenConnection:
            def cursor(self):
                raise OperationalError("connection refused")

        monkeypatch.setattr(health, "connection", BrokenConnection())
        res = APIClient().get(url)
        assert res.status_code == 503
        assert res.json() == {"status": "error", "checks": {"database": "error", "redis": "ok"}}

    def test_redis_failure_only_degrades(self, monkeypatch):
        def refuse(*args, **kwargs):
            raise redis.ConnectionError("down")

        monkeypatch.setattr(health.redis.Redis, "from_url", refuse)
        res = APIClient().get("/api/v1/health/ready/")
        assert res.status_code == 200
        assert res.json() == {"status": "degraded", "checks": {"database": "ok", "redis": "error"}}

    def test_both_down_is_503(self, monkeypatch):
        monkeypatch.setattr(health, "check_database", lambda: False)
        monkeypatch.setattr(health, "check_redis", lambda: False)
        res = APIClient().get("/api/v1/health/ready/")
        assert res.status_code == 503 and res.json()["checks"] == {"database": "error", "redis": "error"}

    def test_probes_need_no_authentication_or_session(self):
        client = APIClient()
        client.cookies["lantern_sessionid"] = "garbage"
        assert client.get("/api/v1/health/live/").status_code == 200


class TestCsv:
    @pytest.mark.parametrize("value", ["=1+1", "+SUM(A1)", "-2+3", "@cmd", "\t=x", "\r=x", ' =HYPERLINK("x")'])
    def test_formula_triggers_are_neutralised(self, value):
        assert safe_cell(value) == "'" + value

    @pytest.mark.parametrize("value", ["plain", "a=b", "", None, 5])
    def test_safe_values_pass_through(self, value):
        assert safe_cell(value) == ("" if value is None else value)

    def test_response_is_escaped_and_attachment(self):
        res = csv_response("x.csv", ["email", "=bad"], [["=evil@example.com", "ok"], ["a,b", 'q"uote']])
        body = b"".join(res.streaming_content).decode("utf-8-sig")
        lines = body.strip().splitlines()
        assert lines[0] == "email,'=bad"
        assert lines[1] == "'=evil@example.com,ok"
        assert lines[2] == '"a,b","q""uote"'
        assert res["Content-Disposition"] == 'attachment; filename="x.csv"'
        assert res["Content-Type"].startswith("text/csv")


class TestValidators:
    @pytest.mark.parametrize("value", ["+1 555 010 0100", "(555) 010-0100", "555.010.0100", "+442079460958", ""])
    def test_phone_ok(self, value):
        validate_phone(value)

    @pytest.mark.parametrize("value", ["abc", "12", "+", "555-CALL-NOW", "1" * 40, "<script>", "++1555010010"])
    def test_phone_bad(self, value):
        with pytest.raises(ValidationError):
            validate_phone(value)

    @pytest.mark.parametrize("value", ["/menu", "https://example.com/x", "http://a.b", ""])
    def test_safe_link_ok(self, value):
        validate_safe_link(value)

    @pytest.mark.parametrize(
        "value", ["javascript:alert(1)", "//evil.com", "data:text/html,x", "ftp://x.com", "menu", "https:///x"]
    )
    def test_safe_link_bad(self, value):
        with pytest.raises(ValidationError):
            validate_safe_link(value)

    @pytest.mark.parametrize("value", ["javascript:alert(1)", "ftp://example.com", "example.com", "/relative", ""])
    def test_http_url_bad(self, value):
        with pytest.raises(ValidationError):
            validate_http_url(value)

    def test_http_url_ok(self):
        validate_http_url("https://instagram.com/lantern")


def png_bytes(size=(4, 4), fmt="PNG"):
    buf = io.BytesIO()
    Image.new("RGB", size, "#B4602B").save(buf, fmt)
    return buf.getvalue()


class TestImageValidation:
    @pytest.mark.parametrize("fmt", ["PNG", "JPEG", "WEBP"])
    def test_accepts_supported_formats(self, fmt):
        validate_image_upload(SimpleUploadedFile("x", png_bytes(fmt=fmt)))

    def test_rejects_gif(self):
        buf = io.BytesIO()
        Image.new("RGB", (2, 2)).save(buf, "GIF")
        with pytest.raises(ValidationError, match="Unsupported"):
            validate_image_upload(SimpleUploadedFile("x.png", buf.getvalue()))

    def test_rejects_non_images_even_with_image_extension(self):
        with pytest.raises(ValidationError, match="not a valid image"):
            validate_image_upload(SimpleUploadedFile("x.png", b"<svg onload=alert(1)></svg>"))

    def test_rejects_truncated_image(self):
        with pytest.raises(ValidationError):
            validate_image_upload(SimpleUploadedFile("x.png", png_bytes(size=(200, 200))[:60]))

    def test_rejects_oversize(self, settings):
        settings.MAX_IMAGE_UPLOAD_BYTES = 100
        with pytest.raises(ValidationError, match="too large"):
            validate_image_upload(SimpleUploadedFile("x.png", png_bytes(size=(64, 64))))

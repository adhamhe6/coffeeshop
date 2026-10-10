"""Consistent error envelope: {"error": {"code": str, "message": str, "fields": {...}?, "request_id": str}}."""

import logging

from django.core.exceptions import PermissionDenied, RequestDataTooBig, SuspiciousOperation
from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import Http404
from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

from .middleware import get_request_id

log = logging.getLogger(__name__)


class DomainError(exceptions.APIException):
    """Raise from services for expected business-rule failures. `code` is stable and machine readable."""

    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "invalid"

    def __init__(
        self,
        message: str,
        code: str | None = None,
        status_code: int | None = None,
        fields: dict | None = None,
        extra: dict | None = None,
    ):
        super().__init__(detail=message, code=code or self.default_code)
        if status_code:
            self.status_code = status_code
        self.fields = fields
        self.extra = extra or {}


class Conflict(DomainError):
    status_code = status.HTTP_409_CONFLICT
    default_code = "conflict"


def _flatten(detail):
    if isinstance(detail, dict):
        return {k: _flatten(v) for k, v in detail.items()}
    if isinstance(detail, list):
        return [_flatten(v) for v in detail] if detail and isinstance(detail[0], dict) else [str(v) for v in detail]
    return str(detail)


def exception_handler(exc, context):
    if isinstance(exc, DjangoValidationError):
        exc = exceptions.ValidationError(detail=exc.message_dict if hasattr(exc, "error_dict") else exc.messages)
    elif isinstance(exc, Http404):
        exc = exceptions.NotFound()
    elif isinstance(exc, PermissionDenied):
        exc = exceptions.PermissionDenied()
    elif isinstance(exc, RequestDataTooBig):  # body above DATA_UPLOAD_MAX_MEMORY_SIZE: a client error, not a crash
        exc = DomainError("The request body is too large.", code="payload_too_large", status_code=413)
    elif isinstance(exc, SuspiciousOperation):  # malformed multipart, too many fields, ...
        exc = DomainError("The request could not be processed.", code="bad_request", status_code=400)

    response = drf_exception_handler(exc, context)
    if response is None:
        log.exception("Unhandled exception", extra={"path": getattr(context.get("request"), "path", "")})
        return Response(
            {
                "error": {
                    "code": "server_error",
                    "message": "Something went wrong on our side.",
                    "request_id": get_request_id(),
                }
            },
            status=500,
        )

    body: dict = {"code": "error", "message": "", "request_id": get_request_id()}
    if isinstance(exc, DomainError):
        body["code"] = exc.detail.code if hasattr(exc.detail, "code") else exc.default_code
        body["message"] = str(exc.detail)
        if exc.fields:
            body["fields"] = exc.fields
        body.update(exc.extra)
    elif isinstance(exc, exceptions.ValidationError):
        body["code"] = "validation_error"
        flat = _flatten(exc.detail)
        if isinstance(flat, dict):
            body["fields"] = flat
            non_field = flat.get("non_field_errors") or flat.get("detail")
            body["message"] = (
                non_field[0] if isinstance(non_field, list) and non_field else "Please correct the highlighted fields."
            )
        else:
            body["message"] = flat[0] if flat else "Invalid request."
    else:
        codes = {
            exceptions.NotAuthenticated: "not_authenticated",
            exceptions.AuthenticationFailed: "authentication_failed",
            exceptions.PermissionDenied: "permission_denied",
            exceptions.NotFound: "not_found",
            exceptions.MethodNotAllowed: "method_not_allowed",
            exceptions.Throttled: "throttled",
            exceptions.ParseError: "parse_error",
        }
        body["code"] = next((v for k, v in codes.items() if isinstance(exc, k)), "error")
        body["message"] = str(getattr(exc, "detail", exc))
        if isinstance(exc, exceptions.Throttled) and exc.wait:
            body["retry_after"] = int(exc.wait)
    # SessionAuthentication reports unauthenticated as 403; the SPA relies on 401.
    if body["code"] == "not_authenticated":
        response.status_code = status.HTTP_401_UNAUTHORIZED
    response.data = {"error": body}
    return response

"""Customer-facing auth, account and address endpoints."""

from __future__ import annotations

import logging

from django.contrib.auth import logout, update_session_auth_hash
from django.middleware.csrf import get_token
from drf_spectacular.utils import OpenApiResponse, extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.decorators import action
from rest_framework.exceptions import Throttled
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet

from apps.core.authentication import EnforceCsrfMixin

from . import services
from .models import Address, User
from .permissions import ALL_CAPABILITIES, branch_scope, capabilities_for, staff_role
from .serializers import (
    AccountUpdateSerializer,
    AddressSerializer,
    LoginSerializer,
    MeSerializer,
    PasswordChangeSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    RegisterSerializer,
    UserSerializer,
    VerifyEmailResponseSerializer,
    VerifyEmailSerializer,
)

log = logging.getLogger(__name__)

DetailSerializer = inline_serializer("Detail", {"detail": serializers.CharField()})
NO_STORE = {"Cache-Control": "no-store"}


class PublicAuthView(EnforceCsrfMixin, APIView):
    """Anonymous-friendly auth endpoint. CSRF is enforced even for anonymous callers (see core/authentication.py)."""

    permission_classes = [AllowAny]


@extend_schema(tags=["auth"], summary="Set the CSRF cookie", responses={204: OpenApiResponse(description="Cookie set")})
class CsrfView(APIView):
    authentication_classes: list = []
    permission_classes = [AllowAny]

    def get(self, request):
        get_token(request)  # makes CsrfViewMiddleware attach the cookie to this response
        return Response(status=status.HTTP_204_NO_CONTENT, headers=NO_STORE)


@extend_schema(
    tags=["auth"],
    summary="Register a customer account and sign in",
    request=RegisterSerializer,
    responses={201: UserSerializer},
)
class RegisterView(PublicAuthView):
    throttle_scope = "register"

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        user = services.register_user(
            request,
            email=data["email"],
            password=data["password"],
            first_name=data["first_name"],
            last_name=data["last_name"],
            phone=data.get("phone", ""),
            marketing_opt_in=data.get("marketing_opt_in", False),
        )
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED, headers=NO_STORE)


@extend_schema(
    tags=["auth"], summary="Sign in with email and password", request=LoginSerializer, responses={200: MeSerializer}
)
class LoginView(PublicAuthView):
    throttle_scope = "login"

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = services.login_user(
            request, email=serializer.validated_data["email"], password=serializer.validated_data["password"]
        )
        return Response(build_me_payload(user), headers=NO_STORE)


@extend_schema(
    tags=["auth"],
    summary="Sign out (ends the server session)",
    request=None,
    responses={204: OpenApiResponse(description="Signed out")},
)
class LogoutView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        logout(request)  # flushes the session server side
        return Response(status=status.HTTP_204_NO_CONTENT, headers=NO_STORE)


def build_me_payload(user) -> dict:
    if not user.is_authenticated:
        return {"authenticated": False, "user": None, "staff": None, "unread_notifications": 0}
    from apps.notifications.models import Notification

    staff = None
    role = staff_role(user)
    if role:
        scope = branch_scope(user)
        staff = {
            "role": role,
            "role_label": user.staff_profile.get_role_display(),
            "job_title": user.staff_profile.job_title,
            "capabilities": [c for c in ALL_CAPABILITIES if c in capabilities_for(user)],
            "branch_ids": None if scope is None else sorted(scope),
        }
    return {
        "authenticated": True,
        "user": UserSerializer(user).data,
        "staff": staff,
        "unread_notifications": Notification.objects.filter(user=user, is_read=False).count(),
    }


@extend_schema(tags=["auth"], summary="Current session (200 for anonymous visitors too)", responses={200: MeSerializer})
class MeView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response(build_me_payload(request.user), headers=NO_STORE)


@extend_schema(
    tags=["auth"],
    summary="Request a password reset email",
    request=PasswordResetRequestSerializer,
    responses={202: DetailSerializer},
)
class PasswordResetRequestView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "password_reset"

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"].strip().lower()
        user = User.objects.filter(email__iexact=email, is_active=True).first()
        if user is not None and user.has_usable_password():
            from .tasks import send_password_reset_email

            try:
                send_password_reset_email.delay(user.pk)
            except Exception:  # broker outage must not change the response (and so cannot leak existence)
                log.exception("could not enqueue password reset email user_id=%s", user.pk)
        else:
            log.info("password reset requested for unknown or inactive email")
        return Response(
            {"detail": "If an account exists for that email, a reset link is on its way."},
            status=status.HTTP_202_ACCEPTED,
        )


@extend_schema(
    tags=["auth"],
    summary="Set a new password using an emailed link",
    request=PasswordResetConfirmSerializer,
    responses={200: DetailSerializer},
)
class PasswordResetConfirmView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "password_reset"

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        user = services.user_from_reset(data["uid"], data["token"])
        services.validate_new_password(data["new_password"], user, field="new_password")
        user.set_password(data["new_password"])
        user.save(update_fields=["password"])
        # Following a link sent to the address on file proves the owner reads that mailbox.
        if services.mark_email_verified(user):
            log.info("email verified through password reset user_id=%s", user.pk)
        # The session auth hash derives from the password hash, so every other session of this user is now invalid.
        log.info("password reset completed user_id=%s", user.pk)
        return Response({"detail": "Your password has been updated. You can now sign in."})


@extend_schema(
    tags=["auth"],
    summary="Confirm an email address using the emailed link",
    description="Works signed out. Idempotent: confirming an already verified address answers 200 again. A tampered, "
    "expired (3 days) or outdated link (the account email changed since it was sent) answers 400 `invalid_token`.",
    request=VerifyEmailSerializer,
    responses={200: VerifyEmailResponseSerializer},
)
class VerifyEmailView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "verify"

    def post(self, request):
        serializer = VerifyEmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = services.user_from_verification_token(serializer.validated_data["token"])
        if services.mark_email_verified(user):
            log.info("email verified user_id=%s", user.pk)
        return Response({"detail": "Your email address is confirmed.", "email_verified": True}, headers=NO_STORE)


@extend_schema(
    tags=["auth"],
    summary="Send the verification email again",
    description="Signed in only. Does nothing (200, no email) when the address is already verified; otherwise 202.",
    request=None,
    responses={200: VerifyEmailResponseSerializer, 202: VerifyEmailResponseSerializer},
)
class ResendVerificationView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = "resend_verification"

    def post(self, request):
        user: User = request.user
        if user.email_verified_at is not None:
            return Response(
                {"detail": "Your email address is already confirmed.", "email_verified": True}, headers=NO_STORE
            )
        services.queue_verification_email(user)
        return Response(
            {"detail": "We sent a new confirmation link to your email address.", "email_verified": False},
            status=status.HTTP_202_ACCEPTED,
            headers=NO_STORE,
        )


class EmailChangeThrottle(UserRateThrottle):
    """Each email change mails the new address, so cap how often one account can aim the verification mail elsewhere."""

    scope = "email_change"

    def get_rate(self):
        return self.THROTTLE_RATES.get(self.scope, "5/hour")


class AccountView(APIView):
    """Profile of the signed-in customer."""

    permission_classes = [IsAuthenticated]

    def get_throttles(self):
        self.throttle_scope = "login" if self.request.method == "PATCH" else None  # guards the password check
        return super().get_throttles()

    @extend_schema(tags=["account"], summary="Get my profile", responses={200: UserSerializer})
    def get(self, request):
        return Response(UserSerializer(request.user).data, headers=NO_STORE)

    @extend_schema(
        tags=["account"], summary="Update my profile", request=AccountUpdateSerializer, responses={200: UserSerializer}
    )
    def patch(self, request):
        serializer = AccountUpdateSerializer(data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user: User = request.user
        email_changed = "email" in serializer.validated_data
        if email_changed:
            limiter = EmailChangeThrottle()
            if not limiter.allow_request(request, self):
                raise Throttled(wait=limiter.wait())
        for field, value in serializer.validated_data.items():
            setattr(user, field, value)
        if email_changed:
            user.email_verified_at = (
                None  # the new address must prove itself; old links are void (token binds the email)
            )
        if serializer.validated_data:
            user.save()
        if email_changed:
            services.queue_verification_email(user)
        return Response(UserSerializer(user).data, headers=NO_STORE)


@extend_schema(
    tags=["account"],
    summary="Change my password",
    request=PasswordChangeSerializer,
    responses={204: OpenApiResponse(description="Password changed; this session stays signed in")},
)
class PasswordChangeView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_scope = "login"

    def post(self, request):
        serializer = PasswordChangeSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user: User = request.user
        user.set_password(serializer.validated_data["new_password"])
        user.save(update_fields=["password"])
        update_session_auth_hash(request, user)  # keep this session, invalidate all others
        log.info("password changed user_id=%s", user.pk)
        return Response(status=status.HTTP_204_NO_CONTENT)


@extend_schema(tags=["addresses"])
class AddressViewSet(ModelViewSet):
    """Delivery addresses of the signed-in customer. Other customers' addresses are 404."""

    serializer_class = AddressSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None
    filter_backends: list = []
    http_method_names = ["get", "post", "put", "patch", "delete", "head", "options"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Address.objects.none()
        return services.active_addresses(self.request.user).select_related("zone")

    @extend_schema(summary="List my addresses")
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    def perform_create(self, serializer):
        serializer.instance = services.create_address(self.request.user, dict(serializer.validated_data))

    def perform_update(self, serializer):
        serializer.instance = services.update_address(serializer.instance, dict(serializer.validated_data))

    def perform_destroy(self, instance):
        services.delete_address(instance)

    @extend_schema(request=None, responses={200: AddressSerializer}, summary="Make this my default address")
    @action(detail=True, methods=["post"], url_path="set-default")
    def set_default(self, request, pk=None):
        address = services.set_default_address(self.get_object())
        return Response(self.get_serializer(address).data)

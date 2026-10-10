"""Account business rules: registration, login, password reset, addresses and staff management."""

from __future__ import annotations

import logging

from django.contrib.auth import login, password_validation
from django.contrib.auth.tokens import default_token_generator
from django.core import signing
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from rest_framework import serializers

from apps.core.audit import audit, client_ip
from apps.core.errors import DomainError

from .models import Address, StaffProfile, User
from .permissions import GLOBAL_ROLES, ROLE_CAPABILITIES

log = logging.getLogger(__name__)

MAX_ACTIVE_ADDRESSES = 10
# Roles that operate on specific branches and therefore must be assigned at least one.
BRANCH_REQUIRED_ROLES = {"BRANCH_MANAGER", "ORDER_MANAGER", "INVENTORY_MANAGER"}


# ── passwords ────────────────────────────────────────────────────────────────
def validate_new_password(password: str, user: User | None = None, field: str = "password") -> None:
    """Run AUTH_PASSWORD_VALIDATORS and convert failures into a field-level API error."""
    try:
        password_validation.validate_password(password, user=user)
    except DjangoValidationError as exc:
        raise serializers.ValidationError({field: list(exc.messages)}) from None


def email_taken(email: str, exclude_pk: int | None = None) -> bool:
    qs = User.objects.filter(email__iexact=email.strip())
    if exclude_pk:
        qs = qs.exclude(pk=exclude_pk)
    return qs.exists()


# ── registration / login ─────────────────────────────────────────────────────
def merge_guest_cart_safely(request, user) -> None:
    """Hand the guest cart cookie to the cart app. Never lets a cart problem break authentication."""
    try:
        from apps.cart.services import merge_guest_cart
    except ImportError:
        return
    try:
        merge_guest_cart(request, user)
    except Exception:
        log.exception("guest cart merge failed for user %s", user.pk)


def register_user(request, *, email, password, first_name, last_name, phone="", marketing_opt_in=False) -> User:
    try:
        with transaction.atomic():
            user = User.objects.create_user(
                email=email,
                password=password,
                first_name=first_name,
                last_name=last_name,
                phone=phone,
                marketing_opt_in=marketing_opt_in,
            )
    except IntegrityError:  # lost a race against a concurrent registration with the same email
        raise serializers.ValidationError({"email": ["An account with this email already exists."]}) from None
    login(request, user, backend="django.contrib.auth.backends.ModelBackend")  # rotates the session key
    log.info("customer registered user_id=%s", user.pk)
    queue_verification_email(user)
    merge_guest_cart_safely(request, user)
    return user


_GENERIC_LOGIN_ERROR = "The email or password you entered is incorrect."


def login_user(request, *, email: str, password: str) -> User:
    """Authenticate with a message that never reveals whether the email exists. Passwords are never logged."""
    email = email.strip().lower()
    ip = client_ip(request)
    user = User.objects.filter(email__iexact=email).first()
    if user is None:
        User().set_password(password)  # burn comparable hashing time so timing does not reveal the account
        log.warning("login failed: unknown email=%s ip=%s", email, ip)
        raise DomainError(_GENERIC_LOGIN_ERROR, code="invalid_credentials", status_code=400)
    if not user.check_password(password):
        log.warning("login failed: bad password user_id=%s ip=%s", user.pk, ip)
        raise DomainError(_GENERIC_LOGIN_ERROR, code="invalid_credentials", status_code=400)
    if not user.is_active:
        # Only reachable with the correct password, so this does not help enumerate accounts.
        log.warning("login refused: restricted account user_id=%s ip=%s", user.pk, ip)
        raise DomainError(
            "Your account has been restricted. Please contact support for help.",
            code="account_restricted",
            status_code=403,
        )
    # Credentials were verified above (once: hashing is deliberately slow), so log in directly.
    login(request, user, backend="django.contrib.auth.backends.ModelBackend")  # cycles the session key
    merge_guest_cart_safely(request, user)
    return user


# ── password reset ───────────────────────────────────────────────────────────
def make_reset_uid_token(user: User) -> tuple[str, str]:
    return urlsafe_base64_encode(force_bytes(user.pk)), default_token_generator.make_token(user)


def user_from_reset(uid: str, token: str) -> User:
    """Resolve and verify a reset link; any problem yields the same error."""
    invalid = DomainError("This reset link is invalid or has expired.", code="invalid_token", status_code=400)
    try:
        pk = force_str(urlsafe_base64_decode(uid))
        user = User.objects.get(pk=pk)
    except (TypeError, ValueError, OverflowError, User.DoesNotExist):
        raise invalid from None
    if not user.is_active or not default_token_generator.check_token(user, token):
        raise invalid
    return user


# ── email verification ──────────────────────────────────────────────────────
# Lightweight proof of mailbox ownership (finding S9). It never blocks purchases: it only gates which addresses we send
# order / payment / refund / marketing email to, so nobody can use us to mail a third party's inbox.
VERIFY_SALT = "accounts.verify-email"
VERIFY_MAX_AGE = 3 * 24 * 60 * 60  # seconds (3 days)


def make_verification_token(user: User) -> str:
    """Signed, expiring token bound to the user id AND the current address (changing email voids older links)."""
    return signing.dumps({"uid": user.pk, "email": user.email}, salt=VERIFY_SALT, compress=True)


def user_from_verification_token(token: str) -> User:
    """Resolve a verification link; any problem (tampered, expired, stale address, inactive user) yields one error."""
    invalid = DomainError("This verification link is invalid or has expired.", code="invalid_token", status_code=400)
    try:
        data = signing.loads(token, salt=VERIFY_SALT, max_age=VERIFY_MAX_AGE)
        user = User.objects.get(pk=data["uid"])
        expected = data["email"]
    except (signing.BadSignature, KeyError, TypeError, ValueError, User.DoesNotExist):
        raise invalid from None
    if not user.is_active or user.email != expected:
        raise invalid
    return user


def mark_email_verified(user: User) -> bool:
    """Idempotent. Returns True when this call changed the state."""
    updated = User.objects.filter(pk=user.pk, email_verified_at__isnull=True).update(email_verified_at=timezone.now())
    user.refresh_from_db(fields=["email_verified_at"])
    return bool(updated)


def queue_verification_email(user: User) -> None:
    """Enqueue the verification email (call after the user row is committed). Never raises into the caller."""
    if user.email_verified_at is not None:
        return
    from .tasks import send_verification_email

    try:
        send_verification_email.delay(user.pk)
    except Exception:  # broker outage: the customer can use "resend" later
        log.exception("could not enqueue verification email user_id=%s", user.pk)


def can_email(user: User | None) -> bool:
    """True when it is safe to send order / payment / refund / marketing email to this user's address.

    Password-reset email is the one exception (it goes to the address on file by design) and does not use this.
    """
    return user is not None and user.is_active and user.email_verified_at is not None


def can_send_marketing_email(user: User | None) -> bool:
    return can_email(user) and bool(user.marketing_opt_in)


# ── addresses ────────────────────────────────────────────────────────────────
def _lock_user(user) -> None:
    """Serialise address mutations per user so the single-default invariant cannot be raced."""
    User.objects.select_for_update().only("id").get(pk=user.pk)


def active_addresses(user):
    return Address.objects.filter(user=user, is_deleted=False)


def _make_default(user, address: Address) -> None:
    active_addresses(user).exclude(pk=address.pk).filter(is_default=True).update(is_default=False)
    if not address.is_default:
        address.is_default = True
        address.save(update_fields=["is_default", "updated_at"])


def create_address(user, data: dict) -> Address:
    with transaction.atomic():
        _lock_user(user)
        if active_addresses(user).count() >= MAX_ACTIVE_ADDRESSES:
            raise DomainError(
                f"You can save up to {MAX_ACTIVE_ADDRESSES} addresses. Delete one to add another.",
                code="address_limit_reached",
                status_code=409,
            )
        want_default = bool(data.pop("is_default", False))
        first = not active_addresses(user).exists()
        address = Address.objects.create(user=user, is_default=False, **data)
        if first or want_default:
            _make_default(user, address)
    address.refresh_from_db()
    return address


def update_address(address: Address, data: dict) -> Address:
    with transaction.atomic():
        _lock_user(address.user)
        address = Address.objects.get(pk=address.pk, is_deleted=False)
        want_default = data.pop("is_default", None)
        for key, value in data.items():
            setattr(address, key, value)
        address.save()
        if want_default:  # False is ignored: there is always exactly one default, move it with set-default
            _make_default(address.user, address)
    address.refresh_from_db()
    return address


def set_default_address(address: Address) -> Address:
    with transaction.atomic():
        _lock_user(address.user)
        address = Address.objects.get(pk=address.pk, is_deleted=False)
        _make_default(address.user, address)
    address.refresh_from_db()
    return address


def delete_address(address: Address) -> None:
    with transaction.atomic():
        _lock_user(address.user)
        address = Address.objects.get(pk=address.pk, is_deleted=False)
        was_default = address.is_default
        address.is_deleted = True
        address.is_default = False
        address.save(update_fields=["is_deleted", "is_default", "updated_at"])
        if was_default:
            successor = active_addresses(address.user).order_by("-updated_at", "-id").first()
            if successor:
                _make_default(address.user, successor)


# ── staff management ─────────────────────────────────────────────────────────
def role_matrix() -> list[dict]:
    return [
        {
            "role": value,
            "label": label,
            "capabilities": sorted(ROLE_CAPABILITIES.get(value, set())),
            "is_global": value in GLOBAL_ROLES,
            "branch_required": value in BRANCH_REQUIRED_ROLES,
        }
        for value, label in StaffProfile.Role.choices
    ]


def _assert_not_last_super_admin(target: StaffProfile) -> None:
    """Refuse to remove the last active SUPER_ADMIN. Locks the candidates so concurrent demotions serialise."""
    ids = list(
        StaffProfile.objects.select_for_update()
        .filter(role="SUPER_ADMIN", user__is_active=True)
        .values_list("user_id", flat=True)
    )
    if ids == [target.user_id]:
        raise DomainError("At least one active super admin must remain.", code="last_super_admin", status_code=409)


def _check_branches(role: str, branch_ids: list[int]) -> list[int]:
    from apps.branches.models import Branch

    ids = sorted(set(branch_ids))
    if role in GLOBAL_ROLES:
        return []  # global roles are never branch scoped
    found = set(Branch.objects.filter(pk__in=ids).values_list("pk", flat=True))
    if found != set(ids):
        raise serializers.ValidationError({"branch_ids": ["One or more branches do not exist."]})
    if role in BRANCH_REQUIRED_ROLES and not ids:
        raise serializers.ValidationError({"branch_ids": ["This role must be assigned at least one branch."]})
    return ids


def _assert_can_grant(actor: User, role: str) -> None:
    if role == "SUPER_ADMIN" and getattr(getattr(actor, "staff_profile", None), "role", None) != "SUPER_ADMIN":
        raise DomainError("Only a super admin can grant the super admin role.", code="forbidden_role", status_code=403)


def _sync_user_flags(user: User, role: str, *, is_active: bool | None = None) -> None:
    user.is_staff = True
    user.is_superuser = role == "SUPER_ADMIN"
    if is_active is not None:
        user.is_active = is_active


def create_staff(actor: User, request, *, email, password, first_name, last_name, phone, role, job_title, branch_ids):
    _assert_can_grant(actor, role)
    if email_taken(email):
        raise serializers.ValidationError({"email": ["An account with this email already exists."]})
    with transaction.atomic():
        branch_ids = _check_branches(role, branch_ids)
        try:
            user = User.objects.create_user(
                email=email,
                password=password,
                first_name=first_name,
                last_name=last_name,
                phone=phone,
                email_verified_at=timezone.now(),  # an administrator vouches for staff addresses
            )
        except IntegrityError:
            raise serializers.ValidationError({"email": ["An account with this email already exists."]}) from None
        _sync_user_flags(user, role)
        user.save(update_fields=["is_staff", "is_superuser"])
        profile = StaffProfile.objects.create(user=user, role=role, job_title=job_title)
        profile.branches.set(branch_ids)
        audit(
            actor,
            "staff.create",
            user,
            summary=f"Created staff account {user.email} ({role})",
            changes={"role": role, "branch_ids": branch_ids, "job_title": job_title},
            request=request,
        )
    return user


def update_staff(actor: User, request, user: User, data: dict) -> User:
    with transaction.atomic():
        profile = StaffProfile.objects.select_for_update().select_related("user").get(user=user)
        user = profile.user
        old_role = profile.role
        old_branches = sorted(profile.branches.values_list("pk", flat=True))
        new_role = data.get("role", old_role)
        actor_role = getattr(getattr(actor, "staff_profile", None), "role", None)
        if old_role == "SUPER_ADMIN" and actor_role != "SUPER_ADMIN":
            raise DomainError("Only a super admin can modify a super admin.", code="forbidden_role", status_code=403)
        if new_role != old_role:
            _assert_can_grant(actor, new_role)
            if old_role == "SUPER_ADMIN":
                _assert_not_last_super_admin(profile)
        new_branches = _check_branches(new_role, data.get("branch_ids", old_branches))
        if "email" in data and data["email"].lower() != user.email:
            if email_taken(data["email"], exclude_pk=user.pk):
                raise serializers.ValidationError({"email": ["An account with this email already exists."]})
            user.email = data["email"]
        for field in ("first_name", "last_name", "phone"):
            if field in data:
                setattr(user, field, data[field])
        _sync_user_flags(user, new_role)
        user.save()
        profile.role = new_role
        if "job_title" in data:
            profile.job_title = data["job_title"]
        profile.save()
        profile.branches.set(new_branches)
        changes: dict = {}
        if new_role != old_role:
            changes["role"] = {"from": old_role, "to": new_role}
        if new_branches != old_branches:
            changes["branch_ids"] = {"from": old_branches, "to": new_branches}
        other = sorted(k for k in data if k not in {"role", "branch_ids"})
        if other:
            changes["fields"] = other
        audit(
            actor,
            "staff.update",
            user,
            summary=f"Updated staff account {user.email}",
            changes=changes,
            request=request,
        )
    return user


def set_staff_active(actor: User, request, user: User, active: bool) -> User:
    with transaction.atomic():
        profile = StaffProfile.objects.select_for_update().select_related("user").get(user=user)
        user = profile.user
        if user.is_active == active:
            return user
        if not active:
            if user.pk == actor.pk:
                raise DomainError(
                    "You cannot deactivate your own account.", code="cannot_deactivate_self", status_code=409
                )
            if profile.role == "SUPER_ADMIN":
                if getattr(getattr(actor, "staff_profile", None), "role", None) != "SUPER_ADMIN":
                    raise DomainError(
                        "Only a super admin can deactivate a super admin.", code="forbidden_role", status_code=403
                    )
                _assert_not_last_super_admin(profile)
        elif profile.role == "SUPER_ADMIN" and getattr(actor.staff_profile, "role", None) != "SUPER_ADMIN":
            raise DomainError(
                "Only a super admin can reactivate a super admin.", code="forbidden_role", status_code=403
            )
        user.is_active = active
        if active:
            user.restriction_reason = ""
        user.save(update_fields=["is_active", "restriction_reason"])
        audit(
            actor,
            "staff.activate" if active else "staff.deactivate",
            user,
            summary=f"{'Reactivated' if active else 'Deactivated'} staff account {user.email}",
            changes={"role": profile.role},
            request=request,
        )
    return user

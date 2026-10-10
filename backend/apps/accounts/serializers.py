from __future__ import annotations

from django.contrib.auth import password_validation
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from apps.branches.models import DeliveryZone
from apps.core.validators import validate_phone

from .models import Address, StaffProfile, User
from .services import email_taken, validate_new_password

PASSWORD_KW = {"write_only": True, "trim_whitespace": False, "max_length": 128, "style": {"input_type": "password"}}


def _normalized_email(value: str) -> str:
    return value.strip().lower()


class UserSerializer(serializers.ModelSerializer):
    email_verified = serializers.BooleanField(
        read_only=True,
        help_text="False until the owner follows the emailed link. Order, payment and refund emails are only sent to "
        "verified addresses; purchases are never blocked.",
    )

    class Meta:
        model = User
        fields = ["id", "email", "first_name", "last_name", "phone", "marketing_opt_in", "email_verified"]
        read_only_fields = fields


class StaffInfoSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=StaffProfile.Role.choices)
    role_label = serializers.CharField()
    job_title = serializers.CharField(allow_blank=True)
    capabilities = serializers.ListField(child=serializers.CharField())
    branch_ids = serializers.ListField(
        child=serializers.IntegerField(), allow_null=True, help_text="null = all branches"
    )


class MeSerializer(serializers.Serializer):
    authenticated = serializers.BooleanField()
    user = UserSerializer(allow_null=True)
    staff = StaffInfoSerializer(allow_null=True)
    unread_notifications = serializers.IntegerField()


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(**PASSWORD_KW)
    first_name = serializers.CharField(max_length=150)
    last_name = serializers.CharField(max_length=150)
    phone = serializers.CharField(max_length=30, required=False, allow_blank=True, validators=[validate_phone])
    marketing_opt_in = serializers.BooleanField(required=False, default=False)

    def validate_email(self, value):
        value = _normalized_email(value)
        if email_taken(value):
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def validate(self, attrs):
        candidate = User(email=attrs["email"], first_name=attrs["first_name"], last_name=attrs["last_name"])
        validate_new_password(attrs["password"], candidate)
        return attrs


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(**{**PASSWORD_KW, "write_only": False})


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField(max_length=64)
    token = serializers.CharField(max_length=128)
    new_password = serializers.CharField(**PASSWORD_KW)


class VerifyEmailSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=512, trim_whitespace=True)


class VerifyEmailResponseSerializer(serializers.Serializer):
    detail = serializers.CharField()
    email_verified = serializers.BooleanField()


class AccountUpdateSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=150, required=False)
    last_name = serializers.CharField(max_length=150, required=False)
    phone = serializers.CharField(max_length=30, required=False, allow_blank=True, validators=[validate_phone])
    marketing_opt_in = serializers.BooleanField(required=False)
    email = serializers.EmailField(max_length=254, required=False)
    current_password = serializers.CharField(required=False, allow_blank=True, **{**PASSWORD_KW})

    def validate(self, attrs):
        user: User = self.context["request"].user
        new_email = attrs.get("email")
        if new_email is not None:
            new_email = _normalized_email(new_email)
            attrs["email"] = new_email
            if new_email == user.email:
                attrs.pop("email")
            else:
                if not attrs.get("current_password"):
                    raise serializers.ValidationError(
                        {"current_password": ["Enter your current password to change your email."]}
                    )
                if not user.check_password(attrs["current_password"]):
                    raise serializers.ValidationError({"current_password": ["Your current password is incorrect."]})
                if email_taken(new_email, exclude_pk=user.pk):
                    raise serializers.ValidationError({"email": ["An account with this email already exists."]})
        attrs.pop("current_password", None)
        return attrs


class PasswordChangeSerializer(serializers.Serializer):
    current_password = serializers.CharField(**PASSWORD_KW)
    new_password = serializers.CharField(**PASSWORD_KW)

    def validate(self, attrs):
        user: User = self.context["request"].user
        if not user.check_password(attrs["current_password"]):
            raise serializers.ValidationError({"current_password": ["Your current password is incorrect."]})
        if attrs["current_password"] == attrs["new_password"]:
            raise serializers.ValidationError({"new_password": ["Choose a password you have not used just now."]})
        validate_new_password(attrs["new_password"], user, field="new_password")
        return attrs


class AddressSerializer(serializers.ModelSerializer):
    zone = serializers.PrimaryKeyRelatedField(
        queryset=DeliveryZone.objects.all(),
        allow_null=True,
        required=False,
        help_text="DeliveryZone id (delivery-zones/)",
    )
    zone_name = serializers.CharField(source="zone.name", read_only=True, default=None)
    phone = serializers.CharField(max_length=30, validators=[validate_phone])
    is_default = serializers.BooleanField(
        required=False,
        help_text="true makes this the default address. false is ignored: move the default with set-default.",
    )

    class Meta:
        model = Address
        fields = [
            "id",
            "label",
            "recipient_name",
            "phone",
            "line1",
            "line2",
            "city",
            "postal_code",
            "zone",
            "zone_name",
            "instructions",
            "is_default",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_zone(self, zone):
        if zone is not None and not zone.is_active and (self.instance is None or self.instance.zone_id != zone.pk):
            raise serializers.ValidationError("This delivery zone is not available.")
        return zone


# ── staff API ────────────────────────────────────────────────────────────────
class OrderSummarySerializer(serializers.Serializer):
    number = serializers.CharField()
    status = serializers.CharField()
    payment_status = serializers.CharField()
    order_type = serializers.CharField()
    total = serializers.DecimalField(max_digits=10, decimal_places=2)
    currency = serializers.CharField()
    branch_name = serializers.CharField(source="branch.name")
    placed_at = serializers.DateTimeField()


class CustomerListSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(read_only=True)
    email_verified = serializers.BooleanField(read_only=True)
    order_count = serializers.IntegerField(
        read_only=True, help_text="Completed, paid-counted orders (same definition as reports)"
    )
    lifetime_spend = serializers.DecimalField(
        max_digits=12, decimal_places=2, read_only=True, help_text="Sum of total minus refunds over those orders"
    )
    last_order_at = serializers.DateTimeField(read_only=True, allow_null=True)

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "full_name",
            "first_name",
            "last_name",
            "phone",
            "marketing_opt_in",
            "email_verified",
            "is_active",
            "date_joined",
            "last_login",
            "order_count",
            "lifetime_spend",
            "last_order_at",
        ]
        read_only_fields = fields


class CustomerAddressSerializer(serializers.ModelSerializer):
    zone_name = serializers.CharField(source="zone.name", read_only=True, default=None)

    class Meta:
        model = Address
        fields = [
            "id",
            "label",
            "recipient_name",
            "phone",
            "line1",
            "line2",
            "city",
            "postal_code",
            "zone_name",
            "instructions",
            "is_default",
        ]
        read_only_fields = fields


class CustomerDetailSerializer(CustomerListSerializer):
    restriction_reason = serializers.CharField(read_only=True)
    addresses = CustomerAddressSerializer(many=True, read_only=True, source="active_addresses")
    recent_orders = OrderSummarySerializer(many=True, read_only=True)

    class Meta(CustomerListSerializer.Meta):
        fields = [*CustomerListSerializer.Meta.fields, "restriction_reason", "addresses", "recent_orders"]
        read_only_fields = fields


class CustomerSuspendSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=200, help_text="Shown to staff only")


class BranchRefSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()


class StaffSerializer(serializers.ModelSerializer):
    role = serializers.CharField(source="staff_profile.role")
    role_label = serializers.CharField(source="staff_profile.get_role_display")
    job_title = serializers.CharField(source="staff_profile.job_title")
    branch_ids = serializers.SerializerMethodField()
    branches = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "first_name",
            "last_name",
            "phone",
            "role",
            "role_label",
            "job_title",
            "branch_ids",
            "branches",
            "is_active",
            "last_login",
            "date_joined",
        ]
        read_only_fields = fields

    def _branches(self, obj):
        return list(obj.staff_profile.branches.all())

    def get_branch_ids(self, obj) -> list[int]:
        return sorted(b.pk for b in self._branches(obj))

    def get_branches(self, obj) -> list[dict]:
        return [{"id": b.pk, "name": b.name} for b in sorted(self._branches(obj), key=lambda b: b.pk)]


class StaffWriteSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254, required=False)
    first_name = serializers.CharField(max_length=150, required=False)
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    phone = serializers.CharField(max_length=30, required=False, allow_blank=True, validators=[validate_phone])
    role = serializers.ChoiceField(choices=StaffProfile.Role.choices, required=False)
    job_title = serializers.CharField(max_length=80, required=False, allow_blank=True)
    branch_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), required=False, max_length=100)

    def validate_email(self, value):
        return _normalized_email(value)


class StaffCreateSerializer(StaffWriteSerializer):
    email = serializers.EmailField(max_length=254)
    first_name = serializers.CharField(max_length=150)
    role = serializers.ChoiceField(choices=StaffProfile.Role.choices)
    password = serializers.CharField(**PASSWORD_KW, help_text="Temporary password; the staff member should change it")
    branch_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1), required=False, default=list, max_length=100
    )

    def validate(self, attrs):
        candidate = User(email=attrs["email"], first_name=attrs["first_name"], last_name=attrs.get("last_name", ""))
        try:
            password_validation.validate_password(attrs["password"], user=candidate)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": list(exc.messages)}) from None
        return attrs


class RoleSerializer(serializers.Serializer):
    role = serializers.CharField()
    label = serializers.CharField()
    capabilities = serializers.ListField(child=serializers.CharField())
    is_global = serializers.BooleanField()
    branch_required = serializers.BooleanField()


class RoleMatrixSerializer(serializers.Serializer):
    capabilities = serializers.ListField(child=serializers.CharField(), help_text="Every capability string")
    roles = RoleSerializer(many=True)

from django.conf import settings
from django.contrib.auth.base_user import BaseUserManager
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.db.models import Q
from django.utils import timezone


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create(self, email, password, **extra):
        if not email:
            raise ValueError("Email is required")
        user = self.model(email=self.normalize_email(email).lower(), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra):
        extra.setdefault("is_staff", False)
        extra.setdefault("is_superuser", False)
        return self._create(email, password, **extra)

    def create_superuser(self, email, password=None, **extra):
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        extra.setdefault("email_verified_at", timezone.now())  # created on the command line by the operator
        user = self._create(email, password, **extra)
        StaffProfile.objects.get_or_create(user=user, defaults={"role": StaffProfile.Role.SUPER_ADMIN})
        return user


class User(AbstractUser):
    """Email-login user. Customers and staff share the table; staff additionally have a StaffProfile."""

    username = None
    email = models.EmailField("email address", unique=True)  # always stored lower-case (see save())
    phone = models.CharField(max_length=30, blank=True)
    marketing_opt_in = models.BooleanField(default=False)
    email_verified_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="When the owner of the current email address proved access to it. Reset whenever the email changes.",
    )
    restriction_reason = models.CharField(max_length=200, blank=True, help_text="Set when staff suspend the account")

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []
    objects = UserManager()

    def save(self, *args, **kwargs):
        self.email = (self.email or "").strip().lower()
        super().save(*args, **kwargs)

    @property
    def email_verified(self) -> bool:
        return self.email_verified_at is not None

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip() or self.email

    @property
    def is_restricted(self) -> bool:
        return not self.is_active


class StaffProfile(models.Model):
    class Role(models.TextChoices):
        SUPER_ADMIN = "SUPER_ADMIN", "Super admin"
        ADMIN = "ADMIN", "Admin"
        BRANCH_MANAGER = "BRANCH_MANAGER", "Branch manager"
        ORDER_MANAGER = "ORDER_MANAGER", "Order manager"
        INVENTORY_MANAGER = "INVENTORY_MANAGER", "Inventory manager"
        PRODUCT_MANAGER = "PRODUCT_MANAGER", "Product manager"
        MARKETING_MANAGER = "MARKETING_MANAGER", "Marketing manager"
        SUPPORT_AGENT = "SUPPORT_AGENT", "Support agent"

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="staff_profile")
    role = models.CharField(max_length=24, choices=Role.choices)
    job_title = models.CharField(max_length=80, blank=True)
    branches = models.ManyToManyField("branches.Branch", blank=True, related_name="staff")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.user.email} ({self.role})"


class Address(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="addresses")
    label = models.CharField(max_length=40, blank=True, help_text="e.g. Home, Office")
    recipient_name = models.CharField(max_length=120)
    phone = models.CharField(max_length=30)
    line1 = models.CharField("address line", max_length=200)
    line2 = models.CharField(max_length=200, blank=True)
    city = models.CharField(max_length=80)
    postal_code = models.CharField(max_length=20, blank=True)
    zone = models.ForeignKey(
        "branches.DeliveryZone", null=True, blank=True, on_delete=models.PROTECT, related_name="addresses"
    )
    instructions = models.CharField(max_length=300, blank=True)
    is_default = models.BooleanField(default=False)
    is_deleted = models.BooleanField(default=False, help_text="Soft delete; past orders keep their own snapshot")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-is_default", "-updated_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["user"], condition=Q(is_default=True, is_deleted=False), name="one_default_address_per_user"
            )
        ]
        verbose_name_plural = "addresses"

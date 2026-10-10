"""Role → capability map and DRF permission helpers. This is the single authority for staff authorization.

Capabilities are coarse, workflow-shaped strings. Branch scoping is separate: roles in GLOBAL_ROLES see every branch,
all other staff are limited to `StaffProfile.branches`.
"""

from __future__ import annotations

from rest_framework.permissions import BasePermission

R = "accounts.StaffProfile.Role"  # documentation only

ALL_CAPABILITIES = [
    "dashboard.view",
    "catalog.view",
    "catalog.manage",  # products, categories, modifiers, collections
    "inventory.view",
    "inventory.manage",
    "orders.view",
    "orders.manage",
    "orders.cancel",
    "orders.note",
    "payments.view",
    "payments.refund",
    "payments.collect",  # collect = mark cash payment received
    "customers.view",
    "customers.manage",
    "promotions.manage",
    "reviews.moderate",
    "content.manage",  # pages, blocks, announcements, social links
    "branches.view",
    "branches.manage",
    "staff.manage",
    "settings.manage",
    "reports.view",
    "reports.export",
    "audit.view",
]

ROLE_CAPABILITIES: dict[str, set[str]] = {
    "SUPER_ADMIN": set(ALL_CAPABILITIES),
    "ADMIN": set(ALL_CAPABILITIES) - {"staff.manage"},
    "BRANCH_MANAGER": {
        "dashboard.view",
        "catalog.view",
        "inventory.view",
        "inventory.manage",
        "orders.view",
        "orders.manage",
        "orders.cancel",
        "orders.note",
        "payments.view",
        "payments.collect",
        "customers.view",
        "branches.view",
        "branches.manage",
        "reports.view",
        "reports.export",
    },
    "ORDER_MANAGER": {
        "dashboard.view",
        "catalog.view",
        "inventory.view",
        "orders.view",
        "orders.manage",
        "orders.cancel",
        "orders.note",
        "payments.view",
        "payments.collect",
        "customers.view",
    },
    "INVENTORY_MANAGER": {
        "dashboard.view",
        "catalog.view",
        "inventory.view",
        "inventory.manage",
        "branches.view",
        "reports.view",
    },
    "PRODUCT_MANAGER": {"dashboard.view", "catalog.view", "catalog.manage", "inventory.view", "reviews.moderate"},
    "MARKETING_MANAGER": {
        "dashboard.view",
        "catalog.view",
        "promotions.manage",
        "content.manage",
        "reviews.moderate",
        "reports.view",
    },
    "SUPPORT_AGENT": {
        "dashboard.view",
        "orders.view",
        "orders.note",
        "payments.view",
        "customers.view",
        "catalog.view",
    },
}

GLOBAL_ROLES = {"SUPER_ADMIN", "ADMIN"}
# Roles whose scope is the whole catalogue/marketing surface rather than branch operations.
BRANCHLESS_OK_ROLES = {"PRODUCT_MANAGER", "MARKETING_MANAGER"}


def staff_role(user) -> str | None:
    if not getattr(user, "is_authenticated", False) or not user.is_active:
        return None
    profile = getattr(user, "staff_profile", None)
    return profile.role if profile else None


def capabilities_for(user) -> set[str]:
    role = staff_role(user)
    return set(ROLE_CAPABILITIES.get(role, set())) if role else set()


def has_capability(user, capability: str) -> bool:
    return capability in capabilities_for(user)


def branch_scope(user):
    """Return None for 'all branches', else a set of branch ids the staff member may operate on."""
    role = staff_role(user)
    if role is None:
        return set()
    if role in GLOBAL_ROLES:
        return None
    return set(user.staff_profile.branches.values_list("id", flat=True))


def scope_queryset_by_branch(queryset, user, field: str = "branch_id"):
    ids = branch_scope(user)
    return queryset if ids is None else queryset.filter(**{f"{field}__in": ids})


def can_access_branch(user, branch_id: int) -> bool:
    ids = branch_scope(user)
    return ids is None or branch_id in ids


class HasCapability(BasePermission):
    """Usage: `permission_classes = [HasCapability.require("orders.view")]`. Per-method override via `capability_map`."""

    capability: str = ""
    message = "You do not have permission to perform this action."

    @classmethod
    def require(cls, capability: str):
        return type(f"Has_{capability.replace('.', '_')}", (cls,), {"capability": capability})

    def has_permission(self, request, view):
        cap = (
            getattr(view, "capability_map", {}).get(request.method, self.capability)
            if hasattr(view, "capability_map")
            else self.capability
        )
        return bool(request.user and request.user.is_authenticated and has_capability(request.user, cap))


class IsStaff(BasePermission):
    def has_permission(self, request, view):
        return staff_role(request.user) is not None

from typing import Final

SUPER_ADMIN_ROLE: Final[str] = "super_admin"
ADMIN_ROLE: Final[str] = "admin"
COMPANY_ADMIN_ROLE: Final[str] = "company_admin"
MANAGER_ROLE: Final[str] = "manager"
USER_ROLE: Final[str] = "user"
ANALYST_ROLE: Final[str] = "analyst"

VALID_ROLES: Final[tuple[str, ...]] = (
    SUPER_ADMIN_ROLE,
    ADMIN_ROLE,
    COMPANY_ADMIN_ROLE,
    MANAGER_ROLE,
    USER_ROLE,
    ANALYST_ROLE,
)
PUBLIC_REGISTRATION_ROLES: Final[tuple[str, ...]] = (
    MANAGER_ROLE,
    USER_ROLE,
    ANALYST_ROLE,
)
MANAGEMENT_ROLES: Final[tuple[str, ...]] = (
    SUPER_ADMIN_ROLE,
    ADMIN_ROLE,
    COMPANY_ADMIN_ROLE,
    MANAGER_ROLE,
)
ADMIN_CENTER_ROLES: Final[tuple[str, ...]] = (
    SUPER_ADMIN_ROLE,
    ADMIN_ROLE,
)
USER_ADMIN_ROLES: Final[tuple[str, ...]] = (
    SUPER_ADMIN_ROLE,
    ADMIN_ROLE,
    COMPANY_ADMIN_ROLE,
)
SUPER_ADMIN_ROLES: Final[tuple[str, ...]] = (SUPER_ADMIN_ROLE,)


def normalize_role(role: str) -> str:
    return role.strip().lower()


def has_role(role: str, allowed_roles: tuple[str, ...]) -> bool:
    return normalize_role(role) in allowed_roles

from typing import Final

ADMIN_ROLE: Final[str] = "admin"
MANAGER_ROLE: Final[str] = "manager"
USER_ROLE: Final[str] = "user"
ANALYST_ROLE: Final[str] = "analyst"

VALID_ROLES: Final[tuple[str, ...]] = (
    ADMIN_ROLE,
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
    ADMIN_ROLE,
    MANAGER_ROLE,
)


def normalize_role(role: str) -> str:
    return role.strip().lower()


def has_role(role: str, allowed_roles: tuple[str, ...]) -> bool:
    return normalize_role(role) in allowed_roles

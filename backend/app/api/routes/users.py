from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query, Response, status

from app.core.roles import COMPANY_ADMIN_ROLE, SUPER_ADMIN_ROLE, normalize_role
from app.core.dependencies import (
    CurrentUserAdmin,
    DEFAULT_PAGE_SIZE,
    DbSession,
    PaginationLimit,
    PaginationOffset,
)
from app.schemas.invitation import (
    UserInvitationActionResponse,
    UserInvitationCreateRequest,
    UserInvitationRead,
)
from app.schemas.user import (
    UserAccountStatus,
    UserCreate,
    UserRead,
    UserRole,
    UserRoleUpdate,
    UserStatusUpdate,
    UserUpdate,
)
from app.services.invitation_service import (
    cancel_user_invitation,
    create_user_invitation,
    delete_user_invitation,
    list_user_invitations,
    resend_user_invitation,
    serialize_user_invitation,
)
from app.services.user_service import (
    create_user,
    delete_user,
    get_user_by_email,
    get_user_by_id,
    list_users,
    set_user_account_status,
    set_user_active_state,
    set_user_role,
    update_user,
)

router = APIRouter(tags=["users"])


def _read_user_or_404(db: DbSession, user_id: int):
    target_user = get_user_by_id(db, user_id)
    if target_user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    return target_user


def _ensure_super_admin_assignment_allowed(current_admin, target_role: str) -> None:
    if (
        normalize_role(target_role) == SUPER_ADMIN_ROLE
        and normalize_role(current_admin.role) != SUPER_ADMIN_ROLE
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a super administrator can assign this role",
        )


def _ensure_super_admin_target_allowed(current_admin, target_user) -> None:
    if (
        normalize_role(target_user.role) == SUPER_ADMIN_ROLE
        and normalize_role(current_admin.role) != SUPER_ADMIN_ROLE
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a super administrator can manage this account",
        )


def _ensure_company_admin_scope(current_admin, target_user) -> None:
    if normalize_role(current_admin.role) != COMPANY_ADMIN_ROLE:
        return

    if current_admin.company_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This company administrator is not linked to a company",
        )

    if target_user.company_id != current_admin.company_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only manage users from your company",
        )

    if normalize_role(target_user.role) in {SUPER_ADMIN_ROLE, "admin", COMPANY_ADMIN_ROLE}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot manage this account",
        )


def _ensure_company_admin_role_assignment_allowed(current_admin, target_role: str) -> None:
    if normalize_role(current_admin.role) != COMPANY_ADMIN_ROLE:
        return

    if normalize_role(target_role) not in {"manager", "analyst", "user"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Company administrators can only assign manager, analyst or user roles",
        )


def _ensure_invitation_admin_scope(current_admin) -> int:
    if normalize_role(current_admin.role) != COMPANY_ADMIN_ROLE or current_admin.company_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="La gestion des invitations est reservee aux administrateurs d'entreprise.",
        )
    return current_admin.company_id


@router.get("/", response_model=list[UserRead])
def read_users(
    db: DbSession,
    current_admin: CurrentUserAdmin,
    offset: PaginationOffset = 0,
    limit: PaginationLimit = DEFAULT_PAGE_SIZE,
    search: Annotated[str | None, Query(max_length=120)] = None,
    role: UserRole | None = None,
    status_filter: Annotated[UserAccountStatus | None, Query(alias="status")] = None,
    department_id: Annotated[int | None, Query(gt=0)] = None,
) -> list[UserRead]:
    company_id = None
    if normalize_role(current_admin.role) == COMPANY_ADMIN_ROLE:
        company_id = current_admin.company_id

    users = list_users(
        db,
        offset=offset,
        limit=limit,
        search=search,
        role=role,
        user_status=status_filter,
        department_id=department_id,
        company_id=company_id,
    )
    return [UserRead.model_validate(user) for user in users]


@router.get("/invitations", response_model=list[UserInvitationRead])
def read_user_invitations(
    db: DbSession,
    current_admin: CurrentUserAdmin,
) -> list[UserInvitationRead]:
    company_id = _ensure_invitation_admin_scope(current_admin)
    invitations = list_user_invitations(db, company_id=company_id)
    return [serialize_user_invitation(invitation) for invitation in invitations]


@router.post("/invitations", response_model=UserInvitationActionResponse, status_code=status.HTTP_201_CREATED)
def create_new_user_invitation(
    payload: UserInvitationCreateRequest,
    response: Response,
    db: DbSession,
    current_admin: CurrentUserAdmin,
) -> UserInvitationActionResponse:
    _ensure_invitation_admin_scope(current_admin)
    result = create_user_invitation(db, current_admin=current_admin, payload=payload)
    response.status_code = result.status_code
    return UserInvitationActionResponse(
        code=result.response_code,
        message=result.message,
        invitation=serialize_user_invitation(result.invitation),
    )


@router.patch("/invitations/{invitation_id}/cancel", response_model=UserInvitationActionResponse)
def cancel_existing_user_invitation(
    invitation_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    current_admin: CurrentUserAdmin,
) -> UserInvitationActionResponse:
    _ensure_invitation_admin_scope(current_admin)
    invitation = cancel_user_invitation(
        db,
        current_admin=current_admin,
        invitation_id=invitation_id,
    )
    return UserInvitationActionResponse(
        code="INVITATION_CANCELLED",
        message="L'invitation a ete annulee.",
        invitation=serialize_user_invitation(invitation),
    )


@router.post("/invitations/{invitation_id}/resend", response_model=UserInvitationActionResponse)
def resend_existing_user_invitation(
    invitation_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    current_admin: CurrentUserAdmin,
) -> UserInvitationActionResponse:
    _ensure_invitation_admin_scope(current_admin)
    result = resend_user_invitation(
        db,
        current_admin=current_admin,
        invitation_id=invitation_id,
    )
    return UserInvitationActionResponse(
        code=result.response_code,
        message=result.message,
        invitation=serialize_user_invitation(result.invitation),
    )


@router.delete("/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_existing_user_invitation(
    invitation_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    current_admin: CurrentUserAdmin,
) -> Response:
    _ensure_invitation_admin_scope(current_admin)
    delete_user_invitation(
        db,
        current_admin=current_admin,
        invitation_id=invitation_id,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{user_id}", response_model=UserRead)
def read_user(
    user_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    current_admin: CurrentUserAdmin,
) -> UserRead:
    target_user = _read_user_or_404(db, user_id)
    _ensure_company_admin_scope(current_admin, target_user)
    return UserRead.model_validate(target_user)


@router.post("/", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_new_user(
    payload: UserCreate,
    db: DbSession,
    current_admin: CurrentUserAdmin,
) -> UserRead:
    existing_user = get_user_by_email(db, str(payload.email))
    if existing_user is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists",
        )

    _ensure_super_admin_assignment_allowed(current_admin, payload.role)
    _ensure_company_admin_role_assignment_allowed(current_admin, payload.role)
    if normalize_role(current_admin.role) == COMPANY_ADMIN_ROLE:
        payload = payload.model_copy(
            update={
                "company_id": current_admin.company_id,
                "account_status": payload.account_status
                or ("active" if payload.is_active else "suspended"),
            }
        )
    user = create_user(db, payload)
    return UserRead.model_validate(user)


@router.put("/{user_id}", response_model=UserRead)
def update_existing_user(
    user_id: Annotated[int, Path(gt=0)],
    payload: UserUpdate,
    db: DbSession,
    current_admin: CurrentUserAdmin,
) -> UserRead:
    target_user = _read_user_or_404(db, user_id)
    _ensure_super_admin_target_allowed(current_admin, target_user)
    _ensure_company_admin_scope(current_admin, target_user)

    normalized_email = str(payload.email).lower().strip() if payload.email is not None else None
    if normalized_email:
        existing_user = get_user_by_email(db, normalized_email)
        if existing_user is not None and existing_user.id != target_user.id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A user with this email already exists",
            )

    if target_user.id == current_admin.id:
        if payload.is_active is False:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You cannot deactivate your own account",
            )
        if payload.role is not None and payload.role != target_user.role:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You cannot change your own role",
            )

    if payload.role is not None:
        _ensure_super_admin_assignment_allowed(current_admin, payload.role)
        _ensure_company_admin_role_assignment_allowed(current_admin, payload.role)

    if normalize_role(current_admin.role) == COMPANY_ADMIN_ROLE:
        payload = payload.model_copy(update={"company_id": current_admin.company_id})

    user = update_user(db, target_user, payload)
    return UserRead.model_validate(user)


@router.patch("/{user_id}/status", response_model=UserRead)
def update_user_status(
    user_id: Annotated[int, Path(gt=0)],
    payload: UserStatusUpdate,
    db: DbSession,
    current_admin: CurrentUserAdmin,
) -> UserRead:
    target_user = _read_user_or_404(db, user_id)
    _ensure_super_admin_target_allowed(current_admin, target_user)
    _ensure_company_admin_scope(current_admin, target_user)
    if target_user.id == current_admin.id and payload.status != "active":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot deactivate your own account",
        )

    user = set_user_account_status(db, target_user, payload.status)
    return UserRead.model_validate(user)


@router.patch("/{user_id}/deactivate", response_model=UserRead)
def deactivate_existing_user(
    user_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    current_admin: CurrentUserAdmin,
) -> UserRead:
    target_user = _read_user_or_404(db, user_id)
    _ensure_super_admin_target_allowed(current_admin, target_user)
    _ensure_company_admin_scope(current_admin, target_user)

    if target_user.id == current_admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot deactivate your own account",
        )

    user = set_user_active_state(db, target_user, False)
    return UserRead.model_validate(user)


@router.patch("/{user_id}/role", response_model=UserRead)
def change_user_role(
    user_id: Annotated[int, Path(gt=0)],
    payload: UserRoleUpdate,
    db: DbSession,
    current_admin: CurrentUserAdmin,
) -> UserRead:
    target_user = _read_user_or_404(db, user_id)
    _ensure_super_admin_target_allowed(current_admin, target_user)
    _ensure_company_admin_scope(current_admin, target_user)

    if target_user.id == current_admin.id and payload.role != target_user.role:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot change your own role",
        )

    _ensure_super_admin_assignment_allowed(current_admin, payload.role)
    _ensure_company_admin_role_assignment_allowed(current_admin, payload.role)
    user = set_user_role(db, target_user, payload.role)
    return UserRead.model_validate(user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_existing_user(
    user_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    current_admin: CurrentUserAdmin,
) -> Response:
    target_user = _read_user_or_404(db, user_id)
    _ensure_super_admin_target_allowed(current_admin, target_user)
    _ensure_company_admin_scope(current_admin, target_user)

    if target_user.id == current_admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot delete your own account",
        )

    delete_user(db, target_user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query, Response, status

from app.core.dependencies import (
    DEFAULT_PAGE_SIZE,
    CurrentAdminUser,
    DbSession,
    PaginationLimit,
    PaginationOffset,
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
from app.services.user_service import (
    create_user,
    delete_user,
    get_user_by_email,
    get_user_by_id,
    list_users,
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


@router.get("/", response_model=list[UserRead])
def read_users(
    db: DbSession,
    _: CurrentAdminUser,
    offset: PaginationOffset = 0,
    limit: PaginationLimit = DEFAULT_PAGE_SIZE,
    search: Annotated[str | None, Query(max_length=120)] = None,
    role: UserRole | None = None,
    status_filter: Annotated[UserAccountStatus | None, Query(alias="status")] = None,
    department_id: Annotated[int | None, Query(gt=0)] = None,
) -> list[UserRead]:
    users = list_users(
        db,
        offset=offset,
        limit=limit,
        search=search,
        role=role,
        user_status=status_filter,
        department_id=department_id,
    )
    return [UserRead.model_validate(user) for user in users]


@router.get("/{user_id}", response_model=UserRead)
def read_user(
    user_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    _: CurrentAdminUser,
) -> UserRead:
    return UserRead.model_validate(_read_user_or_404(db, user_id))


@router.post("/", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_new_user(
    payload: UserCreate,
    db: DbSession,
    _: CurrentAdminUser,
) -> UserRead:
    existing_user = get_user_by_email(db, str(payload.email))
    if existing_user is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email already exists",
        )

    user = create_user(db, payload)
    return UserRead.model_validate(user)


@router.put("/{user_id}", response_model=UserRead)
def update_existing_user(
    user_id: Annotated[int, Path(gt=0)],
    payload: UserUpdate,
    db: DbSession,
    current_admin: CurrentAdminUser,
) -> UserRead:
    target_user = _read_user_or_404(db, user_id)

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

    user = update_user(db, target_user, payload)
    return UserRead.model_validate(user)


@router.patch("/{user_id}/status", response_model=UserRead)
def update_user_status(
    user_id: Annotated[int, Path(gt=0)],
    payload: UserStatusUpdate,
    db: DbSession,
    current_admin: CurrentAdminUser,
) -> UserRead:
    target_user = _read_user_or_404(db, user_id)
    next_is_active = payload.status == "active"

    if target_user.id == current_admin.id and not next_is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot deactivate your own account",
        )

    user = set_user_active_state(db, target_user, next_is_active)
    return UserRead.model_validate(user)


@router.patch("/{user_id}/deactivate", response_model=UserRead)
def deactivate_existing_user(
    user_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    current_admin: CurrentAdminUser,
) -> UserRead:
    target_user = _read_user_or_404(db, user_id)

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
    current_admin: CurrentAdminUser,
) -> UserRead:
    target_user = _read_user_or_404(db, user_id)

    if target_user.id == current_admin.id and payload.role != target_user.role:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot change your own role",
        )

    user = set_user_role(db, target_user, payload.role)
    return UserRead.model_validate(user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_existing_user(
    user_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    current_admin: CurrentAdminUser,
) -> Response:
    target_user = _read_user_or_404(db, user_id)

    if target_user.id == current_admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot delete your own account",
        )

    delete_user(db, target_user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

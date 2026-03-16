from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Response, status

from app.core.dependencies import (
    DEFAULT_PAGE_SIZE,
    CurrentActiveUser,
    CurrentAdminUser,
    DbSession,
    PaginationLimit,
    PaginationOffset,
    get_accessible_user,
)
from app.models.user import User
from app.schemas.user import UserCreate, UserRead, UserUpdate
from app.services.user_service import (
    create_user,
    delete_user,
    get_user_by_email,
    get_user_by_id,
    list_users,
    update_user,
)

router = APIRouter(tags=["users"])


@router.get("/", response_model=list[UserRead])
def read_users(
    db: DbSession,
    _: CurrentActiveUser,
    offset: PaginationOffset = 0,
    limit: PaginationLimit = DEFAULT_PAGE_SIZE,
) -> list[UserRead]:
    users = list_users(db, offset=offset, limit=limit)
    return [UserRead.model_validate(user) for user in users]


@router.get("/{user_id}", response_model=UserRead)
def read_user(
    user: Annotated[User, Depends(get_accessible_user)],
) -> UserRead:
    return UserRead.model_validate(user)


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
    target_user = get_user_by_id(db, user_id)
    if target_user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

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


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_existing_user(
    user_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    current_admin: CurrentAdminUser,
) -> Response:
    target_user = get_user_by_id(db, user_id)
    if target_user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    if target_user.id == current_admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot delete your own account",
        )

    delete_user(db, target_user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Response, status
from sqlalchemy.orm import Session

from app.core.dependencies import (
    DEFAULT_PAGE_SIZE,
    CurrentActiveUser,
    DbSession,
    PaginationLimit,
    PaginationOffset,
)
from app.models.phone_line import PhoneLine
from app.schemas.phone_line import (
    PhoneLineCreate,
    PhoneLineRead,
    PhoneLineStatsRead,
    PhoneLineUpdate,
)
from app.services.phone_line_service import (
    create_phone_line,
    delete_phone_line,
    get_phone_line,
    get_phone_line_by_number,
    get_phone_line_stats,
    list_phone_lines,
    update_phone_line,
)

router = APIRouter(tags=["phone-lines"])


def get_phone_line_or_404(db: Session, phone_line_id: int) -> PhoneLine:
    phone_line = get_phone_line(db, phone_line_id)
    if phone_line is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Phone line not found",
        )
    return phone_line


@router.get("/", response_model=list[PhoneLineRead])
def read_phone_lines(
    db: DbSession,
    _: CurrentActiveUser,
    offset: PaginationOffset = 0,
    limit: PaginationLimit = DEFAULT_PAGE_SIZE,
) -> list[PhoneLineRead]:
    phone_lines = list_phone_lines(db, offset=offset, limit=limit)
    return [PhoneLineRead.model_validate(phone_line) for phone_line in phone_lines]


@router.get("/stats", response_model=PhoneLineStatsRead)
def read_phone_line_stats(
    db: DbSession,
    _: CurrentActiveUser,
) -> PhoneLineStatsRead:
    stats = get_phone_line_stats(db)
    return PhoneLineStatsRead(**stats)


@router.get("/{phone_line_id}", response_model=PhoneLineRead)
def read_phone_line(
    phone_line_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    _: CurrentActiveUser,
) -> PhoneLineRead:
    phone_line = get_phone_line_or_404(db, phone_line_id)
    return PhoneLineRead.model_validate(phone_line)


@router.post("/", response_model=PhoneLineRead, status_code=status.HTTP_201_CREATED)
def create_new_phone_line(
    payload: PhoneLineCreate,
    db: DbSession,
    _: CurrentActiveUser,
) -> PhoneLineRead:
    existing_phone_line = get_phone_line_by_number(db, payload.phone_number)
    if existing_phone_line is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A phone line with this number already exists",
        )

    phone_line = create_phone_line(db, payload)
    return PhoneLineRead.model_validate(phone_line)


@router.put("/{phone_line_id}", response_model=PhoneLineRead)
def update_existing_phone_line(
    phone_line_id: Annotated[int, Path(gt=0)],
    payload: PhoneLineUpdate,
    db: DbSession,
    _: CurrentActiveUser,
) -> PhoneLineRead:
    phone_line = get_phone_line_or_404(db, phone_line_id)

    if payload.phone_number:
        existing_phone_line = get_phone_line_by_number(db, payload.phone_number)
        if existing_phone_line is not None and existing_phone_line.id != phone_line_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A phone line with this number already exists",
            )

    updated_phone_line = update_phone_line(db, phone_line, payload)
    return PhoneLineRead.model_validate(updated_phone_line)


@router.delete("/{phone_line_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_existing_phone_line(
    phone_line_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    _: CurrentActiveUser,
) -> Response:
    phone_line = get_phone_line_or_404(db, phone_line_id)
    delete_phone_line(db, phone_line)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

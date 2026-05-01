from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Response, status
from sqlalchemy.orm import Session

from app.core.dependencies import (
    CurrentActiveUser,
    CurrentManagerOrAdminUser,
    DbSession,
    PaginationLimit,
    PaginationOffset,
)
from app.models.phone_line import PhoneLine
from app.schemas.phone_line import (
    PhoneLineCreate,
    PhoneLinePlanChange,
    PhoneLineRead,
    PhoneLineStatsRead,
    PhoneLineUpdate,
)
from app.services.plan_service import get_plan
from app.services.phone_line_service import (
    change_phone_line_plan,
    compute_occupation_status,
    create_phone_line,
    delete_phone_line,
    extract_contact_email,
    get_occupation_stats,
    get_phone_line,
    get_phone_line_by_number,
    get_phone_line_stats,
    list_phone_lines,
    reactivate_phone_line,
    suspend_phone_line,
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


def _serialize_phone_line(phone_line: PhoneLine) -> PhoneLineRead:
    phone_line.occupation_status = compute_occupation_status(phone_line)
    phone_line.contact_email = extract_contact_email(phone_line.notes)
    return PhoneLineRead.model_validate(phone_line)


@router.get("/", response_model=list[PhoneLineRead])
def read_phone_lines(
    db: DbSession,
    _: CurrentActiveUser,
    offset: PaginationOffset = 0,
    limit: PaginationLimit = 50,
    assigned_filter: str | None = None,
    status_filter: str | None = None,
) -> list[PhoneLineRead]:
    phone_lines = list_phone_lines(
        db,
        offset=offset,
        limit=limit,
        assigned_filter=assigned_filter,
        status_filter=status_filter,
    )
    return [_serialize_phone_line(phone_line) for phone_line in phone_lines]


@router.get("/stats", response_model=PhoneLineStatsRead)
def read_phone_line_stats(
    db: DbSession,
    _: CurrentActiveUser,
) -> PhoneLineStatsRead:
    stats = get_phone_line_stats(db)
    return PhoneLineStatsRead(**stats)


@router.get("/stats/occupation", response_model=dict)
def read_occupation_stats(
    db: DbSession,
    _: CurrentActiveUser,
) -> dict:
    return get_occupation_stats(db)


@router.get("/{phone_line_id}", response_model=PhoneLineRead)
def read_phone_line(
    phone_line_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    _: CurrentActiveUser,
) -> PhoneLineRead:
    phone_line = get_phone_line_or_404(db, phone_line_id)
    return _serialize_phone_line(phone_line)


@router.post("/", response_model=PhoneLineRead, status_code=status.HTTP_201_CREATED)
def create_new_phone_line(
    payload: PhoneLineCreate,
    db: DbSession,
    _: CurrentManagerOrAdminUser,
) -> PhoneLineRead:
    existing_phone_line = get_phone_line_by_number(db, payload.phone_number)
    if existing_phone_line is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A phone line with this number already exists",
        )

    phone_line = create_phone_line(db, payload)
    return _serialize_phone_line(phone_line)


@router.put("/{phone_line_id}", response_model=PhoneLineRead)
def update_existing_phone_line(
    phone_line_id: Annotated[int, Path(gt=0)],
    payload: PhoneLineUpdate,
    db: DbSession,
    _: CurrentManagerOrAdminUser,
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
    return _serialize_phone_line(updated_phone_line)


@router.post("/{phone_line_id}/change-plan", response_model=PhoneLineRead)
def change_existing_phone_line_plan(
    phone_line_id: Annotated[int, Path(gt=0)],
    payload: PhoneLinePlanChange,
    db: DbSession,
    _: CurrentManagerOrAdminUser,
) -> PhoneLineRead:
    phone_line = get_phone_line_or_404(db, phone_line_id)
    if phone_line.status != "active":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only active phone lines can change plan",
        )

    plan = get_plan(db, payload.plan_id)
    if plan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Plan not found",
        )

    updated_phone_line = change_phone_line_plan(db, phone_line, plan)
    return _serialize_phone_line(updated_phone_line)


@router.post("/{phone_line_id}/suspend", response_model=PhoneLineRead)
def suspend_existing_phone_line(
    phone_line_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    _: CurrentManagerOrAdminUser,
) -> PhoneLineRead:
    phone_line = get_phone_line_or_404(db, phone_line_id)
    if phone_line.status == "suspended":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Phone line is already suspended",
        )
    if phone_line.status == "inactive":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Inactive phone lines cannot be suspended",
        )

    updated_phone_line = suspend_phone_line(db, phone_line)
    return _serialize_phone_line(updated_phone_line)


@router.post("/{phone_line_id}/reactivate", response_model=PhoneLineRead)
def reactivate_existing_phone_line(
    phone_line_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    _: CurrentManagerOrAdminUser,
) -> PhoneLineRead:
    phone_line = get_phone_line_or_404(db, phone_line_id)
    if phone_line.status != "suspended":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only suspended phone lines can be reactivated",
        )

    updated_phone_line = reactivate_phone_line(db, phone_line)
    return _serialize_phone_line(updated_phone_line)


@router.delete("/{phone_line_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_existing_phone_line(
    phone_line_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    _: CurrentManagerOrAdminUser,
) -> Response:
    phone_line = get_phone_line_or_404(db, phone_line_id)
    delete_phone_line(db, phone_line)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

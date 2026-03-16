from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Response, status
from sqlalchemy.orm import Session

from app.core.dependencies import (
    DEFAULT_PAGE_SIZE,
    CurrentActiveUser,
    CurrentAdminUser,
    DbSession,
    PaginationLimit,
    PaginationOffset,
)
from app.models.plan import Plan
from app.schemas.plan import PlanCreate, PlanRead, PlanUpdate
from app.services.plan_service import (
    create_plan,
    delete_plan,
    get_plan,
    get_plan_by_name,
    list_plans,
    update_plan,
)

router = APIRouter(tags=["plans"])


def get_plan_or_404(db: Session, plan_id: int) -> Plan:
    plan = get_plan(db, plan_id)
    if plan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Plan not found",
        )
    return plan


@router.get("/", response_model=list[PlanRead])
def read_plans(
    db: DbSession,
    _: CurrentActiveUser,
    offset: PaginationOffset = 0,
    limit: PaginationLimit = DEFAULT_PAGE_SIZE,
) -> list[PlanRead]:
    plans = list_plans(db, offset=offset, limit=limit)
    return [PlanRead.model_validate(plan) for plan in plans]


@router.get("/{plan_id}", response_model=PlanRead)
def read_plan(
    plan_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    _: CurrentActiveUser,
) -> PlanRead:
    plan = get_plan_or_404(db, plan_id)
    return PlanRead.model_validate(plan)


@router.post("/", response_model=PlanRead, status_code=status.HTTP_201_CREATED)
def create_new_plan(
    payload: PlanCreate,
    db: DbSession,
    _: CurrentAdminUser,
) -> PlanRead:
    existing_plan = get_plan_by_name(db, payload.name)
    if existing_plan is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A plan with this name already exists",
        )

    plan = create_plan(db, payload)
    return PlanRead.model_validate(plan)


@router.put("/{plan_id}", response_model=PlanRead)
def update_existing_plan(
    plan_id: Annotated[int, Path(gt=0)],
    payload: PlanUpdate,
    db: DbSession,
    _: CurrentAdminUser,
) -> PlanRead:
    plan = get_plan_or_404(db, plan_id)

    if payload.name:
        existing_plan = get_plan_by_name(db, payload.name)
        if existing_plan is not None and existing_plan.id != plan_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A plan with this name already exists",
            )

    updated_plan = update_plan(db, plan, payload)
    return PlanRead.model_validate(updated_plan)


@router.delete("/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_existing_plan(
    plan_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    _: CurrentAdminUser,
) -> Response:
    plan = get_plan_or_404(db, plan_id)
    delete_plan(db, plan)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Response, status
from sqlalchemy.orm import Session

from app.core.dependencies import (
    DEFAULT_PAGE_SIZE,
    CurrentActiveUser,
    CurrentAdminUser,
    CurrentManagerOrAdminUser,
    DbSession,
    PaginationLimit,
    PaginationOffset,
)
from app.models.phone_line import PhoneLine
from app.models.plan import Plan
from app.schemas.phone_line import PhoneLineRead
from app.schemas.plan import (
    PlanActivationRequest,
    PlanActivationResponse,
    PlanCreate,
    PlanDeactivationResponse,
    PlanLifecycleImpactRead,
    PlanRead,
    PlanReplacementRequest,
    PlanReplacementResponse,
    PlanUpdate,
)
from app.services.plan_service import (
    activate_plan,
    create_plan,
    deactivate_plan,
    delete_plan,
    get_plan,
    get_plan_by_name,
    get_plan_lifecycle_impact,
    list_plans,
    replace_plan,
    update_plan,
    PlanLifecycleConflictError,
)
from app.services.phone_line_service import (
    compute_occupation_status,
    extract_contact_email,
    get_phone_line,
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


def _serialize_phone_line(phone_line: PhoneLine) -> PhoneLineRead:
    phone_line.occupation_status = compute_occupation_status(phone_line)
    phone_line.contact_email = extract_contact_email(phone_line.notes)
    return PhoneLineRead.model_validate(phone_line)


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


@router.post("/activate-plan", response_model=PlanActivationResponse)
def activate_existing_plan(
    payload: PlanActivationRequest,
    db: DbSession,
    current_user: CurrentManagerOrAdminUser,
) -> PlanActivationResponse:
    plan = get_plan_or_404(db, payload.plan_id)
    phone_line = get_phone_line(db, payload.phone_line_id) if payload.phone_line_id is not None else None

    if payload.phone_line_id is not None and phone_line is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Phone line not found",
        )

    activated_plan, updated_phone_line = activate_plan(
        db,
        plan,
        current_user,
        phone_line=phone_line,
    )

    return PlanActivationResponse(
        action="Activation forfait",
        message="Forfait active avec succes",
        activated_at=activated_plan.activated_at or activated_plan.updated_at,
        activated_by_user_id=current_user.id,
        activated_by_name=current_user.full_name,
        plan=PlanRead.model_validate(activated_plan),
        phone_line=_serialize_phone_line(updated_phone_line) if updated_phone_line is not None else None,
    )


@router.get("/{plan_id}/lifecycle-impact", response_model=PlanLifecycleImpactRead)
def read_plan_lifecycle_impact(
    plan_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    _: CurrentManagerOrAdminUser,
) -> PlanLifecycleImpactRead:
    plan = get_plan_or_404(db, plan_id)
    return get_plan_lifecycle_impact(db, plan)


@router.patch("/{plan_id}/deactivate", response_model=PlanDeactivationResponse)
def deactivate_existing_plan(
    plan_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    current_user: CurrentManagerOrAdminUser,
) -> PlanDeactivationResponse:
    plan = get_plan_or_404(db, plan_id)

    try:
        deactivated_plan, lifecycle_impact, deactivated_at = deactivate_plan(db, plan, current_user)
    except PlanLifecycleConflictError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(error),
        ) from error

    return PlanDeactivationResponse(
        action="Desactivation forfait",
        message="Forfait desactive avec succes",
        deactivated_at=deactivated_at,
        deactivated_by_user_id=current_user.id,
        deactivated_by_name=current_user.full_name,
        plan=PlanRead.model_validate(deactivated_plan),
        impact=lifecycle_impact,
    )


@router.post("/{plan_id}/replace", response_model=PlanReplacementResponse)
def replace_existing_plan(
    plan_id: Annotated[int, Path(gt=0)],
    payload: PlanReplacementRequest,
    db: DbSession,
    current_user: CurrentManagerOrAdminUser,
) -> PlanReplacementResponse:
    current_plan = get_plan_or_404(db, plan_id)
    replacement_plan = get_plan_or_404(db, payload.replacement_plan_id)

    try:
        previous_plan, next_plan, lifecycle_impact, reassigned_lines, replaced_at = replace_plan(
            db,
            current_plan,
            replacement_plan,
            current_user,
        )
    except PlanLifecycleConflictError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(error),
        ) from error

    return PlanReplacementResponse(
        action="Remplacement forfait",
        message="Forfait remplace avec succes",
        replaced_at=replaced_at,
        replaced_by_user_id=current_user.id,
        replaced_by_name=current_user.full_name,
        previous_plan=PlanRead.model_validate(previous_plan),
        replacement_plan=PlanRead.model_validate(next_plan),
        impact=lifecycle_impact,
        reassigned_lines=reassigned_lines,
    )


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

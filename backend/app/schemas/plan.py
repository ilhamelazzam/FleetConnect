from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.phone_line import PhoneLineRead

PlanActivationStatus = Literal["pending", "active", "suspended", "inactive"]


class PlanBase(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    operator_name: str = Field(min_length=2, max_length=100)
    monthly_price: int = Field(ge=0, le=1_000_000)
    voice_quota: str = Field(min_length=1, max_length=100)
    data_quota: str = Field(min_length=1, max_length=100)
    sms_quota: str = Field(min_length=1, max_length=100)
    roaming_zone: str = Field(min_length=1, max_length=120)
    active_lines: int = Field(default=0, ge=0, le=1_000_000)
    description: str | None = Field(default=None, max_length=1000)


class PlanCreate(PlanBase):
    pass


class PlanUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    operator_name: str | None = Field(default=None, min_length=2, max_length=100)
    monthly_price: int | None = Field(default=None, ge=0, le=1_000_000)
    voice_quota: str | None = Field(default=None, min_length=1, max_length=100)
    data_quota: str | None = Field(default=None, min_length=1, max_length=100)
    sms_quota: str | None = Field(default=None, min_length=1, max_length=100)
    roaming_zone: str | None = Field(default=None, min_length=1, max_length=120)
    active_lines: int | None = Field(default=None, ge=0, le=1_000_000)
    activation_status: PlanActivationStatus | None = None
    description: str | None = Field(default=None, max_length=1000)


class PlanRead(PlanBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    activation_status: PlanActivationStatus
    activated_at: datetime | None
    activated_by_user_id: int | None
    created_at: datetime
    updated_at: datetime


class PlanActivationRequest(BaseModel):
    plan_id: int = Field(gt=0)
    phone_line_id: int | None = Field(default=None, gt=0)


class PlanActivationResponse(BaseModel):
    action: str
    message: str
    activated_at: datetime
    activated_by_user_id: int
    activated_by_name: str
    plan: PlanRead
    phone_line: PhoneLineRead | None = None


class PlanLifecycleImpactRead(BaseModel):
    impacted_lines: int = Field(ge=0)
    actual_linked_lines: int = Field(ge=0)
    estimated_monthly_cost_mad: int = Field(ge=0)
    coverage_impact_label: str
    coverage_impact_summary: str
    can_deactivate: bool
    requires_reassignment: bool
    is_critical: bool
    blocking_reason: str | None = None
    recommended_replacement_plan_id: int | None = Field(default=None, gt=0)
    recommended_replacement_plan_name: str | None = None
    recommended_monthly_savings_mad: int | None = Field(default=None, ge=0)
    ai_recommendation: str | None = None


class PlanDeactivationResponse(BaseModel):
    action: str
    message: str
    deactivated_at: datetime
    deactivated_by_user_id: int
    deactivated_by_name: str
    plan: PlanRead
    impact: PlanLifecycleImpactRead


class PlanReplacementRequest(BaseModel):
    replacement_plan_id: int = Field(gt=0)


class PlanReplacementResponse(BaseModel):
    action: str
    message: str
    replaced_at: datetime
    replaced_by_user_id: int
    replaced_by_name: str
    previous_plan: PlanRead
    replacement_plan: PlanRead
    impact: PlanLifecycleImpactRead
    reassigned_lines: int = Field(ge=0)

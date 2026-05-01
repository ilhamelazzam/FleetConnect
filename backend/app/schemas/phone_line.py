from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

PhoneLineStatus = Literal["active", "inactive", "suspended"]
PhoneLineOccupationStatus = Literal["libre", "attribuee", "en_cours", "suspendue", "inactive"]


class PhoneLineBase(BaseModel):
    phone_number: str = Field(pattern=r"^\+?[0-9]{8,15}$")
    operator_name: str = Field(min_length=2, max_length=100)
    plan_name: str = Field(min_length=2, max_length=120)
    assigned_to: str | None = Field(default=None, max_length=120)
    contact_email: str | None = Field(default=None, max_length=255)
    department: str | None = Field(default=None, max_length=120)
    status: PhoneLineStatus = "active"
    monthly_limit: int | None = Field(default=None, ge=0)
    current_data_usage_gb: float | None = Field(default=None, ge=0)
    previous_data_usage_gb: float | None = Field(default=None, ge=0)
    notes: str | None = Field(default=None, max_length=1000)


class PhoneLineCreate(PhoneLineBase):
    pass


class PhoneLineUpdate(BaseModel):
    phone_number: str | None = Field(default=None, pattern=r"^\+?[0-9]{8,15}$")
    operator_name: str | None = Field(default=None, min_length=2, max_length=100)
    plan_name: str | None = Field(default=None, min_length=2, max_length=120)
    assigned_to: str | None = Field(default=None, max_length=120)
    contact_email: str | None = Field(default=None, max_length=255)
    department: str | None = Field(default=None, max_length=120)
    status: PhoneLineStatus | None = None
    monthly_limit: int | None = Field(default=None, ge=0)
    current_data_usage_gb: float | None = Field(default=None, ge=0)
    previous_data_usage_gb: float | None = Field(default=None, ge=0)
    notes: str | None = Field(default=None, max_length=1000)


class PhoneLineRead(PhoneLineBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime
    occupation_status: PhoneLineOccupationStatus | None = None


class PhoneLineStatsRead(BaseModel):
    total: int
    created_this_month: int
    average_data_usage_gb: float | None = None
    previous_average_data_usage_gb: float | None = None
    average_data_usage_change_pct: float | None = None
    total_ai_alerts: int = 0
    critical_ai_alerts: int = 0
    estimated_monthly_savings_mad: int = 0


class PhoneLinePlanChange(BaseModel):
    plan_id: int = Field(gt=0)

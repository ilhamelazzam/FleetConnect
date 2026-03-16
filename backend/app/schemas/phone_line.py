from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

PhoneLineStatus = Literal["active", "inactive", "suspended"]


class PhoneLineBase(BaseModel):
    phone_number: str = Field(pattern=r"^\+?[0-9]{8,15}$")
    operator_name: str = Field(min_length=2, max_length=100)
    plan_name: str = Field(min_length=2, max_length=120)
    assigned_to: str | None = Field(default=None, max_length=120)
    department: str | None = Field(default=None, max_length=120)
    status: PhoneLineStatus = "active"
    monthly_limit: int | None = Field(default=None, ge=0)
    notes: str | None = Field(default=None, max_length=1000)


class PhoneLineCreate(PhoneLineBase):
    pass


class PhoneLineUpdate(BaseModel):
    phone_number: str | None = Field(default=None, pattern=r"^\+?[0-9]{8,15}$")
    operator_name: str | None = Field(default=None, min_length=2, max_length=100)
    plan_name: str | None = Field(default=None, min_length=2, max_length=120)
    assigned_to: str | None = Field(default=None, max_length=120)
    department: str | None = Field(default=None, max_length=120)
    status: PhoneLineStatus | None = None
    monthly_limit: int | None = Field(default=None, ge=0)
    notes: str | None = Field(default=None, max_length=1000)


class PhoneLineRead(PhoneLineBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime


class PhoneLineStatsRead(BaseModel):
    total: int
    created_this_month: int

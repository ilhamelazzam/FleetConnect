from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


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
    description: str | None = Field(default=None, max_length=1000)


class PlanRead(PlanBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime

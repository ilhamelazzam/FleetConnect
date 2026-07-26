from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

UserRole = Literal["super_admin", "admin", "company_admin", "manager", "user", "analyst"]
UserAccountStatus = Literal["pending", "active", "suspended", "rejected"]


class UserBase(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    photo_url: str | None = Field(default=None, max_length=1_000_000)
    phone: str | None = Field(default=None, max_length=30)
    role: UserRole = "manager"
    company_id: int | None = Field(default=None, gt=0)
    department_id: int | None = Field(default=None, gt=0)
    requested_department: str | None = Field(default=None, max_length=120)
    job_profile: str | None = Field(default=None, max_length=120)
    is_active: bool = True
    account_status: UserAccountStatus | None = None


class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=128)


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    email: EmailStr | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)
    photo_url: str | None = Field(default=None, max_length=1_000_000)
    phone: str | None = Field(default=None, max_length=30)
    role: UserRole | None = None
    company_id: int | None = Field(default=None, gt=0)
    department_id: int | None = Field(default=None, gt=0)
    requested_department: str | None = Field(default=None, max_length=120)
    job_profile: str | None = Field(default=None, max_length=120)
    is_active: bool | None = None
    account_status: UserAccountStatus | None = None


class UserRead(UserBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    company_name: str | None = None
    department_name: str | None = None
    status: UserAccountStatus
    updated_at: datetime
    last_login_at: datetime | None
    created_at: datetime


class UserStatusUpdate(BaseModel):
    status: UserAccountStatus


class UserRoleUpdate(BaseModel):
    role: UserRole

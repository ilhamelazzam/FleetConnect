from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

UserRole = Literal["admin", "manager", "user", "analyst"]
UserAccountStatus = Literal["active", "suspended"]


class UserBase(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    photo_url: str | None = Field(default=None, max_length=1_000_000)
    role: UserRole = "manager"
    department_id: int | None = Field(default=None, gt=0)
    job_profile: str | None = Field(default=None, max_length=120)
    is_active: bool = True


class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=128)


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    email: EmailStr | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)
    photo_url: str | None = Field(default=None, max_length=1_000_000)
    role: UserRole | None = None
    department_id: int | None = Field(default=None, gt=0)
    job_profile: str | None = Field(default=None, max_length=120)
    is_active: bool | None = None


class UserRead(UserBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    department_name: str | None = None
    status: UserAccountStatus
    updated_at: datetime
    last_login_at: datetime | None
    created_at: datetime


class UserStatusUpdate(BaseModel):
    status: UserAccountStatus


class UserRoleUpdate(BaseModel):
    role: UserRole

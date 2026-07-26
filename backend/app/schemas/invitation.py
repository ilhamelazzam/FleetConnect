from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.user import UserRole

InvitationExpiration = Literal["7_days", "14_days", "30_days"]
InvitationStatus = Literal["pending", "accepted", "cancelled", "expired"]
InvitationActionCode = Literal[
    "INVITATION_SENT",
    "INVITATION_RESENT",
    "INVITATION_ALREADY_SENT",
    "INVITATION_CANCELLED",
]


class UserInvitationCreateRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=5, max_length=255)
    phone: str | None = Field(default=None, min_length=6, max_length=30)
    department: str = Field(min_length=2, max_length=120)
    job_title: str = Field(min_length=2, max_length=120)
    expiration: InvitationExpiration = "7_days"


class UserInvitationRead(BaseModel):
    id: int
    full_name: str
    email: str
    phone: str | None = None
    department: str
    job_title: str
    role: UserRole
    status: InvitationStatus
    expiration_date: datetime
    created_at: datetime
    sent_at: datetime | None = None
    created_by_id: int | None = None
    created_by_name: str | None = None
    invitation_url: str


class UserInvitationActionResponse(BaseModel):
    code: InvitationActionCode
    message: str
    invitation: UserInvitationRead


class InvitationValidationResponse(BaseModel):
    company_name: str
    full_name: str
    email: str
    phone: str | None = None
    department: str
    job_title: str
    role: UserRole
    expires_at: datetime


class AcceptInvitationRequest(BaseModel):
    token: str = Field(min_length=16, max_length=2048)
    password: str = Field(min_length=8, max_length=128)
    phone: str | None = Field(default=None, max_length=30)


class AcceptInvitationResponse(BaseModel):
    message: str
    company_name: str

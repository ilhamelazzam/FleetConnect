from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

CompanyRegistrationStatus = Literal["pending", "under_review", "approved", "rejected"]
CompanyLifecycleStatus = Literal["active", "suspended", "deleted"]
RequestedCompanyRole = Literal["ADMIN", "MANAGER", "ANALYST"]
CompanyRegistrationEligibilityReason = Literal[
    "available",
    "active_request_exists",
    "active_user_exists",
    "resubmission_allowed",
]


class CompanyRegistrationDocumentRead(BaseModel):
    key: str
    label: str
    file_name: str
    download_url: str


class CompanyRegistrationDecisionRead(BaseModel):
    status: CompanyRegistrationStatus
    rejection_reason: str | None = None
    reviewed_at: datetime | None = None
    reviewed_by_user_id: int | None = None
    reviewed_by_name: str | None = None


class CompanyStatusHistoryRead(BaseModel):
    id: int
    action: str
    title: str
    comment: str | None = None
    previous_status: str | None = None
    next_status: str | None = None
    actor_user_id: int | None = None
    actor_user_name: str | None = None
    created_at: datetime


class CompanyOperatorDistributionRead(BaseModel):
    operator: str
    total: int


class CompanyRegistrationRequestSummaryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    responsible_full_name: str
    responsible_email: EmailStr
    responsible_phone: str
    job_title: str
    requested_role: RequestedCompanyRole
    requested_role_label: str
    company_name: str
    sector: str
    city: str
    address_line: str | None = None
    region: str | None = None
    postal_code: str | None = None
    country: str | None = None
    company_phone: str
    ice: str | None = None
    rc: str | None = None
    primary_operator: str | None = None
    estimated_phone_lines: int
    employees_count: int
    operators: list[str]
    status: CompanyRegistrationStatus
    is_deleted: bool = False
    deleted_at: datetime | None = None
    deleted_by_user_id: int | None = None
    deleted_by_name: str | None = None
    previous_request_id: int | None = None
    resubmission_number: int = 1
    reviewed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class CompanyRegistrationRequestDetailRead(CompanyRegistrationRequestSummaryRead):
    tax_id: str | None = None
    cnss: str | None = None
    patente: str | None = None
    website: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    coverage_zones: list[str]
    documents: list[CompanyRegistrationDocumentRead]
    history: list[CompanyStatusHistoryRead]
    decision: CompanyRegistrationDecisionRead
    approved_company_id: int | None = None
    approved_company_name: str | None = None
    approved_admin_user_id: int | None = None
    approved_admin_email: EmailStr | None = None


class CompanyRegistrationRequestListResponse(BaseModel):
    total: int
    offset: int
    limit: int
    items: list[CompanyRegistrationRequestSummaryRead]


class CompanySummaryRead(BaseModel):
    id: int
    company_code: str | None = None
    name: str
    sector: str
    city: str
    country: str | None = None
    phone: str
    ice: str | None = None
    status: CompanyLifecycleStatus = "active"
    user_count: int = 0
    estimated_phone_lines: int = 0
    operators: list[str] = Field(default_factory=list)
    created_at: datetime


class CompanyAdminSummaryRead(BaseModel):
    id: int
    full_name: str
    email: EmailStr
    role: str
    company_id: int | None = None
    company_name: str | None = None
    created_at: datetime


class CompanyRegistrationStatsRead(BaseModel):
    pending: int
    under_review: int
    approved: int
    rejected: int
    this_month: int
    total: int
    active_companies: int
    total_users: int
    suspended_companies: int
    connections: int


class CompanyRegistrationOverviewRead(BaseModel):
    stats: CompanyRegistrationStatsRead
    operator_distribution: list[CompanyOperatorDistributionRead]
    recent_companies: list[CompanySummaryRead]
    recent_company_admins: list[CompanyAdminSummaryRead]


class CompanyRegistrationRejectRequest(BaseModel):
    rejection_reason: str = Field(min_length=10, max_length=1_500)


class CompanyRegistrationInfoRequest(BaseModel):
    comment: str = Field(min_length=10, max_length=1_500)


class CompanyRegistrationSubmitResponse(BaseModel):
    message: str
    request_id: int
    status: CompanyRegistrationStatus
    previous_request_id: int | None = None
    resubmission_number: int = 1


class CompanyRegistrationActionResponse(BaseModel):
    message: str
    request: CompanyRegistrationRequestDetailRead


class CompanyRegistrationDeleteRequest(BaseModel):
    force: bool = False
    reason: str | None = Field(default=None, max_length=1_500)


class CompanyRegistrationRestoreRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=1_500)


class CompanyRegistrationReopenRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=1_500)


class CompanyRegistrationEmailEligibilityRead(BaseModel):
    can_submit: bool
    reason: CompanyRegistrationEligibilityReason
    message: str
    previous_request_id: int | None = None


class CompanyListItemRead(BaseModel):
    id: int
    company_code: str | None = None
    name: str
    sector: str
    city: str
    address_line: str | None = None
    region: str | None = None
    postal_code: str | None = None
    country: str | None = None
    phone: str
    ice: str | None = None
    rc: str | None = None
    tax_id: str | None = None
    cnss: str | None = None
    patente: str | None = None
    website: str | None = None
    status: CompanyLifecycleStatus
    join_code: str | None = None
    estimated_phone_lines: int
    employees_count: int
    user_count: int
    active_user_count: int
    suspended_user_count: int
    pending_user_count: int
    admin_count: int
    operators: list[str]
    coverage_zones: list[str]
    logo_download_url: str | None = None
    created_at: datetime
    updated_at: datetime


class CompanyListResponse(BaseModel):
    total: int
    offset: int
    limit: int
    items: list[CompanyListItemRead]


class CompanyDashboardMetricsRead(BaseModel):
    total_users: int
    active_users: int
    suspended_users: int
    pending_users: int
    admin_users: int
    estimated_phone_lines: int
    employees_count: int
    operators_count: int


class CompanyDashboardRead(BaseModel):
    company: CompanyListItemRead
    metrics: CompanyDashboardMetricsRead
    admins: list[CompanyAdminSummaryRead]
    history: list[CompanyStatusHistoryRead]


class CompanyActionResponse(BaseModel):
    message: str
    company: CompanyListItemRead


class CompanyUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    sector: str | None = Field(default=None, min_length=2, max_length=120)
    city: str | None = Field(default=None, min_length=2, max_length=120)
    address_line: str | None = Field(default=None, max_length=255)
    region: str | None = Field(default=None, max_length=120)
    postal_code: str | None = Field(default=None, max_length=40)
    country: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, min_length=6, max_length=30)
    ice: str | None = Field(default=None, max_length=80)
    rc: str | None = Field(default=None, max_length=80)
    tax_id: str | None = Field(default=None, max_length=80)
    cnss: str | None = Field(default=None, max_length=80)
    patente: str | None = Field(default=None, max_length=80)
    website: str | None = Field(default=None, max_length=255)
    estimated_phone_lines: int | None = Field(default=None, ge=0)
    employees_count: int | None = Field(default=None, ge=0)
    operators: list[str] | None = None
    coverage_zones: list[str] | None = None


class CompanyStatusCommentRequest(BaseModel):
    comment: str | None = Field(default=None, max_length=1_500)


class CompanyAuditLogListResponse(BaseModel):
    total: int
    offset: int
    limit: int
    items: list[CompanyStatusHistoryRead]

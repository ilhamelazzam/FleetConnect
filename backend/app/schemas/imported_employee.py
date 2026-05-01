from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ImportedEmployeeStatus = Literal["active", "inactive", "suspended"]
EmployeeImportRowStatus = Literal["importable", "incomplete", "error"]
EmployeeImportIssueSeverity = Literal["warning", "error"]
EmployeeImportMappingConfidence = Literal["none", "high", "manual"]
EmployeeImportSuggestionAction = Literal[
    "apply_default_value",
    "auto_fix",
    "review_mapping",
    "complete_after_import",
    "none",
]


class ImportedEmployeeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    identity_key: str
    email: str | None
    employee_identifier: str | None
    employee_code: str | None
    department_name: str | None
    job_profile: str | None
    status: ImportedEmployeeStatus
    source_filename: str | None
    source_format: str | None
    created_at: datetime
    updated_at: datetime


class ImportedEmployeeListRead(BaseModel):
    total: int
    offset: int
    limit: int
    items: list[ImportedEmployeeRead]


class EmployeeImportRecognizedColumnRead(BaseModel):
    field_name: str
    source_column: str


class EmployeeImportIssueRead(BaseModel):
    code: str
    severity: EmployeeImportIssueSeverity
    message: str
    field_name: str | None = None
    fixable: bool = False


class EmployeeImportFieldMappingRead(BaseModel):
    field_name: str
    label: str
    source_column: str | None = None
    required: bool = False
    confidence: EmployeeImportMappingConfidence = "none"
    manually_assigned: bool = False
    suggested_columns: list[str] = Field(default_factory=list)
    helper_text: str | None = None


class EmployeeImportSuggestionRead(BaseModel):
    id: str
    title: str
    description: str
    action_label: str | None = None
    action_type: EmployeeImportSuggestionAction = "none"
    target_field: str | None = None
    suggested_value: str | None = None
    affected_rows: int = Field(default=0, ge=0)


class EmployeeImportPreviewRowRead(BaseModel):
    row_number: int = Field(ge=1)
    full_name: str | None = None
    email: str | None = None
    employee_identifier: str | None = None
    employee_code: str | None = None
    department_name: str | None = None
    job_profile: str | None = None
    status: ImportedEmployeeStatus = "active"
    row_status: EmployeeImportRowStatus = "importable"
    issues: list[EmployeeImportIssueRead] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    duplicate_reason: str | None = None


class EmployeeImportPreviewRead(BaseModel):
    file_name: str
    detected_format: Literal["csv", "xlsx"]
    total_rows: int = Field(ge=0)
    valid_rows: int = Field(ge=0)
    ready_rows: int = Field(ge=0)
    incomplete_rows: int = Field(ge=0)
    invalid_rows: int = Field(ge=0)
    duplicate_rows: int = Field(ge=0)
    error_rows: int = Field(ge=0)
    quality_score: int = Field(default=0, ge=0, le=100)
    anomalies_count: int = Field(default=0, ge=0)
    fixable_anomalies: int = Field(default=0, ge=0)
    global_notice: str | None = None
    recognized_columns: list[EmployeeImportRecognizedColumnRead] = Field(default_factory=list)
    available_columns: list[str] = Field(default_factory=list)
    field_mappings: list[EmployeeImportFieldMappingRead] = Field(default_factory=list)
    missing_required_fields: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    suggestions: list[EmployeeImportSuggestionRead] = Field(default_factory=list)
    preview_rows: list[EmployeeImportPreviewRowRead] = Field(default_factory=list)


class EmployeeImportSummaryRead(BaseModel):
    file_name: str
    detected_format: Literal["csv", "xlsx"]
    total_rows: int = Field(ge=0)
    imported_count: int = Field(ge=0)
    incomplete_count: int = Field(ge=0)
    skipped_count: int = Field(ge=0)
    duplicate_count: int = Field(ge=0)
    invalid_count: int = Field(ge=0)
    rejected_count: int = Field(ge=0)
    quality_score: int = Field(default=0, ge=0, le=100)
    recognized_columns: list[EmployeeImportRecognizedColumnRead] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class EmployeeImportRowOverride(BaseModel):
    row_number: int = Field(ge=1)
    full_name: str | None = None
    email: str | None = None
    department_name: str | None = None
    job_profile: str | None = None
    employee_identifier: str | None = None
    employee_code: str | None = None
    status: ImportedEmployeeStatus | None = None


class EmployeeImportOptions(BaseModel):
    mapping_overrides: dict[str, str | None] = Field(default_factory=dict)
    row_overrides: list[EmployeeImportRowOverride] = Field(default_factory=list)
    default_values: dict[str, str | None] = Field(default_factory=dict)
    auto_fix_enabled: bool = False

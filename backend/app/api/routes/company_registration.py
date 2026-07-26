import logging
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Path, Query, UploadFile, status
from fastapi.responses import FileResponse

from app.core.config import get_settings
from app.core.dependencies import (
    CurrentSuperAdminUser,
    DEFAULT_PAGE_SIZE,
    DbSession,
    PaginationLimit,
    PaginationOffset,
)
from app.schemas.company_registration import (
    CompanyAuditLogListResponse,
    CompanyDashboardRead,
    CompanyRegistrationDeleteRequest,
    CompanyRegistrationEmailEligibilityRead,
    CompanyLifecycleStatus,
    CompanyListResponse,
    CompanyRegistrationActionResponse,
    CompanyRegistrationInfoRequest,
    CompanyRegistrationOverviewRead,
    CompanyRegistrationRejectRequest,
    CompanyRegistrationReopenRequest,
    CompanyRegistrationRequestDetailRead,
    CompanyRegistrationRequestListResponse,
    CompanyRegistrationRestoreRequest,
    CompanyRegistrationStatus,
    CompanyRegistrationSubmitResponse,
)
from app.services.company_registration_service import (
    approve_company_registration_request,
    build_submission_response_message,
    build_company_dashboard,
    build_company_list_response,
    build_company_registration_overview,
    build_request_detail,
    build_request_summary,
    can_create_request,
    create_company_registration_request,
    get_company_or_404,
    get_request_or_404,
    guess_document_media_type,
    list_companies,
    list_company_audit_logs,
    list_company_registration_requests,
    normalize_coverage_zones,
    request_more_company_registration_information,
    reopen_company_registration_request,
    reject_company_registration_request,
    restore_request,
    resolve_stored_document_path,
    soft_delete_request,
)

router = APIRouter(tags=["company-registration"])
settings = get_settings()
logger = logging.getLogger(__name__)


@router.post(
    "/company-registration/request",
    response_model=CompanyRegistrationSubmitResponse,
    status_code=status.HTTP_201_CREATED,
)
async def submit_company_registration_request(
    db: DbSession,
    responsible_full_name: Annotated[str, Form(min_length=2, max_length=120)],
    responsible_phone: Annotated[str, Form(min_length=6, max_length=30)],
    job_title: Annotated[str, Form(min_length=2, max_length=120)],
    requested_role: Annotated[str, Form(pattern="^(ADMIN|MANAGER|ANALYST)$")],
    responsible_email: Annotated[str, Form(min_length=5, max_length=255)],
    password: Annotated[str, Form(min_length=8, max_length=128)],
    company_name: Annotated[str, Form(min_length=2, max_length=160)],
    sector: Annotated[str, Form(min_length=2, max_length=120)],
    city: Annotated[str, Form(min_length=2, max_length=120)],
    company_phone: Annotated[str, Form(min_length=6, max_length=30)],
    ice: Annotated[str | None, Form(max_length=80)] = None,
    rc: Annotated[str | None, Form(max_length=80)] = None,
    tax_id: Annotated[str | None, Form(max_length=80)] = None,
    cnss: Annotated[str | None, Form(max_length=80)] = None,
    patente: Annotated[str | None, Form(max_length=80)] = None,
    website: Annotated[str | None, Form(max_length=255)] = None,
    estimated_phone_lines: Annotated[int, Form()] = 0,
    employees_count: Annotated[int, Form()] = 0,
    operators: Annotated[list[str], Form()] = [],
    coverage_zones: Annotated[str, Form(min_length=2)] = "",
    address_line: Annotated[str | None, Form(max_length=255)] = None,
    region: Annotated[str | None, Form(max_length=120)] = None,
    postal_code: Annotated[str | None, Form(max_length=40)] = None,
    country: Annotated[str | None, Form(max_length=120)] = None,
    latitude: Annotated[float | None, Form()] = None,
    longitude: Annotated[float | None, Form()] = None,
    logo: UploadFile | None = File(default=None),
    legal_representative_cin: UploadFile | None = File(default=None),
    commercial_register: UploadFile | None = File(default=None),
    fiscal_document: UploadFile | None = File(default=None),
    company_stamp: UploadFile | None = File(default=None),
    ) -> CompanyRegistrationSubmitResponse:
    normalized_email = responsible_email.strip().lower()
    logger.info(
        "event=company_registration_endpoint step=request_received email=%s company_name=%s",
        normalized_email,
        company_name.strip(),
    )
    logger.info(
        "event=company_registration_endpoint step=validation_passed email=%s requested_role=%s",
        normalized_email,
        requested_role,
    )
    registration_request = create_company_registration_request(
        db,
        responsible_full_name=responsible_full_name,
        responsible_phone=responsible_phone,
        job_title=job_title,
        requested_role=requested_role,
        responsible_email=responsible_email,
        password=password,
        company_name=company_name,
        sector=sector,
        city=city,
        address_line=address_line,
        region=region,
        postal_code=postal_code,
        country=country,
        latitude=latitude,
        longitude=longitude,
        company_phone=company_phone,
        ice=ice,
        rc=rc,
        tax_id=tax_id,
        cnss=cnss,
        patente=patente,
        website=website,
        estimated_phone_lines=estimated_phone_lines,
        employees_count=employees_count,
        operators=operators,
        coverage_zones=normalize_coverage_zones(coverage_zones),
        logo_file=logo,
        legal_representative_cin_file=legal_representative_cin,
        commercial_register_file=commercial_register,
        fiscal_document_file=fiscal_document,
        company_stamp_file=company_stamp,
    )
    logger.info(
        "event=company_registration_endpoint step=request_created request_id=%s status=%s email=%s",
        registration_request.id,
        registration_request.status,
        registration_request.responsible_email,
    )
    return CompanyRegistrationSubmitResponse(
        message=build_submission_response_message(registration_request),
        request_id=registration_request.id,
        status=registration_request.status,
        previous_request_id=registration_request.previous_request_id,
        resubmission_number=registration_request.resubmission_number,
    )


@router.get(
    "/company-registration/request-eligibility",
    response_model=CompanyRegistrationEmailEligibilityRead,
)
def read_company_registration_email_eligibility(
    db: DbSession,
    email: Annotated[str, Query(min_length=5, max_length=255)],
) -> CompanyRegistrationEmailEligibilityRead:
    eligibility = can_create_request(db, email)
    return CompanyRegistrationEmailEligibilityRead(
        can_submit=eligibility.can_submit,
        reason=eligibility.reason,  # type: ignore[arg-type]
        message=eligibility.message,
        previous_request_id=eligibility.previous_request_id,
    )


@router.get(
    "/admin/company-registration/overview",
    response_model=CompanyRegistrationOverviewRead,
)
def read_company_registration_overview(
    db: DbSession,
    _: CurrentSuperAdminUser,
) -> CompanyRegistrationOverviewRead:
    return build_company_registration_overview(db)


@router.get(
    "/admin/company-registration/requests",
    response_model=CompanyRegistrationRequestListResponse,
)
def read_company_registration_requests(
    db: DbSession,
    _: CurrentSuperAdminUser,
    offset: PaginationOffset = 0,
    limit: PaginationLimit = DEFAULT_PAGE_SIZE,
    status_filter: Annotated[
        CompanyRegistrationStatus | None,
        Query(alias="status"),
    ] = None,
    search: Annotated[str | None, Query(max_length=160)] = None,
    sort_by: Annotated[str, Query(pattern="^(date|company|status)$")] = "date",
    sort_order: Annotated[str, Query(pattern="^(asc|desc)$")] = "desc",
    include_deleted: bool = False,
    deleted_only: bool = False,
) -> CompanyRegistrationRequestListResponse:
    total, items = list_company_registration_requests(
        db,
        offset=offset,
        limit=limit,
        status_filter=status_filter,
        search=search,
        sort_by=sort_by,
        sort_order=sort_order,
        include_deleted=include_deleted,
        deleted_only=deleted_only,
    )
    return CompanyRegistrationRequestListResponse(
        total=total,
        offset=offset,
        limit=limit,
        items=[build_request_summary(item) for item in items],
    )


@router.get(
    "/admin/company-registration/requests/{request_id}",
    response_model=CompanyRegistrationRequestDetailRead,
)
def read_company_registration_request(
    request_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    _: CurrentSuperAdminUser,
) -> CompanyRegistrationRequestDetailRead:
    registration_request = get_request_or_404(db, request_id)
    return build_request_detail(registration_request, api_prefix=settings.api_v1_prefix)


@router.get("/admin/company-registration/requests/{request_id}/documents/{document_key}")
def download_company_registration_document(
    request_id: Annotated[int, Path(gt=0)],
    document_key: Annotated[str, Path()],
    db: DbSession,
    _: CurrentSuperAdminUser,
) -> FileResponse:
    registration_request = get_request_or_404(db, request_id)
    if registration_request.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    document_paths = {
        "logo": registration_request.logo_path,
        "legal_representative_cin": registration_request.legal_representative_cin_path,
        "commercial_register": registration_request.commercial_register_path,
        "fiscal_document": registration_request.fiscal_document_path,
        "company_stamp": registration_request.company_stamp_path,
    }
    relative_path = document_paths.get(document_key)
    if not relative_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    resolved_path = resolve_stored_document_path(relative_path)
    if not resolved_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    return FileResponse(
        resolved_path,
        media_type=guess_document_media_type(relative_path),
        filename=resolved_path.name,
    )


@router.post(
    "/admin/company-registration/requests/{request_id}/approve",
    response_model=CompanyRegistrationActionResponse,
)
@router.patch(
    "/admin/company-registration/requests/{request_id}/approve",
    response_model=CompanyRegistrationActionResponse,
)
@router.patch(
    "/admin/company-requests/{request_id}/approve",
    response_model=CompanyRegistrationActionResponse,
)
def approve_request(
    request_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    current_user: CurrentSuperAdminUser,
) -> CompanyRegistrationActionResponse:
    registration_request = approve_company_registration_request(
        db,
        get_request_or_404(db, request_id),
        reviewer=current_user,
    )
    return CompanyRegistrationActionResponse(
        message="La demande a ete approuvee et le compte entreprise a ete cree.",
        request=build_request_detail(registration_request, api_prefix=settings.api_v1_prefix),
    )


@router.patch(
    "/admin/company-registration/requests/{request_id}/reopen",
    response_model=CompanyRegistrationActionResponse,
)
@router.patch(
    "/admin/company-requests/{request_id}/reopen",
    response_model=CompanyRegistrationActionResponse,
)
def reopen_request(
    request_id: Annotated[int, Path(gt=0)],
    payload: CompanyRegistrationReopenRequest,
    db: DbSession,
    current_user: CurrentSuperAdminUser,
) -> CompanyRegistrationActionResponse:
    registration_request = reopen_company_registration_request(
        db,
        get_request_or_404(db, request_id),
        reviewer=current_user,
        reason=payload.reason,
    )
    return CompanyRegistrationActionResponse(
        message="La demande est de nouveau en cours d'examen.",
        request=build_request_detail(registration_request, api_prefix=settings.api_v1_prefix),
    )


@router.post(
    "/admin/company-registration/requests/{request_id}/reject",
    response_model=CompanyRegistrationActionResponse,
)
def reject_request(
    request_id: Annotated[int, Path(gt=0)],
    payload: CompanyRegistrationRejectRequest,
    db: DbSession,
    current_user: CurrentSuperAdminUser,
) -> CompanyRegistrationActionResponse:
    registration_request = reject_company_registration_request(
        db,
        get_request_or_404(db, request_id),
        reviewer=current_user,
        rejection_reason=payload.rejection_reason,
    )
    return CompanyRegistrationActionResponse(
        message="La demande a ete refusee et l'entreprise a ete notifiee.",
        request=build_request_detail(registration_request, api_prefix=settings.api_v1_prefix),
    )


@router.patch(
    "/admin/company-registration/requests/{request_id}/delete",
    response_model=CompanyRegistrationActionResponse,
)
def delete_request(
    request_id: Annotated[int, Path(gt=0)],
    payload: CompanyRegistrationDeleteRequest,
    db: DbSession,
    current_user: CurrentSuperAdminUser,
) -> CompanyRegistrationActionResponse:
    registration_request = soft_delete_request(
        db,
        get_request_or_404(db, request_id),
        reviewer=current_user,
        force=payload.force,
        reason=payload.reason,
    )
    return CompanyRegistrationActionResponse(
        message="La demande a ete supprimee de la liste active.",
        request=build_request_detail(registration_request, api_prefix=settings.api_v1_prefix),
    )


@router.patch(
    "/admin/company-registration/requests/{request_id}/restore",
    response_model=CompanyRegistrationActionResponse,
)
def restore_deleted_request(
    request_id: Annotated[int, Path(gt=0)],
    payload: CompanyRegistrationRestoreRequest,
    db: DbSession,
    current_user: CurrentSuperAdminUser,
) -> CompanyRegistrationActionResponse:
    registration_request = restore_request(
        db,
        get_request_or_404(db, request_id),
        reviewer=current_user,
        reason=payload.reason,
    )
    return CompanyRegistrationActionResponse(
        message="La demande a ete restauree dans la liste active.",
        request=build_request_detail(registration_request, api_prefix=settings.api_v1_prefix),
    )


@router.post(
    "/admin/company-registration/requests/{request_id}/request-information",
    response_model=CompanyRegistrationActionResponse,
)
def request_information_for_company_registration(
    request_id: Annotated[int, Path(gt=0)],
    payload: CompanyRegistrationInfoRequest,
    db: DbSession,
    current_user: CurrentSuperAdminUser,
) -> CompanyRegistrationActionResponse:
    registration_request = request_more_company_registration_information(
        db,
        get_request_or_404(db, request_id),
        reviewer=current_user,
        comment=payload.comment,
    )
    return CompanyRegistrationActionResponse(
        message="La demande d'informations complementaires a ete envoyee.",
        request=build_request_detail(registration_request, api_prefix=settings.api_v1_prefix),
    )


@router.get("/admin/companies", response_model=CompanyListResponse)
def read_companies(
    db: DbSession,
    _: CurrentSuperAdminUser,
    offset: PaginationOffset = 0,
    limit: PaginationLimit = DEFAULT_PAGE_SIZE,
    search: Annotated[str | None, Query(max_length=160)] = None,
    status_filter: Annotated[
        CompanyLifecycleStatus | None,
        Query(alias="status"),
    ] = None,
    sort_by: Annotated[str, Query(pattern="^(date|company|status)$")] = "date",
    sort_order: Annotated[str, Query(pattern="^(asc|desc)$")] = "desc",
) -> CompanyListResponse:
    total, companies = list_companies(
        db,
        offset=offset,
        limit=limit,
        search=search,
        status_filter=status_filter,
        sort_by=sort_by,
        sort_order=sort_order,
    )
    return build_company_list_response(
        companies,
        total=total,
        offset=offset,
        limit=limit,
        api_prefix=settings.api_v1_prefix,
    )


@router.get("/admin/companies/{company_id}/dashboard", response_model=CompanyDashboardRead)
def read_company_dashboard(
    company_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    _: CurrentSuperAdminUser,
) -> CompanyDashboardRead:
    return build_company_dashboard(
        get_company_or_404(db, company_id),
        api_prefix=settings.api_v1_prefix,
    )


@router.get("/admin/companies/{company_id}/logo")
def download_company_logo(
    company_id: Annotated[int, Path(gt=0)],
    db: DbSession,
    _: CurrentSuperAdminUser,
) -> FileResponse:
    company = get_company_or_404(db, company_id)
    if not company.logo_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    resolved_path = resolve_stored_document_path(company.logo_path)
    if not resolved_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    return FileResponse(
        resolved_path,
        media_type=guess_document_media_type(company.logo_path),
        filename=resolved_path.name,
    )


@router.get(
    "/admin/company-registration/audit-logs",
    response_model=CompanyAuditLogListResponse,
)
def read_company_registration_audit_logs(
    db: DbSession,
    _: CurrentSuperAdminUser,
    offset: PaginationOffset = 0,
    limit: PaginationLimit = DEFAULT_PAGE_SIZE,
    action_filter: Annotated[str | None, Query(alias="action", max_length=80)] = None,
    search: Annotated[str | None, Query(max_length=160)] = None,
) -> CompanyAuditLogListResponse:
    return list_company_audit_logs(
        db,
        offset=offset,
        limit=limit,
        action_filter=action_filter,
        search=search,
    )

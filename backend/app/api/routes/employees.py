from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, status
from pydantic import ValidationError

from app.core.dependencies import (
    DEFAULT_PAGE_SIZE,
    CurrentManagerOrAdminUser,
    DbSession,
    PaginationLimit,
    PaginationOffset,
)
from app.schemas.imported_employee import (
    EmployeeImportOptions,
    EmployeeImportPreviewRead,
    EmployeeImportSummaryRead,
    ImportedEmployeeListRead,
)
from app.services.imported_employee_service import (
    import_employees,
    list_imported_employees,
    preview_employee_import,
)

router = APIRouter(prefix="/employees", tags=["employees"])


def _parse_import_options(options_json: str | None) -> EmployeeImportOptions:
    if not options_json:
        return EmployeeImportOptions()

    try:
        return EmployeeImportOptions.model_validate_json(options_json)
    except ValidationError as exc:  # pragma: no cover - request validation guard
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Options d'import invalides.",
        ) from exc


@router.get("/", response_model=ImportedEmployeeListRead)
def read_imported_employees(
    db: DbSession,
    _: CurrentManagerOrAdminUser,
    offset: PaginationOffset = 0,
    limit: PaginationLimit = DEFAULT_PAGE_SIZE,
    search: Annotated[str | None, Query()] = None,
    status: Annotated[str | None, Query()] = None,
) -> ImportedEmployeeListRead:
    return ImportedEmployeeListRead(**list_imported_employees(
        db,
        offset=offset,
        limit=limit,
        search=search,
        status_filter=status,
    ))


@router.post("/import/preview", response_model=EmployeeImportPreviewRead)
async def preview_imported_employee_file(
    db: DbSession,
    _: CurrentManagerOrAdminUser,
    file: UploadFile = File(...),
    options_json: Annotated[str | None, Form()] = None,
) -> EmployeeImportPreviewRead:
    content = await file.read()
    file_name = file.filename or "employees.csv"
    options = _parse_import_options(options_json)
    return EmployeeImportPreviewRead(
        **preview_employee_import(
            db,
            file_name=file_name,
            content=content,
            options=options,
        )
    )


@router.post("/import", response_model=EmployeeImportSummaryRead)
async def import_employee_file(
    db: DbSession,
    _: CurrentManagerOrAdminUser,
    file: UploadFile = File(...),
    options_json: Annotated[str | None, Form()] = None,
) -> EmployeeImportSummaryRead:
    content = await file.read()
    file_name = file.filename or "employees.csv"
    options = _parse_import_options(options_json)
    return EmployeeImportSummaryRead(
        **import_employees(
            db,
            file_name=file_name,
            content=content,
            options=options,
        )
    )

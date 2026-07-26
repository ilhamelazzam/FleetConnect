from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse

from app.core.dependencies import CurrentActiveUser, DbSession
from app.schemas.chat import ChatErrorResponse
from app.schemas.reports import ReportGenerateRequest, ReportGenerateResponse
from app.services.chat_service import ChatDataUnavailableError, ChatServiceError
from app.services.report_generation_service import (
    ReportDependenciesUnavailableError,
    generate_ai_pdf_report,
    get_generated_report_pdf_path,
)

router = APIRouter(prefix="/reports", tags=["reports"])


@router.post("/generate", response_model=ReportGenerateResponse)
async def generate_report(
    payload: ReportGenerateRequest,
    db: DbSession,
    _: CurrentActiveUser,
) -> ReportGenerateResponse | JSONResponse:
    try:
        return await generate_ai_pdf_report(db, payload)
    except ChatServiceError as exc:
        return JSONResponse(
            status_code=exc.status_code,
            content=ChatErrorResponse(
                code=exc.code,
                error_type=exc.code.lower(),
                message=exc.user_message,
            ).model_dump(mode="json"),
        )
    except ChatDataUnavailableError as exc:
        return JSONResponse(
            status_code=503,
            content=ChatErrorResponse(
                code="SERVER_ERROR",
                error_type="data_unavailable",
                message=str(exc),
            ).model_dump(mode="json"),
        )
    except ReportDependenciesUnavailableError as exc:
        return JSONResponse(
            status_code=503,
            content=ChatErrorResponse(
                code="SERVER_ERROR",
                error_type="dependency_unavailable",
                message=str(exc),
            ).model_dump(mode="json"),
        )


@router.get("/{report_id}/pdf")
def download_generated_report_pdf(
    report_id: str,
    _: CurrentActiveUser,
) -> FileResponse:
    pdf_path = get_generated_report_pdf_path(report_id)
    if pdf_path is None:
        raise HTTPException(status_code=404, detail="Rapport PDF introuvable.")

    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=f"rapport-ia-{report_id}.pdf",
    )

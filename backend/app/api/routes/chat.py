import inspect
import json
import logging

from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import ValidationError

from app.core.dependencies import CurrentActiveUser, DbSession
from app.schemas.chat import (
    ChatContextMessage,
    ChatErrorResponse,
    ChatImageResponse,
    ChatRequest,
    ChatResponse,
    ChatActionPlanRequest,
    ChatActionPlanResponse,
    ExplainabilityRequest,
    ExplainabilityResponse,
    ExplainRecommendationRequest,
    ExplainRecommendationResponse,
    ExecutiveReportRequest,
    ExecutiveReportResponse,
    ChatVoiceHealthResponse,
    ChatVoiceRespondResponse,
    ChatVoiceSpeakRequest,
    ChatVoiceSpeakResponse,
    ChatVoiceTranscriptionResponse,
)
from app.services.chat_service import (
    ChatServiceError,
    ChatDataUnavailableError,
    generate_chat_response,
    generate_copilot_action_plan,
    stream_chat_response,
)
from app.services.business_answer_quality_service import polish_chat_image_response
from app.services.document_chat_service import generate_document_chat_response
from app.services.explainability_service import generate_explainability_response
from app.services.executive_report_service import generate_executive_report
from app.services.multimodal_chat_service import generate_image_chat_response
from app.services.recommendation_explainability_service import RecommendationExplainabilityService
from app.services.voice_conversation_service import (
    generate_voice_chat_response,
    stream_voice_chat_response,
)
from app.services.voice_service import (
    get_voice_transcription_health,
    synthesize_voice_response,
    transcribe_voice_message,
)

router = APIRouter(tags=["chat"])
CHAT_ROUTE_LOGGER = logging.getLogger("app.chat.route")
IMAGE_SERVICE_UNAVAILABLE_CODES = {"OLLAMA_OFFLINE", "VISION_UNAVAILABLE", "OCR_UNAVAILABLE"}


def _parse_history_json(history_json: str | None) -> list[ChatContextMessage]:
    if not history_json or not history_json.strip():
        return []

    try:
        raw_history = json.loads(history_json)
    except json.JSONDecodeError as exc:
        raise ValueError("Historique conversation invalide.") from exc

    if not isinstance(raw_history, list):
        raise ValueError("Historique conversation invalide.")

    try:
        return [ChatContextMessage.model_validate(item) for item in raw_history]
    except ValidationError as exc:
        raise ValueError("Historique conversation invalide.") from exc


def _build_image_error_response(exc: ChatServiceError) -> JSONResponse:
    error_type = (
        "service_unavailable"
        if exc.code in IMAGE_SERVICE_UNAVAILABLE_CODES and exc.status_code == 503
        else exc.code.lower()
    )
    fallback_answer = (
        "La lecture documentaire locale n'etait pas disponible ; relancez l'analyse pour une consolidation plus complete."
        if exc.code == "OCR_UNAVAILABLE"
        else "Le traitement approfondi n'etait pas disponible ; une nouvelle tentative permettra d'affiner la priorisation."
        if exc.code in IMAGE_SERVICE_UNAVAILABLE_CODES
        else "Relancez l'analyse ou utilisez une lecture de premier niveau pour obtenir une premiere priorisation."
        if exc.code == "TIMEOUT"
        else None
    )
    return JSONResponse(
        status_code=exc.status_code,
        content=ChatErrorResponse(
            code=exc.code,
            error_type=error_type,
            message=exc.user_message,
            fallback_answer=fallback_answer,
            details=exc.details,
        ).model_dump(mode="json"),
    )


def _build_chat_error_response(exc: ChatServiceError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=ChatErrorResponse(
            code=exc.code,
            error_type=exc.code.lower(),
            message=exc.user_message,
            details=exc.details,
        ).model_dump(mode="json"),
    )


@router.post("", response_model=ChatResponse)
async def chat_with_local_model(
    payload: ChatRequest,
    db: DbSession,
    _: CurrentActiveUser,
) -> ChatResponse | JSONResponse:
    try:
        return await generate_chat_response(
            db,
            question=payload.question,
            history=payload.history,
        )
    except ChatServiceError as exc:
        return JSONResponse(
            status_code=exc.status_code,
            content=ChatErrorResponse(
                code=exc.code,
                error_type=exc.code.lower(),
                message=exc.user_message,
            ).model_dump(mode="json", exclude_none=True),
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


@router.post("/stream")
async def stream_chat_with_local_model(
    request: Request,
    payload: ChatRequest,
    db: DbSession,
    _: CurrentActiveUser,
) -> StreamingResponse:
    return StreamingResponse(
        stream_chat_response(
            request,
            db,
            question=payload.question,
            history=payload.history,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/executive-report", response_model=ExecutiveReportResponse)
async def executive_report_with_local_model(
    payload: ExecutiveReportRequest,
    db: DbSession,
    _: CurrentActiveUser,
) -> ExecutiveReportResponse | JSONResponse:
    try:
        return await generate_executive_report(
            db,
            history=payload.history,
            image_analyses=payload.image_analyses,
            conversation_id=payload.conversation_id,
        )
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


@router.post("/explain", response_model=ExplainabilityResponse)
async def explain_with_local_model(
    payload: ExplainabilityRequest,
    db: DbSession,
    _: CurrentActiveUser,
) -> ExplainabilityResponse | JSONResponse:
    try:
        return await generate_explainability_response(
            db,
            payload,
        )
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


@router.post("/explain-recommendation", response_model=ExplainRecommendationResponse)
async def explain_recommendation_with_local_model(
    payload: ExplainRecommendationRequest,
    db: DbSession,
    _: CurrentActiveUser,
) -> ExplainRecommendationResponse | JSONResponse:
    try:
        service = RecommendationExplainabilityService(db)
        return await service.explain_recommendation(payload)
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


@router.post("/copilot/actions", response_model=ChatActionPlanResponse)
async def copilot_action_plan(
    payload: ChatActionPlanRequest,
    db: DbSession,
    _: CurrentActiveUser,
) -> ChatActionPlanResponse | JSONResponse:
    try:
        response = generate_copilot_action_plan(db, history=payload.history)
        if inspect.isawaitable(response):
            response = await response
        return response
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


@router.post("/image", response_model=ChatImageResponse)
async def chat_with_image(
    request: Request,
    db: DbSession,
    _: CurrentActiveUser,
    image: UploadFile = File(...),
    question: str = Form(...),
    analysis_mode: str = Form(default="advanced"),
    conversation_id: str | None = Form(default=None),
    history_json: str | None = Form(default=None),
) -> ChatImageResponse | JSONResponse:
    try:
        history = _parse_history_json(history_json)
        CHAT_ROUTE_LOGGER.info(
            "event=image_route_received filename=%s content_type=%s conversation_id=%s analysis_mode=%s",
            image.filename,
            image.content_type,
            conversation_id,
            analysis_mode,
        )
        image_bytes = await image.read()
        CHAT_ROUTE_LOGGER.info(
            "event=image_route_payload_ready filename=%s size_bytes=%s has_history=%s",
            image.filename,
            len(image_bytes),
            bool(history),
        )
        image_request_kwargs = {
            "question": question,
            "history": history,
            "image_bytes": image_bytes,
            "filename": image.filename,
            "content_type": image.content_type,
            "conversation_id": conversation_id,
        }
        if analysis_mode.strip().lower() != "advanced":
            image_request_kwargs["analysis_mode"] = analysis_mode
        image_response = await generate_image_chat_response(
            request,
            db,
            **image_request_kwargs,
        )
        return polish_chat_image_response(image_response)
    except ValueError as exc:
        return JSONResponse(
            status_code=422,
            content=ChatErrorResponse(
                code="MULTIPART_INVALID",
                error_type="multipart_invalid",
                message=str(exc),
            ).model_dump(mode="json"),
        )
    except ChatServiceError as exc:
        CHAT_ROUTE_LOGGER.warning(
            "event=image_route_failed code=%s status=%s message=%s analysis_mode=%s filename=%s",
            exc.code,
            exc.status_code,
            exc.user_message,
            analysis_mode,
            image.filename,
        )
        return _build_image_error_response(exc)
    except ChatDataUnavailableError as exc:
        return JSONResponse(
            status_code=503,
            content=ChatErrorResponse(
                code="SERVER_ERROR",
                error_type="data_unavailable",
                message=str(exc),
            ).model_dump(mode="json"),
        )


async def _handle_uploaded_document(
    request: Request,
    db: DbSession,
    upload: UploadFile,
    question: str,
    analysis_mode: str = "advanced",
    conversation_id: str | None = None,
    history_json: str | None = None,
) -> ChatImageResponse | JSONResponse:
    try:
        history = _parse_history_json(history_json)
        CHAT_ROUTE_LOGGER.info(
            "event=document_route_received filename=%s content_type=%s conversation_id=%s analysis_mode=%s",
            upload.filename,
            upload.content_type,
            conversation_id,
            analysis_mode,
        )
        document_bytes = await upload.read()
        document_response = await generate_document_chat_response(
            request,
            db,
            question=question,
            history=history,
            document_bytes=document_bytes,
            filename=upload.filename,
            content_type=upload.content_type,
            analysis_mode=analysis_mode,
            conversation_id=conversation_id,
        )
        return polish_chat_image_response(document_response)
    except ValueError as exc:
        return JSONResponse(
            status_code=422,
            content=ChatErrorResponse(
                code="MULTIPART_INVALID",
                error_type="multipart_invalid",
                message=str(exc),
            ).model_dump(mode="json"),
        )
    except ChatServiceError as exc:
        CHAT_ROUTE_LOGGER.warning(
            "event=document_route_failed code=%s status=%s message=%s filename=%s",
            exc.code,
            exc.status_code,
            exc.user_message,
            upload.filename,
        )
        return _build_image_error_response(exc)
    except ChatDataUnavailableError as exc:
        return JSONResponse(
            status_code=503,
            content=ChatErrorResponse(
                code="SERVER_ERROR",
                error_type="data_unavailable",
                message=str(exc),
            ).model_dump(mode="json"),
        )


@router.post("/upload-document", response_model=ChatImageResponse)
async def chat_with_document(
    request: Request,
    db: DbSession,
    _: CurrentActiveUser,
    document: UploadFile = File(...),
    question: str = Form(...),
    analysis_mode: str = Form(default="advanced"),
    conversation_id: str | None = Form(default=None),
    history_json: str | None = Form(default=None),
) -> ChatImageResponse | JSONResponse:
    return await _handle_uploaded_document(
        request,
        db,
        document,
        question=question,
        analysis_mode=analysis_mode,
        conversation_id=conversation_id,
        history_json=history_json,
    )


@router.post("/upload-pdf", response_model=ChatImageResponse)
async def chat_with_pdf(
    request: Request,
    db: DbSession,
    _: CurrentActiveUser,
    pdf: UploadFile = File(...),
    question: str = Form(...),
    analysis_mode: str = Form(default="advanced"),
    conversation_id: str | None = Form(default=None),
    history_json: str | None = Form(default=None),
) -> ChatImageResponse | JSONResponse:
    return await _handle_uploaded_document(
        request,
        db,
        pdf,
        question=question,
        analysis_mode=analysis_mode,
        conversation_id=conversation_id,
        history_json=history_json,
    )


@router.post("/voice/transcribe", response_model=ChatVoiceTranscriptionResponse)
async def transcribe_voice(
    request: Request,
    _: CurrentActiveUser,
    audio: UploadFile = File(...),
) -> ChatVoiceTranscriptionResponse | JSONResponse:
    try:
        audio_bytes = await audio.read()
        CHAT_ROUTE_LOGGER.info(
            "event=voice_route_received filename=%s upload_content_type=%s request_content_type=%s request_content_length=%s size_bytes=%s",
            audio.filename,
            audio.content_type,
            request.headers.get("content-type"),
            request.headers.get("content-length"),
            len(audio_bytes),
        )
        transcription = await transcribe_voice_message(
            audio_bytes,
            filename=audio.filename,
            content_type=audio.content_type,
        )
        CHAT_ROUTE_LOGGER.info(
            "event=voice_route_completed filename=%s provider=%s model=%s language=%s confidence=%s transcript_chars=%s duration_ms=%s audio_duration_ms=%s",
            audio.filename,
            transcription.provider,
            transcription.model,
            transcription.language,
            round(transcription.confidence, 4),
            len(transcription.transcript),
            transcription.duration_ms,
            transcription.audio_duration_ms,
        )
        return ChatVoiceTranscriptionResponse(
            text=transcription.transcript,
            transcript=transcription.transcript,
            language=transcription.language,
            confidence=transcription.confidence,
            provider=transcription.provider,
            model=transcription.model,
            duration_ms=transcription.duration_ms,
            audio_duration_ms=transcription.audio_duration_ms,
        )
    except ChatServiceError as exc:
        CHAT_ROUTE_LOGGER.warning(
            "event=voice_route_failed filename=%s code=%s status=%s message=%s details=%s",
            audio.filename,
            exc.code,
            exc.status_code,
            exc.user_message,
            exc.details or {},
        )
        return _build_chat_error_response(exc)
    except Exception as exc:
        CHAT_ROUTE_LOGGER.exception(
            "event=voice_route_unexpected_error filename=%s error_type=%s error=%s",
            audio.filename,
            type(exc).__name__,
            exc,
        )
        return JSONResponse(
            status_code=500,
            content=ChatErrorResponse(
                code="SERVER_ERROR",
                error_type="server_error",
                message="Une erreur inattendue est survenue pendant la transcription vocale.",
            ).model_dump(mode="json"),
        )


@router.get("/voice/health", response_model=ChatVoiceHealthResponse)
async def voice_health(_: CurrentActiveUser) -> ChatVoiceHealthResponse:
    health = get_voice_transcription_health(check_runtime=True)
    return ChatVoiceHealthResponse(
        enabled=health.enabled,
        ready=health.ready,
        status=health.status,
        provider=health.provider,
        model=health.model,
        language=health.language,
        device=health.device,
        compute_type=health.compute_type,
        runtime_available=health.runtime_available,
        model_loaded=health.model_loaded,
        ffmpeg_available=health.ffmpeg_available,
        message=health.message,
        details=health.details,
    )


@router.post("/voice/speak", response_model=ChatVoiceSpeakResponse)
async def speak_voice(
    payload: ChatVoiceSpeakRequest,
    _: CurrentActiveUser,
) -> ChatVoiceSpeakResponse | JSONResponse:
    try:
        CHAT_ROUTE_LOGGER.info(
            "event=voice_speak_route_received text_chars=%s",
            len(payload.text),
        )
        voice_result = await synthesize_voice_response(payload.text)
        return ChatVoiceSpeakResponse(
            audio_url=voice_result.audio_url,
            duration=voice_result.duration,
            format=voice_result.media_type,
        )
    except ChatServiceError as exc:
        return _build_chat_error_response(exc)


@router.post("/voice/respond", response_model=ChatVoiceRespondResponse)
async def respond_voice(
    request: Request,
    db: DbSession,
    _: CurrentActiveUser,
    audio: UploadFile | None = File(default=None),
    transcript: str | None = Form(default=None),
    conversation_id: str | None = Form(default=None),
    history_json: str | None = Form(default=None),
) -> ChatVoiceRespondResponse | JSONResponse:
    try:
        history = _parse_history_json(history_json)
        audio_bytes = await audio.read() if audio is not None else None
        CHAT_ROUTE_LOGGER.info(
            "event=voice_respond_route_received filename=%s upload_content_type=%s request_content_type=%s request_content_length=%s conversation_id=%s history_size=%s has_transcript=%s size_bytes=%s",
            audio.filename if audio is not None else None,
            audio.content_type if audio is not None else None,
            request.headers.get("content-type"),
            request.headers.get("content-length"),
            conversation_id,
            len(history),
            bool(transcript and transcript.strip()),
            len(audio_bytes) if audio_bytes is not None else 0,
        )
        voice_response = await generate_voice_chat_response(
            db,
            history=history,
            audio_bytes=audio_bytes,
            filename=audio.filename if audio is not None else None,
            content_type=audio.content_type if audio is not None else None,
            transcript=transcript,
        )
        return ChatVoiceRespondResponse(
            transcript=voice_response.transcript,
            language=voice_response.language,
            confidence=voice_response.confidence,
            answer=voice_response.answer.answer,
            audio_url=voice_response.speech.audio_url,
            duration=voice_response.speech.duration,
            format=voice_response.speech.media_type,
            model=voice_response.answer.model,
            sources=voice_response.answer.sources,
            summary_updated_at=voice_response.answer.summary_updated_at,
            cached=voice_response.answer.cached,
            fallback_used=voice_response.answer.fallback_used,
            duration_ms=voice_response.answer.duration_ms,
        )
    except ValueError as exc:
        return JSONResponse(
            status_code=422,
            content=ChatErrorResponse(
                code="MULTIPART_INVALID",
                error_type="multipart_invalid",
                message=str(exc),
            ).model_dump(mode="json"),
        )
    except ChatServiceError as exc:
        return _build_chat_error_response(exc)


@router.post("/voice/stream", response_model=None)
async def stream_voice(
    request: Request,
    db: DbSession,
    _: CurrentActiveUser,
    audio: UploadFile | None = File(default=None),
    transcript: str | None = Form(default=None),
    conversation_id: str | None = Form(default=None),
    history_json: str | None = Form(default=None),
) -> StreamingResponse:
    try:
        history = _parse_history_json(history_json)
        audio_bytes = await audio.read() if audio is not None else None
        CHAT_ROUTE_LOGGER.info(
            "event=voice_stream_route_received filename=%s upload_content_type=%s request_content_type=%s request_content_length=%s conversation_id=%s history_size=%s has_transcript=%s size_bytes=%s",
            audio.filename if audio is not None else None,
            audio.content_type if audio is not None else None,
            request.headers.get("content-type"),
            request.headers.get("content-length"),
            conversation_id,
            len(history),
            bool(transcript and transcript.strip()),
            len(audio_bytes) if audio_bytes is not None else 0,
        )
        return StreamingResponse(
            stream_voice_chat_response(
                request,
                db,
                history=history,
                audio_bytes=audio_bytes,
                filename=audio.filename if audio is not None else None,
                content_type=audio.content_type if audio is not None else None,
                transcript=transcript,
            ),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )
    except ValueError as exc:
        return JSONResponse(
            status_code=422,
            content=ChatErrorResponse(
                code="MULTIPART_INVALID",
                error_type="multipart_invalid",
                message=str(exc),
            ).model_dump(mode="json"),
        )

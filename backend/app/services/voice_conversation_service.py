from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session

from app.schemas.chat import ChatContextMessage, ChatResponse
from app.services.chat_service import (
    ChatServerError,
    ChatServiceError,
    RequestCancelledError,
    generate_chat_response,
    stream_chat_response,
)
from app.services.voice_service import (
    VoiceSpeechResult,
    VoiceTranscriptionResult,
    synthesize_voice_response,
    transcribe_voice_message,
)

VOICE_CONVERSATION_LOGGER = logging.getLogger("app.chat.voice.conversation")


@dataclass(frozen=True)
class VoiceConversationResponse:
    transcript: str
    language: str
    confidence: float
    answer: ChatResponse
    speech: VoiceSpeechResult


def _to_sse_event(event_name: str, payload: dict[str, Any]) -> str:
    return f"event: {event_name}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _parse_sse_event(raw_event: str) -> tuple[str, dict[str, Any]] | None:
    event_name = "message"
    data_lines: list[str] = []

    for line in raw_event.splitlines():
        if line.startswith("event:"):
            event_name = line[6:].strip() or "message"
        elif line.startswith("data:"):
            data_lines.append(line[5:].lstrip())

    if not data_lines:
        return None

    payload = json.loads("\n".join(data_lines))
    if not isinstance(payload, dict):
        return None

    return event_name, payload


def _normalize_transcript_text(value: str | None) -> str:
    return " ".join((value or "").split()).strip()[:4000]


async def _resolve_transcription(
    *,
    audio_bytes: bytes | None,
    filename: str | None,
    content_type: str | None,
    transcript: str | None,
) -> VoiceTranscriptionResult:
    normalized_transcript = _normalize_transcript_text(transcript)
    if normalized_transcript:
        VOICE_CONVERSATION_LOGGER.info(
            "event=voice_transcript_override_used transcript_chars=%s",
            len(normalized_transcript),
        )
        return VoiceTranscriptionResult(
            transcript=normalized_transcript,
            language="fr",
            confidence=1.0,
            provider="manual",
            model="manual",
        )

    if audio_bytes is None:
        raise ValueError("Audio ou transcription manquants.")

    VOICE_CONVERSATION_LOGGER.info(
        "event=voice_audio_transcription_requested filename=%s content_type=%s size_bytes=%s",
        filename,
        content_type,
        len(audio_bytes),
    )
    transcription = await transcribe_voice_message(
        audio_bytes,
        filename=filename,
        content_type=content_type,
    )
    VOICE_CONVERSATION_LOGGER.info(
        "event=voice_audio_transcription_resolved language=%s confidence=%s transcript_chars=%s",
        transcription.language,
        round(transcription.confidence, 4),
        len(transcription.transcript),
    )
    return transcription


async def generate_voice_chat_response(
    db: Session,
    *,
    history: list[ChatContextMessage],
    audio_bytes: bytes | None = None,
    filename: str | None = None,
    content_type: str | None = None,
    transcript: str | None = None,
) -> VoiceConversationResponse:
    transcription = await _resolve_transcription(
        audio_bytes=audio_bytes,
        filename=filename,
        content_type=content_type,
        transcript=transcript,
    )
    answer = await generate_chat_response(
        db,
        question=transcription.transcript,
        history=history,
    )
    speech = await synthesize_voice_response(answer.answer)
    return VoiceConversationResponse(
        transcript=transcription.transcript,
        language=transcription.language,
        confidence=transcription.confidence,
        answer=answer,
        speech=speech,
    )


async def stream_voice_chat_response(
    request: Request,
    db: Session,
    *,
    history: list[ChatContextMessage],
    audio_bytes: bytes | None = None,
    filename: str | None = None,
    content_type: str | None = None,
    transcript: str | None = None,
):
    try:
        yield _to_sse_event(
            "stage",
            {
                "stage": "transcribing",
                "label": "Transcription en cours...",
            },
        )

        transcription = await _resolve_transcription(
            audio_bytes=audio_bytes,
            filename=filename,
            content_type=content_type,
            transcript=transcript,
        )

        if await request.is_disconnected():
            raise RequestCancelledError()

        yield _to_sse_event(
            "transcript",
            {
                "text": transcription.transcript,
                "transcript": transcription.transcript,
                "language": transcription.language,
                "confidence": transcription.confidence,
                "provider": transcription.provider,
                "model": transcription.model,
                "duration_ms": transcription.duration_ms,
                "audio_duration_ms": transcription.audio_duration_ms,
            },
        )
        yield _to_sse_event(
            "stage",
            {
                "stage": "thinking",
                "label": "Analyse IA...",
            },
        )

        final_response: ChatResponse | None = None

        async for raw_event in stream_chat_response(
            request,
            db,
            question=transcription.transcript,
            history=history,
        ):
            parsed_event = _parse_sse_event(raw_event)
            if parsed_event is None:
                continue

            event_name, payload = parsed_event
            if event_name == "done":
                final_response = ChatResponse.model_validate(payload)
                yield _to_sse_event("done", final_response.model_dump(mode="json"))
                continue

            if event_name == "error":
                yield _to_sse_event("error", payload)
                return

            if event_name in {"meta", "token"}:
                yield raw_event

        if final_response is None:
            return

        if await request.is_disconnected():
            raise RequestCancelledError()

        yield _to_sse_event(
            "stage",
            {
                "stage": "speaking",
                "label": "Lecture de la reponse...",
            },
        )

        try:
            speech = await synthesize_voice_response(final_response.answer)
        except ChatServiceError as exc:
            yield _to_sse_event(
                "voice_error",
                {
                    "code": exc.code,
                    "message": exc.user_message,
                },
            )
            return

        yield _to_sse_event(
            "audio",
            {
                "audio_url": speech.audio_url,
                "duration": speech.duration,
                "format": speech.media_type,
            },
        )
    except RequestCancelledError:
        return
    except ChatServiceError as exc:
        VOICE_CONVERSATION_LOGGER.warning(
            "event=voice_stream_failed code=%s message=%s",
            exc.code,
            exc.user_message,
        )
        yield _to_sse_event(
            "error",
            {
                "code": exc.code,
                "message": exc.user_message,
            },
        )
    except Exception:
        VOICE_CONVERSATION_LOGGER.exception("event=voice_stream_failed_unexpected")
        fallback_error = ChatServerError()
        yield _to_sse_event(
            "error",
            {
                "code": fallback_error.code,
                "message": fallback_error.user_message,
            },
        )

from __future__ import annotations

import asyncio
import base64
import logging
import shutil
import subprocess
import sys
import tempfile
import time
import wave
from dataclasses import dataclass, replace
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from app.core.config import get_settings
from app.services.chat_service import (
    AudioTooLargeError,
    InvalidAudioError,
    NoAudioDetectedError,
    TranscriptionUnavailableError,
    TtsUnavailableError,
    VoiceSttDisabledError,
    VoiceSttUnavailableError,
)

VOICE_LOGGER = logging.getLogger("app.chat.voice")
SUPPORTED_AUDIO_TYPES = {
    "audio/webm",
    "audio/wav",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/ogg",
    "audio/aac",
}
COMPRESSED_AUDIO_TYPES = {
    "audio/webm",
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/ogg",
    "audio/aac",
}
MEDIA_TYPE_TO_SUFFIX = {
    "audio/webm": ".webm",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/mp4": ".m4a",
    "audio/ogg": ".ogg",
    "audio/aac": ".aac",
}
SUPPORTED_STT_PROVIDERS = {"auto", "disabled", "faster-whisper", "whisper", "external"}

try:  # pragma: no cover - optional runtime dependency
    import edge_tts  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - optional runtime dependency
    edge_tts = None

try:  # pragma: no cover - optional runtime dependency
    import pyttsx3  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - optional runtime dependency
    pyttsx3 = None

try:  # pragma: no cover - optional runtime dependency
    from faster_whisper import WhisperModel  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - optional runtime dependency
    WhisperModel = None

try:  # pragma: no cover - optional runtime dependency
    import whisper as openai_whisper  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - optional runtime dependency
    openai_whisper = None


@dataclass(frozen=True)
class VoiceTranscriptionResult:
    transcript: str
    language: str
    confidence: float
    provider: str
    model: str
    duration_ms: int = 0
    audio_duration_ms: int | None = None


@dataclass(frozen=True)
class VoiceTranscriptionHealth:
    enabled: bool
    ready: bool
    status: Literal["ready", "disabled", "degraded", "unavailable"]
    provider: str
    model: str
    language: str
    device: str
    compute_type: str
    runtime_available: bool
    model_loaded: bool
    ffmpeg_available: bool
    message: str
    details: dict[str, Any]


@dataclass(frozen=True)
class VoiceSpeechResult:
    audio_url: str
    duration: float
    media_type: str


def _normalize_media_type(content_type: str | None) -> str:
    return (content_type or "").split(";", 1)[0].strip().lower()


def _infer_audio_media_type(content_type: str | None, filename: str | None) -> str:
    normalized_type = _normalize_media_type(content_type)
    if normalized_type in SUPPORTED_AUDIO_TYPES:
        return normalized_type

    normalized_name = (filename or "").lower()
    if normalized_name.endswith(".webm"):
        return "audio/webm"
    if normalized_name.endswith(".wav"):
        return "audio/wav"
    if normalized_name.endswith(".mp3"):
        return "audio/mpeg"
    if normalized_name.endswith(".m4a") or normalized_name.endswith(".mp4"):
        return "audio/mp4"
    if normalized_name.endswith(".ogg") or normalized_name.endswith(".opus"):
        return "audio/ogg"
    if normalized_name.endswith(".aac"):
        return "audio/aac"
    return normalized_type


def _validate_audio_payload(
    audio_bytes: bytes,
    *,
    filename: str | None,
    content_type: str | None,
) -> str:
    settings = get_settings()
    media_type = _infer_audio_media_type(content_type, filename)

    if not audio_bytes:
        raise NoAudioDetectedError()

    if len(audio_bytes) > settings.voice_max_upload_bytes:
        raise AudioTooLargeError(
            f"Fichier audio trop lourd. Limite {settings.voice_max_upload_bytes // (1024 * 1024)} Mo."
        )

    if media_type not in SUPPORTED_AUDIO_TYPES:
        raise InvalidAudioError(
            "Format audio non supporte.",
            details={
                "reason": "unsupported_media_type",
                "content_type": content_type,
                "filename": filename,
            },
        )

    return media_type


def _resolve_audio_suffix(media_type: str, filename: str | None) -> str:
    normalized_name = (filename or "").lower()
    if "." in normalized_name:
        suffix = f".{normalized_name.rsplit('.', 1)[-1]}"
        if suffix in {".webm", ".wav", ".mp3", ".m4a", ".mp4", ".ogg", ".opus", ".aac"}:
            return suffix
    return MEDIA_TYPE_TO_SUFFIX.get(media_type, ".webm")


def _normalize_stt_provider(value: str) -> str:
    normalized = value.strip().lower() or "auto"
    if normalized not in SUPPORTED_STT_PROVIDERS:
        return "auto"
    return normalized


def _is_ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def _is_transcription_enabled() -> bool:
    settings = get_settings()
    return settings.voice_stt_enabled and _normalize_stt_provider(settings.voice_stt_provider) != "disabled"


def _get_stt_provider_sequence() -> list[str]:
    settings = get_settings()
    configured_provider = _normalize_stt_provider(settings.voice_stt_provider)
    if not settings.voice_stt_enabled or configured_provider == "disabled":
        return []
    if configured_provider == "auto":
        return ["faster-whisper", "whisper", "external"]
    return [configured_provider]


def _build_runtime_details(
    *,
    provider: str,
    model: str | None = None,
    language: str | None = None,
    device: str | None = None,
    compute_type: str | None = None,
    filename: str | None = None,
    content_type: str | None = None,
    media_type: str | None = None,
    reason: str,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    details: dict[str, Any] = {
        "provider": provider,
        "model": model,
        "language": language,
        "device": device,
        "compute_type": compute_type,
        "filename": filename,
        "content_type": content_type,
        "media_type": media_type,
        "ffmpeg_available": _is_ffmpeg_available(),
        "reason": reason,
    }
    if extra:
        details.update(extra)
    return details


def _clamp_confidence(value: float | None) -> float:
    if value is None:
        return 0.0
    return max(0.0, min(float(value), 1.0))


def _normalize_language(value: str | None) -> str | None:
    normalized = (value or "").strip()
    if not normalized or normalized.lower() == "auto":
        return None
    return normalized


def _is_provider_runtime_available(provider: str) -> bool:
    if provider == "faster-whisper":
        return WhisperModel is not None
    if provider == "whisper":
        return openai_whisper is not None
    if provider == "external":
        return False
    return False


def _is_provider_model_loaded(provider: str) -> bool:
    if provider == "faster-whisper":
        return _load_faster_whisper_model.cache_info().currsize > 0
    if provider == "whisper":
        return _load_openai_whisper_model.cache_info().currsize > 0
    return False


@lru_cache(maxsize=8)
def _load_faster_whisper_model(model_name: str, device: str, compute_type: str):
    if WhisperModel is None:  # pragma: no cover - optional runtime dependency
        raise VoiceSttUnavailableError(
            "La dependance faster-whisper n'est pas installee.",
            details=_build_runtime_details(
                provider="faster-whisper",
                model=model_name,
                device=device,
                compute_type=compute_type,
                reason="dependency_missing",
            ),
        )

    VOICE_LOGGER.info(
        "event=voice_stt_model_loading provider=%s model=%s device=%s compute_type=%s",
        "faster-whisper",
        model_name,
        device,
        compute_type,
    )
    try:
        model = WhisperModel(model_name, device=device, compute_type=compute_type)
    except Exception as exc:  # pragma: no cover - runtime path
        VOICE_LOGGER.exception(
            "event=voice_stt_model_load_failed provider=%s model=%s device=%s compute_type=%s error_type=%s error=%s",
            "faster-whisper",
            model_name,
            device,
            compute_type,
            type(exc).__name__,
            exc,
        )
        raise VoiceSttUnavailableError(
            "Le modele de transcription faster-whisper n'a pas pu etre charge.",
            details=_build_runtime_details(
                provider="faster-whisper",
                model=model_name,
                device=device,
                compute_type=compute_type,
                reason="model_load_failed",
                extra={
                    "error_type": type(exc).__name__,
                    "error": str(exc),
                },
            ),
        ) from exc

    VOICE_LOGGER.info(
        "event=voice_stt_model_loaded provider=%s model=%s device=%s compute_type=%s",
        "faster-whisper",
        model_name,
        device,
        compute_type,
    )
    return model


@lru_cache(maxsize=8)
def _load_openai_whisper_model(model_name: str, device: str):
    if openai_whisper is None:  # pragma: no cover - optional runtime dependency
        raise VoiceSttUnavailableError(
            "La dependance whisper n'est pas installee.",
            details=_build_runtime_details(
                provider="whisper",
                model=model_name,
                device=device,
                reason="dependency_missing",
            ),
        )

    resolved_device = None if device == "auto" else device
    VOICE_LOGGER.info(
        "event=voice_stt_model_loading provider=%s model=%s device=%s",
        "whisper",
        model_name,
        resolved_device or "auto",
    )
    try:
        model = openai_whisper.load_model(model_name, device=resolved_device)
    except Exception as exc:  # pragma: no cover - runtime path
        VOICE_LOGGER.exception(
            "event=voice_stt_model_load_failed provider=%s model=%s device=%s error_type=%s error=%s",
            "whisper",
            model_name,
            resolved_device or "auto",
            type(exc).__name__,
            exc,
        )
        raise VoiceSttUnavailableError(
            "Le modele de transcription whisper n'a pas pu etre charge.",
            details=_build_runtime_details(
                provider="whisper",
                model=model_name,
                device=resolved_device or "auto",
                reason="model_load_failed",
                extra={
                    "error_type": type(exc).__name__,
                    "error": str(exc),
                },
            ),
        ) from exc

    VOICE_LOGGER.info(
        "event=voice_stt_model_loaded provider=%s model=%s device=%s",
        "whisper",
        model_name,
        resolved_device or "auto",
    )
    return model


def _estimate_audio_duration_ms_from_segments(segment_ends: list[float]) -> int | None:
    if not segment_ends:
        return None
    return max(0, int(max(segment_ends) * 1000))


def _is_audio_decode_error(exc: Exception) -> bool:
    normalized_error = f"{type(exc).__name__}: {exc}".lower()
    patterns = (
        "invalid data found when processing input",
        "error opening input",
        "failed to open input",
        "could not open input",
        "cannot decode",
        "decode error",
        "invalid argument",
        "corrupt",
        "moov atom not found",
        "no stream",
        "unsupported codec",
        "format not recognised",
        "invaliddataerror",
        "ffmpegerror",
    )
    return any(pattern in normalized_error for pattern in patterns)


def _is_ffmpeg_related_error(exc: Exception) -> bool:
    normalized_error = f"{type(exc).__name__}: {exc}".lower()
    patterns = (
        "ffmpeg",
        "ffprobe",
        "libav",
        "decoder",
        "demux",
        "codec",
    )
    return any(pattern in normalized_error for pattern in patterns)


def _map_transcription_exception(
    exc: Exception,
    *,
    provider: str,
    model_name: str,
    language: str,
    device: str,
    compute_type: str,
    filename: str | None,
    content_type: str | None,
    media_type: str,
) -> Exception:
    if isinstance(exc, (InvalidAudioError, NoAudioDetectedError, VoiceSttUnavailableError, TranscriptionUnavailableError)):
        return exc

    if _is_audio_decode_error(exc):
        if media_type in COMPRESSED_AUDIO_TYPES and not _is_ffmpeg_available() and _is_ffmpeg_related_error(exc):
            return VoiceSttUnavailableError(
                "Le serveur ne peut pas decoder ce format audio car ffmpeg est indisponible.",
                details=_build_runtime_details(
                    provider=provider,
                    model=model_name,
                    language=language,
                    device=device,
                    compute_type=compute_type,
                    filename=filename,
                    content_type=content_type,
                    media_type=media_type,
                    reason="ffmpeg_missing",
                    extra={
                        "error_type": type(exc).__name__,
                        "error": str(exc),
                    },
                ),
            )
        return InvalidAudioError(
            "Fichier audio illisible ou corrompu.",
            details=_build_runtime_details(
                provider=provider,
                model=model_name,
                language=language,
                device=device,
                compute_type=compute_type,
                filename=filename,
                content_type=content_type,
                media_type=media_type,
                reason="audio_decode_failed",
                extra={
                    "error_type": type(exc).__name__,
                    "error": str(exc),
                },
            ),
        )

    return VoiceSttUnavailableError(
        "Le moteur de transcription vocale est temporairement indisponible.",
        details=_build_runtime_details(
            provider=provider,
            model=model_name,
            language=language,
            device=device,
            compute_type=compute_type,
            filename=filename,
            content_type=content_type,
            media_type=media_type,
            reason="runtime_failure",
            extra={
                "error_type": type(exc).__name__,
                "error": str(exc),
            },
        ),
    )


def _transcribe_with_faster_whisper(
    audio_path: str,
    *,
    filename: str | None,
    content_type: str | None,
    media_type: str,
    model_name: str,
    language: str,
    device: str,
    compute_type: str,
) -> VoiceTranscriptionResult:
    model = _load_faster_whisper_model(model_name, device, compute_type)
    selected_language = _normalize_language(language)
    segment_ends: list[float] = []

    try:
        segments, info = model.transcribe(
            audio_path,
            beam_size=3,
            vad_filter=True,
            language=selected_language,
            condition_on_previous_text=False,
        )
    except Exception as exc:  # pragma: no cover - runtime path
        raise _map_transcription_exception(
            exc,
            provider="faster-whisper",
            model_name=model_name,
            language=language,
            device=device,
            compute_type=compute_type,
            filename=filename,
            content_type=content_type,
            media_type=media_type,
        ) from exc

    transcript_parts: list[str] = []
    segment_count = 0
    for segment in segments:
        segment_count += 1
        segment_text = " ".join(str(segment.text).split()).strip()
        if segment_text:
            transcript_parts.append(segment_text)
        segment_end = getattr(segment, "end", None)
        if isinstance(segment_end, (int, float)):
            segment_ends.append(float(segment_end))

    transcript = " ".join(transcript_parts).strip()
    if not transcript:
        raise NoAudioDetectedError()

    resolved_language = str(getattr(info, "language", None) or selected_language or "fr").strip() or "fr"
    confidence = _clamp_confidence(getattr(info, "language_probability", None))
    audio_duration_ms = _estimate_audio_duration_ms_from_segments(segment_ends)
    VOICE_LOGGER.info(
        "event=voice_stt_provider_completed provider=%s model=%s language=%s confidence=%s segment_count=%s transcript_chars=%s audio_duration_ms=%s",
        "faster-whisper",
        model_name,
        resolved_language,
        round(confidence, 4),
        segment_count,
        len(transcript),
        audio_duration_ms,
    )
    return VoiceTranscriptionResult(
        transcript=transcript[:4000],
        language=resolved_language,
        confidence=confidence,
        provider="faster-whisper",
        model=model_name,
        audio_duration_ms=audio_duration_ms,
    )


def _transcribe_with_openai_whisper(
    audio_path: str,
    *,
    filename: str | None,
    content_type: str | None,
    media_type: str,
    model_name: str,
    language: str,
    device: str,
) -> VoiceTranscriptionResult:
    model = _load_openai_whisper_model(model_name, device)
    selected_language = _normalize_language(language)

    try:
        result = model.transcribe(
            audio_path,
            language=selected_language,
            condition_on_previous_text=False,
            fp16=False,
        )
    except Exception as exc:  # pragma: no cover - runtime path
        raise _map_transcription_exception(
            exc,
            provider="whisper",
            model_name=model_name,
            language=language,
            device=device,
            compute_type="default",
            filename=filename,
            content_type=content_type,
            media_type=media_type,
        ) from exc

    transcript = " ".join(str(result.get("text", "")).split()).strip()
    if not transcript:
        raise NoAudioDetectedError()

    segments = result.get("segments") or []
    segment_ends = [
        float(segment.get("end"))
        for segment in segments
        if isinstance(segment, dict) and isinstance(segment.get("end"), (int, float))
    ]
    resolved_language = str(result.get("language") or selected_language or "fr").strip() or "fr"
    audio_duration_ms = _estimate_audio_duration_ms_from_segments(segment_ends)
    VOICE_LOGGER.info(
        "event=voice_stt_provider_completed provider=%s model=%s language=%s confidence=%s segment_count=%s transcript_chars=%s audio_duration_ms=%s",
        "whisper",
        model_name,
        resolved_language,
        0.0,
        len(segments),
        len(transcript),
        audio_duration_ms,
    )
    return VoiceTranscriptionResult(
        transcript=transcript[:4000],
        language=resolved_language,
        confidence=0.0,
        provider="whisper",
        model=model_name,
        audio_duration_ms=audio_duration_ms,
    )


def _transcribe_with_external_provider(
    *,
    filename: str | None,
    content_type: str | None,
    media_type: str,
    model_name: str,
    language: str,
    device: str,
    compute_type: str,
) -> VoiceTranscriptionResult:
    raise VoiceSttUnavailableError(
        "Aucun provider STT externe n'est configure sur ce serveur.",
        details=_build_runtime_details(
            provider="external",
            model=model_name,
            language=language,
            device=device,
            compute_type=compute_type,
            filename=filename,
            content_type=content_type,
            media_type=media_type,
            reason="external_provider_not_configured",
        ),
    )


def _transcribe_with_provider(
    provider: str,
    audio_path: str,
    *,
    filename: str | None,
    content_type: str | None,
    media_type: str,
    model_name: str,
    language: str,
    device: str,
    compute_type: str,
) -> VoiceTranscriptionResult:
    VOICE_LOGGER.info(
        "event=voice_stt_provider_started provider=%s model=%s language=%s device=%s compute_type=%s audio_path=%s",
        provider,
        model_name,
        language,
        device,
        compute_type,
        audio_path,
    )
    if provider == "faster-whisper":
        return _transcribe_with_faster_whisper(
            audio_path,
            filename=filename,
            content_type=content_type,
            media_type=media_type,
            model_name=model_name,
            language=language,
            device=device,
            compute_type=compute_type,
        )
    if provider == "whisper":
        return _transcribe_with_openai_whisper(
            audio_path,
            filename=filename,
            content_type=content_type,
            media_type=media_type,
            model_name=model_name,
            language=language,
            device=device,
        )
    if provider == "external":
        return _transcribe_with_external_provider(
            filename=filename,
            content_type=content_type,
            media_type=media_type,
            model_name=model_name,
            language=language,
            device=device,
            compute_type=compute_type,
        )
    raise VoiceSttUnavailableError(
        "Provider de transcription inconnu.",
        details=_build_runtime_details(
            provider=provider,
            model=model_name,
            language=language,
            device=device,
            compute_type=compute_type,
            filename=filename,
            content_type=content_type,
            media_type=media_type,
            reason="unknown_provider",
        ),
    )


def is_transcription_runtime_available() -> bool:
    if not _is_transcription_enabled():
        return False
    return any(_is_provider_runtime_available(provider) for provider in _get_stt_provider_sequence())


def is_tts_runtime_available() -> bool:
    return edge_tts is not None or pyttsx3 is not None or sys.platform.startswith("win")


def get_voice_transcription_health(*, check_runtime: bool = False) -> VoiceTranscriptionHealth:
    settings = get_settings()
    configured_provider = _normalize_stt_provider(settings.voice_stt_provider)
    candidate_providers = _get_stt_provider_sequence()
    ffmpeg_available = _is_ffmpeg_available()
    details: dict[str, Any] = {
        "configured_provider": configured_provider,
        "candidate_providers": candidate_providers,
        "voice_stt_preload": settings.voice_stt_preload,
    }

    if not _is_transcription_enabled():
        details["reason"] = "disabled"
        return VoiceTranscriptionHealth(
            enabled=False,
            ready=False,
            status="disabled",
            provider="disabled",
            model=settings.voice_stt_model,
            language=settings.voice_stt_language,
            device=settings.voice_stt_device,
            compute_type=settings.voice_stt_compute_type,
            runtime_available=False,
            model_loaded=False,
            ffmpeg_available=ffmpeg_available,
            message="La transcription vocale est desactivee.",
            details=details,
        )

    if not candidate_providers:
        details["reason"] = "no_candidate_provider"
        return VoiceTranscriptionHealth(
            enabled=True,
            ready=False,
            status="unavailable",
            provider=configured_provider,
            model=settings.voice_stt_model,
            language=settings.voice_stt_language,
            device=settings.voice_stt_device,
            compute_type=settings.voice_stt_compute_type,
            runtime_available=False,
            model_loaded=False,
            ffmpeg_available=ffmpeg_available,
            message="Aucun provider de transcription n'est disponible.",
            details=details,
        )

    runtime_failures: list[dict[str, Any]] = []
    for provider in candidate_providers:
        if not _is_provider_runtime_available(provider):
            runtime_failures.append({"provider": provider, "reason": "dependency_missing"})
            continue

        model_loaded = _is_provider_model_loaded(provider)
        if check_runtime and not model_loaded:
            try:
                if provider == "faster-whisper":
                    _load_faster_whisper_model(
                        settings.voice_stt_model,
                        settings.voice_stt_device,
                        settings.voice_stt_compute_type,
                    )
                elif provider == "whisper":
                    _load_openai_whisper_model(settings.voice_stt_model, settings.voice_stt_device)
            except VoiceSttUnavailableError as exc:
                runtime_failures.append(
                    {
                        "provider": provider,
                        "reason": "model_load_failed",
                        "details": exc.details or {},
                    }
                )
                continue
            model_loaded = _is_provider_model_loaded(provider)

        details["resolved_provider"] = provider
        if runtime_failures:
            details["provider_failures"] = runtime_failures
        return VoiceTranscriptionHealth(
            enabled=True,
            ready=True,
            status="ready",
            provider=provider,
            model=settings.voice_stt_model,
            language=settings.voice_stt_language,
            device=settings.voice_stt_device,
            compute_type=settings.voice_stt_compute_type,
            runtime_available=True,
            model_loaded=model_loaded,
            ffmpeg_available=ffmpeg_available,
            message="Le moteur de transcription vocale est pret.",
            details=details,
        )

    details["provider_failures"] = runtime_failures
    return VoiceTranscriptionHealth(
        enabled=True,
        ready=False,
        status="unavailable",
        provider=configured_provider,
        model=settings.voice_stt_model,
        language=settings.voice_stt_language,
        device=settings.voice_stt_device,
        compute_type=settings.voice_stt_compute_type,
        runtime_available=False,
        model_loaded=False,
        ffmpeg_available=ffmpeg_available,
        message="Le moteur de transcription vocale est indisponible.",
        details=details,
    )


def preload_transcription_runtime() -> VoiceTranscriptionHealth:
    health = get_voice_transcription_health(check_runtime=True)
    log_level = logging.INFO if health.ready else logging.WARNING
    VOICE_LOGGER.log(
        log_level,
        "event=voice_stt_preload_completed ready=%s provider=%s model=%s status=%s ffmpeg_available=%s",
        health.ready,
        health.provider,
        health.model,
        health.status,
        health.ffmpeg_available,
    )
    return health


async def transcribe_voice_message(
    audio_bytes: bytes,
    *,
    filename: str | None = None,
    content_type: str | None = None,
) -> VoiceTranscriptionResult:
    settings = get_settings()
    if not _is_transcription_enabled():
        raise VoiceSttDisabledError(
            details=_build_runtime_details(
                provider=_normalize_stt_provider(settings.voice_stt_provider),
                model=settings.voice_stt_model,
                language=settings.voice_stt_language,
                device=settings.voice_stt_device,
                compute_type=settings.voice_stt_compute_type,
                filename=filename,
                content_type=content_type,
                reason="disabled",
            )
        )

    media_type = _validate_audio_payload(
        audio_bytes,
        filename=filename,
        content_type=content_type,
    )
    suffix = _resolve_audio_suffix(media_type, filename)
    started_at = time.perf_counter()
    provider_failures: list[dict[str, Any]] = []
    VOICE_LOGGER.info(
        "event=voice_transcription_started filename=%s requested_content_type=%s media_type=%s size_bytes=%s candidate_providers=%s selected_language=%s model=%s device=%s compute_type=%s ffmpeg_available=%s",
        filename,
        content_type,
        media_type,
        len(audio_bytes),
        _get_stt_provider_sequence(),
        settings.voice_stt_language,
        settings.voice_stt_model,
        settings.voice_stt_device,
        settings.voice_stt_compute_type,
        _is_ffmpeg_available(),
    )

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temporary_file:
        temp_path = Path(temporary_file.name)
        temporary_file.write(audio_bytes)
    VOICE_LOGGER.info(
        "event=voice_temp_file_written filename=%s temp_path=%s suffix=%s size_bytes=%s",
        filename,
        temp_path,
        suffix,
        len(audio_bytes),
    )

    try:
        for provider in _get_stt_provider_sequence():
            if not _is_provider_runtime_available(provider):
                provider_failures.append(
                    {
                        "provider": provider,
                        "reason": "dependency_missing",
                    }
                )
                continue

            try:
                result = await asyncio.to_thread(
                    _transcribe_with_provider,
                    provider,
                    str(temp_path),
                    filename=filename,
                    content_type=content_type,
                    media_type=media_type,
                    model_name=settings.voice_stt_model,
                    language=settings.voice_stt_language,
                    device=settings.voice_stt_device,
                    compute_type=settings.voice_stt_compute_type,
                )
            except (InvalidAudioError, NoAudioDetectedError):
                raise
            except (VoiceSttUnavailableError, TranscriptionUnavailableError) as exc:
                VOICE_LOGGER.warning(
                    "event=voice_stt_provider_failed provider=%s code=%s message=%s details=%s",
                    provider,
                    exc.code,
                    exc.user_message,
                    exc.details or {},
                )
                provider_failures.append(
                    {
                        "provider": provider,
                        "code": exc.code,
                        "message": exc.user_message,
                        "details": exc.details or {},
                    }
                )
                continue

            duration_ms = max(1, int((time.perf_counter() - started_at) * 1000))
            resolved_result = replace(result, duration_ms=duration_ms)
            VOICE_LOGGER.info(
                "event=voice_transcription_completed filename=%s provider=%s model=%s language=%s confidence=%s transcript_chars=%s duration_ms=%s audio_duration_ms=%s",
                filename,
                resolved_result.provider,
                resolved_result.model,
                resolved_result.language,
                round(resolved_result.confidence, 4),
                len(resolved_result.transcript),
                resolved_result.duration_ms,
                resolved_result.audio_duration_ms,
            )
            return resolved_result

        raise VoiceSttUnavailableError(
            "Aucun moteur de transcription vocal n'est operationnel sur ce serveur.",
            details=_build_runtime_details(
                provider=_normalize_stt_provider(settings.voice_stt_provider),
                model=settings.voice_stt_model,
                language=settings.voice_stt_language,
                device=settings.voice_stt_device,
                compute_type=settings.voice_stt_compute_type,
                filename=filename,
                content_type=content_type,
                media_type=media_type,
                reason="no_provider_available",
                extra={
                    "provider_failures": provider_failures,
                },
            ),
        )
    finally:
        temp_path.unlink(missing_ok=True)
        VOICE_LOGGER.info("event=voice_temp_file_deleted temp_path=%s", temp_path)


def _estimate_duration_seconds(text: str, measured_seconds: float | None = None) -> float:
    if measured_seconds is not None and measured_seconds > 0:
        return round(measured_seconds, 2)
    word_count = max(1, len(text.split()))
    return round(max(1.0, word_count / 2.8), 2)


async def _synthesize_with_edge_tts(text: str) -> VoiceSpeechResult:
    if edge_tts is None:  # pragma: no cover - optional runtime dependency
        raise TtsUnavailableError()

    settings = get_settings()
    communicate = edge_tts.Communicate(
        text=text,
        voice=settings.voice_tts_voice,
        rate=settings.voice_tts_rate,
        volume=settings.voice_tts_volume,
        pitch=settings.voice_tts_pitch,
    )

    audio_chunks: list[bytes] = []
    last_offset_seconds = 0.0
    async for chunk in communicate.stream():
        chunk_type = chunk.get("type")
        if chunk_type == "audio":
            audio_data = chunk.get("data")
            if isinstance(audio_data, (bytes, bytearray)):
                audio_chunks.append(bytes(audio_data))
        elif chunk_type == "WordBoundary":
            offset = float(chunk.get("offset", 0.0) or 0.0) / 10_000_000
            duration = float(chunk.get("duration", 0.0) or 0.0) / 10_000_000
            last_offset_seconds = max(last_offset_seconds, offset + duration)

    audio_bytes = b"".join(audio_chunks)
    if not audio_bytes:
        raise TtsUnavailableError()

    return VoiceSpeechResult(
        audio_url=f"data:audio/mpeg;base64,{base64.b64encode(audio_bytes).decode('ascii')}",
        duration=_estimate_duration_seconds(text, last_offset_seconds),
        media_type="audio/mpeg",
    )


def _configure_pyttsx3_engine(engine) -> None:
    try:
        voices = engine.getProperty("voices") or []
    except Exception:  # pragma: no cover - runtime path
        voices = []

    for voice in voices:
        languages = getattr(voice, "languages", None) or []
        normalized_languages = " ".join(str(language).lower() for language in languages)
        voice_name = str(getattr(voice, "name", "")).lower()
        if "fr" in normalized_languages or "french" in voice_name or "fran" in voice_name:
            engine.setProperty("voice", voice.id)
            break


def _run_pyttsx3_synthesis(text: str) -> VoiceSpeechResult:
    if pyttsx3 is None:  # pragma: no cover - optional runtime dependency
        raise TtsUnavailableError()

    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as temporary_file:
        temp_path = Path(temporary_file.name)

    try:
        engine = pyttsx3.init()
        _configure_pyttsx3_engine(engine)
        engine.save_to_file(text, str(temp_path))
        engine.runAndWait()
        engine.stop()

        audio_bytes = temp_path.read_bytes()
        if not audio_bytes:
            raise TtsUnavailableError()

        with wave.open(str(temp_path), "rb") as wav_file:
            frame_rate = wav_file.getframerate() or 1
            duration = wav_file.getnframes() / frame_rate
    except TtsUnavailableError:
        raise
    except Exception as exc:
        raise TtsUnavailableError() from exc
    finally:
        temp_path.unlink(missing_ok=True)

    return VoiceSpeechResult(
        audio_url=f"data:audio/wav;base64,{base64.b64encode(audio_bytes).decode('ascii')}",
        duration=_estimate_duration_seconds(text, duration),
        media_type="audio/wav",
    )


def _run_windows_sapi_synthesis(text: str) -> VoiceSpeechResult:
    if not sys.platform.startswith("win"):
        raise TtsUnavailableError()

    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as temporary_file:
        temp_path = Path(temporary_file.name)

    escaped_text = text.replace("'", "''")
    escaped_path = str(temp_path).replace("'", "''")
    command = (
        "[void][Reflection.Assembly]::LoadWithPartialName('System.Speech');"
        "$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer;"
        "$voice = $speaker.GetInstalledVoices() | "
        "Where-Object { $_.VoiceInfo.Culture.Name -like 'fr*' } | "
        "Select-Object -First 1;"
        "if ($voice) { $speaker.SelectVoice($voice.VoiceInfo.Name) };"
        f"$speaker.SetOutputToWaveFile('{escaped_path}');"
        f"$speaker.Speak('{escaped_text}');"
        "$speaker.Dispose();"
    )

    try:
        subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                command,
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        audio_bytes = temp_path.read_bytes()
        if not audio_bytes:
            raise TtsUnavailableError()

        with wave.open(str(temp_path), "rb") as wav_file:
            frame_rate = wav_file.getframerate() or 1
            duration = wav_file.getnframes() / frame_rate
    except TtsUnavailableError:
        raise
    except Exception as exc:
        raise TtsUnavailableError() from exc
    finally:
        temp_path.unlink(missing_ok=True)

    return VoiceSpeechResult(
        audio_url=f"data:audio/wav;base64,{base64.b64encode(audio_bytes).decode('ascii')}",
        duration=_estimate_duration_seconds(text, duration),
        media_type="audio/wav",
    )


async def synthesize_voice_response(text: str) -> VoiceSpeechResult:
    cleaned_text = " ".join(text.split()).strip()
    if not cleaned_text:
        raise TtsUnavailableError()

    text_to_speak = cleaned_text[: get_settings().voice_tts_max_chars]
    VOICE_LOGGER.info(
        "event=voice_synthesis_started text_chars=%s",
        len(text_to_speak),
    )

    if edge_tts is not None:
        try:
            result = await _synthesize_with_edge_tts(text_to_speak)
            VOICE_LOGGER.info(
                "event=voice_synthesis_completed provider=%s duration=%s",
                "edge_tts",
                result.duration,
            )
            return result
        except Exception:
            VOICE_LOGGER.warning("event=voice_synthesis_edge_failed")

    if pyttsx3 is not None:
        result = await asyncio.to_thread(_run_pyttsx3_synthesis, text_to_speak)
        VOICE_LOGGER.info(
            "event=voice_synthesis_completed provider=%s duration=%s",
            "pyttsx3",
            result.duration,
        )
        return result

    if sys.platform.startswith("win"):
        try:
            result = await asyncio.to_thread(_run_windows_sapi_synthesis, text_to_speak)
            VOICE_LOGGER.info(
                "event=voice_synthesis_completed provider=%s duration=%s",
                "windows_sapi",
                result.duration,
            )
            return result
        except Exception:
            VOICE_LOGGER.warning("event=voice_synthesis_windows_sapi_failed")

    raise TtsUnavailableError()

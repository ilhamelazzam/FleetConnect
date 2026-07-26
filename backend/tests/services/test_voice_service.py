import asyncio
from pathlib import Path
from types import SimpleNamespace

from app.services.chat_service import (
    AudioTooLargeError,
    InvalidAudioError,
    TtsUnavailableError,
    VoiceSttDisabledError,
    VoiceSttUnavailableError,
)
from app.services.voice_service import (
    VoiceSpeechResult,
    VoiceTranscriptionResult,
    get_voice_transcription_health,
    synthesize_voice_response,
    transcribe_voice_message,
)


def build_voice_settings(**overrides):
    defaults = {
        "voice_max_upload_bytes": 12 * 1024 * 1024,
        "voice_stt_enabled": True,
        "voice_stt_provider": "faster-whisper",
        "voice_stt_model": "base",
        "voice_stt_language": "fr",
        "voice_stt_device": "cpu",
        "voice_stt_compute_type": "int8",
        "voice_stt_preload": False,
        "voice_tts_max_chars": 4000,
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_transcribe_voice_message_returns_transcript(monkeypatch) -> None:
    captured_path: Path | None = None

    monkeypatch.setattr(
        "app.services.voice_service.get_settings",
        lambda: build_voice_settings(),
    )
    monkeypatch.setattr(
        "app.services.voice_service._is_provider_runtime_available",
        lambda provider: provider == "faster-whisper",
    )

    def fake_transcribe_with_provider(
        provider: str,
        audio_path: str,
        **_: object,
    ) -> VoiceTranscriptionResult:
        nonlocal captured_path
        captured_path = Path(audio_path)
        assert provider == "faster-whisper"
        assert captured_path.suffix == ".webm"
        return VoiceTranscriptionResult(
            transcript="Quels couts dois-je optimiser ?",
            language="fr",
            confidence=0.91,
            provider="faster-whisper",
            model="base",
            audio_duration_ms=1800,
        )

    monkeypatch.setattr(
        "app.services.voice_service._transcribe_with_provider",
        fake_transcribe_with_provider,
    )

    response = asyncio.run(
        transcribe_voice_message(
            b"voice-bytes",
            filename="question.webm",
            content_type="audio/webm",
        )
    )

    assert response.transcript == "Quels couts dois-je optimiser ?"
    assert response.language == "fr"
    assert response.confidence == 0.91
    assert response.provider == "faster-whisper"
    assert response.model == "base"
    assert response.duration_ms >= 1
    assert response.audio_duration_ms == 1800
    assert captured_path is not None
    assert not captured_path.exists()


def test_transcribe_voice_message_rejects_when_stt_disabled(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.voice_service.get_settings",
        lambda: build_voice_settings(voice_stt_enabled=False),
    )

    try:
        asyncio.run(
            transcribe_voice_message(
                b"voice-bytes",
                filename="question.webm",
                content_type="audio/webm",
            )
        )
    except VoiceSttDisabledError as exc:
        assert exc.code == "VOICE_STT_DISABLED"
    else:
        raise AssertionError("VoiceSttDisabledError attendue")


def test_transcribe_voice_message_rejects_invalid_audio_type(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.voice_service.get_settings",
        lambda: build_voice_settings(),
    )

    try:
        asyncio.run(
            transcribe_voice_message(
                b"not-audio",
                filename="question.txt",
                content_type="text/plain",
            )
        )
    except InvalidAudioError as exc:
        assert exc.code == "AUDIO_INVALID"
        assert exc.status_code == 400
    else:
        raise AssertionError("InvalidAudioError attendue")


def test_transcribe_voice_message_rejects_large_audio(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.voice_service.get_settings",
        lambda: build_voice_settings(voice_max_upload_bytes=4),
    )

    try:
        asyncio.run(
            transcribe_voice_message(
                b"123456789",
                filename="question.webm",
                content_type="audio/webm",
            )
        )
    except AudioTooLargeError as exc:
        assert exc.code == "AUDIO_TOO_LARGE"
    else:
        raise AssertionError("AudioTooLargeError attendue")


def test_transcribe_voice_message_cleans_up_temp_file_on_failure(monkeypatch) -> None:
    captured_path: Path | None = None

    monkeypatch.setattr(
        "app.services.voice_service.get_settings",
        lambda: build_voice_settings(),
    )
    monkeypatch.setattr(
        "app.services.voice_service._is_provider_runtime_available",
        lambda provider: provider == "faster-whisper",
    )

    def fake_transcribe_with_provider(
        provider: str,
        audio_path: str,
        **_: object,
    ) -> VoiceTranscriptionResult:
        nonlocal captured_path
        captured_path = Path(audio_path)
        raise VoiceSttUnavailableError("Backend STT indisponible.")

    monkeypatch.setattr(
        "app.services.voice_service._transcribe_with_provider",
        fake_transcribe_with_provider,
    )

    try:
        asyncio.run(
            transcribe_voice_message(
                b"voice-bytes",
                filename="question.webm",
                content_type="audio/webm",
            )
        )
    except VoiceSttUnavailableError as exc:
        assert exc.code == "VOICE_STT_UNAVAILABLE"
    else:
        raise AssertionError("VoiceSttUnavailableError attendue")

    assert captured_path is not None
    assert not captured_path.exists()


def test_get_voice_transcription_health_reports_disabled_mode(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.voice_service.get_settings",
        lambda: build_voice_settings(voice_stt_enabled=False),
    )

    health = get_voice_transcription_health()

    assert health.enabled is False
    assert health.ready is False
    assert health.status == "disabled"


def test_synthesize_voice_response_uses_edge_tts(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.voice_service.get_settings",
        lambda: build_voice_settings(),
    )
    monkeypatch.setattr("app.services.voice_service.edge_tts", object())

    async def fake_synthesize_with_edge_tts(text: str) -> VoiceSpeechResult:
        assert text == "Reponse IA a lire"
        return VoiceSpeechResult(
            audio_url="data:audio/mpeg;base64,ZmFrZQ==",
            duration=4.2,
            media_type="audio/mpeg",
        )

    monkeypatch.setattr(
        "app.services.voice_service._synthesize_with_edge_tts",
        fake_synthesize_with_edge_tts,
    )

    response = asyncio.run(synthesize_voice_response("Reponse IA a lire"))

    assert response.audio_url.startswith("data:audio/mpeg;base64,")
    assert response.duration == 4.2
    assert response.media_type == "audio/mpeg"


def test_synthesize_voice_response_raises_when_tts_unavailable(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.voice_service.get_settings",
        lambda: build_voice_settings(),
    )
    monkeypatch.setattr("app.services.voice_service.edge_tts", None)
    monkeypatch.setattr("app.services.voice_service.pyttsx3", None)
    monkeypatch.setattr("app.services.voice_service.sys.platform", "linux")

    try:
        asyncio.run(synthesize_voice_response("Reponse IA a lire"))
    except TtsUnavailableError as exc:
        assert exc.code == "TTS_UNAVAILABLE"
    else:
        raise AssertionError("TtsUnavailableError attendue")


def test_synthesize_voice_response_uses_windows_sapi_fallback(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.voice_service.get_settings",
        lambda: build_voice_settings(),
    )
    monkeypatch.setattr("app.services.voice_service.edge_tts", None)
    monkeypatch.setattr("app.services.voice_service.pyttsx3", None)
    monkeypatch.setattr("app.services.voice_service.sys.platform", "win32")

    def fake_run_windows_sapi_synthesis(text: str) -> VoiceSpeechResult:
        assert text == "Reponse IA a lire"
        return VoiceSpeechResult(
            audio_url="data:audio/wav;base64,ZmFrZQ==",
            duration=3.8,
            media_type="audio/wav",
        )

    monkeypatch.setattr(
        "app.services.voice_service._run_windows_sapi_synthesis",
        fake_run_windows_sapi_synthesis,
    )

    response = asyncio.run(synthesize_voice_response("Reponse IA a lire"))

    assert response.audio_url.startswith("data:audio/wav;base64,")
    assert response.duration == 3.8
    assert response.media_type == "audio/wav"

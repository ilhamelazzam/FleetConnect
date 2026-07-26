import asyncio
from types import SimpleNamespace

from app.schemas.chat import ChatResponse
from app.services.chat_service import TranscriptionUnavailableError
from app.services.voice_conversation_service import (
    VoiceConversationResponse,
    generate_voice_chat_response,
    stream_voice_chat_response,
)
from app.services.voice_service import VoiceSpeechResult, VoiceTranscriptionResult


def test_generate_voice_chat_response_chains_transcription_chat_and_tts(monkeypatch) -> None:
    async def fake_transcribe_voice_message(
        audio_bytes: bytes,
        *,
        filename: str | None = None,
        content_type: str | None = None,
    ) -> VoiceTranscriptionResult:
        assert audio_bytes == b"voice-bytes"
        assert filename == "question.webm"
        assert content_type == "audio/webm"
        return VoiceTranscriptionResult(
            transcript="Analyse ma flotte actuelle",
            language="fr",
            confidence=0.93,
            provider="faster-whisper",
            model="base",
        )

    async def fake_generate_chat_response(db, *, question: str, history):
        assert question == "Analyse ma flotte actuelle"
        assert history == []
        return ChatResponse(
            answer="Votre flotte presente un risque moyen.",
            model="llama3.2:3b",
            title_hint=None,
            sources=["cdr_analytics"],
            summary_updated_at="2026-05-10T09:18:00+00:00",
            cached=False,
            fallback_used=False,
            duration_ms=910,
        )

    async def fake_synthesize_voice_response(text: str) -> VoiceSpeechResult:
        assert text == "Votre flotte presente un risque moyen."
        return VoiceSpeechResult(
            audio_url="data:audio/mpeg;base64,ZmFrZQ==",
            duration=3.8,
            media_type="audio/mpeg",
        )

    monkeypatch.setattr(
        "app.services.voice_conversation_service.transcribe_voice_message",
        fake_transcribe_voice_message,
    )
    monkeypatch.setattr(
        "app.services.voice_conversation_service.generate_chat_response",
        fake_generate_chat_response,
    )
    monkeypatch.setattr(
        "app.services.voice_conversation_service.synthesize_voice_response",
        fake_synthesize_voice_response,
    )

    response = asyncio.run(
        generate_voice_chat_response(
            SimpleNamespace(),
            history=[],
            audio_bytes=b"voice-bytes",
            filename="question.webm",
            content_type="audio/webm",
        )
    )

    assert isinstance(response, VoiceConversationResponse)
    assert response.transcript == "Analyse ma flotte actuelle"
    assert response.answer.model == "llama3.2:3b"
    assert response.speech.duration == 3.8


def test_generate_voice_chat_response_uses_provided_transcript_without_runtime(monkeypatch) -> None:
    async def fail_transcribe_voice_message(
        audio_bytes: bytes,
        *,
        filename: str | None = None,
        content_type: str | None = None,
    ) -> VoiceTranscriptionResult:
        raise AssertionError("La transcription backend ne doit pas etre appelee quand un transcript existe.")

    async def fake_generate_chat_response(db, *, question: str, history):
        assert question == "Analyse les alertes roaming"
        assert history == []
        return ChatResponse(
            answer="Les alertes roaming doivent etre surveillees en priorite.",
            model="llama3.2:3b",
            title_hint=None,
            sources=["cdr_analytics"],
            summary_updated_at="2026-05-10T09:18:00+00:00",
            cached=False,
            fallback_used=False,
            duration_ms=680,
        )

    async def fake_synthesize_voice_response(text: str) -> VoiceSpeechResult:
        assert text == "Les alertes roaming doivent etre surveillees en priorite."
        return VoiceSpeechResult(
            audio_url="data:audio/mpeg;base64,ZmFrZQ==",
            duration=3.1,
            media_type="audio/mpeg",
        )

    monkeypatch.setattr(
        "app.services.voice_conversation_service.transcribe_voice_message",
        fail_transcribe_voice_message,
    )
    monkeypatch.setattr(
        "app.services.voice_conversation_service.generate_chat_response",
        fake_generate_chat_response,
    )
    monkeypatch.setattr(
        "app.services.voice_conversation_service.synthesize_voice_response",
        fake_synthesize_voice_response,
    )

    response = asyncio.run(
        generate_voice_chat_response(
            SimpleNamespace(),
            history=[],
            transcript=" Analyse   les alertes roaming ",
        )
    )

    assert response.transcript == "Analyse les alertes roaming"
    assert response.confidence == 1.0
    assert response.answer.answer.startswith("Les alertes roaming")


def test_stream_voice_chat_response_emits_transcript_text_and_audio(monkeypatch) -> None:
    async def fake_transcribe_voice_message(
        audio_bytes: bytes,
        *,
        filename: str | None = None,
        content_type: str | None = None,
    ) -> VoiceTranscriptionResult:
        return VoiceTranscriptionResult(
            transcript="Analyse ma flotte actuelle",
            language="fr",
            confidence=0.93,
            provider="faster-whisper",
            model="base",
        )

    async def fake_stream_chat_response(request, db, *, question: str, history):
        assert question == "Analyse ma flotte actuelle"
        yield 'event: meta\ndata: {"model":"llama3.2:3b","summary_updated_at":"2026-05-10T09:18:00+00:00","sources":["cdr_analytics"]}\n\n'
        yield 'event: token\ndata: {"text":"Bonjour "}\n\n'
        yield 'event: done\ndata: {"answer":"Bonjour","model":"llama3.2:3b","title_hint":null,"sources":["cdr_analytics"],"summary_updated_at":"2026-05-10T09:18:00+00:00","cached":false,"fallback_used":false,"duration_ms":920}\n\n'

    async def fake_synthesize_voice_response(text: str) -> VoiceSpeechResult:
        assert text == "Bonjour"
        return VoiceSpeechResult(
            audio_url="data:audio/mpeg;base64,ZmFrZQ==",
            duration=2.4,
            media_type="audio/mpeg",
        )

    monkeypatch.setattr(
        "app.services.voice_conversation_service.transcribe_voice_message",
        fake_transcribe_voice_message,
    )
    monkeypatch.setattr(
        "app.services.voice_conversation_service.stream_chat_response",
        fake_stream_chat_response,
    )
    monkeypatch.setattr(
        "app.services.voice_conversation_service.synthesize_voice_response",
        fake_synthesize_voice_response,
    )

    async def collect_events():
        request = SimpleNamespace(is_disconnected=lambda: asyncio.sleep(0, result=False))
        events = []
        async for event in stream_voice_chat_response(
            request,
            SimpleNamespace(),
            history=[],
            audio_bytes=b"voice-bytes",
            filename="question.webm",
            content_type="audio/webm",
        ):
            events.append(event)
        return events

    events = asyncio.run(collect_events())

    assert any("event: stage" in event for event in events)
    assert any("event: transcript" in event for event in events)
    assert any('event: token\ndata: {"text":"Bonjour "}' in event for event in events)
    assert any("event: audio" in event and "data:audio/mpeg;base64,ZmFrZQ==" in event for event in events)


def test_stream_voice_chat_response_emits_structured_error_when_transcription_fails(monkeypatch) -> None:
    async def fake_transcribe_voice_message(
        audio_bytes: bytes,
        *,
        filename: str | None = None,
        content_type: str | None = None,
    ):
        raise TranscriptionUnavailableError()

    monkeypatch.setattr(
        "app.services.voice_conversation_service.transcribe_voice_message",
        fake_transcribe_voice_message,
    )

    async def collect_events():
        request = SimpleNamespace(is_disconnected=lambda: asyncio.sleep(0, result=False))
        events = []
        async for event in stream_voice_chat_response(
            request,
            SimpleNamespace(),
            history=[],
            audio_bytes=b"voice-bytes",
            filename="question.webm",
            content_type="audio/webm",
        ):
            events.append(event)
        return events

    events = asyncio.run(collect_events())

    assert any('event: stage' in event for event in events)
    assert any('event: error' in event for event in events)
    assert any('"code": "TRANSCRIPTION_UNAVAILABLE"' in event for event in events)

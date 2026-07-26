import asyncio

import pytest

from app.services.chat_service import VisionUnavailableError
from app.services.vision_service import analyze_image_with_llava, is_vision_model_available


def test_is_vision_model_available_returns_pull_hint_when_model_is_missing(monkeypatch) -> None:
    class DummyResponse:
        @staticmethod
        def json() -> dict[str, object]:
            return {"models": [{"name": "llama3.2:3b"}]}

    class DummySettings:
        ollama_base_url = "http://localhost:11434"
        ollama_vision_model = "llava"

    monkeypatch.setattr("app.services.vision_service.get_settings", lambda: DummySettings())
    monkeypatch.setattr("app.services.vision_service._get_ollama_tags", lambda _: DummyResponse())

    available, message = asyncio.run(is_vision_model_available())

    assert available is False
    assert message is not None
    assert "ollama pull llava" in message


def test_analyze_image_with_llava_raises_actionable_message_when_model_is_missing(monkeypatch) -> None:
    class DummyResponse:
        status_code = 404

        @staticmethod
        def json() -> dict[str, object]:
            return {"error": "model not found"}

    class DummySettings:
        ollama_base_url = "http://localhost:11434"
        ollama_vision_model = "llava"
        ollama_vision_timeout_seconds = 30
        ollama_vision_retry_count = 0

    monkeypatch.setattr("app.services.vision_service.get_settings", lambda: DummySettings())
    monkeypatch.setattr(
        "app.services.vision_service._post_ollama_generate",
        lambda *args, **kwargs: DummyResponse(),
    )

    with pytest.raises(VisionUnavailableError) as exc_info:
        asyncio.run(
            analyze_image_with_llava(
                question="Quels equipements sont visibles ?",
                image_base64="router-image-base64",
                analysis_mode="advanced",
            )
        )

    assert "ollama pull llava" in str(exc_info.value)

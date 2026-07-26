from __future__ import annotations

from io import BytesIO

from PIL import Image

from app.services import image_preprocessing_service
from app.services.image_preprocessing_service import prepare_image_for_analysis


def _build_long_dashboard_png(width: int = 1200, height: int = 8219) -> bytes:
    image = Image.new("RGB", (width, height), color="white")
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def test_prepare_image_for_analysis_chunks_long_dashboard_without_destructive_resize() -> None:
    image_bytes = _build_long_dashboard_png()

    prepared = prepare_image_for_analysis(
        image_bytes,
        filename="long-dashboard.png",
        content_type="image/png",
        max_side=1024,
    )

    assert prepared.is_long_screenshot is True
    assert prepared.width == 1200
    assert prepared.height == 8219
    assert prepared.processed_width is not None
    assert prepared.processed_width >= 1000
    assert prepared.processed_width != 150
    assert len(prepared.chunks) >= 2
    assert all(chunk.processed_width >= 1000 for chunk in prepared.chunks)
    assert all(1400 <= chunk.processed_height <= 1800 for chunk in prepared.chunks)


def test_prepare_image_for_analysis_long_dashboard_pillow_fallback_keeps_width(monkeypatch) -> None:
    image_bytes = _build_long_dashboard_png()
    monkeypatch.setattr(image_preprocessing_service, "cv2", None)
    monkeypatch.setattr(image_preprocessing_service, "np", None)

    prepared = prepare_image_for_analysis(
        image_bytes,
        filename="long-dashboard-fallback.png",
        content_type="image/png",
        max_side=1024,
    )

    assert prepared.is_long_screenshot is True
    assert prepared.processed_width is not None
    assert prepared.processed_width >= 1000
    assert len(prepared.chunks) >= 2
    assert all(chunk.processed_width >= 1000 for chunk in prepared.chunks)

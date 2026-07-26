from __future__ import annotations

import base64
import logging
import time
from dataclasses import dataclass
from io import BytesIO

from app.core.config import get_settings
from app.services.chat_service import ImageTooLargeError, InvalidImageError, MemoryPressureError

IMAGE_LOGGER = logging.getLogger("app.chat.image")

LONG_SCREENSHOT_RATIO_THRESHOLD = 3.0
LONG_SCREENSHOT_MIN_WIDTH = 1000
LONG_SCREENSHOT_MAX_WIDTH = 1600
LONG_SCREENSHOT_CHUNK_MAX_HEIGHT = 1600
LONG_SCREENSHOT_CHUNK_MIN_HEIGHT = 1400
LONG_SCREENSHOT_CHUNK_OVERLAP = 120
LONG_SCREENSHOT_VISION_MAX_WIDTH = 1024

try:  # pragma: no cover - optional runtime dependency
    import cv2  # type: ignore[import-not-found]
    import numpy as np  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - optional runtime dependency
    cv2 = None
    np = None

try:  # pragma: no cover - optional runtime dependency
    from PIL import Image, ImageEnhance, ImageFilter, ImageOps, UnidentifiedImageError
except ImportError:  # pragma: no cover - optional runtime dependency
    Image = None
    ImageEnhance = None
    ImageFilter = None
    ImageOps = None
    UnidentifiedImageError = ValueError


@dataclass(frozen=True)
class PreparedImage:
    original_bytes: bytes
    processed_bytes: bytes
    media_type: str
    width: int | None
    height: int | None
    processed_width: int | None = None
    processed_height: int | None = None
    is_long_screenshot: bool = False
    chunks: tuple["PreparedImageChunk", ...] = ()

    @property
    def base64_payload(self) -> str:
        return base64.b64encode(self.processed_bytes).decode("utf-8")

    @property
    def vision_base64_payload(self) -> str:
        preferred_bytes = (
            self.original_bytes
            if self.original_bytes and len(self.original_bytes) <= max(len(self.processed_bytes), 1) * 4
            else self.processed_bytes
        )
        return base64.b64encode(preferred_bytes).decode("utf-8")


@dataclass(frozen=True)
class PreparedImageChunk:
    index: int
    offset_y: int
    original_bytes: bytes
    processed_bytes: bytes
    media_type: str
    width: int
    height: int
    processed_width: int
    processed_height: int

    @property
    def base64_payload(self) -> str:
        return base64.b64encode(self.processed_bytes).decode("utf-8")

    @property
    def vision_base64_payload(self) -> str:
        preferred_bytes = (
            self.original_bytes
            if self.original_bytes and len(self.original_bytes) <= max(len(self.processed_bytes), 1) * 4
            else self.processed_bytes
        )
        return base64.b64encode(preferred_bytes).decode("utf-8")


def _infer_media_type(content_type: str | None, filename: str | None) -> str:
    normalized_content_type = (content_type or "").strip().lower()
    if normalized_content_type in {"image/jpeg", "image/png", "image/webp"}:
        return normalized_content_type

    normalized_filename = (filename or "").lower()
    if normalized_filename.endswith((".jpg", ".jpeg")):
        return "image/jpeg"
    if normalized_filename.endswith(".webp"):
        return "image/webp"
    return "image/png"


def _validate_image_payload(
    image_bytes: bytes,
    *,
    filename: str | None,
    content_type: str | None,
) -> str:
    settings = get_settings()
    media_type = _infer_media_type(content_type, filename)

    if not image_bytes:
        raise InvalidImageError("Image vide ou invalide.", code="IMAGE_INVALID", status_code=400)

    if len(image_bytes) > settings.image_max_upload_bytes:
        raise ImageTooLargeError(
            f"Image trop lourde pour analyse. Limite {settings.image_max_upload_bytes // (1024 * 1024)} Mo."
        )

    if media_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise InvalidImageError("Format image non supporté.")

    return media_type


def _resolve_max_side(max_side: int | None = None) -> int:
    return max(512, max_side or get_settings().image_preprocess_max_side)


def _is_long_screenshot(width: int, height: int) -> bool:
    if width <= 0 or height <= 0:
        return False
    return (height / max(width, 1)) > LONG_SCREENSHOT_RATIO_THRESHOLD


def _resolve_long_screenshot_target_width(width: int) -> int:
    return max(LONG_SCREENSHOT_MIN_WIDTH, min(width, LONG_SCREENSHOT_MAX_WIDTH))


def _iter_chunk_bounds(height: int) -> list[tuple[int, int]]:
    if height <= LONG_SCREENSHOT_CHUNK_MAX_HEIGHT:
        return [(0, height)]

    bounds: list[tuple[int, int]] = []
    step = max(1, LONG_SCREENSHOT_CHUNK_MAX_HEIGHT - LONG_SCREENSHOT_CHUNK_OVERLAP)
    start_y = 0
    while start_y + LONG_SCREENSHOT_CHUNK_MAX_HEIGHT < height:
        next_start = start_y + step
        remaining_after_next = height - next_start
        bounds.append((start_y, start_y + LONG_SCREENSHOT_CHUNK_MAX_HEIGHT))
        if remaining_after_next < LONG_SCREENSHOT_CHUNK_MIN_HEIGHT:
            final_start = max(0, height - LONG_SCREENSHOT_CHUNK_MAX_HEIGHT)
            if final_start > bounds[-1][0]:
                bounds.append((final_start, height))
            return bounds
        start_y += step
    final_start = max(0, height - LONG_SCREENSHOT_CHUNK_MAX_HEIGHT)
    if not bounds or final_start > bounds[-1][0]:
        bounds.append((final_start, height))
    else:
        last_start, _ = bounds[-1]
        bounds[-1] = (last_start, height)
    return bounds


def _encode_pil_jpeg(image, *, quality: int = 88) -> bytes:
    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=quality, optimize=True)
    return buffer.getvalue()


def _enhance_pil_for_ocr(image):
    if ImageOps is None or ImageEnhance is None or ImageFilter is None:
        return image
    enhanced = ImageOps.autocontrast(image.convert("L"))
    enhanced = ImageEnhance.Contrast(enhanced).enhance(1.16)
    enhanced = ImageEnhance.Sharpness(enhanced).enhance(1.28)
    return enhanced.filter(ImageFilter.SHARPEN)


def _prepare_pil_for_vision(image):
    if Image is None:
        return image
    if image.width <= LONG_SCREENSHOT_VISION_MAX_WIDTH:
        return image
    target_width = LONG_SCREENSHOT_VISION_MAX_WIDTH
    target_height = max(1, round(image.height * (target_width / max(image.width, 1))))
    return image.resize((target_width, target_height), Image.Resampling.LANCZOS)


def _prepare_long_screenshot_with_pillow(
    image_bytes: bytes,
    *,
    media_type: str,
) -> PreparedImage:
    if Image is None or ImageOps is None:
        raise InvalidImageError("Format image non supporte.")

    try:
        with Image.open(BytesIO(image_bytes)) as opened_image:
            image = ImageOps.exif_transpose(opened_image).convert("RGB")
            original_width, original_height = image.size
            target_width = _resolve_long_screenshot_target_width(original_width)
            if original_width != target_width:
                target_height = max(1, round(original_height * (target_width / max(original_width, 1))))
                prepared = image.resize((target_width, target_height), Image.Resampling.LANCZOS)
            else:
                prepared = image

            chunk_bounds = _iter_chunk_bounds(prepared.height)
            chunks: list[PreparedImageChunk] = []
            for index, (start_y, end_y) in enumerate(chunk_bounds):
                visual_chunk = prepared.crop((0, start_y, prepared.width, end_y))
                vision_chunk = _prepare_pil_for_vision(visual_chunk)
                ocr_chunk = _enhance_pil_for_ocr(visual_chunk)
                if ocr_chunk.width < 800:
                    raise InvalidImageError(
                        "Le pretraitement du dashboard reduit trop la largeur utile.",
                        log_message="Destructive long screenshot resize blocked.",
                    )
                original_chunk_bytes = _encode_pil_jpeg(vision_chunk, quality=70)
                processed_chunk_bytes = _encode_pil_jpeg(ocr_chunk, quality=88)
                chunks.append(
                    PreparedImageChunk(
                        index=index,
                        offset_y=start_y,
                        original_bytes=original_chunk_bytes,
                        processed_bytes=processed_chunk_bytes,
                        media_type="image/jpeg",
                        width=visual_chunk.width,
                        height=visual_chunk.height,
                        processed_width=ocr_chunk.width,
                        processed_height=ocr_chunk.height,
                    )
                )
    except MemoryError as exc:  # pragma: no cover - runtime path
        raise MemoryPressureError() from exc
    except UnidentifiedImageError as exc:
        raise InvalidImageError("Format image non supporte.", log_message="Image decode failed.") from exc
    except OSError as exc:
        raise InvalidImageError("Format image non supporte.", log_message="Image decode failed.") from exc

    if not chunks:
        raise InvalidImageError("Format image non supporte.", log_message="Long screenshot chunking failed.")

    prepared_image = PreparedImage(
        original_bytes=image_bytes,
        processed_bytes=chunks[0].processed_bytes,
        media_type="image/jpeg",
        width=original_width,
        height=original_height,
        processed_width=chunks[0].processed_width,
        processed_height=chunks[0].processed_height,
        is_long_screenshot=True,
        chunks=tuple(chunks),
    )
    IMAGE_LOGGER.info(
        "event=image_preprocess_long_screenshot backend=%s width=%s height=%s processed_width=%s processed_height=%s is_long_screenshot=%s number_of_chunks=%s chunk_sizes=%s",
        "pillow",
        prepared_image.width,
        prepared_image.height,
        prepared_image.processed_width,
        prepared_image.processed_height,
        prepared_image.is_long_screenshot,
        len(prepared_image.chunks),
        [
            {
                "index": chunk.index,
                "offset_y": chunk.offset_y,
                "width": chunk.processed_width,
                "height": chunk.processed_height,
            }
            for chunk in prepared_image.chunks
        ],
    )
    return prepared_image


def _resize_image(image, *, max_side: int | None = None):
    if cv2 is None:
        return image

    image_max_side = max(image.shape[:2])
    max_allowed_side = _resolve_max_side(max_side)
    if image_max_side <= max_allowed_side:
        return image

    ratio = max_allowed_side / image_max_side
    next_width = max(1, int(image.shape[1] * ratio))
    next_height = max(1, int(image.shape[0] * ratio))
    return cv2.resize(image, (next_width, next_height), interpolation=cv2.INTER_AREA)


def _enhance_for_ocr(image, *, max_side: int | None = None):
    if cv2 is None:
        return image

    resized = _resize_image(image, max_side=max_side)
    grayscale = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8))
    contrasted = clahe.apply(grayscale)
    denoised = cv2.fastNlMeansDenoising(contrasted, None, 12, 7, 21)
    sharpen_kernel = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]])
    sharpened = cv2.filter2D(denoised, -1, sharpen_kernel)
    return sharpened


def _prepare_with_pillow(
    image_bytes: bytes,
    *,
    media_type: str,
    max_side: int | None = None,
) -> PreparedImage:
    if Image is None or ImageOps is None or ImageEnhance is None or ImageFilter is None:
        raise InvalidImageError("Format image non supporte.")

    max_allowed_side = _resolve_max_side(max_side)

    try:
        with Image.open(BytesIO(image_bytes)) as opened_image:
            image = ImageOps.exif_transpose(opened_image)
            original_width, original_height = image.size
            if _is_long_screenshot(original_width, original_height):
                return _prepare_long_screenshot_with_pillow(
                    image_bytes,
                    media_type=media_type,
                )
            prepared = image.convert("RGB")
            resized = max(prepared.size) > max_allowed_side
            if resized:
                prepared.thumbnail((max_allowed_side, max_allowed_side), Image.Resampling.LANCZOS)

            enhanced = ImageOps.autocontrast(prepared)
            enhanced = ImageEnhance.Contrast(enhanced).enhance(1.08)
            enhanced = ImageEnhance.Sharpness(enhanced).enhance(1.18)
            enhanced = enhanced.filter(ImageFilter.SHARPEN)

            output_buffer = BytesIO()
            enhanced.save(output_buffer, format="JPEG", quality=82, optimize=True)
            processed_bytes = output_buffer.getvalue()
    except MemoryError as exc:  # pragma: no cover - runtime path
        raise MemoryPressureError() from exc
    except UnidentifiedImageError as exc:
        raise InvalidImageError("Format image non supporte.", log_message="Image decode failed.") from exc
    except OSError as exc:
        raise InvalidImageError("Format image non supporte.", log_message="Image decode failed.") from exc

    use_original = not resized and len(image_bytes) <= len(processed_bytes)
    prepared_image = PreparedImage(
        original_bytes=image_bytes,
        processed_bytes=image_bytes if use_original else processed_bytes,
        media_type=media_type if use_original else "image/jpeg",
        width=original_width,
        height=original_height,
        processed_width=original_width if use_original else enhanced.width,
        processed_height=original_height if use_original else enhanced.height,
    )
    IMAGE_LOGGER.info(
        "event=image_preprocess_completed backend=%s width=%s height=%s processed_width=%s processed_height=%s output_bytes=%s reused_original=%s",
        "pillow",
        prepared_image.width,
        prepared_image.height,
        prepared_image.processed_width,
        prepared_image.processed_height,
        len(prepared_image.processed_bytes),
        use_original,
    )
    return prepared_image


def prepare_image_for_analysis(
    image_bytes: bytes,
    *,
    filename: str | None = None,
    content_type: str | None = None,
    max_side: int | None = None,
) -> PreparedImage:
    started_at = time.perf_counter()
    media_type = _validate_image_payload(
        image_bytes,
        filename=filename,
        content_type=content_type,
    )
    IMAGE_LOGGER.info(
        "event=image_received filename=%s content_type=%s media_type=%s size_bytes=%s",
        filename,
        content_type,
        media_type,
        len(image_bytes),
    )

    if cv2 is None or np is None:  # pragma: no cover - optional runtime dependency
        if Image is not None:
            IMAGE_LOGGER.warning(
                "event=image_preprocess_fallback reason=%s",
                "opencv_unavailable_using_pillow",
            )
            return _prepare_with_pillow(image_bytes, media_type=media_type, max_side=max_side)

        IMAGE_LOGGER.warning(
            "event=image_preprocess_fallback reason=%s",
            "opencv_and_pillow_unavailable",
        )
        return PreparedImage(
            original_bytes=image_bytes,
            processed_bytes=image_bytes,
            media_type=media_type,
            width=None,
            height=None,
            processed_width=None,
            processed_height=None,
            is_long_screenshot=False,
            chunks=(),
        )

    if Image is not None:
        try:
            with Image.open(BytesIO(image_bytes)) as opened_image:
                size_probe = ImageOps.exif_transpose(opened_image)
                probed_width, probed_height = size_probe.size
        except Exception:
            probed_width, probed_height = 0, 0
        if _is_long_screenshot(probed_width, probed_height):
            IMAGE_LOGGER.info(
                "event=image_preprocess_long_screenshot_detected filename=%s width=%s height=%s ratio=%s",
                filename,
                probed_width,
                probed_height,
                round(probed_height / max(probed_width, 1), 2) if probed_width else None,
            )
            return _prepare_long_screenshot_with_pillow(
                image_bytes,
                media_type=media_type,
            )

    try:
        image_array = np.frombuffer(image_bytes, dtype=np.uint8)
        decoded = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
    except MemoryError as exc:  # pragma: no cover - runtime path
        raise MemoryPressureError() from exc

    if decoded is None:
        raise InvalidImageError("Format image non supporté.", log_message="Image decode failed.")

    try:
        processed = _enhance_for_ocr(decoded, max_side=max_side)
        success, encoded = cv2.imencode(
            ".jpg",
            processed,
            [int(cv2.IMWRITE_JPEG_QUALITY), 82],
        )
    except MemoryError as exc:  # pragma: no cover - runtime path
        raise MemoryPressureError() from exc

    if not success:
        IMAGE_LOGGER.warning(
            "event=image_preprocess_fallback reason=%s",
            "encode_failed",
        )
        return PreparedImage(
            original_bytes=image_bytes,
            processed_bytes=image_bytes,
            media_type=media_type,
            width=int(decoded.shape[1]),
            height=int(decoded.shape[0]),
            processed_width=int(processed.shape[1]) if hasattr(processed, "shape") else int(decoded.shape[1]),
            processed_height=int(processed.shape[0]) if hasattr(processed, "shape") else int(decoded.shape[0]),
            is_long_screenshot=False,
            chunks=(),
        )

    prepared_image = PreparedImage(
        original_bytes=image_bytes,
        processed_bytes=encoded.tobytes(),
        media_type="image/jpeg",
        width=int(decoded.shape[1]),
        height=int(decoded.shape[0]),
        processed_width=int(processed.shape[1]) if hasattr(processed, "shape") else int(decoded.shape[1]),
        processed_height=int(processed.shape[0]) if hasattr(processed, "shape") else int(decoded.shape[0]),
        is_long_screenshot=False,
        chunks=(),
    )
    IMAGE_LOGGER.info(
        "event=image_preprocess_completed filename=%s width=%s height=%s processed_width=%s processed_height=%s output_bytes=%s duration_ms=%s",
        filename,
        prepared_image.width,
        prepared_image.height,
        prepared_image.processed_width,
        prepared_image.processed_height,
        len(prepared_image.processed_bytes),
        round((time.perf_counter() - started_at) * 1000),
    )
    return prepared_image

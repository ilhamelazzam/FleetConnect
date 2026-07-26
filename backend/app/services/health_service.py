from __future__ import annotations

import asyncio
import csv
from datetime import UTC, datetime
import logging
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import text

from app.core.config import ResolvedDataSource, get_settings
from app.db.session import engine
from app.schemas.common import (
    HealthCheckResponse,
    HealthChecksResponse,
    HealthResponse,
)
from app.services.live_monitoring_service import (
    ensure_live_monitoring_started,
    get_live_monitoring_status,
)

HEALTH_LOGGER = logging.getLogger("app.health")


def _utcnow_iso() -> str:
    return datetime.now(tz=UTC).isoformat()


def _detect_csv_delimiter(sample: str) -> str:
    try:
        return csv.Sniffer().sniff(sample, delimiters=";,").delimiter
    except csv.Error:
        return ";" if sample.count(";") >= sample.count(",") else ","


def _count_csv_rows(csv_path: Path) -> int:
    with csv_path.open("r", encoding="utf-8-sig", newline="") as csv_file:
        sample = csv_file.read(4096)
        csv_file.seek(0)
        reader = csv.reader(csv_file, delimiter=_detect_csv_delimiter(sample))
        next(reader, None)
        return sum(1 for _ in reader)


def _build_path_metadata(csv_path: Path | None) -> dict[str, Any]:
    if csv_path is None or not csv_path.exists():
        return {
            "selected_path_modified_at": None,
            "selected_path_size_bytes": None,
        }

    try:
        stat_result = csv_path.stat()
    except OSError:
        return {
            "selected_path_modified_at": None,
            "selected_path_size_bytes": None,
        }

    return {
        "selected_path_modified_at": datetime.fromtimestamp(
            stat_result.st_mtime,
            tz=UTC,
        ).isoformat(),
        "selected_path_size_bytes": stat_result.st_size,
    }


def _build_data_source_details(
    source: ResolvedDataSource,
    *,
    rows: int = 0,
    error: str | None = None,
) -> dict[str, Any]:
    details: dict[str, Any] = {
        "preferred_name": source.preferred_name,
        "configured_path": str(source.configured_path) if source.configured_path else None,
        "selected_path": str(source.path) if source.path else None,
        "searched_paths": [str(path) for path in source.searched_paths],
        "exists": source.exists,
        "rows": rows,
        "optional": source.optional,
        **_build_path_metadata(source.path),
    }
    if error:
        details["error"] = error
    return details


def _check_database() -> HealthCheckResponse:
    settings = get_settings()
    database_details = {
        "dialect": engine.dialect.name,
        "host": settings.db_host,
        "port": settings.db_port,
        "database": settings.db_name,
    }

    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception as exc:  # pragma: no cover - exercised via tests with monkeypatch
        return HealthCheckResponse(
            status="error",
            message="Base de donnees inaccessible.",
            details={**database_details, "error": str(exc)},
        )

    return HealthCheckResponse(
        status="ok",
        message="Base de donnees disponible.",
        details=database_details,
    )


def _matches_ollama_model(available_models: list[str], expected_name: str) -> bool:
    normalized_expected_name = expected_name.strip().lower()
    return any(
        model_name == normalized_expected_name
        or model_name.startswith(f"{normalized_expected_name}:")
        for model_name in available_models
    )


async def _fetch_ollama_models() -> tuple[list[str] | None, str | None]:
    settings = get_settings()
    tags_url = f"{settings.ollama_base_url.rstrip('/')}/api/tags"
    timeout = min(max(settings.ollama_timeout_seconds, 1), 5)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(tags_url)
            response.raise_for_status()
            payload = response.json()
    except Exception as exc:
        return None, str(exc)

    models = [
        str(model.get("name") or model.get("model") or "").strip().lower()
        for model in payload.get("models", [])
        if isinstance(model, dict)
    ]
    return models, None


async def _check_ollama_services() -> tuple[HealthCheckResponse, HealthCheckResponse, HealthCheckResponse]:
    settings = get_settings()
    model_details = {
        "base_url": settings.ollama_base_url,
        "chat_model": settings.ollama_model,
        "vision_model": settings.ollama_vision_model,
    }
    models, error = await _fetch_ollama_models()
    if models is None:
        chat_check = HealthCheckResponse(
            status="degraded",
            message="Ollama indisponible pour le chat.",
            details={**model_details, "error": error},
        )
        vision_check = HealthCheckResponse(
            status="unavailable",
            message="Analyse visuelle indisponible tant que Ollama reste inaccessible.",
            details={**model_details, "error": error},
        )
        ollama_check = HealthCheckResponse(
            status="degraded",
            message="Ollama indisponible.",
            details={**model_details, "error": error},
        )
        return ollama_check, chat_check, vision_check

    chat_available = _matches_ollama_model(models, settings.ollama_model)
    vision_available = _matches_ollama_model(models, settings.ollama_vision_model)
    catalog_details = {
        **model_details,
        "available_models": models,
        "models_count": len(models),
    }

    chat_check = HealthCheckResponse(
        status="ok" if chat_available else "degraded",
        message=(
            "Modele de chat Ollama disponible."
            if chat_available
            else (
                f"Le modele de chat `{settings.ollama_model}` est absent. "
                f"Executez `ollama pull {settings.ollama_model}`."
            )
        ),
        details=catalog_details,
    )
    vision_check = HealthCheckResponse(
        status="ok" if vision_available else "unavailable",
        message=(
            "Modele de vision Ollama disponible."
            if vision_available
            else (
                f"Le modele vision `{settings.ollama_vision_model}` est absent. "
                f"Vision desactivee, utilisez `ollama pull {settings.ollama_vision_model}` pour l'activer."
            )
        ),
        details={**catalog_details, "fallback_mode": "ocr_text" if not vision_available else None},
    )

    if chat_available and vision_available:
        ollama_message = "Ollama disponible pour le chat et la vision."
        ollama_status = "ok"
    elif chat_available:
        ollama_message = "Ollama disponible pour le chat, vision desactivee."
        ollama_status = "degraded"
    else:
        ollama_message = "Ollama partiellement disponible."
        ollama_status = "degraded"

    ollama_check = HealthCheckResponse(
        status=ollama_status,
        message=ollama_message,
        details=catalog_details,
    )
    return ollama_check, chat_check, vision_check


def _check_csv_source(source: ResolvedDataSource) -> HealthCheckResponse:
    if source.path is None:
        return HealthCheckResponse(
            status="missing",
            message=f"La source analytique {source.key} n'est pas encore disponible.",
            details=_build_data_source_details(source),
        )

    try:
        row_count = _count_csv_rows(source.path)
    except Exception as exc:  # pragma: no cover - exercised via tests with monkeypatch
        return HealthCheckResponse(
            status="degraded",
            message=f"La source analytique {source.key} est presente mais illisible.",
            details=_build_data_source_details(source, error=str(exc)),
        )

    return HealthCheckResponse(
        status="ok",
        message=f"Source analytique {source.key} chargee.",
        details=_build_data_source_details(source, rows=row_count),
    )


def _build_csv_aggregate(csv_checks: dict[str, HealthCheckResponse]) -> HealthCheckResponse:
    unavailable_sources = [
        source_name
        for source_name, source_check in csv_checks.items()
        if source_check.status != "ok"
    ]
    if not unavailable_sources:
        return HealthCheckResponse(
            status="ok",
            message="Toutes les sources CSV sont disponibles.",
            details={"services": csv_checks},
        )

    return HealthCheckResponse(
        status="degraded",
        message="Certaines sources CSV optionnelles sont indisponibles.",
        details={
            "services": {
                source_name: source_check.model_dump(mode="json")
                for source_name, source_check in csv_checks.items()
            },
            "unavailable_sources": unavailable_sources,
        },
    )


async def _check_websocket() -> HealthCheckResponse:
    try:
        await ensure_live_monitoring_started()
        status = get_live_monitoring_status()
    except Exception as exc:  # pragma: no cover - exercised via tests with monkeypatch
        return HealthCheckResponse(
            status="degraded",
            message="Flux WebSocket indisponible.",
            details={"error": str(exc)},
        )

    return HealthCheckResponse(
        status="ok",
        message="Flux WebSocket disponible.",
        details={
            "path": status.websocket_path,
            "active": status.active,
            "mode": status.mode,
            "connected_clients": status.connected_clients,
            "latest_tick": status.latest_tick,
        },
    )


def log_health_status(payload: HealthResponse) -> None:
    if not get_settings().is_development:
        return

    level = logging.INFO if payload.status == "ok" else logging.WARNING
    HEALTH_LOGGER.log(
        level,
        "event=%s status=%s environment=%s version=%s",
        "BACKEND_ONLINE" if payload.status != "error" else "BACKEND_OFFLINE",
        payload.status,
        payload.environment,
        payload.version,
    )

    component_events = {
        "backend": "API_READY",
        "postgres": "POSTGRES_CONNECTED",
        "ollama_chat": "OLLAMA_CHAT_READY",
        "ollama_vision": "OLLAMA_VISION_READY",
        "cdr_analytics": "CDR_ANALYTICS_SOURCE",
        "mobile_fleet": "MOBILE_FLEET_SOURCE",
        "customer_churn_input": "CUSTOMER_CHURN_INPUT_SOURCE",
        "customer_churn_output": "CUSTOMER_CHURN_OUTPUT_SOURCE",
        "websocket": "WEBSOCKET_CONNECTED",
    }

    for component_name, component in payload.services.items():
        component_level = logging.INFO
        if component.status != "ok":
            is_optional_missing = (
                component.status == "missing"
                and bool(component.details.get("optional"))
            )
            if not is_optional_missing:
                component_level = logging.WARNING
        HEALTH_LOGGER.log(
            component_level,
            "event=%s status=%s message=%s details=%s",
            component_events.get(component_name, component_name.upper()),
            component.status,
            component.message,
            component.details,
        )


async def collect_health_status() -> HealthResponse:
    settings = get_settings()

    database_check = await asyncio.to_thread(_check_database)
    cdr_analytics_check, mobile_fleet_check, customer_churn_input_check, customer_churn_output_check = await asyncio.gather(
        asyncio.to_thread(_check_csv_source, settings.resolve_cdr_analytics_source()),
        asyncio.to_thread(_check_csv_source, settings.resolve_mobile_fleet_source()),
        asyncio.to_thread(_check_csv_source, settings.resolve_customer_churn_input_source()),
        asyncio.to_thread(_check_csv_source, settings.resolve_customer_churn_output_source()),
    )
    ollama_check, ollama_chat_check, ollama_vision_check = await _check_ollama_services()
    websocket_check = await _check_websocket()

    csv_checks = {
        "cdr_analytics": cdr_analytics_check,
        "mobile_fleet": mobile_fleet_check,
        "customer_churn_input": customer_churn_input_check,
        "customer_churn_output": customer_churn_output_check,
    }
    csv_aggregate_check = _build_csv_aggregate(csv_checks)

    backend_check = HealthCheckResponse(
        status="ok",
        message="API FastAPI disponible.",
        details={
            "api_prefix": settings.api_v1_prefix,
            "frontend_url": settings.frontend_url,
        },
    )

    overall_status = "ok"
    if database_check.status == "error":
        overall_status = "error"
    elif any(
        check.status != "ok"
        for check in (ollama_chat_check, websocket_check)
    ):
        overall_status = "degraded"

    services_map = {
        "backend": backend_check,
        "postgres": database_check,
        "ollama_chat": ollama_chat_check,
        "ollama_vision": ollama_vision_check,
        "cdr_analytics": cdr_analytics_check,
        "mobile_fleet": mobile_fleet_check,
        "customer_churn_input": customer_churn_input_check,
        "customer_churn_output": customer_churn_output_check,
        "websocket": websocket_check,
    }
    legacy_checks_map = {
        **services_map,
        "database": database_check,
        "ollama": ollama_check,
        "csv": csv_aggregate_check,
    }

    return HealthResponse(
        status=overall_status,
        app_name=settings.app_name,
        environment=settings.app_env,
        version=settings.app_version,
        timestamp=_utcnow_iso(),
        services=HealthChecksResponse(root=services_map),
        checks=HealthChecksResponse(root=legacy_checks_map),
    )

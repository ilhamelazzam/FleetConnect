import asyncio
import logging
from types import SimpleNamespace
from pathlib import Path

from app.schemas.common import HealthCheckResponse, HealthChecksResponse, HealthResponse
from app.core.config import get_settings
from app.services.health_service import collect_health_status, log_health_status


def _write_csv(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")


def test_collect_health_status_keeps_global_ok_for_optional_missing_services(
    monkeypatch,
    tmp_path: Path,
) -> None:
    cdr_csv = tmp_path / "cdr.csv"
    churn_input_csv = tmp_path / "customer_input.csv"
    churn_output_csv = tmp_path / "customer_output.csv"
    missing_mobile_csv = tmp_path / "missing_mobile.csv"

    _write_csv(
        cdr_csv,
        "start_time;duration_sec;call_type\n2026-07-16 10:00:00;60;local\n",
    )
    _write_csv(
        churn_input_csv,
        "customerID,gender\n0001,Female\n",
    )
    _write_csv(
        churn_output_csv,
        "gender;operator;department;monthly_cost_mad\nFemale;Maroc Telecom;IT;320.0\n",
    )

    monkeypatch.setenv("CDR_ANALYTICS_CSV_PATH", str(cdr_csv))
    monkeypatch.setenv("CUSTOMER_CHURN_INPUT_CSV_PATH", str(churn_input_csv))
    monkeypatch.setenv("CUSTOMER_CHURN_OUTPUT_CSV_PATH", str(churn_output_csv))
    monkeypatch.setenv("MOBILE_FLEET_CSV_PATH", str(missing_mobile_csv))
    get_settings.cache_clear()

    async def fake_ensure_live_monitoring_started() -> None:
        return None

    monkeypatch.setattr(
        "app.services.health_service._fetch_ollama_models",
        lambda: asyncio.sleep(0, result=(["llama3.2:3b"], None)),
    )
    monkeypatch.setattr(
        "app.services.health_service.ensure_live_monitoring_started",
        fake_ensure_live_monitoring_started,
    )
    monkeypatch.setattr(
        "app.services.health_service.get_live_monitoring_status",
        lambda: SimpleNamespace(
            websocket_path="/api/v1/live/stream",
            active=True,
            mode="test",
            connected_clients=0,
            latest_tick=None,
        ),
    )

    payload = asyncio.run(collect_health_status())

    assert payload.status == "ok"
    assert payload.services["postgres"].status == "ok"
    assert payload.services["ollama_chat"].status == "ok"
    assert payload.services["ollama_vision"].status == "unavailable"
    assert payload.services["mobile_fleet"].status == "missing"
    assert payload.checks is not None
    assert payload.checks["csv"].status == "degraded"

    get_settings.cache_clear()


def test_collect_health_status_degrades_when_chat_model_is_missing(
    monkeypatch,
    tmp_path: Path,
) -> None:
    churn_output_csv = tmp_path / "customer_output.csv"
    _write_csv(
        churn_output_csv,
        "gender;operator;department;monthly_cost_mad\nFemale;Maroc Telecom;IT;320.0\n",
    )

    monkeypatch.setenv("CUSTOMER_CHURN_OUTPUT_CSV_PATH", str(churn_output_csv))
    get_settings.cache_clear()

    async def fake_ensure_live_monitoring_started() -> None:
        return None

    monkeypatch.setattr(
        "app.services.health_service._fetch_ollama_models",
        lambda: asyncio.sleep(0, result=(["llava"], None)),
    )
    monkeypatch.setattr(
        "app.services.health_service.ensure_live_monitoring_started",
        fake_ensure_live_monitoring_started,
    )
    monkeypatch.setattr(
        "app.services.health_service.get_live_monitoring_status",
        lambda: SimpleNamespace(
            websocket_path="/api/v1/live/stream",
            active=True,
            mode="test",
            connected_clients=0,
            latest_tick=None,
        ),
    )

    payload = asyncio.run(collect_health_status())

    assert payload.status == "degraded"
    assert payload.services["ollama_chat"].status == "degraded"
    assert payload.services["ollama_vision"].status == "ok"

    get_settings.cache_clear()


def test_collect_health_status_includes_csv_metadata(
    monkeypatch,
    tmp_path: Path,
) -> None:
    mobile_csv = tmp_path / "mobile_fleet.csv"
    mobile_csv.write_text(
        "operator;department;employee_profile\nMaroc Telecom;IT;Usage standard\n",
        encoding="utf-8",
    )

    monkeypatch.setenv("MOBILE_FLEET_CSV_PATH", str(mobile_csv))
    get_settings.cache_clear()

    async def fake_ensure_live_monitoring_started() -> None:
        return None

    monkeypatch.setattr(
        "app.services.health_service._fetch_ollama_models",
        lambda: asyncio.sleep(0, result=(["llama3.2:3b"], None)),
    )
    monkeypatch.setattr(
        "app.services.health_service.ensure_live_monitoring_started",
        fake_ensure_live_monitoring_started,
    )
    monkeypatch.setattr(
        "app.services.health_service.get_live_monitoring_status",
        lambda: SimpleNamespace(
            websocket_path="/api/v1/live/stream",
            active=True,
            mode="test",
            connected_clients=0,
            latest_tick=None,
        ),
    )

    payload = asyncio.run(collect_health_status())

    mobile_details = payload.services["mobile_fleet"].details
    assert mobile_details["selected_path"] == str(mobile_csv)
    assert mobile_details["selected_path_modified_at"] is not None
    assert mobile_details["selected_path_size_bytes"] == mobile_csv.stat().st_size

    get_settings.cache_clear()


def test_log_health_status_uses_info_for_optional_missing_sources(caplog) -> None:
    payload = HealthResponse(
        status="ok",
        app_name="FleetConnect API",
        environment="test",
        version="0.1.0",
        timestamp="2026-07-16T12:00:00+00:00",
        services=HealthChecksResponse(
            root={
                "backend": HealthCheckResponse(
                    status="ok",
                    message="API FastAPI disponible.",
                    details={},
                ),
                "mobile_fleet": HealthCheckResponse(
                    status="missing",
                    message="La source analytique mobile_fleet n'est pas encore disponible.",
                    details={"optional": True},
                ),
            }
        ),
    )

    with caplog.at_level(logging.INFO, logger="app.health"):
        log_health_status(payload)

    mobile_record = next(
        record
        for record in caplog.records
        if "event=MOBILE_FLEET_SOURCE" in record.message
    )
    assert mobile_record.levelno == logging.INFO

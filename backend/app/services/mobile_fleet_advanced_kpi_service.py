from __future__ import annotations

import csv
import logging
import re
import threading
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.core.config import AI_OUTPUT_DIR, ResolvedDataSource, get_settings

DEFAULT_ADVANCED_KPI_CSV_PATH = AI_OUTPUT_DIR / "fleetconnect_advanced_kpi.csv"
MOBILE_FLEET_ADVANCED_KPI_LOGGER = logging.getLogger("app.mobile_fleet_advanced_kpi")


@dataclass(slots=True)
class _AdvancedKpiCache:
    path: Path | None = None
    mtime: float | None = None
    payload: dict[str, Any] | None = None


_cache = _AdvancedKpiCache()
_cache_lock = threading.Lock()


def clear_mobile_fleet_advanced_kpi_cache() -> None:
    with _cache_lock:
        _cache.path = None
        _cache.mtime = None
        _cache.payload = None


def _default_payload() -> dict[str, Any]:
    return {
        "total_devices": 0,
        "total_estimated_budget_mad": 0.0,
        "total_cost_12_months_mad": 0.0,
        "fleet_health_score": 0,
        "average_fit_score": 0.0,
        "adapted_devices": 0,
        "unfit_devices": 0,
        "oversized_devices": 0,
        "undersized_devices": 0,
        "potential_savings_mad": 0.0,
        "alerts_summary": "",
        "fit_rate_pct": 0.0,
        "optimization_rate_pct": 0.0,
    }


def _resolve_csv_source() -> ResolvedDataSource:
    return get_settings().resolve_mobile_fleet_advanced_kpi_source()


def _detect_csv_delimiter(sample: str) -> str:
    try:
        return csv.Sniffer().sniff(sample, delimiters=";,").delimiter
    except csv.Error:
        return ";" if sample.count(";") >= sample.count(",") else ","


def _normalize_header(value: str) -> str:
    without_accents = "".join(
        character
        for character in unicodedata.normalize("NFKD", value or "")
        if not unicodedata.combining(character)
    )
    normalized = re.sub(r"[^a-z0-9]+", " ", without_accents.lower()).strip()
    return normalized


def _parse_float(raw_value: Any, default: float = 0.0) -> float:
    try:
        if raw_value is None:
            return default
        normalized = str(raw_value).strip().replace(",", ".")
        if normalized == "":
            return default
        return float(normalized)
    except (TypeError, ValueError):
        return default


def _parse_int(raw_value: Any, default: int = 0) -> int:
    return int(round(_parse_float(raw_value, float(default))))


def _parse_csv_payload(csv_path: Path) -> dict[str, Any]:
    header_mapping = {
        "nombre total d appareils": "total_devices",
        "budget total estime mad": "total_estimated_budget_mad",
        "tco total 12 mois mad": "total_cost_12_months_mad",
        "fleet health score": "fleet_health_score",
        "score moyen d adequation": "average_fit_score",
        "appareils adaptes": "adapted_devices",
        "appareils inadaptes": "unfit_devices",
        "appareils surdimensionnes": "oversized_devices",
        "appareils sous dimensionnes": "undersized_devices",
        "economie potentielle mad": "potential_savings_mad",
        "alertes": "alerts_summary",
    }

    with csv_path.open("r", encoding="utf-8-sig", newline="") as csv_file:
        sample = csv_file.read(2048)
        csv_file.seek(0)
        reader = csv.DictReader(csv_file, delimiter=_detect_csv_delimiter(sample))
        raw_row = next(reader, None)

    if raw_row is None:
        return _default_payload()

    normalized_row = {
        header_mapping[_normalize_header(key)]: value
        for key, value in raw_row.items()
        if _normalize_header(key) in header_mapping
    }

    payload = _default_payload()
    payload["total_devices"] = _parse_int(normalized_row.get("total_devices"))
    payload["total_estimated_budget_mad"] = round(
        _parse_float(normalized_row.get("total_estimated_budget_mad")),
        2,
    )
    payload["total_cost_12_months_mad"] = round(
        _parse_float(normalized_row.get("total_cost_12_months_mad")),
        2,
    )
    payload["fleet_health_score"] = _parse_int(normalized_row.get("fleet_health_score"))
    payload["average_fit_score"] = round(
        _parse_float(normalized_row.get("average_fit_score")),
        2,
    )
    payload["adapted_devices"] = _parse_int(normalized_row.get("adapted_devices"))
    payload["unfit_devices"] = _parse_int(normalized_row.get("unfit_devices"))
    payload["oversized_devices"] = _parse_int(normalized_row.get("oversized_devices"))
    payload["undersized_devices"] = _parse_int(normalized_row.get("undersized_devices"))
    payload["potential_savings_mad"] = round(
        _parse_float(normalized_row.get("potential_savings_mad")),
        2,
    )
    payload["alerts_summary"] = str(normalized_row.get("alerts_summary") or "").strip()

    total_devices = payload["total_devices"]
    if total_devices > 0:
        payload["fit_rate_pct"] = round((payload["adapted_devices"] / total_devices) * 100, 2)
        payload["optimization_rate_pct"] = round(
            ((payload["oversized_devices"] + payload["undersized_devices"]) / total_devices) * 100,
            2,
        )

    return payload


def get_mobile_fleet_advanced_kpis() -> dict[str, Any]:
    source = _resolve_csv_source()
    csv_path = source.path or source.configured_path or DEFAULT_ADVANCED_KPI_CSV_PATH

    if not csv_path.exists():
        MOBILE_FLEET_ADVANCED_KPI_LOGGER.info(
            "event=csv_source_missing source=%s preferred=%s searched=%s configured_path=%s",
            source.key,
            source.preferred_name,
            [str(path) for path in source.searched_paths],
            str(source.configured_path) if source.configured_path else None,
        )
        return _default_payload()

    current_mtime = csv_path.stat().st_mtime

    with _cache_lock:
        if (
            _cache.payload is not None
            and _cache.path == csv_path
            and _cache.mtime == current_mtime
        ):
            return _cache.payload

    try:
        payload = _parse_csv_payload(csv_path)
    except Exception as exc:
        MOBILE_FLEET_ADVANCED_KPI_LOGGER.warning(
            "event=csv_source_read_failed source=%s path=%s searched=%s error=%s",
            source.key,
            str(csv_path),
            [str(path) for path in source.searched_paths],
            str(exc),
        )
        return _default_payload()

    MOBILE_FLEET_ADVANCED_KPI_LOGGER.info(
        "event=csv_source_loaded source=%s path=%s searched=%s",
        source.key,
        str(csv_path),
        [str(path) for path in source.searched_paths],
    )

    with _cache_lock:
        _cache.path = csv_path
        _cache.mtime = current_mtime
        _cache.payload = payload

    return payload

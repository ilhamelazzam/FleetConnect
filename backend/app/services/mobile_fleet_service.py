from __future__ import annotations

import csv
import threading
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.core.config import get_settings

UNKNOWN_VALUE = "Inconnu"
RISK_LEVEL_ORDER = ("Critique", "Eleve", "Moyen", "Faible")
DEFAULT_MOBILE_FLEET_CSV_PATH = (
    Path(__file__).resolve().parents[3]
    / "ai"
    / "data"
    / "output"
    / "mobile_fleet_project_ready.csv"
)


@dataclass(slots=True)
class _MobileFleetCache:
    path: Path | None = None
    mtime: float | None = None
    rows: list[dict[str, Any]] | None = None


_cache = _MobileFleetCache()
_cache_lock = threading.Lock()


def clear_mobile_fleet_cache() -> None:
    with _cache_lock:
        _cache.path = None
        _cache.mtime = None
        _cache.rows = None


def _resolve_csv_path() -> Path:
    settings = get_settings()
    configured_path = settings.mobile_fleet_csv_path

    if configured_path:
        candidate = Path(configured_path)
        if not candidate.is_absolute():
            candidate = Path(__file__).resolve().parents[3] / candidate
        return candidate

    return DEFAULT_MOBILE_FLEET_CSV_PATH


def _parse_float(raw_value: Any, default: float = 0.0) -> float:
    try:
        if raw_value is None or str(raw_value).strip() == "":
            return default
        return float(str(raw_value).strip())
    except (TypeError, ValueError):
        return default


def _parse_int(raw_value: Any, default: int = 0) -> int:
    try:
        if raw_value is None or str(raw_value).strip() == "":
            return default
        return int(float(str(raw_value).strip()))
    except (TypeError, ValueError):
        return default


def _normalize_text(raw_value: Any, *, fallback: str = UNKNOWN_VALUE) -> str:
    if raw_value is None:
        return fallback

    normalized = str(raw_value).strip()
    return normalized or fallback


def _strip_accents(value: str) -> str:
    return "".join(
        character
        for character in unicodedata.normalize("NFKD", value)
        if not unicodedata.combining(character)
    )


def _normalize_risk_level(raw_value: Any) -> str:
    normalized = _strip_accents(_normalize_text(raw_value, fallback="Faible")).lower()

    if "critique" in normalized:
        return "Critique"
    if "eleve" in normalized:
        return "Eleve"
    if "moyen" in normalized:
        return "Moyen"
    return "Faible"


def _risk_rank(risk_level: str) -> int:
    try:
        return RISK_LEVEL_ORDER.index(risk_level)
    except ValueError:
        return len(RISK_LEVEL_ORDER)


def _normalize_mobile_fleet_row(row_index: int, row: dict[str, str]) -> dict[str, Any]:
    device_category = _normalize_text(row.get("device_category"))
    estimated_price_mad = round(_parse_float(row.get("estimated_price_mad")), 2)
    budget_risk_score = round(_parse_float(row.get("budget_risk_score")), 1)
    risk_level = _normalize_risk_level(row.get("risk_level"))
    alert_flag = _parse_int(row.get("alert_flag")) == 1

    return {
        "fleet_row_id": row_index,
        "operator": _normalize_text(row.get("operator")),
        "department": _normalize_text(row.get("department")),
        "employee_profile": _normalize_text(row.get("employee_profile")),
        "device_category": device_category,
        "estimated_price_mad": estimated_price_mad,
        "budget_risk_score": budget_risk_score,
        "risk_level": risk_level,
        "alert_flag": alert_flag,
        "recommendation": _normalize_text(row.get("recommendation")),
        "real_price_range": _parse_int(row.get("real_price_range")),
        "real_price_label": _normalize_text(row.get("real_price_label")),
        "predicted_price_range": _parse_int(row.get("predicted_price_range")),
        "predicted_price_label": _normalize_text(row.get("predicted_price_label")),
        "prediction_confidence": round(_parse_float(row.get("prediction_confidence")), 4),
        "is_premium": device_category == "Premium",
        "is_priority": alert_flag or risk_level in {"Critique", "Eleve"},
    }


def _build_mobile_risk_insight(row: dict[str, Any]) -> dict[str, Any]:
    default_recommendation = (
        "Verifier la categorie de ressource, l'usage metier et le forfait associe."
    )
    recommendation = row["recommendation"] or default_recommendation
    if row["risk_level"] == "Critique":
        suggested_action = "Revoir immediatement l'attribution et proposer un forfait plus adapte."
    elif row["risk_level"] == "Eleve":
        suggested_action = "Comparer le cout estime avec le besoin metier avant renouvellement."
    elif row["budget_risk_score"] >= 40:
        suggested_action = (
            "Suivre le cout et valider que la categorie correspond au profil utilisateur."
        )
    else:
        suggested_action = "Maintenir la surveillance budgetaire standard."

    return {
        "risk_id": f"mobile-fleet-{row['fleet_row_id']}",
        "title": f"Risque budget appareil-{row['fleet_row_id']}",
        "description": (
            f"{row['device_category']} attribue au profil {row['employee_profile']} "
            f"avec un niveau {row['risk_level'].lower()}."
        ),
        "impact": (
            f"{row['estimated_price_mad']:.2f} MAD estimes, score budget "
            f"{row['budget_risk_score']:.1f}/100."
        ),
        "ai_recommendation": recommendation,
        "suggested_action": suggested_action,
        "confidence_score": row["prediction_confidence"],
    }


def _parse_mobile_fleet_csv(csv_path: Path) -> list[dict[str, Any]]:
    with csv_path.open("r", encoding="utf-8-sig", newline="") as csv_file:
        reader = csv.DictReader(csv_file)
        return [
            _normalize_mobile_fleet_row(row_index, row)
            for row_index, row in enumerate(reader, start=1)
        ]


def _load_mobile_fleet_rows() -> list[dict[str, Any]]:
    csv_path = _resolve_csv_path()
    if not csv_path.exists():
        raise FileNotFoundError(f"Mobile fleet CSV not found at {csv_path}")

    current_mtime = csv_path.stat().st_mtime

    with _cache_lock:
        if (
            _cache.rows is not None
            and _cache.path == csv_path
            and _cache.mtime == current_mtime
        ):
            return _cache.rows

    rows = _parse_mobile_fleet_csv(csv_path)

    with _cache_lock:
        _cache.path = csv_path
        _cache.mtime = current_mtime
        _cache.rows = rows

    return rows


def _matches_filters(
    row: dict[str, Any],
    *,
    search: str | None = None,
    operator: str | None = None,
    department: str | None = None,
    employee_profile: str | None = None,
    device_category: str | None = None,
    risk_level: str | None = None,
) -> bool:
    if operator and row["operator"] != operator:
        return False
    if department and row["department"] != department:
        return False
    if employee_profile and row["employee_profile"] != employee_profile:
        return False
    if device_category and row["device_category"] != device_category:
        return False
    if risk_level and row["risk_level"] != risk_level:
        return False

    if not search:
        return True

    normalized_search = _strip_accents(search.strip()).lower()
    if normalized_search == "":
        return True

    searchable_values = (
        str(row["fleet_row_id"]),
        row["operator"],
        row["department"],
        row["employee_profile"],
        row["device_category"],
        row["recommendation"],
        row["predicted_price_label"],
        row["risk_level"],
    )

    return any(
        normalized_search in _strip_accents(str(value)).lower()
        for value in searchable_values
    )


def _filter_rows(
    *,
    priority_only: bool = False,
    search: str | None = None,
    operator: str | None = None,
    department: str | None = None,
    employee_profile: str | None = None,
    device_category: str | None = None,
    risk_level: str | None = None,
) -> list[dict[str, Any]]:
    rows = _load_mobile_fleet_rows()
    filtered_rows = [
        row
        for row in rows
        if _matches_filters(
            row,
            search=search,
            operator=operator,
            department=department,
            employee_profile=employee_profile,
            device_category=device_category,
            risk_level=risk_level,
        )
    ]

    if priority_only:
        filtered_rows = [row for row in filtered_rows if row["is_priority"]]

    return filtered_rows


def _serialize_device(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "fleet_row_id": row["fleet_row_id"],
        "operator": row["operator"],
        "department": row["department"],
        "employee_profile": row["employee_profile"],
        "device_category": row["device_category"],
        "estimated_price_mad": row["estimated_price_mad"],
        "budget_risk_score": row["budget_risk_score"],
        "risk_level": row["risk_level"],
        "alert_flag": row["alert_flag"],
        "recommendation": row["recommendation"],
        "predicted_price_label": row["predicted_price_label"],
        "prediction_confidence": row["prediction_confidence"],
        **_build_mobile_risk_insight(row),
    }


def _serialize_recommendation(row: dict[str, Any]) -> dict[str, Any]:
    return {
        **_serialize_device(row),
        "priority_rank": _risk_rank(row["risk_level"]),
    }


def _sort_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        rows,
        key=lambda row: (
            _risk_rank(row["risk_level"]),
            -row["alert_flag"],
            -row["budget_risk_score"],
            -row["estimated_price_mad"],
            row["fleet_row_id"],
        ),
    )


def _build_kpis(rows: list[dict[str, Any]]) -> dict[str, Any]:
    total_devices = len(rows)
    total_estimated_budget_mad = round(sum(row["estimated_price_mad"] for row in rows), 2)
    average_budget_risk_score = (
        round(sum(row["budget_risk_score"] for row in rows) / total_devices, 2)
        if total_devices
        else 0.0
    )
    average_estimated_price_mad = (
        round(total_estimated_budget_mad / total_devices, 2) if total_devices else 0.0
    )

    return {
        "total_devices": total_devices,
        "total_estimated_budget_mad": total_estimated_budget_mad,
        "average_estimated_price_mad": average_estimated_price_mad,
        "average_budget_risk_score": average_budget_risk_score,
        "alert_devices": sum(1 for row in rows if row["alert_flag"]),
        "critical_risks": sum(1 for row in rows if row["risk_level"] == "Critique"),
        "premium_devices": sum(1 for row in rows if row["is_premium"]),
    }


def _build_distribution(counter: Counter[str]) -> list[dict[str, Any]]:
    return [
        {"label": label, "count": count}
        for label, count in sorted(counter.items(), key=lambda item: item[1], reverse=True)
    ]


def _build_budget_breakdown(rows: list[dict[str, Any]], group_key: str) -> list[dict[str, Any]]:
    grouped_rows: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped_rows[row[group_key]].append(row)

    return [
        {
            "label": label,
            "total_estimated_price_mad": round(
                sum(grouped_row["estimated_price_mad"] for grouped_row in grouped_rows[label]),
                2,
            ),
            "average_budget_risk_score": round(
                sum(grouped_row["budget_risk_score"] for grouped_row in grouped_rows[label])
                / len(grouped_rows[label]),
                2,
            ),
            "alert_devices": sum(
                1 for grouped_row in grouped_rows[label] if grouped_row["alert_flag"]
            ),
        }
        for label in sorted(
            grouped_rows,
            key=lambda current_label: sum(
                grouped_row["estimated_price_mad"] for grouped_row in grouped_rows[current_label]
            ),
            reverse=True,
        )
    ]


def get_mobile_fleet_filters() -> dict[str, list[str]]:
    rows = _load_mobile_fleet_rows()
    return {
        "operators": sorted({row["operator"] for row in rows}),
        "departments": sorted({row["department"] for row in rows}),
        "employee_profiles": sorted({row["employee_profile"] for row in rows}),
        "device_categories": sorted({row["device_category"] for row in rows}),
        "risk_levels": list(RISK_LEVEL_ORDER),
        "predicted_price_labels": sorted({row["predicted_price_label"] for row in rows}),
    }


def get_mobile_fleet_overview(
    *,
    search: str | None = None,
    operator: str | None = None,
    department: str | None = None,
    employee_profile: str | None = None,
    device_category: str | None = None,
    risk_level: str | None = None,
) -> dict[str, Any]:
    rows = _filter_rows(
        search=search,
        operator=operator,
        department=department,
        employee_profile=employee_profile,
        device_category=device_category,
        risk_level=risk_level,
    )

    risk_counter = Counter(row["risk_level"] for row in rows)
    operator_counter = Counter(row["operator"] for row in rows)
    category_counter = Counter(row["device_category"] for row in rows)

    return {
        "kpis": _build_kpis(rows),
        "risk_distribution": [
            {"label": risk_label, "count": risk_counter.get(risk_label, 0)}
            for risk_label in RISK_LEVEL_ORDER
        ],
        "devices_by_operator": _build_distribution(operator_counter),
        "devices_by_category": _build_distribution(category_counter),
        "budget_by_department": _build_budget_breakdown(rows, "department"),
        "top_devices": [_serialize_device(row) for row in _sort_rows(rows)[:8]],
    }


def list_mobile_fleet_devices(
    *,
    offset: int = 0,
    limit: int = 50,
    search: str | None = None,
    operator: str | None = None,
    department: str | None = None,
    employee_profile: str | None = None,
    device_category: str | None = None,
    risk_level: str | None = None,
) -> dict[str, Any]:
    rows = _sort_rows(
        _filter_rows(
            search=search,
            operator=operator,
            department=department,
            employee_profile=employee_profile,
            device_category=device_category,
            risk_level=risk_level,
        )
    )

    return {
        "total": len(rows),
        "offset": offset,
        "limit": limit,
        "items": [_serialize_device(row) for row in rows[offset : offset + limit]],
    }


def get_mobile_fleet_consumption(
    *,
    search: str | None = None,
    operator: str | None = None,
    department: str | None = None,
    employee_profile: str | None = None,
    device_category: str | None = None,
    risk_level: str | None = None,
) -> dict[str, Any]:
    rows = _filter_rows(
        search=search,
        operator=operator,
        department=department,
        employee_profile=employee_profile,
        device_category=device_category,
        risk_level=risk_level,
    )

    risk_counter = Counter(row["risk_level"] for row in rows)

    return {
        "kpis": _build_kpis(rows),
        "budget_by_operator": _build_budget_breakdown(rows, "operator"),
        "budget_by_device_category": _build_budget_breakdown(rows, "device_category"),
        "risk_distribution": [
            {"label": risk_label, "count": risk_counter.get(risk_label, 0)}
            for risk_label in RISK_LEVEL_ORDER
        ],
        "top_expensive_devices": [
            _serialize_device(row)
            for row in sorted(
                rows,
                key=lambda row: (
                    -row["estimated_price_mad"],
                    -row["budget_risk_score"],
                    row["fleet_row_id"],
                ),
            )[:10]
        ],
    }


def list_mobile_fleet_recommendations(
    *,
    offset: int = 0,
    limit: int = 50,
    search: str | None = None,
    operator: str | None = None,
    department: str | None = None,
    employee_profile: str | None = None,
    device_category: str | None = None,
    risk_level: str | None = None,
) -> dict[str, Any]:
    rows = _sort_rows(
        _filter_rows(
            priority_only=True,
            search=search,
            operator=operator,
            department=department,
            employee_profile=employee_profile,
            device_category=device_category,
            risk_level=risk_level,
        )
    )

    return {
        "total": len(rows),
        "offset": offset,
        "limit": limit,
        "items": [_serialize_recommendation(row) for row in rows[offset : offset + limit]],
    }


def get_mobile_fleet_reports(
    *,
    search: str | None = None,
    operator: str | None = None,
    department: str | None = None,
    employee_profile: str | None = None,
    device_category: str | None = None,
    risk_level: str | None = None,
) -> dict[str, Any]:
    rows = _filter_rows(
        search=search,
        operator=operator,
        department=department,
        employee_profile=employee_profile,
        device_category=device_category,
        risk_level=risk_level,
    )

    recommendations_by_department: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        if row["is_priority"]:
            recommendations_by_department[row["department"]].append(row)

    recommendation_department_rows = [
        {
            "department": department_name,
            "devices_to_optimize": len(department_rows),
            "alert_devices": sum(
                1 for department_row in department_rows if department_row["alert_flag"]
            ),
            "critical_risks": sum(
                1
                for department_row in department_rows
                if department_row["risk_level"] == "Critique"
            ),
            "estimated_budget_mad": round(
                sum(department_row["estimated_price_mad"] for department_row in department_rows),
                2,
            ),
        }
        for department_name, department_rows in sorted(
            recommendations_by_department.items(),
            key=lambda item: sum(row["estimated_price_mad"] for row in item[1]),
            reverse=True,
        )
    ]

    return {
        "kpis": _build_kpis(rows),
        "budget_by_department": _build_budget_breakdown(rows, "department"),
        "devices_by_category": _build_distribution(Counter(row["device_category"] for row in rows)),
        "risk_distribution": [
            {
                "label": risk_label,
                "count": Counter(row["risk_level"] for row in rows).get(risk_label, 0),
            }
            for risk_label in RISK_LEVEL_ORDER
        ],
        "recommendations_by_department": recommendation_department_rows,
        "top_recommendations": [
            _serialize_recommendation(row)
            for row in _sort_rows([row for row in rows if row["is_priority"]])[:8]
        ],
    }

from __future__ import annotations

import csv
import logging
import threading
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any
import unicodedata

from app.core.config import AI_OUTPUT_DIR, ResolvedDataSource, get_settings

UNKNOWN_VALUE = "Inconnu"
SEVERITY_ORDER = ("critique", "eleve", "moyen", "faible")
DEFAULT_CDR_ANALYTICS_CSV_PATH = AI_OUTPUT_DIR / "telecom_cdr_fraud_fleetconnect_enriched.csv"
CDR_ANALYTICS_LOGGER = logging.getLogger("app.cdr_analytics")


@dataclass(slots=True)
class _CdrAnalyticsCache:
    path: Path | None = None
    mtime: float | None = None
    rows: list[dict[str, Any]] | None = None


_cache = _CdrAnalyticsCache()
_cache_lock = threading.Lock()


def clear_cdr_analytics_cache() -> None:
    with _cache_lock:
        _cache.path = None
        _cache.mtime = None
        _cache.rows = None


def _resolve_csv_source() -> ResolvedDataSource:
    return get_settings().resolve_cdr_analytics_source()


def _resolve_csv_path() -> Path:
    source = _resolve_csv_source()
    return source.path or source.configured_path or DEFAULT_CDR_ANALYTICS_CSV_PATH


def _parse_int(raw_value: Any, default: int = 0) -> int:
    try:
        if raw_value is None or str(raw_value).strip() == "":
            return default
        return int(float(str(raw_value).strip()))
    except (TypeError, ValueError):
        return default


def _parse_float(raw_value: Any, default: float = 0.0) -> float:
    try:
        if raw_value is None or str(raw_value).strip() == "":
            return default
        return float(str(raw_value).strip())
    except (TypeError, ValueError):
        return default


def _normalize_text(raw_value: Any, *, fallback: str = UNKNOWN_VALUE) -> str:
    if raw_value is None:
        return fallback

    normalized = str(raw_value).strip()
    return normalized or fallback


def _normalize_fraud_type(raw_value: Any) -> str:
    fraud_type = _normalize_text(raw_value, fallback="none")
    return fraud_type.lower().replace("-", "_").replace(" ", "_")


def _strip_accents(value: str) -> str:
    return "".join(
        character
        for character in unicodedata.normalize("NFKD", value)
        if not unicodedata.combining(character)
    )


def _normalize_severity(raw_value: Any, fallback_score: float) -> str:
    normalized = _strip_accents(_normalize_text(raw_value, fallback="")).lower()

    if "crit" in normalized:
        return "critique"
    if "elev" in normalized or "high" in normalized:
        return "eleve"
    if "moy" in normalized or "med" in normalized:
        return "moyen"
    if "faib" in normalized or "low" in normalized:
        return "faible"

    return _get_severity(fallback_score)


def _get_severity(score: float) -> str:
    if score >= 80:
        return "critique"
    if score >= 60:
        return "eleve"
    if score >= 40:
        return "moyen"
    return "faible"


def _derive_investigation_priority(severity: str, score: float) -> str:
    if severity == "critique" or score >= 85:
        return "P1"
    if severity == "eleve" or score >= 65:
        return "P2"
    if severity == "moyen" or score >= 40:
        return "P3"
    return "P4"


def _derive_ai_recommendation_priority(severity: str, high_cost_flag: bool) -> str:
    if severity == "critique":
        return "Immediate"
    if high_cost_flag or severity == "eleve":
        return "High"
    if severity == "moyen":
        return "Medium"
    return "Low"


def _build_recommendation(
    *,
    fraud_type: str,
    roaming_flag: bool,
    international_flag: bool,
    high_cost_flag: bool,
    long_duration_flag: bool,
    severity: str,
) -> tuple[str, str, list[str]]:
    rule_matches: list[str] = []

    if fraud_type not in {"none", "unknown", "inconnu"}:
        if "sim_box" in fraud_type:
            rule_matches.append("Fraude SIM box detectee")
        else:
            rule_matches.append(f"Type de fraude detecte: {fraud_type.replace('_', ' ')}")

    if roaming_flag:
        rule_matches.append("Usage roaming detecte")
    if international_flag:
        rule_matches.append("Appel international detecte")
    if high_cost_flag:
        rule_matches.append("Cout d'appel eleve")
    if long_duration_flag:
        rule_matches.append("Duree anormalement longue")
    if not rule_matches:
        rule_matches.append(f"Risque {severity}, revue manuelle recommandee")

    if "sim_box" in fraud_type:
        return (
            "Bloquer la SIM et ouvrir une investigation fraude",
            "La combinaison du type de fraude et du score de risque justifie une "
            "isolation immediate.",
            rule_matches,
        )
    if roaming_flag:
        return (
            "Verifier le roaming et restreindre l'itinerrance si necessaire",
            "Un appel suspect en roaming doit etre confirme rapidement pour limiter l'exposition.",
            rule_matches,
        )
    if international_flag:
        return (
            "Auditer les appels internationaux et confirmer la legitimite",
            "Les destinations internationales augmentent le risque financier et "
            "meritent une verification.",
            rule_matches,
        )
    if high_cost_flag:
        return (
            "Controler le cout et verifier la facturation associee",
            "Le montant de l'appel est eleve et doit etre rapproche de l'usage attendu.",
            rule_matches,
        )
    if long_duration_flag:
        return (
            "Examiner la duree de l'appel et confirmer l'usage",
            "Une duree inhabituelle peut signaler un usage detourne ou non conforme.",
            rule_matches,
        )

    return (
        "Declencher une revue manuelle par l'equipe fraude",
        "Le score de risque est suffisant pour justifier une analyse manuelle.",
        rule_matches,
    )


def _normalize_cdr_row(row_index: int, row: dict[str, str]) -> dict[str, Any]:
    fraud_risk_score_100 = round(_parse_float(row.get("fraud_risk_score_100")), 1)
    fraud_risk_proba = round(_parse_float(row.get("fraud_risk_proba")), 6)
    fraud_flag = _parse_int(row.get("fraud_flag")) == 1
    fraud_type = _normalize_fraud_type(row.get("fraud_type"))
    roaming_flag = _parse_int(row.get("roaming_flag")) == 1
    high_cost_flag = _parse_int(row.get("high_cost_flag")) == 1
    long_duration_flag = _parse_int(row.get("long_duration_flag")) == 1
    international_flag = _parse_int(row.get("international_flag")) == 1
    severity = _normalize_severity(
        row.get("fraud_severity") or row.get("risk_level"),
        fraud_risk_score_100,
    )
    fallback_recommendation, recommendation_reason, rule_matches = _build_recommendation(
        fraud_type=fraud_type,
        roaming_flag=roaming_flag,
        international_flag=international_flag,
        high_cost_flag=high_cost_flag,
        long_duration_flag=long_duration_flag,
        severity=severity,
    )
    csv_recommendation = _normalize_text(row.get("recommendation"), fallback="")
    recommendation = csv_recommendation or fallback_recommendation

    location_origin = _normalize_text(row.get("location_origin"))
    country_origin = _normalize_text(row.get("country_origin"))
    location_dest = _normalize_text(row.get("location_dest"))
    country_dest = _normalize_text(row.get("country_dest"))
    estimated_financial_loss = round(
        _parse_float(row.get("estimated_financial_loss"), default=-1),
        2,
    )
    if estimated_financial_loss < 0:
        estimated_financial_loss = round(
            max(_parse_float(row.get("call_cost_mad")), 0.0),
            2,
        )
    alert_flag = _parse_int(row.get("alert_flag"), default=1 if fraud_flag else 0) == 1
    fraud_severity_score = round(
        _parse_float(row.get("fraud_severity_score"), default=fraud_risk_score_100),
        2,
    )
    investigation_priority = _normalize_text(
        row.get("investigation_priority"),
        fallback=_derive_investigation_priority(severity, fraud_risk_score_100),
    )
    ai_recommendation_priority = _normalize_text(
        row.get("ai_recommendation_priority"),
        fallback=_derive_ai_recommendation_priority(severity, high_cost_flag),
    )

    return {
        "cdr_row_id": row_index,
        "start_time": _normalize_text(row.get("start_time")),
        "duration_sec": _parse_int(row.get("duration_sec")),
        "call_type": _normalize_text(row.get("call_type")),
        "location_origin": location_origin,
        "country_origin": country_origin,
        "location_dest": location_dest,
        "country_dest": country_dest,
        "is_night_call": _parse_int(row.get("is_night_call")) == 1,
        "transaction_status": _normalize_text(row.get("transaction_status")),
        "fraud_type": fraud_type,
        "operator_maroc": _normalize_text(row.get("operator_maroc")),
        "department": _normalize_text(row.get("department")),
        "call_zone": _normalize_text(row.get("call_zone")),
        "roaming_flag": roaming_flag,
        "call_cost_mad": round(_parse_float(row.get("call_cost_mad")), 2),
        "high_cost_flag": high_cost_flag,
        "long_duration_flag": long_duration_flag,
        "international_flag": international_flag,
        "fraud_flag": fraud_flag,
        "is_alert": alert_flag,
        "alert_flag": alert_flag,
        "fraud_risk_proba": fraud_risk_proba,
        "fraud_risk_score_100": fraud_risk_score_100,
        "severity": severity,
        "fraud_severity": severity,
        "fraud_severity_score": fraud_severity_score,
        "risk_level": severity,
        "investigation_priority": investigation_priority,
        "estimated_financial_loss": estimated_financial_loss,
        "ai_recommendation_priority": ai_recommendation_priority,
        "recommendation": recommendation,
        "recommendation_reason": recommendation_reason,
        "rule_matches": rule_matches,
        "route_label": (
            f"{location_origin} ({country_origin}) -> {location_dest} ({country_dest})"
        ),
        "phone_number": _normalize_text(row.get("phone_number"), fallback=""),
        "msisdn": _normalize_text(row.get("msisdn"), fallback=""),
        "line_number": _normalize_text(row.get("line_number"), fallback=""),
        "caller_number": _normalize_text(row.get("caller_number"), fallback=""),
        "latitude": _normalize_text(row.get("latitude"), fallback=""),
        "longitude": _normalize_text(row.get("longitude"), fallback=""),
        "lat": _normalize_text(row.get("lat"), fallback=""),
        "lng": _normalize_text(row.get("lng"), fallback=""),
        "gps_latitude": _normalize_text(row.get("gps_latitude"), fallback=""),
        "gps_longitude": _normalize_text(row.get("gps_longitude"), fallback=""),
        "gps_consent": _normalize_text(row.get("gps_consent"), fallback=""),
        "location_consent": _normalize_text(row.get("location_consent"), fallback=""),
        "geo_consent": _normalize_text(row.get("geo_consent"), fallback=""),
        "consent_location": _normalize_text(row.get("consent_location"), fallback=""),
        "consent_gps": _normalize_text(row.get("consent_gps"), fallback=""),
        "mcc": _normalize_text(row.get("mcc"), fallback=""),
        "country_mcc": _normalize_text(row.get("country_mcc"), fallback=""),
        "operator_mcc": _normalize_text(row.get("operator_mcc"), fallback=""),
        "mcc_code": _normalize_text(row.get("mcc_code"), fallback=""),
    }


def _parse_cdr_csv(csv_path: Path) -> list[dict[str, Any]]:
    with csv_path.open("r", encoding="utf-8-sig", newline="") as csv_file:
        reader = csv.DictReader(csv_file, delimiter=";")
        return [
            _normalize_cdr_row(
                row_index,
                {
                    (key or "").replace("\ufeff", "").strip(): value
                    for key, value in row.items()
                },
            )
            for row_index, row in enumerate(reader, start=1)
        ]


def _load_cdr_rows() -> list[dict[str, Any]]:
    source = _resolve_csv_source()
    csv_path = source.path
    if csv_path is None:
        CDR_ANALYTICS_LOGGER.warning(
            "event=csv_source_missing source=%s preferred=%s searched=%s configured_path=%s",
            source.key,
            source.preferred_name,
            [str(path) for path in source.searched_paths],
            str(source.configured_path) if source.configured_path else None,
        )
        return []

    current_mtime = csv_path.stat().st_mtime

    with _cache_lock:
        if (
            _cache.rows is not None
            and _cache.path == csv_path
            and _cache.mtime == current_mtime
        ):
            return _cache.rows

    try:
        rows = _parse_cdr_csv(csv_path)
    except Exception as exc:
        CDR_ANALYTICS_LOGGER.warning(
            "event=csv_source_read_failed source=%s path=%s searched=%s error=%s",
            source.key,
            str(csv_path),
            [str(path) for path in source.searched_paths],
            str(exc),
        )
        return []

    CDR_ANALYTICS_LOGGER.info(
        "event=csv_source_loaded source=%s path=%s rows=%s searched=%s",
        source.key,
        str(csv_path),
        len(rows),
        [str(path) for path in source.searched_paths],
    )

    with _cache_lock:
        _cache.path = csv_path
        _cache.mtime = current_mtime
        _cache.rows = rows

    return rows


def get_cdr_rows() -> list[dict[str, Any]]:
    return list(_load_cdr_rows())


def _matches_filters(
    row: dict[str, Any],
    *,
    search: str | None = None,
    operator: str | None = None,
    department: str | None = None,
    call_zone: str | None = None,
    severity: str | None = None,
) -> bool:
    if operator and row["operator_maroc"] != operator:
        return False
    if department and row["department"] != department:
        return False
    if call_zone and row["call_zone"] != call_zone:
        return False
    if severity and row["severity"] != severity:
        return False

    if not search:
        return True

    normalized_search = search.strip().lower()
    if normalized_search == "":
        return True

    searchable_values = (
        str(row["cdr_row_id"]),
        row["operator_maroc"],
        row["department"],
        row["call_zone"],
        row["fraud_type"],
        row["location_origin"],
        row["country_origin"],
        row["location_dest"],
        row["country_dest"],
        row["transaction_status"],
        row["recommendation"],
    )

    return any(normalized_search in str(value).lower() for value in searchable_values)


def _filter_rows(
    *,
    alerts_only: bool = False,
    search: str | None = None,
    operator: str | None = None,
    department: str | None = None,
    call_zone: str | None = None,
    severity: str | None = None,
) -> list[dict[str, Any]]:
    rows = _load_cdr_rows()
    filtered_rows = [
        row
        for row in rows
        if _matches_filters(
            row,
            search=search,
            operator=operator,
            department=department,
            call_zone=call_zone,
            severity=severity,
        )
    ]

    if alerts_only:
        filtered_rows = [row for row in filtered_rows if row["is_alert"]]

    return filtered_rows


def _build_cdr_risk_insight(row: dict[str, Any]) -> dict[str, Any]:
    suggested_action = "Ouvrir le detail CDR et appliquer le controle fraude recommande."
    if "sim_box" in row["fraud_type"]:
        suggested_action = "Bloquer la SIM, notifier le SOC et lancer une investigation fraude."
    elif row["severity"] == "critique":
        suggested_action = "Escalader l'alerte au SOC et confirmer la legitimite de l'appel."
    elif row["severity"] == "eleve":
        suggested_action = "Verifier le contexte metier et surveiller les appels similaires."

    return {
        "risk_id": f"cdr-fraud-{row['cdr_row_id']}",
        "title": f"Alerte fraude CDR-{row['cdr_row_id']}",
        "description": row["recommendation_reason"],
        "impact": (
            f"{row['call_cost_mad']:.2f} MAD exposes en zone {row['call_zone']}."
        ),
        "ai_recommendation": row["recommendation"],
        "suggested_action": suggested_action,
        "confidence_score": row["fraud_risk_proba"],
    }


def _serialize_alert(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "cdr_row_id": row["cdr_row_id"],
        "start_time": row["start_time"],
        "operator_maroc": row["operator_maroc"],
        "department": row["department"],
        "call_zone": row["call_zone"],
        "fraud_type": row["fraud_type"],
        "call_cost_mad": row["call_cost_mad"],
        "fraud_risk_score_100": row["fraud_risk_score_100"],
        "severity": row["severity"],
        "is_alert": row["is_alert"],
        "alert_flag": row["alert_flag"],
        "fraud_severity": row["fraud_severity"],
        "fraud_severity_score": row["fraud_severity_score"],
        "investigation_priority": row["investigation_priority"],
        "estimated_financial_loss": row["estimated_financial_loss"],
        "ai_recommendation_priority": row["ai_recommendation_priority"],
        "recommendation": row["recommendation"],
        **_build_cdr_risk_insight(row),
    }


def _serialize_recommendation(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "cdr_row_id": row["cdr_row_id"],
        "start_time": row["start_time"],
        "operator_maroc": row["operator_maroc"],
        "department": row["department"],
        "call_zone": row["call_zone"],
        "severity": row["severity"],
        "fraud_type": row["fraud_type"],
        "call_cost_mad": row["call_cost_mad"],
        "fraud_risk_score_100": row["fraud_risk_score_100"],
        "alert_flag": row["alert_flag"],
        "fraud_severity": row["fraud_severity"],
        "fraud_severity_score": row["fraud_severity_score"],
        "investigation_priority": row["investigation_priority"],
        "estimated_financial_loss": row["estimated_financial_loss"],
        "ai_recommendation_priority": row["ai_recommendation_priority"],
        "recommendation": row["recommendation"],
        "recommendation_reason": row["recommendation_reason"],
        **_build_cdr_risk_insight(row),
    }


def _sort_alert_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    severity_rank = {severity: index for index, severity in enumerate(SEVERITY_ORDER)}
    return sorted(
        rows,
        key=lambda row: (
            severity_rank.get(row["severity"], len(SEVERITY_ORDER)),
            -row["fraud_risk_score_100"],
            -row["call_cost_mad"],
            -row["duration_sec"],
            row["cdr_row_id"],
        ),
    )


def get_cdr_filters() -> dict[str, list[str]]:
    rows = _load_cdr_rows()
    return {
        "operators": sorted({row["operator_maroc"] for row in rows}),
        "departments": sorted({row["department"] for row in rows}),
        "call_zones": sorted({row["call_zone"] for row in rows}),
        "severities": list(SEVERITY_ORDER),
    }


def get_cdr_overview(
    *,
    search: str | None = None,
    operator: str | None = None,
    department: str | None = None,
    call_zone: str | None = None,
    severity: str | None = None,
) -> dict[str, Any]:
    rows = _filter_rows(
        search=search,
        operator=operator,
        department=department,
        call_zone=call_zone,
        severity=severity,
    )
    alert_rows = [row for row in rows if row["is_alert"]]

    total_calls = len(rows)
    suspicious_calls = len(alert_rows)
    total_cost = sum(row["call_cost_mad"] for row in rows)
    total_risk_score = sum(row["fraud_risk_score_100"] for row in rows)
    suspicious_cost_exposure_mad = round(
        sum(row["call_cost_mad"] for row in alert_rows),
        2,
    )

    risk_counter = Counter(row["severity"] for row in rows)
    department_counter = Counter(row["department"] for row in alert_rows)
    zone_counter = Counter(row["call_zone"] for row in rows)
    operator_costs: defaultdict[str, float] = defaultdict(float)
    operator_alerts: Counter[str] = Counter()

    for row in rows:
        operator_costs[row["operator_maroc"]] += row["call_cost_mad"]
        if row["is_alert"]:
            operator_alerts[row["operator_maroc"]] += 1

    ranked_alerts = _sort_alert_rows(alert_rows)

    start_times = [row["start_time"] for row in rows]
    snapshot_start_time = min(start_times) if start_times else None
    snapshot_end_time = max(start_times) if start_times else None

    return {
        "snapshot_start_time": snapshot_start_time,
        "snapshot_end_time": snapshot_end_time,
        "kpis": {
            "total_calls": total_calls,
            "suspicious_calls": suspicious_calls,
            "critical_alerts": sum(1 for row in alert_rows if row["severity"] == "critique"),
            "average_cost_mad": round(total_cost / total_calls, 2) if total_calls else 0.0,
            "average_risk_score": round(total_risk_score / total_calls, 2) if total_calls else 0.0,
            "suspicious_cost_exposure_mad": suspicious_cost_exposure_mad,
        },
        "risk_distribution": [
            {"severity": severity_name, "count": risk_counter.get(severity_name, 0)}
            for severity_name in SEVERITY_ORDER
        ],
        "alerts_by_department": [
            {"department": department_name, "count": count}
            for department_name, count in department_counter.most_common()
        ],
        "cost_by_operator": [
            {
                "operator": operator_name,
                "total_cost_mad": round(total_operator_cost, 2),
                "suspicious_calls": operator_alerts.get(operator_name, 0),
            }
            for operator_name, total_operator_cost in sorted(
                operator_costs.items(),
                key=lambda item: item[1],
                reverse=True,
            )
        ],
        "calls_by_zone": [
            {"call_zone": zone_name, "count": count}
            for zone_name, count in sorted(
                zone_counter.items(), key=lambda item: item[1], reverse=True
            )
        ],
        "top_risky_calls": [_serialize_alert(row) for row in ranked_alerts[:5]],
        "priority_alerts": [_serialize_alert(row) for row in ranked_alerts[:8]],
    }


def list_cdr_alerts(
    *,
    offset: int = 0,
    limit: int = 50,
    search: str | None = None,
    operator: str | None = None,
    department: str | None = None,
    call_zone: str | None = None,
    severity: str | None = None,
) -> dict[str, Any]:
    alert_rows = _sort_alert_rows(
        _filter_rows(
            alerts_only=True,
            search=search,
            operator=operator,
            department=department,
            call_zone=call_zone,
            severity=severity,
        )
    )

    sliced_rows = alert_rows[offset : offset + limit]
    return {
        "total": len(alert_rows),
        "offset": offset,
        "limit": limit,
        "items": [_serialize_alert(row) for row in sliced_rows],
    }


def get_cdr_alert_detail(cdr_row_id: int) -> dict[str, Any] | None:
    rows = _load_cdr_rows()
    target_row = next(
        (row for row in rows if row["cdr_row_id"] == cdr_row_id and row["is_alert"]),
        None,
    )
    if target_row is None:
        return None

    return {
        **_serialize_alert(target_row),
        "duration_sec": target_row["duration_sec"],
        "call_type": target_row["call_type"],
        "location_origin": target_row["location_origin"],
        "country_origin": target_row["country_origin"],
        "location_dest": target_row["location_dest"],
        "country_dest": target_row["country_dest"],
        "transaction_status": target_row["transaction_status"],
        "is_night_call": target_row["is_night_call"],
        "roaming_flag": target_row["roaming_flag"],
        "high_cost_flag": target_row["high_cost_flag"],
        "long_duration_flag": target_row["long_duration_flag"],
        "international_flag": target_row["international_flag"],
        "fraud_risk_proba": target_row["fraud_risk_proba"],
        "fraud_severity": target_row["fraud_severity"],
        "fraud_severity_score": target_row["fraud_severity_score"],
        "investigation_priority": target_row["investigation_priority"],
        "estimated_financial_loss": target_row["estimated_financial_loss"],
        "ai_recommendation_priority": target_row["ai_recommendation_priority"],
        "recommendation_reason": target_row["recommendation_reason"],
        "rule_matches": target_row["rule_matches"],
        "route_label": target_row["route_label"],
    }


def list_cdr_recommendations(
    *,
    offset: int = 0,
    limit: int = 50,
    search: str | None = None,
    operator: str | None = None,
    department: str | None = None,
    call_zone: str | None = None,
    severity: str | None = None,
) -> dict[str, Any]:
    alert_rows = _sort_alert_rows(
        _filter_rows(
            alerts_only=True,
            search=search,
            operator=operator,
            department=department,
            call_zone=call_zone,
            severity=severity,
        )
    )
    sliced_rows = alert_rows[offset : offset + limit]

    return {
        "total": len(alert_rows),
        "offset": offset,
        "limit": limit,
        "items": [_serialize_recommendation(row) for row in sliced_rows],
    }

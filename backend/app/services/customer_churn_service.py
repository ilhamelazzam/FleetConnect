from __future__ import annotations

import csv
import logging
import threading
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.core.config import AI_INPUT_DIR, AI_OUTPUT_DIR, ResolvedDataSource, get_settings

UNKNOWN_VALUE = "Inconnu"
RISK_LEVEL_ORDER = ("Critique", "Eleve", "Moyen", "Faible")
TENURE_GROUP_ORDER = (
    "0-12 mois",
    "13-24 mois",
    "25-48 mois",
    "49 mois et plus",
)
PRICE_RANGE_ORDER = (
    "Moins de 400 MAD",
    "400-599 MAD",
    "600-799 MAD",
    "800 MAD et plus",
)
BOOLEAN_FILTER_OPTIONS = ["Yes", "No"]
DEFAULT_CUSTOMER_CHURN_INPUT_CSV_PATH = AI_INPUT_DIR / "WA_Fn-UseC_-Telco-Customer-Churn.csv"
DEFAULT_CUSTOMER_CHURN_OUTPUT_CSV_PATH = AI_OUTPUT_DIR / "fleet_ai_results_morocco.csv"
CUSTOMER_CHURN_LOGGER = logging.getLogger("app.customer_churn")


@dataclass(slots=True)
class _CustomerChurnCache:
    input_path: Path | None = None
    output_path: Path | None = None
    input_mtime: float | None = None
    output_mtime: float | None = None
    rows: list[dict[str, Any]] | None = None


_cache = _CustomerChurnCache()
_cache_lock = threading.Lock()


def clear_customer_churn_cache() -> None:
    with _cache_lock:
        _cache.input_path = None
        _cache.output_path = None
        _cache.input_mtime = None
        _cache.output_mtime = None
        _cache.rows = None


def _resolve_input_csv_source() -> ResolvedDataSource:
    return get_settings().resolve_customer_churn_input_source()


def _resolve_output_csv_source() -> ResolvedDataSource:
    return get_settings().resolve_customer_churn_output_source()


def _resolve_input_csv_path() -> Path:
    source = _resolve_input_csv_source()
    return source.path or source.configured_path or DEFAULT_CUSTOMER_CHURN_INPUT_CSV_PATH


def _resolve_output_csv_path() -> Path:
    source = _resolve_output_csv_source()
    return source.path or source.configured_path or DEFAULT_CUSTOMER_CHURN_OUTPUT_CSV_PATH


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


def _parse_yes_no(raw_value: Any) -> bool:
    normalized = _normalize_text(raw_value, fallback="No").lower()
    return normalized in {"1", "yes", "true", "oui"}


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


def _derive_tenure_group(tenure: int) -> str:
    if tenure <= 12:
        return TENURE_GROUP_ORDER[0]
    if tenure <= 24:
        return TENURE_GROUP_ORDER[1]
    if tenure <= 48:
        return TENURE_GROUP_ORDER[2]
    return TENURE_GROUP_ORDER[3]


def _derive_price_range(monthly_cost_mad: float) -> str:
    if monthly_cost_mad < 400:
        return PRICE_RANGE_ORDER[0]
    if monthly_cost_mad < 600:
        return PRICE_RANGE_ORDER[1]
    if monthly_cost_mad < 800:
        return PRICE_RANGE_ORDER[2]
    return PRICE_RANGE_ORDER[3]


def _build_key_factors(row: dict[str, Any]) -> list[str]:
    factors: list[str] = []

    if row["contract"] == "Month-to-month":
        factors.append("Contrat mensuel")
    if row["tenure"] <= 12:
        factors.append("Anciennete faible")
    if row["monthly_cost_mad"] >= 700:
        factors.append("Facturation elevee")
    if row["payment_method"] == "Electronic check":
        factors.append("Paiement electronique")
    if row["internet_service"] == "Fiber optic":
        factors.append("Service fibre")
    if row["tech_support"] == "No":
        factors.append("Sans support technique")
    if row["online_security"] == "No":
        factors.append("Sans securite en ligne")
    if row["over_quota_flag"]:
        factors.append("Depassement de quota")
    if row["anomaly_flag"]:
        factors.append("Anomalie d'usage")
    if row["roaming_flag"]:
        factors.append("Roaming actif")

    return factors[:5]


def _build_recommendation_reason(row: dict[str, Any]) -> str:
    factors = row["key_factors"]
    if not factors:
        return "Recommandation preventive basee sur le score churn et la valeur client."

    if len(factors) == 1:
        return f"Action proposee a cause de {factors[0].lower()}."

    return (
        "Action proposee a cause de "
        + ", ".join(factor.lower() for factor in factors[:-1])
        + f" et {factors[-1].lower()}."
    )


def _normalize_customer_churn_row(
    row_index: int,
    output_row: dict[str, str],
    raw_row: dict[str, str] | None,
) -> dict[str, Any]:
    tenure = _parse_int(output_row.get("tenure"))
    monthly_cost_mad = round(_parse_float(output_row.get("monthly_cost_mad")), 2)
    risk_level = _normalize_risk_level(output_row.get("risk_level"))
    predicted_churn = _parse_int(output_row.get("alert_flag")) == 1

    row = {
        "customer_row_id": row_index,
        "customer_id": _normalize_text(
            raw_row.get("customerID") if raw_row else None,
            fallback=f"CUST-{row_index:05d}",
        ),
        "operator": _normalize_text(output_row.get("operator")),
        "department": _normalize_text(output_row.get("department")),
        "gender": _normalize_text(output_row.get("gender")),
        "senior_citizen": _parse_yes_no(output_row.get("SeniorCitizen")),
        "partner": _parse_yes_no(output_row.get("Partner")),
        "dependents": _parse_yes_no(output_row.get("Dependents")),
        "tenure": tenure,
        "tenure_group": _derive_tenure_group(tenure),
        "contract": _normalize_text(output_row.get("Contract")),
        "payment_method": _normalize_text(output_row.get("PaymentMethod")),
        "internet_service": _normalize_text(output_row.get("InternetService")),
        "online_security": _normalize_text(output_row.get("OnlineSecurity")),
        "tech_support": _normalize_text(output_row.get("TechSupport")),
        "monthly_charges": round(_parse_float(output_row.get("MonthlyCharges")), 2),
        "total_charges": round(_parse_float(output_row.get("TotalCharges")), 2),
        "monthly_cost_mad": monthly_cost_mad,
        "total_cost_mad": round(_parse_float(output_row.get("total_cost_mad")), 2),
        "plan": _normalize_text(output_row.get("plan")),
        "price_range_label": _derive_price_range(monthly_cost_mad),
        "roaming_flag": _parse_int(output_row.get("roaming_flag")) == 1,
        "data_usage_gb": round(_parse_float(output_row.get("data_usage_gb")), 2),
        "quota_gb": round(_parse_float(output_row.get("quota_gb")), 2),
        "over_quota_flag": _parse_int(output_row.get("over_quota_flag")) == 1,
        "anomaly_flag": _parse_int(output_row.get("anomaly_flag")) == 1,
        "risk_proba": round(_parse_float(output_row.get("risk_proba")), 4),
        "risk_score_100": round(_parse_float(output_row.get("risk_score_100")), 1),
        "risk_level": risk_level,
        "future_cost_mad": round(_parse_float(output_row.get("future_cost_mad")), 2),
        "future_cost_pred_mad": round(_parse_float(output_row.get("future_cost_pred_mad")), 2),
        "actual_churn": _parse_yes_no(output_row.get("Churn")),
        "predicted_churn": predicted_churn,
        "recommendation": _normalize_text(output_row.get("recommendation")),
    }
    row["revenue_at_risk_mad"] = monthly_cost_mad if predicted_churn else 0.0
    row["is_loyal"] = (
        not row["actual_churn"]
        and not row["predicted_churn"]
        and tenure >= 36
        and risk_level in {"Faible", "Moyen"}
    )
    row["key_factors"] = _build_key_factors(row)
    row["recommendation_reason"] = _build_recommendation_reason(row)
    return row


def _parse_input_rows(csv_path: Path) -> list[dict[str, str]]:
    if not csv_path.exists():
        return []

    with csv_path.open("r", encoding="utf-8-sig", newline="") as csv_file:
        return list(csv.DictReader(csv_file))


def _parse_output_rows(csv_path: Path) -> list[dict[str, str]]:
    with csv_path.open("r", encoding="utf-8-sig", newline="") as csv_file:
        return list(csv.DictReader(csv_file, delimiter=";"))


def _load_customer_churn_rows() -> list[dict[str, Any]]:
    input_source = _resolve_input_csv_source()
    output_source = _resolve_output_csv_source()
    input_csv_path = input_source.path or input_source.configured_path or DEFAULT_CUSTOMER_CHURN_INPUT_CSV_PATH
    output_csv_path = output_source.path

    if output_csv_path is None:
        CUSTOMER_CHURN_LOGGER.warning(
            "event=csv_source_missing source=%s preferred=%s searched=%s configured_path=%s",
            output_source.key,
            output_source.preferred_name,
            [str(path) for path in output_source.searched_paths],
            str(output_source.configured_path) if output_source.configured_path else None,
        )
        return []

    if input_source.path is None:
        CUSTOMER_CHURN_LOGGER.warning(
            "event=csv_source_missing source=%s preferred=%s searched=%s configured_path=%s",
            input_source.key,
            input_source.preferred_name,
            [str(path) for path in input_source.searched_paths],
            str(input_source.configured_path) if input_source.configured_path else None,
        )

    input_mtime = input_csv_path.stat().st_mtime if input_csv_path.exists() else None
    output_mtime = output_csv_path.stat().st_mtime

    with _cache_lock:
        if (
            _cache.rows is not None
            and _cache.input_path == input_csv_path
            and _cache.output_path == output_csv_path
            and _cache.input_mtime == input_mtime
            and _cache.output_mtime == output_mtime
        ):
            return _cache.rows

    try:
        raw_rows = _parse_input_rows(input_csv_path)
        output_rows = _parse_output_rows(output_csv_path)
    except Exception as exc:
        CUSTOMER_CHURN_LOGGER.warning(
            "event=csv_source_read_failed source=%s path=%s searched=%s error=%s",
            output_source.key,
            str(output_csv_path),
            [str(path) for path in output_source.searched_paths],
            str(exc),
        )
        return []

    rows = [
        _normalize_customer_churn_row(
            row_index,
            output_row,
            raw_rows[row_index - 1] if row_index - 1 < len(raw_rows) else None,
        )
        for row_index, output_row in enumerate(output_rows, start=1)
    ]

    CUSTOMER_CHURN_LOGGER.info(
        "event=csv_source_loaded source=%s path=%s rows=%s searched=%s",
        output_source.key,
        str(output_csv_path),
        len(rows),
        [str(path) for path in output_source.searched_paths],
    )

    with _cache_lock:
        _cache.input_path = input_csv_path
        _cache.output_path = output_csv_path
        _cache.input_mtime = input_mtime
        _cache.output_mtime = output_mtime
        _cache.rows = rows

    return rows


def _matches_boolean_filter(value: bool, selected_value: str | None) -> bool:
    if not selected_value:
        return True

    normalized = selected_value.strip().lower()
    if normalized == "yes":
        return value
    if normalized == "no":
        return not value
    return True


def _matches_filters(
    row: dict[str, Any],
    *,
    search: str | None = None,
    operator: str | None = None,
    department: str | None = None,
    contract: str | None = None,
    payment_method: str | None = None,
    internet_service: str | None = None,
    plan: str | None = None,
    price_range: str | None = None,
    risk_level: str | None = None,
    tenure_group: str | None = None,
    churn_status: str | None = None,
    prediction_status: str | None = None,
) -> bool:
    if operator and row["operator"] != operator:
        return False
    if department and row["department"] != department:
        return False
    if contract and row["contract"] != contract:
        return False
    if payment_method and row["payment_method"] != payment_method:
        return False
    if internet_service and row["internet_service"] != internet_service:
        return False
    if plan and row["plan"] != plan:
        return False
    if price_range and row["price_range_label"] != price_range:
        return False
    if risk_level and row["risk_level"] != risk_level:
        return False
    if tenure_group and row["tenure_group"] != tenure_group:
        return False
    if not _matches_boolean_filter(row["actual_churn"], churn_status):
        return False
    if not _matches_boolean_filter(row["predicted_churn"], prediction_status):
        return False

    if not search:
        return True

    normalized_search = _strip_accents(search.strip()).lower()
    if normalized_search == "":
        return True

    searchable_values = (
        row["customer_id"],
        row["operator"],
        row["department"],
        row["contract"],
        row["payment_method"],
        row["internet_service"],
        row["recommendation"],
        row["plan"],
        row["risk_level"],
    )

    return any(
        normalized_search in _strip_accents(str(value)).lower()
        for value in searchable_values
    )


def _filter_rows(
    *,
    search: str | None = None,
    operator: str | None = None,
    department: str | None = None,
    contract: str | None = None,
    payment_method: str | None = None,
    internet_service: str | None = None,
    plan: str | None = None,
    price_range: str | None = None,
    risk_level: str | None = None,
    tenure_group: str | None = None,
    churn_status: str | None = None,
    prediction_status: str | None = None,
    priority_only: bool = False,
) -> list[dict[str, Any]]:
    rows = [
        row
        for row in _load_customer_churn_rows()
        if _matches_filters(
            row,
            search=search,
            operator=operator,
            department=department,
            contract=contract,
            payment_method=payment_method,
            internet_service=internet_service,
            plan=plan,
            price_range=price_range,
            risk_level=risk_level,
            tenure_group=tenure_group,
            churn_status=churn_status,
            prediction_status=prediction_status,
        )
    ]

    if priority_only:
        rows = [
            row
            for row in rows
            if row["predicted_churn"] or row["risk_level"] in {"Critique", "Eleve"}
        ]

    return rows


def _sort_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        rows,
        key=lambda row: (
            -int(row["predicted_churn"]),
            _risk_rank(row["risk_level"]),
            -row["risk_score_100"],
            -row["monthly_cost_mad"],
            row["customer_row_id"],
        ),
    )


def _build_customer_risk_insight(row: dict[str, Any]) -> dict[str, Any]:
    if row["predicted_churn"] or row["risk_level"] == "Critique":
        suggested_action = "Contacter le client et proposer une action de retention prioritaire."
    elif row["risk_level"] == "Eleve":
        suggested_action = "Planifier une relance commerciale et verifier l'adequation du forfait."
    elif row["risk_level"] == "Moyen":
        suggested_action = "Surveiller les signaux d'usage et preparer une offre preventive."
    else:
        suggested_action = "Maintenir la relation standard et suivre l'evolution du score."

    estimated_impact = row.get("revenue_at_risk_mad")
    if estimated_impact is None:
        estimated_impact = round(row["monthly_cost_mad"] * row["risk_proba"], 2)

    return {
        "risk_id": f"customer-churn-{row['customer_row_id']}",
        "title": f"Risque churn {row['customer_id']}",
        "description": row["recommendation_reason"],
        "impact": (
            f"{estimated_impact:.2f} MAD de revenu mensuel potentiellement expose."
        ),
        "ai_recommendation": row["recommendation"],
        "suggested_action": suggested_action,
        "confidence_score": row["risk_proba"],
    }


def _serialize_customer(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "customer_row_id": row["customer_row_id"],
        "customer_id": row["customer_id"],
        "operator": row["operator"],
        "department": row["department"],
        "gender": row["gender"],
        "senior_citizen": row["senior_citizen"],
        "partner": row["partner"],
        "dependents": row["dependents"],
        "tenure": row["tenure"],
        "tenure_group": row["tenure_group"],
        "contract": row["contract"],
        "payment_method": row["payment_method"],
        "internet_service": row["internet_service"],
        "monthly_charges": row["monthly_charges"],
        "total_charges": row["total_charges"],
        "monthly_cost_mad": row["monthly_cost_mad"],
        "total_cost_mad": row["total_cost_mad"],
        "plan": row["plan"],
        "price_range_label": row["price_range_label"],
        "roaming_flag": row["roaming_flag"],
        "data_usage_gb": row["data_usage_gb"],
        "quota_gb": row["quota_gb"],
        "over_quota_flag": row["over_quota_flag"],
        "anomaly_flag": row["anomaly_flag"],
        "risk_proba": row["risk_proba"],
        "risk_score_100": row["risk_score_100"],
        "risk_level": row["risk_level"],
        "actual_churn": row["actual_churn"],
        "predicted_churn": row["predicted_churn"],
        "recommendation": row["recommendation"],
        **_build_customer_risk_insight(row),
    }


def _serialize_prediction(row: dict[str, Any]) -> dict[str, Any]:
    return {
        **_serialize_customer(row),
        "future_cost_mad": row["future_cost_mad"],
        "future_cost_pred_mad": row["future_cost_pred_mad"],
        "revenue_at_risk_mad": row["revenue_at_risk_mad"],
        "key_factors": row["key_factors"],
    }


def _serialize_recommendation(row: dict[str, Any]) -> dict[str, Any]:
    return {
        **_serialize_prediction(row),
        "recommendation_reason": row["recommendation_reason"],
    }


def _build_kpis(rows: list[dict[str, Any]]) -> dict[str, Any]:
    total_customers = len(rows)
    actual_churn_customers = sum(1 for row in rows if row["actual_churn"])
    high_risk_customers = sum(1 for row in rows if row["predicted_churn"])

    return {
        "total_customers": total_customers,
        "actual_churn_customers": actual_churn_customers,
        "churn_rate_pct": round((actual_churn_customers / total_customers) * 100, 2)
        if total_customers
        else 0.0,
        "high_risk_customers": high_risk_customers,
        "loyal_customers": sum(1 for row in rows if row["is_loyal"]),
        "revenue_at_risk_mad": round(sum(row["revenue_at_risk_mad"] for row in rows), 2),
        "average_risk_score": round(
            sum(row["risk_score_100"] for row in rows) / total_customers,
            2,
        )
        if total_customers
        else 0.0,
        "average_tenure_months": round(sum(row["tenure"] for row in rows) / total_customers, 2)
        if total_customers
        else 0.0,
        "average_monthly_revenue_mad": round(
            sum(row["monthly_cost_mad"] for row in rows) / total_customers,
            2,
        )
        if total_customers
        else 0.0,
    }


def _build_breakdown(
    rows: list[dict[str, Any]],
    group_key: str,
    order: tuple[str, ...] | None = None,
) -> list[dict[str, Any]]:
    grouped_rows: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped_rows[row[group_key]].append(row)

    if order:
        labels = [label for label in order if label in grouped_rows]
        labels.extend(sorted(label for label in grouped_rows if label not in order))
    else:
        labels = sorted(grouped_rows, key=lambda label: len(grouped_rows[label]), reverse=True)

    return [
        {
            "label": label,
            "total_customers": len(grouped_rows[label]),
            "actual_churn_customers": sum(1 for row in grouped_rows[label] if row["actual_churn"]),
            "predicted_high_risk_customers": sum(
                1 for row in grouped_rows[label] if row["predicted_churn"]
            ),
            "churn_rate_pct": round(
                sum(1 for row in grouped_rows[label] if row["actual_churn"])
                / len(grouped_rows[label])
                * 100,
                2,
            ),
            "revenue_at_risk_mad": round(
                sum(row["revenue_at_risk_mad"] for row in grouped_rows[label]),
                2,
            ),
            "average_risk_score": round(
                sum(row["risk_score_100"] for row in grouped_rows[label])
                / len(grouped_rows[label]),
                2,
            ),
        }
        for label in labels
    ]


def get_customer_churn_filters() -> dict[str, list[str]]:
    rows = _load_customer_churn_rows()
    return {
        "operators": sorted({row["operator"] for row in rows}),
        "departments": sorted({row["department"] for row in rows}),
        "contracts": sorted({row["contract"] for row in rows}),
        "payment_methods": sorted({row["payment_method"] for row in rows}),
        "internet_services": sorted({row["internet_service"] for row in rows}),
        "plans": sorted({row["plan"] for row in rows}),
        "risk_levels": list(RISK_LEVEL_ORDER),
        "tenure_groups": list(TENURE_GROUP_ORDER),
        "price_ranges": list(PRICE_RANGE_ORDER),
        "churn_statuses": list(BOOLEAN_FILTER_OPTIONS),
        "prediction_statuses": list(BOOLEAN_FILTER_OPTIONS),
    }


def get_customer_churn_overview(**filters: str | None) -> dict[str, Any]:
    rows = _filter_rows(**filters)
    return {
        "kpis": _build_kpis(rows),
        "churn_by_contract": _build_breakdown(rows, "contract"),
        "churn_by_internet_service": _build_breakdown(rows, "internet_service"),
        "churn_by_price_range": _build_breakdown(rows, "price_range_label", PRICE_RANGE_ORDER),
        "risk_by_department": _build_breakdown(rows, "department"),
        "top_at_risk_customers": [
            _serialize_prediction(row)
            for row in _sort_rows(
                [row for row in rows if row["predicted_churn"] or row["actual_churn"]]
            )[:8]
        ],
    }


def list_customer_churn_customers(
    offset: int = 0,
    limit: int = 50,
    **filters: str | None,
) -> dict[str, Any]:
    rows = _sort_rows(_filter_rows(**filters))
    return {
        "total": len(rows),
        "offset": offset,
        "limit": limit,
        "items": [_serialize_customer(row) for row in rows[offset : offset + limit]],
    }


def list_customer_churn_predictions(
    offset: int = 0,
    limit: int = 50,
    **filters: str | None,
) -> dict[str, Any]:
    effective_filters = dict(filters)
    if not effective_filters.get("prediction_status"):
        effective_filters["prediction_status"] = "Yes"
    rows = _sort_rows(_filter_rows(**effective_filters))
    return {
        "total": len(rows),
        "offset": offset,
        "limit": limit,
        "items": [_serialize_prediction(row) for row in rows[offset : offset + limit]],
    }


def list_customer_churn_recommendations(
    offset: int = 0,
    limit: int = 50,
    **filters: str | None,
) -> dict[str, Any]:
    rows = _sort_rows(_filter_rows(priority_only=True, **filters))
    return {
        "total": len(rows),
        "offset": offset,
        "limit": limit,
        "items": [_serialize_recommendation(row) for row in rows[offset : offset + limit]],
    }


def get_customer_churn_reports(**filters: str | None) -> dict[str, Any]:
    rows = _filter_rows(**filters)
    return {
        "kpis": _build_kpis(rows),
        "churn_by_contract": _build_breakdown(rows, "contract"),
        "churn_by_internet_service": _build_breakdown(rows, "internet_service"),
        "churn_by_price_range": _build_breakdown(rows, "price_range_label", PRICE_RANGE_ORDER),
        "risk_by_department": _build_breakdown(rows, "department"),
        "top_revenue_at_risk": [
            _serialize_recommendation(row)
            for row in sorted(
                rows,
                key=lambda current_row: (
                    -current_row["revenue_at_risk_mad"],
                    _risk_rank(current_row["risk_level"]),
                    -current_row["risk_score_100"],
                    current_row["customer_row_id"],
                ),
            )
            if row["revenue_at_risk_mad"] > 0
        ][:10],
    }


def _build_consumption_kpis(rows: list[dict[str, Any]]) -> dict[str, Any]:
    total_lines = len(rows)
    total_data_usage = sum(row["data_usage_gb"] for row in rows)
    total_quota = sum(row["quota_gb"] for row in rows)

    return {
        "total_lines": total_lines,
        "total_monthly_cost_mad": round(sum(row["monthly_cost_mad"] for row in rows), 2),
        "total_future_cost_mad": round(sum(row["future_cost_mad"] for row in rows), 2),
        "total_future_cost_pred_mad": round(
            sum(row["future_cost_pred_mad"] for row in rows),
            2,
        ),
        "total_data_usage_gb": round(total_data_usage, 2),
        "average_data_usage_gb": round(total_data_usage / total_lines, 2) if total_lines else 0.0,
        "average_quota_gb": round(total_quota / total_lines, 2) if total_lines else 0.0,
        "over_quota_lines": sum(1 for row in rows if row["over_quota_flag"]),
        "roaming_lines": sum(1 for row in rows if row["roaming_flag"]),
        "anomaly_lines": sum(1 for row in rows if row["anomaly_flag"]),
        "high_risk_lines": sum(1 for row in rows if row["risk_level"] in {"Critique", "Eleve"}),
        "average_risk_score": round(
            sum(row["risk_score_100"] for row in rows) / total_lines,
            2,
        )
        if total_lines
        else 0.0,
    }


def _build_consumption_breakdown(
    rows: list[dict[str, Any]],
    *,
    group_key: str,
) -> list[dict[str, Any]]:
    grouped_rows: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped_rows[row[group_key]].append(row)

    return [
        {
            "label": label,
            "line_count": len(grouped_rows[label]),
            "total_monthly_cost_mad": round(
                sum(current_row["monthly_cost_mad"] for current_row in grouped_rows[label]),
                2,
            ),
            "total_future_cost_mad": round(
                sum(current_row["future_cost_pred_mad"] for current_row in grouped_rows[label]),
                2,
            ),
            "total_data_usage_gb": round(
                sum(current_row["data_usage_gb"] for current_row in grouped_rows[label]),
                2,
            ),
            "over_quota_lines": sum(
                1 for current_row in grouped_rows[label] if current_row["over_quota_flag"]
            ),
            "anomaly_lines": sum(
                1 for current_row in grouped_rows[label] if current_row["anomaly_flag"]
            ),
            "average_risk_score": round(
                sum(current_row["risk_score_100"] for current_row in grouped_rows[label])
                / len(grouped_rows[label]),
                2,
            ),
        }
        for label in sorted(
            grouped_rows,
            key=lambda current_label: sum(
                item["monthly_cost_mad"] for item in grouped_rows[current_label]
            ),
            reverse=True,
        )
    ]


def get_customer_churn_consumption(**filters: str | None) -> dict[str, Any]:
    rows = _filter_rows(**filters)
    top_consumers = sorted(
        rows,
        key=lambda row: (
            -row["monthly_cost_mad"],
            -row["data_usage_gb"],
            -row["risk_score_100"],
            row["customer_row_id"],
        ),
    )[:10]
    priority_lines = sorted(
        [
            row
            for row in rows
            if row["over_quota_flag"] or row["anomaly_flag"] or row["risk_level"] in {"Critique", "Eleve"}
        ],
        key=lambda row: (
            -int(row["over_quota_flag"]),
            -int(row["anomaly_flag"]),
            _risk_rank(row["risk_level"]),
            -row["monthly_cost_mad"],
            row["customer_row_id"],
        ),
    )[:10]

    return {
        "kpis": _build_consumption_kpis(rows),
        "cost_by_operator": _build_consumption_breakdown(rows, group_key="operator"),
        "cost_by_department": _build_consumption_breakdown(rows, group_key="department"),
        "usage_by_department": _build_consumption_breakdown(rows, group_key="department"),
        "top_consumers": [_serialize_prediction(row) for row in top_consumers],
        "priority_lines": [_serialize_prediction(row) for row in priority_lines],
    }

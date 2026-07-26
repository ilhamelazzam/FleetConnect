from __future__ import annotations

import csv
from collections import Counter
from collections import defaultdict
from datetime import UTC, date, datetime, time
from hashlib import sha1
from pathlib import Path
from typing import Any, Literal
import unicodedata

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import AI_OUTPUT_DIR, get_settings
from app.models.phone_line import PhoneLine
from app.services.cdr_analytics_service import get_cdr_rows

LocationSource = Literal["gps_exact", "estimated_cdr", "estimated_mcc", "simulated_demo"]
LineAssignmentSource = Literal["direct", "estimated_scope", "demo"]
RiskLevel = Literal["low", "medium", "high", "critical"]

UNKNOWN_VALUE = "Inconnu"
ROAMING_REFRESH_INTERVAL_SECONDS = 12
DEFAULT_FLEET_AI_CSV_PATH = AI_OUTPUT_DIR / "fleet_ai_results_morocco.csv"
DEFAULT_MOBILE_FLEET_CSV_PATH = AI_OUTPUT_DIR / "fleetconnect_ai_output.csv"

COUNTRY_NAMES_BY_CODE: dict[str, str] = {
    "AE": "Emirats arabes unis",
    "BE": "Belgique",
    "CA": "Canada",
    "DZ": "Algerie",
    "CI": "Cote d'Ivoire",
    "CM": "Cameroun",
    "EG": "Egypte",
    "ES": "Espagne",
    "ET": "Ethiopie",
    "FR": "France",
    "GB": "Royaume-Uni",
    "GH": "Ghana",
    "KE": "Kenya",
    "MA": "Maroc",
    "NG": "Nigeria",
    "SN": "Senegal",
    "TN": "Tunisie",
    "TR": "Turquie",
    "TZ": "Tanzanie",
    "UG": "Ouganda",
    "ZA": "Afrique du Sud",
}

COUNTRY_COORDINATES: dict[str, tuple[float, float]] = {
    "AE": (23.4241, 53.8478),
    "BE": (50.5039, 4.4699),
    "CA": (56.1304, -106.3468),
    "DZ": (28.0339, 1.6596),
    "CI": (7.53999, -5.54708),
    "CM": (7.3697, 12.3547),
    "EG": (26.8206, 30.8025),
    "ES": (40.4637, -3.7492),
    "ET": (9.1450, 40.4897),
    "FR": (46.2276, 2.2137),
    "GB": (55.3781, -3.4360),
    "GH": (7.9465, -1.0232),
    "KE": (-0.0236, 37.9062),
    "MA": (31.7917, -7.0926),
    "NG": (9.0820, 8.6753),
    "SN": (14.4974, -14.4524),
    "TN": (33.8869, 9.5375),
    "TR": (38.9637, 35.2433),
    "TZ": (-6.3690, 34.8888),
    "UG": (1.3733, 32.2903),
    "ZA": (-30.5595, 22.9375),
}

CITY_COORDINATES: dict[tuple[str, str], tuple[float, float]] = {
    ("AE", "dubai"): (25.2048, 55.2708),
    ("BE", "bruxelles"): (50.8503, 4.3517),
    ("CA", "montreal"): (45.5017, -73.5673),
    ("UG", "kampala"): (0.3476, 32.5825),
    ("EG", "cairo"): (30.0444, 31.2357),
    ("ES", "madrid"): (40.4168, -3.7038),
    ("GH", "accra"): (5.6037, -0.1870),
    ("FR", "paris"): (48.8566, 2.3522),
    ("GB", "londres"): (51.5074, -0.1278),
    ("KE", "nairobi"): (-1.2864, 36.8172),
    ("ET", "addis ababa"): (8.9806, 38.7578),
    ("ZA", "johannesburg"): (-26.2041, 28.0473),
    ("NG", "lagos"): (6.5244, 3.3792),
    ("MA", "agadir"): (30.4278, -9.5981),
    ("MA", "casablanca"): (33.5731, -7.5898),
    ("MA", "fes"): (34.0181, -5.0078),
    ("MA", "marrakech"): (31.6295, -7.9811),
    ("MA", "meknes"): (33.8935, -5.5473),
    ("MA", "oujda"): (34.6814, -1.9086),
    ("MA", "rabat"): (34.0209, -6.8416),
    ("MA", "tanger"): (35.7595, -5.8340),
    ("TN", "tunis"): (36.8065, 10.1815),
    ("TR", "istanbul"): (41.0082, 28.9784),
    ("DZ", "alger"): (36.7538, 3.0588),
    ("SN", "dakar"): (14.7167, -17.4677),
    ("CI", "abidjan"): (5.3600, -4.0083),
    ("CM", "douala"): (4.0511, 9.7679),
    ("TZ", "dar es salaam"): (-6.7924, 39.2083),
}

MCC_TO_COUNTRY_CODE: dict[str, str] = {
    "602": "EG",
    "603": "DZ",
    "604": "MA",
    "605": "TN",
    "607": "GM",
    "608": "SN",
    "611": "GN",
    "612": "CI",
    "620": "GH",
    "621": "NG",
    "639": "KE",
    "640": "TZ",
    "641": "UG",
    "655": "ZA",
}


def _normalize_text(raw_value: Any, *, fallback: str = "") -> str:
    if raw_value is None:
        return fallback
    normalized = str(raw_value).strip()
    return normalized or fallback


def _normalize_city_key(raw_value: Any) -> str:
    normalized = _normalize_text(raw_value).lower()
    if not normalized:
        return ""
    decomposed = unicodedata.normalize("NFD", normalized)
    return "".join(character for character in decomposed if unicodedata.category(character) != "Mn")


def _parse_float(raw_value: Any) -> float | None:
    try:
        if raw_value is None or str(raw_value).strip() == "":
            return None
        return float(str(raw_value).strip())
    except (TypeError, ValueError):
        return None


def _parse_datetime(raw_value: Any) -> datetime | None:
    normalized = _normalize_text(raw_value)
    if not normalized:
        return None

    for parser in (datetime.fromisoformat,):
        try:
            parsed = parser(normalized.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=UTC)
            return parsed.astimezone(UTC)
        except ValueError:
            continue

    try:
        parsed = datetime.strptime(normalized, "%Y-%m-%d %H:%M:%S")
        return parsed.replace(tzinfo=UTC)
    except ValueError:
        return None


def _parse_bool(raw_value: Any) -> bool:
    normalized = _normalize_text(raw_value).lower()
    return normalized in {"1", "true", "yes", "oui", "y"}


def _parse_int(raw_value: Any, default: int = 0) -> int:
    try:
        if isinstance(raw_value, bool):
            return int(raw_value)
        if isinstance(raw_value, (int, float)):
            return int(raw_value)
        if raw_value is None or str(raw_value).strip() == "":
            return default
        return int(float(str(raw_value).strip()))
    except (TypeError, ValueError):
        return default


def _is_roaming_event(row: dict[str, Any]) -> bool:
    return bool(row.get("roaming_flag")) or _normalize_text(row.get("call_zone")).lower() == "roaming"


def _get_display_location(row: dict[str, Any]) -> tuple[str, Any]:
    # For roaming, the map uses the foreign destination as a proxy for the current location
    # when explicit current_location/current_country columns are not available.
    if _is_roaming_event(row):
        display_city = _normalize_text(row.get("current_location")) or _normalize_text(row.get("location_dest"))
        display_country = row.get("current_country") or row.get("country_dest") or row.get("country_origin")
        return display_city, display_country

    display_city = _normalize_text(row.get("location_origin")) or _normalize_text(row.get("location_dest"))
    display_country = row.get("country_origin") or row.get("country_dest")
    return display_city, display_country


def _resolve_fleet_ai_csv_path() -> Path:
    source = get_settings().resolve_customer_churn_output_source()
    return source.path or source.configured_path or DEFAULT_FLEET_AI_CSV_PATH


def _resolve_mobile_fleet_csv_path() -> Path:
    source = get_settings().resolve_mobile_fleet_source()
    return source.path or source.configured_path or DEFAULT_MOBILE_FLEET_CSV_PATH


def _detect_csv_delimiter(sample: str) -> str:
    try:
        return csv.Sniffer().sniff(sample, delimiters=";,").delimiter
    except csv.Error:
        return ";" if sample.count(";") >= sample.count(",") else ","


def _load_csv_rows(csv_path: Path, *, delimiter: str | None) -> list[dict[str, str]]:
    if not csv_path.exists():
        return []

    with csv_path.open("r", encoding="utf-8-sig", newline="") as csv_file:
        resolved_delimiter = delimiter
        if resolved_delimiter is None:
            sample = csv_file.read(4096)
            csv_file.seek(0)
            resolved_delimiter = _detect_csv_delimiter(sample)
        return list(csv.DictReader(csv_file, delimiter=resolved_delimiter))


def _build_scope_key(*, operator: Any, department: Any) -> tuple[str, str]:
    return (
        _normalize_text(operator, fallback=UNKNOWN_VALUE),
        _normalize_text(department, fallback=UNKNOWN_VALUE),
    )


def _parse_date_filter(raw_value: str | None) -> date | None:
    normalized = _normalize_text(raw_value)
    if not normalized:
        return None
    try:
        return date.fromisoformat(normalized)
    except ValueError:
        return None


def _risk_level_from_row(row: dict[str, Any]) -> RiskLevel:
    normalized = _normalize_text(row.get("severity")).lower()
    if normalized == "critique":
        return "critical"
    if normalized == "eleve":
        return "high"
    if normalized == "moyen":
        return "medium"

    score = _parse_float(row.get("fraud_risk_score_100")) or 0.0
    cost = _parse_float(row.get("call_cost_mad")) or 0.0
    if score >= 85 or cost >= 900:
        return "critical"
    if score >= 60 or cost >= 500:
        return "high"
    if score >= 35 or cost >= 220:
        return "medium"
    return "low"


def _risk_rank(risk_level: RiskLevel) -> int:
    if risk_level == "critical":
        return 3
    if risk_level == "high":
        return 2
    if risk_level == "medium":
        return 1
    return 0


def _risk_label(risk_level: RiskLevel) -> str:
    if risk_level == "critical":
        return "Critique"
    if risk_level == "high":
        return "Eleve"
    if risk_level == "medium":
        return "Moyen"
    return "Faible"


def _location_precision_label(location_source: LocationSource) -> str:
    if location_source == "gps_exact":
        return "GPS exact"
    if location_source == "estimated_mcc":
        return "Localisation estimee via MCC"
    if location_source == "estimated_cdr":
        return "Localisation estimee via roaming/CDR"
    return "Localisation simulee"


def _resolve_country_code(raw_value: Any) -> str | None:
    normalized = _normalize_text(raw_value)
    if not normalized:
        return None

    upper_value = normalized.upper()
    if upper_value in COUNTRY_NAMES_BY_CODE:
        return upper_value

    normalized_names = {
        country_name.lower(): country_code
        for country_code, country_name in COUNTRY_NAMES_BY_CODE.items()
    }
    return normalized_names.get(normalized.lower())


def _country_label(raw_value: Any) -> str:
    country_code = _resolve_country_code(raw_value)
    if country_code is None:
        normalized = _normalize_text(raw_value)
        return normalized or UNKNOWN_VALUE
    return COUNTRY_NAMES_BY_CODE.get(country_code, country_code)


def _extract_mcc_country_code(row: dict[str, Any]) -> str | None:
    for key in ("mcc", "country_mcc", "operator_mcc", "mcc_code"):
        normalized = _normalize_text(row.get(key))
        if normalized and normalized[:3] in MCC_TO_COUNTRY_CODE:
            return MCC_TO_COUNTRY_CODE[normalized[:3]]
    return None


def _has_explicit_gps_consent(row: dict[str, Any]) -> bool:
    for key in (
        "gps_consent",
        "location_consent",
        "geo_consent",
        "consent_location",
        "consent_gps",
    ):
        if _parse_bool(row.get(key)):
            return True
    return False


def _resolve_location_point(
    *,
    city: Any = None,
    country: Any = None,
    mcc: Any = None,
    allow_simulated: bool = True,
) -> tuple[float, float, str, str | None]:
    normalized_city = _normalize_text(city)
    country_code = _resolve_country_code(country)

    if country_code and normalized_city:
        coordinates = CITY_COORDINATES.get((country_code, _normalize_city_key(normalized_city)))
        if coordinates is not None:
            return coordinates[0], coordinates[1], COUNTRY_NAMES_BY_CODE[country_code], normalized_city

    if country_code and country_code in COUNTRY_COORDINATES:
        latitude, longitude = COUNTRY_COORDINATES[country_code]
        return latitude, longitude, COUNTRY_NAMES_BY_CODE[country_code], normalized_city or None

    mcc_country_code = None
    normalized_mcc = _normalize_text(mcc)
    if normalized_mcc and normalized_mcc[:3] in MCC_TO_COUNTRY_CODE:
        mcc_country_code = MCC_TO_COUNTRY_CODE[normalized_mcc[:3]]

    if mcc_country_code and mcc_country_code in COUNTRY_COORDINATES:
        latitude, longitude = COUNTRY_COORDINATES[mcc_country_code]
        return (
            latitude,
            longitude,
            COUNTRY_NAMES_BY_CODE.get(mcc_country_code, mcc_country_code),
            normalized_city or None,
        )

    if allow_simulated:
        latitude, longitude = COUNTRY_COORDINATES["MA"]
        return latitude, longitude, "Maroc", normalized_city or None

    raise ValueError("Location unavailable")


def _spread_coordinates(
    latitude: float,
    longitude: float,
    *,
    spread_key: str,
    index: int,
) -> tuple[float, float]:
    digest = sha1(f"{spread_key}:{index}".encode("utf-8")).hexdigest()
    lat_seed = int(digest[:8], 16)
    lon_seed = int(digest[8:16], 16)

    lat_offset = ((lat_seed % 21) - 10) * 0.012
    lon_offset = ((lon_seed % 21) - 10) * 0.012
    return round(latitude + lat_offset, 6), round(longitude + lon_offset, 6)


def _resolve_base_location(
    row: dict[str, Any],
) -> tuple[float, float, LocationSource, str, str | None, str]:
    display_city, display_country = _get_display_location(row)

    for latitude_key, longitude_key in (
        ("latitude", "longitude"),
        ("lat", "lng"),
        ("gps_latitude", "gps_longitude"),
    ):
        latitude = _parse_float(row.get(latitude_key))
        longitude = _parse_float(row.get(longitude_key))
        if (
            latitude is not None
            and longitude is not None
            and _has_explicit_gps_consent(row)
        ):
            country = _country_label(display_country)
            return latitude, longitude, "gps_exact", country, display_city or None, "GPS exact disponible."

    city = display_city
    country_code = _resolve_country_code(display_country)

    if country_code and city:
        coordinates = CITY_COORDINATES.get((country_code, _normalize_city_key(city)))
        if coordinates is not None:
            return (
                coordinates[0],
                coordinates[1],
                "estimated_cdr",
                COUNTRY_NAMES_BY_CODE[country_code],
                city,
                "Position estimee a partir des donnees roaming/CDR.",
            )

    if country_code and country_code in COUNTRY_COORDINATES:
        latitude, longitude = COUNTRY_COORDINATES[country_code]
        return (
            latitude,
            longitude,
            "estimated_cdr",
            COUNTRY_NAMES_BY_CODE[country_code],
            city or None,
            "Position estimee a partir des donnees roaming/CDR.",
        )

    mcc_country_code = _extract_mcc_country_code(row)
    if mcc_country_code and mcc_country_code in COUNTRY_COORDINATES:
        latitude, longitude = COUNTRY_COORDINATES[mcc_country_code]
        return (
            latitude,
            longitude,
            "estimated_mcc",
            COUNTRY_NAMES_BY_CODE.get(mcc_country_code, mcc_country_code),
            city or None,
            "Position estimee a partir du code MCC operateur.",
        )

    simulated_country_code = country_code or mcc_country_code or "MA"
    latitude, longitude = COUNTRY_COORDINATES.get(simulated_country_code, COUNTRY_COORDINATES["MA"])
    return (
        latitude,
        longitude,
        "simulated_demo",
        COUNTRY_NAMES_BY_CODE.get(simulated_country_code, "Maroc"),
        city or None,
        "Position simulee de maniere realiste pour la demonstration PFE.",
    )


def _build_phone_line_indexes(
    db: Session,
) -> tuple[
    dict[tuple[str, str, str], PhoneLine],
    dict[tuple[str, str], list[PhoneLine]],
]:
    phone_lines = list(db.scalars(select(PhoneLine).where(PhoneLine.status != "inactive")))

    direct_by_number: dict[tuple[str, str, str], PhoneLine] = {}
    scoped_lines: dict[tuple[str, str], list[PhoneLine]] = defaultdict(list)

    for phone_line in phone_lines:
        operator = _normalize_text(phone_line.operator_name)
        department = _normalize_text(phone_line.department or UNKNOWN_VALUE, fallback=UNKNOWN_VALUE)
        scoped_lines[(operator, department)].append(phone_line)
        direct_by_number[(operator, department, phone_line.phone_number)] = phone_line

    for scoped_group in scoped_lines.values():
        scoped_group.sort(
            key=lambda current_line: (
                -(current_line.current_data_usage_gb or 0.0),
                current_line.phone_number,
            )
        )

    return direct_by_number, scoped_lines


def _get_phone_number_from_row(row: dict[str, Any]) -> str | None:
    for key in ("phone_number", "msisdn", "line_number", "caller_number"):
        normalized = _normalize_text(row.get(key))
        if normalized:
            return normalized
    return None


def _build_group_key(row: dict[str, Any]) -> tuple[str, str, str, str]:
    operator = _normalize_text(row.get("operator_maroc"), fallback=UNKNOWN_VALUE)
    department = _normalize_text(row.get("department"), fallback=UNKNOWN_VALUE)
    city, country_value = _get_display_location(row)
    city = city or UNKNOWN_VALUE
    country = _country_label(country_value)
    return operator, department, country, city


def _load_roaming_enrichment_rows() -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    fleet_rows = _load_csv_rows(_resolve_fleet_ai_csv_path(), delimiter=";")
    mobile_rows = _load_csv_rows(_resolve_mobile_fleet_csv_path(), delimiter=None)
    return fleet_rows, mobile_rows


def _build_enrichment_indexes(
    fleet_rows: list[dict[str, str]],
    mobile_rows: list[dict[str, str]],
) -> tuple[
    dict[tuple[str, str], list[dict[str, str]]],
    dict[tuple[str, str], list[dict[str, str]]],
]:
    fleet_by_scope: dict[tuple[str, str], list[dict[str, str]]] = defaultdict(list)
    mobile_by_scope: dict[tuple[str, str], list[dict[str, str]]] = defaultdict(list)

    for row in fleet_rows:
        fleet_by_scope[_build_scope_key(operator=row.get("operator"), department=row.get("department"))].append(row)

    for row in mobile_rows:
        mobile_by_scope[_build_scope_key(operator=row.get("operator"), department=row.get("department"))].append(row)

    for scoped_rows in fleet_by_scope.values():
        scoped_rows.sort(
            key=lambda current_row: (
                -_parse_int(current_row.get("alert_flag")),
                -_parse_int(current_row.get("anomaly_flag")),
                -(_parse_float(current_row.get("risk_score_100")) or 0.0),
                -(_parse_float(current_row.get("monthly_cost_mad")) or 0.0),
            )
        )

    for scoped_rows in mobile_by_scope.values():
        scoped_rows.sort(
            key=lambda current_row: (
                -_parse_int(current_row.get("alert_flag")),
                -(_parse_float(current_row.get("budget_risk_score")) or 0.0),
                -(_parse_float(current_row.get("estimated_price_mad")) or 0.0),
            )
        )

    return fleet_by_scope, mobile_by_scope


def _derive_risk_score(
    *,
    grouped_rows: list[dict[str, Any]],
    fleet_row: dict[str, str] | None,
    mobile_row: dict[str, str] | None,
    group_cost: float,
) -> float:
    cdr_score = max((_parse_float(row.get("fraud_risk_score_100")) or 0.0 for row in grouped_rows), default=0.0)
    fleet_score = _parse_float(fleet_row.get("risk_score_100")) if fleet_row else 0.0
    mobile_score = _parse_float(mobile_row.get("budget_risk_score")) if mobile_row else 0.0
    weighted_score = max(cdr_score, fleet_score or 0.0, mobile_score or 0.0)

    if group_cost >= 650:
        weighted_score = max(weighted_score, 88.0)
    elif group_cost >= 420:
        weighted_score = max(weighted_score, 74.0)
    elif group_cost >= 220:
        weighted_score = max(weighted_score, 56.0)

    return round(min(weighted_score, 100.0), 1)


def _risk_level_from_score(score: float) -> RiskLevel:
    if score >= 80:
        return "critical"
    if score >= 60:
        return "high"
    if score >= 40:
        return "medium"
    return "low"


def _derive_anomaly_type(
    *,
    grouped_rows: list[dict[str, Any]],
    fleet_row: dict[str, str] | None,
    risk_score: float,
    group_cost: float,
) -> str:
    fraud_signals = sum(
        1
        for row in grouped_rows
        if _parse_int(row.get("fraud_flag")) == 1 or _normalize_text(row.get("fraud_type")).lower() not in {"", "none"}
    )
    if fraud_signals > 0 or risk_score >= 85:
        return "fraude"
    if group_cost >= 420:
        return "cout_roaming"
    if fleet_row and (_parse_int(fleet_row.get("over_quota_flag")) == 1 or _parse_int(fleet_row.get("anomaly_flag")) == 1):
        return "surconsommation"
    if any(_parse_int(row.get("international_flag")) == 1 for row in grouped_rows):
        return "route_internationale"
    return "roaming_actif"


def _build_ai_reasoning(
    *,
    grouped_rows: list[dict[str, Any]],
    fleet_row: dict[str, str] | None,
    mobile_row: dict[str, str] | None,
    group_cost: float,
    risk_score: float,
    location_source: LocationSource,
) -> list[str]:
    factors: list[str] = []
    roaming_events = len(grouped_rows)
    fraud_signals = sum(
        1
        for row in grouped_rows
        if _parse_int(row.get("fraud_flag")) == 1 or _normalize_text(row.get("fraud_type")).lower() not in {"", "none"}
    )

    if group_cost >= 420:
        factors.append("cout roaming eleve")
    elif group_cost >= 220:
        factors.append("cout roaming significatif")

    if roaming_events >= 3:
        factors.append("roaming recurrent")
    elif roaming_events >= 2:
        factors.append("activite roaming repetee")

    if fleet_row and _parse_int(fleet_row.get("over_quota_flag")) == 1:
        factors.append("depassement de quota")
    if fleet_row and _parse_int(fleet_row.get("anomaly_flag")) == 1:
        factors.append("anomalie de consommation")
    if fleet_row and _parse_int(fleet_row.get("alert_flag")) == 1:
        factors.append("alerte IA flotte")

    if mobile_row and (_parse_float(mobile_row.get("budget_risk_score")) or 0.0) >= 60:
        factors.append("equipement ou profil a risque")

    if fraud_signals > 0:
        factors.append("fraude potentielle")

    if any(_parse_int(row.get("international_flag")) == 1 for row in grouped_rows):
        factors.append("route internationale sensible")

    if location_source != "gps_exact":
        factors.append("position estimee via donnees roaming")

    if risk_score >= 80:
        factors.append("score IA critique")
    elif risk_score >= 60:
        factors.append("score IA eleve")

    return factors[:6] or ["roaming actif a confirmer"]


def _build_country_explanation(country: str, factors: Counter[str], total_cost_mad: float, alerts: int) -> str:
    dominant_factors = [label for label, _ in factors.most_common(3)]
    joined_factors = ", ".join(dominant_factors) if dominant_factors else "pression roaming"
    return (
        f"{country} ressort comme pays a risque a cause de {joined_factors}, "
        f"avec {_format_currency(total_cost_mad)} et {alerts} alerte(s) consolidee(s)."
    )


def _format_currency(amount: float) -> str:
    return f"{amount:,.0f} MAD".replace(",", " ")


def _build_zone_risk_level(*, risk_score: float, critical_alerts: int, fraud_signals: int) -> str:
    if critical_alerts > 0 or fraud_signals > 0 or risk_score >= 80:
        return "critical"
    if risk_score >= 60:
        return "high"
    if risk_score >= 40:
        return "medium"
    return "low"


def get_roaming_map_data(
    db: Session,
    *,
    country: str | None = None,
    operator: str | None = None,
    department: str | None = None,
    risk_level: RiskLevel | None = None,
    min_roaming_cost_mad: float | None = None,
    period_from: str | None = None,
    period_to: str | None = None,
) -> dict[str, Any]:
    rows = [
        row
        for row in get_cdr_rows()
        if _is_roaming_event(row)
    ]

    direct_by_number, scoped_lines = _build_phone_line_indexes(db)
    grouped_rows: dict[tuple[str, str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped_rows[_build_group_key(row)].append(row)

    all_points: list[dict[str, Any]] = []

    for (group_operator, group_department, group_country, group_city), grouped in grouped_rows.items():
        grouped.sort(
            key=lambda current_row: (
                -_risk_rank(_risk_level_from_row(current_row)),
                -(_parse_float(current_row.get("call_cost_mad")) or 0.0),
                current_row.get("cdr_row_id", 0),
            )
        )

        representative_row = grouped[0]
        group_cost = round(
            sum(_parse_float(current_row.get("call_cost_mad")) or 0.0 for current_row in grouped),
            2,
        )
        direct_phone_number = _get_phone_number_from_row(representative_row)
        direct_phone_line = (
            direct_by_number.get((group_operator, group_department, direct_phone_number))
            if direct_phone_number
            else None
        )

        scoped_candidates = scoped_lines.get((group_operator, group_department), [])
        scoped_point_count = min(3, len(scoped_candidates)) if scoped_candidates else 1

        if direct_phone_line is not None:
            allocated_lines = [direct_phone_line]
            assignment_source: LineAssignmentSource = "direct"
        elif scoped_candidates:
            allocated_lines = scoped_candidates[:scoped_point_count]
            assignment_source = "estimated_scope"
        else:
            allocated_lines = [None]
            assignment_source = "demo"

        base_latitude, base_longitude, location_source, resolved_country, resolved_city, location_notice = (
            _resolve_base_location(representative_row)
        )
        max_event_time = max(
            (_parse_datetime(current_row.get("start_time")) for current_row in grouped),
            default=None,
        )
        max_risk_level = max(
            (_risk_level_from_row(current_row) for current_row in grouped),
            key=_risk_rank,
            default="low",
        )
        recommendation = _normalize_text(
            representative_row.get("recommendation"),
            fallback="Verifier le roaming et confirmer la legitimite des usages detectes.",
        )

        cost_per_point = round(group_cost / max(len(allocated_lines), 1), 2)

        for index, allocated_line in enumerate(allocated_lines):
            latitude, longitude = _spread_coordinates(
                base_latitude,
                base_longitude,
                spread_key=f"{group_operator}:{group_department}:{group_country}:{group_city}",
                index=index,
            )

            line_id = allocated_line.id if allocated_line is not None else None
            phone_number = allocated_line.phone_number if allocated_line is not None else None
            employee_name = allocated_line.assigned_to if allocated_line is not None else None
            data_usage_gb = allocated_line.current_data_usage_gb if allocated_line is not None else None
            assignment_notice = None

            if assignment_source == "estimated_scope":
                assignment_notice = "Ligne rapprochee par operateur et departement pour visualisation roaming."
            elif assignment_source == "demo":
                assignment_notice = "Aucune ligne directement rattachable: point conserve en mode demonstration."

            all_points.append(
                {
                    "line_id": line_id,
                    "phone_number": phone_number,
                    "employee_name": employee_name,
                    "department": group_department,
                    "operator": group_operator,
                    "country": resolved_country or group_country,
                    "city": None if resolved_city in {"", UNKNOWN_VALUE} else resolved_city,
                    "latitude": latitude,
                    "longitude": longitude,
                    "location_source": location_source,
                    "location_precision_label": _location_precision_label(location_source),
                    "line_assignment_source": assignment_source,
                    "location_notice": location_notice,
                    "assignment_notice": assignment_notice,
                    "roaming_cost_mad": cost_per_point,
                    "data_usage_gb": round(data_usage_gb, 2) if data_usage_gb is not None else None,
                    "risk_level": max_risk_level,
                    "risk_label": _risk_label(max_risk_level),
                    "recommendation": recommendation,
                    "event_time": max_event_time.isoformat() if max_event_time is not None else None,
                    "roaming_event_count": len(grouped),
                    "position_disclaimer": location_notice
                    if location_source != "gps_exact"
                    else "GPS exact disponible.",
                }
            )

    available_countries = sorted({point["country"] for point in all_points if point["country"]})
    available_operators = sorted({point["operator"] for point in all_points if point["operator"]})
    available_departments = sorted({point["department"] for point in all_points if point["department"]})
    available_risk_levels = ["critical", "high", "medium", "low"]

    start_period = _parse_date_filter(period_from)
    end_period = _parse_date_filter(period_to)
    if end_period is not None:
        end_period_dt = datetime.combine(end_period, time.max, tzinfo=UTC)
    else:
        end_period_dt = None

    if start_period is not None:
        start_period_dt = datetime.combine(start_period, time.min, tzinfo=UTC)
    else:
        start_period_dt = None

    filtered_points = [
        point
        for point in all_points
        if (country is None or point["country"] == country)
        and (operator is None or point["operator"] == operator)
        and (department is None or point["department"] == department)
        and (risk_level is None or point["risk_level"] == risk_level)
        and (
            min_roaming_cost_mad is None
            or point["roaming_cost_mad"] >= min_roaming_cost_mad
        )
        and (
            start_period_dt is None
            or (
                point["event_time"] is not None
                and datetime.fromisoformat(point["event_time"]) >= start_period_dt
            )
        )
        and (
            end_period_dt is None
            or (
                point["event_time"] is not None
                and datetime.fromisoformat(point["event_time"]) <= end_period_dt
            )
        )
    ]

    country_aggregates: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"country": UNKNOWN_VALUE, "total_cost_mad": 0.0, "device_count": 0, "critical_alerts": 0}
    )
    source_counts: dict[LocationSource, int] = {
        "gps_exact": 0,
        "estimated_cdr": 0,
        "estimated_mcc": 0,
        "simulated_demo": 0,
    }

    for point in filtered_points:
        country_entry = country_aggregates[point["country"]]
        country_entry["country"] = point["country"]
        country_entry["total_cost_mad"] += point["roaming_cost_mad"]
        country_entry["device_count"] += 1
        if point["risk_level"] == "critical":
            country_entry["critical_alerts"] += 1
        source_counts[point["location_source"]] += 1

    costly_countries = sorted(
        (
            {
                "country": country_name,
                "total_cost_mad": round(country_payload["total_cost_mad"], 2),
                "device_count": country_payload["device_count"],
                "critical_alerts": country_payload["critical_alerts"],
            }
            for country_name, country_payload in country_aggregates.items()
        ),
        key=lambda payload: (-payload["total_cost_mad"], -payload["critical_alerts"], payload["country"]),
    )[:5]

    point_dates = [point["event_time"] for point in all_points if point["event_time"] is not None]
    generated_at = datetime.now(UTC).isoformat()

    return {
        "points": filtered_points,
        "stats": {
            "roaming_devices": len(filtered_points),
            "total_roaming_cost_mad": round(
                sum(point["roaming_cost_mad"] for point in filtered_points),
                2,
            ),
            "critical_alerts": sum(
                1 for point in filtered_points if point["risk_level"] == "critical"
            ),
            "top_cost_countries": costly_countries,
            "exact_gps_count": source_counts["gps_exact"],
            "estimated_location_count": source_counts["estimated_cdr"] + source_counts["estimated_mcc"],
            "simulated_location_count": source_counts["simulated_demo"],
        },
        "filters": {
            "countries": available_countries,
            "operators": available_operators,
            "departments": available_departments,
            "risk_levels": available_risk_levels,
            "location_sources": ["gps_exact", "estimated_cdr", "estimated_mcc", "simulated_demo"],
            "period_start": min(point_dates) if point_dates else None,
            "period_end": max(point_dates) if point_dates else None,
        },
        "generated_at": generated_at,
        "privacy_notice": (
            "La carte privilegie les positions estimees ou simulees. "
            "Aucune position GPS reelle ne doit etre exploitee sans consentement explicite."
        ),
    }


def _pick_first_non_empty(*values: Any, fallback: str) -> str:
    for value in values:
        normalized = _normalize_text(value)
        if normalized and normalized.lower() not in {"ras", "none", "non renseigne", "inconnu"}:
            return normalized
    return fallback


def get_roaming_intelligence_map(
    db: Session,
    *,
    country: str | None = None,
    operator: str | None = None,
    department: str | None = None,
    risk_level: str | None = None,
    anomaly_type: str | None = None,
    min_cost_mad: float | None = None,
    period_from: str | None = None,
    period_to: str | None = None,
    roaming_active: bool | None = None,
    fraud_only: bool | None = None,
) -> dict[str, Any]:
    cdr_rows = [
        row
        for row in get_cdr_rows()
        if _is_roaming_event(row)
    ]
    fleet_rows, mobile_rows = _load_roaming_enrichment_rows()
    fleet_by_scope, mobile_by_scope = _build_enrichment_indexes(fleet_rows, mobile_rows)
    direct_by_number, scoped_lines = _build_phone_line_indexes(db)

    grouped_rows: dict[tuple[str, str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in cdr_rows:
        grouped_rows[_build_group_key(row)].append(row)

    devices: list[dict[str, Any]] = []
    for (group_operator, group_department, group_country, group_city), grouped in grouped_rows.items():
        grouped.sort(
            key=lambda current_row: (
                -_risk_rank(_risk_level_from_row(current_row)),
                -(_parse_float(current_row.get("call_cost_mad")) or 0.0),
                current_row.get("cdr_row_id", 0),
            )
        )

        representative_row = grouped[0]
        scope_key = _build_scope_key(operator=group_operator, department=group_department)
        fleet_candidates = fleet_by_scope.get(scope_key, [])
        mobile_candidates = mobile_by_scope.get(scope_key, [])
        fleet_reference = fleet_candidates[0] if fleet_candidates else None
        mobile_reference = mobile_candidates[0] if mobile_candidates else None

        direct_phone_number = _get_phone_number_from_row(representative_row)
        direct_phone_line = (
            direct_by_number.get((group_operator, group_department, direct_phone_number))
            if direct_phone_number
            else None
        )

        scoped_candidates = scoped_lines.get((group_operator, group_department), [])
        scoped_point_count = min(3, len(scoped_candidates)) if scoped_candidates else 1
        if direct_phone_line is not None:
            allocated_lines = [direct_phone_line]
            assignment_source: LineAssignmentSource = "direct"
        elif scoped_candidates:
            allocated_lines = scoped_candidates[:scoped_point_count]
            assignment_source = "estimated_scope"
        else:
            allocated_lines = [None]
            assignment_source = "demo"

        base_latitude, base_longitude, location_source, resolved_country, resolved_city, location_notice = (
            _resolve_base_location(representative_row)
        )
        max_event_time = max(
            (_parse_datetime(current_row.get("start_time")) for current_row in grouped),
            default=None,
        )
        group_cost = round(
            sum(_parse_float(current_row.get("call_cost_mad")) or 0.0 for current_row in grouped),
            2,
        )
        fraud_signals = sum(
            1
            for current_row in grouped
            if current_row.get("fraud_flag")
            or _normalize_text(current_row.get("fraud_type")).lower() not in {"", "none"}
        )
        alert_count = sum(
            1
            for current_row in grouped
            if current_row.get("fraud_flag")
            or current_row.get("high_cost_flag")
            or current_row.get("long_duration_flag")
            or current_row.get("international_flag")
            or (_parse_float(current_row.get("fraud_risk_score_100")) or 0.0) >= 60
        )

        cost_per_device = round(group_cost / max(len(allocated_lines), 1), 2)

        for index, allocated_line in enumerate(allocated_lines):
            fleet_row = (
                fleet_candidates[min(index, len(fleet_candidates) - 1)]
                if fleet_candidates
                else fleet_reference
            )
            mobile_row = (
                mobile_candidates[min(index, len(mobile_candidates) - 1)]
                if mobile_candidates
                else mobile_reference
            )
            risk_score = _derive_risk_score(
                grouped_rows=grouped,
                fleet_row=fleet_row,
                mobile_row=mobile_row,
                group_cost=cost_per_device,
            )
            point_risk_level = _risk_level_from_score(risk_score)
            point_anomaly_type = _derive_anomaly_type(
                grouped_rows=grouped,
                fleet_row=fleet_row,
                risk_score=risk_score,
                group_cost=cost_per_device,
            )
            reasoning = _build_ai_reasoning(
                grouped_rows=grouped,
                fleet_row=fleet_row,
                mobile_row=mobile_row,
                group_cost=cost_per_device,
                risk_score=risk_score,
                location_source=location_source,
            )

            latitude, longitude = _spread_coordinates(
                base_latitude,
                base_longitude,
                spread_key=f"{group_operator}:{group_department}:{group_country}:{group_city}",
                index=index,
            )
            line_id = allocated_line.id if allocated_line is not None else None
            phone_number = allocated_line.phone_number if allocated_line is not None else None
            employee_name = allocated_line.assigned_to if allocated_line is not None else None
            if not phone_number:
                phone_number = direct_phone_number
            data_usage = (
                allocated_line.current_data_usage_gb
                if allocated_line is not None
                else _parse_float(fleet_row.get("data_usage_gb")) if fleet_row else None
            )
            assignment_notice = None
            if assignment_source == "estimated_scope":
                assignment_notice = "Ligne rapprochee par operateur et departement pour visualisation roaming."
            elif assignment_source == "demo":
                assignment_notice = "Point de demonstration sans correspondance ligne directe."

            recommendation = _pick_first_non_empty(
                fleet_row.get("recommendation") if fleet_row else None,
                mobile_row.get("recommendation") if mobile_row else None,
                representative_row.get("recommendation"),
                fallback="Activer une option roaming adaptee et verifier l'usage observe.",
            )
            explanation = (
                f"Roaming {group_country} sous surveillance: "
                f"{', '.join(reasoning[:3])}. Recommandation IA: {recommendation.lower()}."
            )

            devices.append(
                {
                    "line_id": line_id,
                    "phone_number": phone_number,
                    "employee": employee_name,
                    "department": group_department,
                    "operator": _pick_first_non_empty(
                        representative_row.get("operator_maroc"),
                        fleet_row.get("operator") if fleet_row else None,
                        fallback=group_operator,
                    ),
                    "country": resolved_country or group_country,
                    "city": None if resolved_city in {"", UNKNOWN_VALUE} else resolved_city,
                    "latitude": latitude,
                    "longitude": longitude,
                    "location_source": location_source,
                    "location_precision_label": _location_precision_label(location_source),
                    "location_notice": location_notice,
                    "assignment_notice": assignment_notice,
                    "line_assignment_source": assignment_source,
                    "roaming_cost": cost_per_device,
                    "data_usage": round(data_usage, 2) if data_usage is not None else None,
                    "risk_level": point_risk_level,
                    "risk_score": risk_score,
                    "alerts": max(alert_count, 1 if point_risk_level in {"high", "critical"} else 0),
                    "fraud_signals": fraud_signals,
                    "anomaly_type": point_anomaly_type,
                    "roaming_active": True,
                    "recommendation": recommendation,
                    "ai_reasoning": reasoning,
                    "explanation": explanation,
                    "last_event_at": max_event_time.isoformat() if max_event_time is not None else None,
                    "roaming_events": len(grouped),
                    "call_zone": _normalize_text(representative_row.get("call_zone"), fallback="Roaming"),
                    "fraud_flag": bool(representative_row.get("fraud_flag")),
                    "call_cost_mad": round(_parse_float(representative_row.get("call_cost_mad")) or cost_per_device, 2),
                    "fraud_risk_score_100": round(
                        _parse_float(representative_row.get("fraud_risk_score_100")) or risk_score,
                        1,
                    ),
                    "location_origin": _normalize_text(representative_row.get("location_origin")) or None,
                    "country_origin": _normalize_text(representative_row.get("country_origin")) or None,
                    "location_dest": _normalize_text(representative_row.get("location_dest")) or None,
                    "country_dest": _normalize_text(representative_row.get("country_dest")) or None,
                }
            )

    available_countries = sorted({device["country"] for device in devices if device["country"]})
    available_operators = sorted({device["operator"] for device in devices if device["operator"]})
    available_departments = sorted({device["department"] for device in devices if device["department"]})
    available_risk_levels = ["critical", "high", "medium", "low"]
    available_anomaly_types = sorted({device["anomaly_type"] for device in devices if device["anomaly_type"]})

    start_period = _parse_date_filter(period_from)
    end_period = _parse_date_filter(period_to)
    start_period_dt = datetime.combine(start_period, time.min, tzinfo=UTC) if start_period else None
    end_period_dt = datetime.combine(end_period, time.max, tzinfo=UTC) if end_period else None

    filtered_devices = [
        device
        for device in devices
        if (country is None or device["country"] == country)
        and (operator is None or device["operator"] == operator)
        and (department is None or device["department"] == department)
        and (risk_level is None or device["risk_level"] == risk_level)
        and (anomaly_type is None or device["anomaly_type"] == anomaly_type)
        and (min_cost_mad is None or device["roaming_cost"] >= min_cost_mad)
        and (roaming_active is None or device["roaming_active"] is roaming_active)
        and (fraud_only is None or (device["fraud_signals"] > 0) is fraud_only)
        and (
            start_period_dt is None
            or (
                device["last_event_at"] is not None
                and datetime.fromisoformat(device["last_event_at"]) >= start_period_dt
            )
        )
        and (
            end_period_dt is None
            or (
                device["last_event_at"] is not None
                and datetime.fromisoformat(device["last_event_at"]) <= end_period_dt
            )
        )
    ]
    filtered_devices.sort(
        key=lambda device: (
            -_risk_rank(device["risk_level"]),
            -device["risk_score"],
            -device["roaming_cost"],
            device["country"],
        )
    )

    country_aggregates: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "country": UNKNOWN_VALUE,
            "total_roaming_cost_mad": 0.0,
            "active_devices": 0,
            "critical_alerts": 0,
            "fraud_signals": 0,
            "risk_score": 0.0,
            "operators": Counter(),
            "departments": Counter(),
            "factors": Counter(),
        }
    )
    location_counts: Counter[str] = Counter()
    cluster_aggregates: dict[tuple[str, str | None], dict[str, Any]] = defaultdict(
        lambda: {
            "label": UNKNOWN_VALUE,
            "country": UNKNOWN_VALUE,
            "city": None,
            "latitude": 0.0,
            "longitude": 0.0,
            "intensity": 0.0,
            "device_count": 0,
            "total_roaming_cost_mad": 0.0,
            "critical_alerts": 0,
            "fraud_signals": 0,
            "risk_score": 0.0,
        }
    )
    timeline_aggregates: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "bucket": "",
            "total_roaming_cost_mad": 0.0,
            "active_devices": 0,
            "alerts": 0,
            "critical_alerts": 0,
            "fraud_signals": 0,
        }
    )

    for device in filtered_devices:
        country_entry = country_aggregates[device["country"]]
        country_entry["country"] = device["country"]
        country_entry["total_roaming_cost_mad"] += device["roaming_cost"]
        country_entry["active_devices"] += 1
        country_entry["critical_alerts"] += int(device["risk_level"] == "critical")
        country_entry["fraud_signals"] += device["fraud_signals"]
        country_entry["risk_score"] = max(country_entry["risk_score"], device["risk_score"])
        country_entry["operators"][device["operator"]] += 1
        country_entry["departments"][device["department"]] += 1
        for factor in device["ai_reasoning"]:
            country_entry["factors"][factor] += 1

        location_counts[device["location_source"]] += 1

        cluster_key = (device["country"], device["city"])
        cluster_entry = cluster_aggregates[cluster_key]
        cluster_entry["label"] = f"{device['city']}, {device['country']}" if device["city"] else device["country"]
        cluster_entry["country"] = device["country"]
        cluster_entry["city"] = device["city"]
        cluster_entry["latitude"] = device["latitude"]
        cluster_entry["longitude"] = device["longitude"]
        cluster_entry["device_count"] += 1
        cluster_entry["total_roaming_cost_mad"] += device["roaming_cost"]
        cluster_entry["critical_alerts"] += int(device["risk_level"] == "critical")
        cluster_entry["fraud_signals"] += device["fraud_signals"]
        cluster_entry["risk_score"] = max(cluster_entry["risk_score"], device["risk_score"])
        cluster_entry["intensity"] += (
            device["roaming_cost"] * 0.16
            + device["alerts"] * 18
            + device["risk_score"] * 0.8
            + device["fraud_signals"] * 25
        )

        if device["last_event_at"]:
            bucket_label = datetime.fromisoformat(device["last_event_at"]).strftime("%d/%m %H:00")
            timeline_entry = timeline_aggregates[bucket_label]
            timeline_entry["bucket"] = bucket_label
            timeline_entry["total_roaming_cost_mad"] += device["roaming_cost"]
            timeline_entry["active_devices"] += 1
            timeline_entry["alerts"] += device["alerts"]
            timeline_entry["critical_alerts"] += int(device["risk_level"] == "critical")
            timeline_entry["fraud_signals"] += device["fraud_signals"]

    top_cost_countries = sorted(
        (
            {
                "country": country_name,
                "total_roaming_cost_mad": round(payload["total_roaming_cost_mad"], 2),
                "device_count": payload["active_devices"],
                "critical_alerts": payload["critical_alerts"],
                "fraud_signals": payload["fraud_signals"],
            }
            for country_name, payload in country_aggregates.items()
        ),
        key=lambda payload: (
            -payload["total_roaming_cost_mad"],
            -payload["critical_alerts"],
            -payload["fraud_signals"],
            payload["country"],
        ),
    )[:5]

    country_insights = sorted(
        (
            {
                "country": country_name,
                "risk_level": _build_zone_risk_level(
                    risk_score=payload["risk_score"],
                    critical_alerts=payload["critical_alerts"],
                    fraud_signals=payload["fraud_signals"],
                ),
                "total_roaming_cost_mad": round(payload["total_roaming_cost_mad"], 2),
                "active_devices": payload["active_devices"],
                "critical_alerts": payload["critical_alerts"],
                "fraud_signals": payload["fraud_signals"],
                "dominant_operator": payload["operators"].most_common(1)[0][0] if payload["operators"] else None,
                "top_department": payload["departments"].most_common(1)[0][0] if payload["departments"] else None,
                "explanation_factors": [label for label, _ in payload["factors"].most_common(4)],
                "explanation": _build_country_explanation(
                    country_name,
                    payload["factors"],
                    payload["total_roaming_cost_mad"],
                    payload["critical_alerts"] + payload["fraud_signals"],
                ),
            }
            for country_name, payload in country_aggregates.items()
        ),
        key=lambda payload: (
            -_risk_rank(payload["risk_level"]),
            -payload["critical_alerts"],
            -payload["fraud_signals"],
            -payload["total_roaming_cost_mad"],
        ),
    )

    cluster_items = sorted(
        (
            {
                "label": payload["label"],
                "country": payload["country"],
                "city": payload["city"],
                "latitude": round(payload["latitude"], 6),
                "longitude": round(payload["longitude"], 6),
                "intensity": round(payload["intensity"], 2),
                "device_count": payload["device_count"],
                "total_roaming_cost_mad": round(payload["total_roaming_cost_mad"], 2),
                "critical_alerts": payload["critical_alerts"],
                "fraud_signals": payload["fraud_signals"],
                "risk_level": _build_zone_risk_level(
                    risk_score=payload["risk_score"],
                    critical_alerts=payload["critical_alerts"],
                    fraud_signals=payload["fraud_signals"],
                ),
            }
            for payload in cluster_aggregates.values()
        ),
        key=lambda payload: (
            -payload["intensity"],
            -payload["critical_alerts"],
            -payload["total_roaming_cost_mad"],
            payload["label"],
        ),
    )

    critical_zones = [
        {
            **cluster,
            "active_devices": cluster["device_count"],
            "alerts": cluster["critical_alerts"] + max(cluster["fraud_signals"], 1 if cluster["risk_level"] in {"high", "critical"} else 0),
            "explanation": next(
                (
                    insight["explanation"]
                    for insight in country_insights
                    if insight["country"] == cluster["country"]
                ),
                f"{cluster['label']} concentre une pression roaming inhabituelle.",
            ),
        }
        for cluster in cluster_items[:6]
    ]

    movement_flow_aggregates: dict[tuple[str, str], dict[str, Any]] = defaultdict(
        lambda: {
            "origin_label": "",
            "destination_label": "",
            "origin_latitude": 0.0,
            "origin_longitude": 0.0,
            "destination_latitude": 0.0,
            "destination_longitude": 0.0,
            "total_roaming_cost_mad": 0.0,
            "alerts": 0,
            "event_count": 0,
            "risk_score": 0.0,
            "fraud_signals": 0,
        }
    )

    for row in cdr_rows:
        row_operator = _normalize_text(row.get("operator_maroc"), fallback=UNKNOWN_VALUE)
        row_department = _normalize_text(row.get("department"), fallback=UNKNOWN_VALUE)
        _, row_display_country = _get_display_location(row)
        row_country = _country_label(row_display_country)
        row_risk_level = _risk_level_from_row(row)
        row_anomaly_type = _derive_anomaly_type(
            grouped_rows=[row],
            fleet_row=(fleet_by_scope.get(_build_scope_key(operator=row_operator, department=row_department)) or [None])[0],
            risk_score=_parse_float(row.get("fraud_risk_score_100")) or 0.0,
            group_cost=_parse_float(row.get("call_cost_mad")) or 0.0,
        )
        row_fraud = bool(row.get("fraud_flag")) or _normalize_text(row.get("fraud_type")).lower() not in {"", "none"}
        row_event_time = _parse_datetime(row.get("start_time"))

        if country is not None and row_country != country:
            continue
        if operator is not None and row_operator != operator:
            continue
        if department is not None and row_department != department:
            continue
        if risk_level is not None and row_risk_level != risk_level:
            continue
        if anomaly_type is not None and row_anomaly_type != anomaly_type:
            continue
        if min_cost_mad is not None and (_parse_float(row.get("call_cost_mad")) or 0.0) < min_cost_mad:
            continue
        if fraud_only is True and not row_fraud:
            continue
        if roaming_active is False:
            continue
        if start_period_dt is not None and (row_event_time is None or row_event_time < start_period_dt):
            continue
        if end_period_dt is not None and (row_event_time is None or row_event_time > end_period_dt):
            continue

        try:
            origin_latitude, origin_longitude, origin_country, origin_city = _resolve_location_point(
                city=row.get("location_origin"),
                country=row.get("country_origin"),
                mcc=row.get("mcc"),
                allow_simulated=False,
            )
            destination_latitude, destination_longitude, destination_country, destination_city = _resolve_location_point(
                city=row.get("location_dest"),
                country=row.get("country_dest"),
                mcc=row.get("mcc"),
                allow_simulated=False,
            )
        except ValueError:
            continue

        origin_label = f"{origin_city}, {origin_country}" if origin_city else origin_country
        destination_label = f"{destination_city}, {destination_country}" if destination_city else destination_country
        flow_entry = movement_flow_aggregates[(origin_label, destination_label)]
        flow_entry["origin_label"] = origin_label
        flow_entry["destination_label"] = destination_label
        flow_entry["origin_latitude"] = origin_latitude
        flow_entry["origin_longitude"] = origin_longitude
        flow_entry["destination_latitude"] = destination_latitude
        flow_entry["destination_longitude"] = destination_longitude
        flow_entry["total_roaming_cost_mad"] += _parse_float(row.get("call_cost_mad")) or 0.0
        flow_entry["alerts"] += int(
            bool(row.get("fraud_flag"))
            or bool(row.get("high_cost_flag"))
            or bool(row.get("international_flag"))
        )
        flow_entry["event_count"] += 1
        flow_entry["risk_score"] = max(
            flow_entry["risk_score"],
            _parse_float(row.get("fraud_risk_score_100")) or 0.0,
        )
        flow_entry["fraud_signals"] += int(row_fraud)

    movement_flows = sorted(
        (
            {
                "origin_label": payload["origin_label"],
                "destination_label": payload["destination_label"],
                "origin_latitude": round(payload["origin_latitude"], 6),
                "origin_longitude": round(payload["origin_longitude"], 6),
                "destination_latitude": round(payload["destination_latitude"], 6),
                "destination_longitude": round(payload["destination_longitude"], 6),
                "total_roaming_cost_mad": round(payload["total_roaming_cost_mad"], 2),
                "alerts": payload["alerts"],
                "event_count": payload["event_count"],
                "risk_level": _build_zone_risk_level(
                    risk_score=payload["risk_score"],
                    critical_alerts=0,
                    fraud_signals=payload["fraud_signals"],
                ),
            }
            for payload in movement_flow_aggregates.values()
        ),
        key=lambda payload: (
            -payload["total_roaming_cost_mad"],
            -payload["alerts"],
            -payload["event_count"],
        ),
    )[:10]

    timeline = sorted(
        (
            {
                "bucket": bucket,
                "total_roaming_cost_mad": round(payload["total_roaming_cost_mad"], 2),
                "active_devices": payload["active_devices"],
                "alerts": payload["alerts"],
                "critical_alerts": payload["critical_alerts"],
                "fraud_signals": payload["fraud_signals"],
            }
            for bucket, payload in timeline_aggregates.items()
        ),
        key=lambda payload: payload["bucket"],
    )[-12:]

    point_dates = [device["last_event_at"] for device in devices if device["last_event_at"] is not None]
    highest_risk_country = country_insights[0]["country"] if country_insights else None
    generated_at = datetime.now(UTC).isoformat()

    return {
        "devices": filtered_devices,
        "stats": {
            "active_roaming_devices": len(filtered_devices),
            "total_roaming_cost_mad": round(sum(device["roaming_cost"] for device in filtered_devices), 2),
            "critical_roaming_alerts": sum(1 for device in filtered_devices if device["risk_level"] == "critical"),
            "fraud_roaming_detected": sum(1 for device in filtered_devices if device["fraud_signals"] > 0),
            "top_cost_countries": top_cost_countries,
            "highest_risk_country": highest_risk_country,
            "exact_gps_locations": location_counts.get("gps_exact", 0),
            "estimated_locations": location_counts.get("estimated_cdr", 0) + location_counts.get("estimated_mcc", 0),
            "simulated_locations": location_counts.get("simulated_demo", 0),
        },
        "filters": {
            "countries": available_countries,
            "operators": available_operators,
            "departments": available_departments,
            "risk_levels": available_risk_levels,
            "anomaly_types": available_anomaly_types,
            "location_sources": ["gps_exact", "estimated_cdr", "estimated_mcc", "simulated_demo"],
            "roaming_states": [True],
            "fraud_states": [True, False],
            "period_start": min(point_dates) if point_dates else None,
            "period_end": max(point_dates) if point_dates else None,
        },
        "heatmap": cluster_items,
        "clusters": cluster_items[:8],
        "critical_zones": critical_zones,
        "movement_flows": movement_flows,
        "timeline": timeline,
        "country_insights": country_insights[:6],
        "generated_at": generated_at,
        "live_supported": True,
        "live_refresh_interval_seconds": ROAMING_REFRESH_INTERVAL_SECONDS,
        "privacy_notice": (
            "Positions GPS reelles affichees uniquement avec consentement explicite. "
            "Sinon, FleetConnect utilise une localisation estimee via roaming/CDR, MCC ou une simulation realiste."
        ),
    }

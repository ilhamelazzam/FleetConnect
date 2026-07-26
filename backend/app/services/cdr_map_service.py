from __future__ import annotations

import logging
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from app.services.cdr_analytics_service import get_cdr_rows

CDR_MAP_LOGGER = logging.getLogger("app.cdr_map")
MOROCCO_CENTER = [31.7917, -7.0926]
MOROCCO_DEFAULT_ZOOM = 6
MOROCCO_COUNTRY_KEYS = {"ma", "maroc", "morocco", "marocco"}
MapMode = Literal["origins", "destinations", "flows"]
MapScope = Literal["morocco", "international", "all"]


@dataclass(frozen=True, slots=True)
class MoroccoCityReference:
    label: str
    region: str
    latitude: float
    longitude: float
    aliases: tuple[str, ...]


MOROCCO_CITIES: tuple[MoroccoCityReference, ...] = (
    MoroccoCityReference("Casablanca", "Casablanca-Settat", 33.5731, -7.5898, ("casablanca", "casablanca settat")),
    MoroccoCityReference("Rabat", "Rabat-Sale-Kenitra", 34.0209, -6.8416, ("rabat",)),
    MoroccoCityReference("Marrakech", "Marrakech-Safi", 31.6295, -7.9811, ("marrakech", "marrakesh")),
    MoroccoCityReference("Fes", "Fes-Meknes", 34.0331, -5.0003, ("fes", "fez", "fes medina")),
    MoroccoCityReference("Tanger", "Tanger-Tetouan-Al Hoceima", 35.7595, -5.8340, ("tanger", "tangier")),
    MoroccoCityReference("Agadir", "Souss-Massa", 30.4278, -9.5981, ("agadir",)),
    MoroccoCityReference("Meknes", "Fes-Meknes", 33.8935, -5.5473, ("meknes",)),
    MoroccoCityReference("Oujda", "Oriental", 34.6814, -1.9086, ("oujda",)),
    MoroccoCityReference("Kenitra", "Rabat-Sale-Kenitra", 34.2610, -6.5802, ("kenitra",)),
    MoroccoCityReference("Tetouan", "Tanger-Tetouan-Al Hoceima", 35.5889, -5.3626, ("tetouan", "tetuan")),
    MoroccoCityReference("Safi", "Marrakech-Safi", 32.2994, -9.2372, ("safi",)),
    MoroccoCityReference("El Jadida", "Casablanca-Settat", 33.2316, -8.5007, ("el jadida", "el-jadida", "jadida")),
    MoroccoCityReference("Beni Mellal", "Beni Mellal-Khenifra", 32.3373, -6.3498, ("beni mellal", "beni-mellal")),
    MoroccoCityReference("Nador", "Oriental", 35.1681, -2.9335, ("nador",)),
    MoroccoCityReference("Laayoune", "Laayoune-Sakia El Hamra", 27.1536, -13.2033, ("laayoune", "laayoun", "laayoune sakia el hamra")),
    MoroccoCityReference("Dakhla", "Dakhla-Oued Ed-Dahab", 23.6848, -15.9570, ("dakhla",)),
    MoroccoCityReference("Settat", "Casablanca-Settat", 33.0010, -7.6166, ("settat",)),
    MoroccoCityReference("Khouribga", "Casablanca-Settat", 32.8860, -6.9063, ("khouribga",)),
    MoroccoCityReference("Mohammedia", "Casablanca-Settat", 33.6861, -7.3829, ("mohammedia",)),
    MoroccoCityReference("Sale", "Rabat-Sale-Kenitra", 34.0372, -6.7985, ("sale", "salé")),
)


def _normalize_key(value: str | None) -> str:
    if value is None:
        return ""

    normalized = unicodedata.normalize("NFKD", value.strip().lower())
    return "".join(character for character in normalized if not unicodedata.combining(character))


CITY_INDEX = {
    _normalize_key(alias): city
    for city in MOROCCO_CITIES
    for alias in city.aliases
}


def _normalize_country(value: str | None) -> str:
    normalized = _normalize_key(value)
    if normalized in MOROCCO_COUNTRY_KEYS:
        return "MA"
    return (value or "").strip().upper()


def _normalize_mode(value: str | None) -> MapMode:
    if value in {"origins", "destinations", "flows"}:
        return value
    return "origins"


def _normalize_scope(value: str | None) -> MapScope:
    if value in {"morocco", "international", "all"}:
        return value
    return "morocco"


def _parse_start_time(value: str | None) -> datetime | None:
    if not value:
        return None

    try:
        return datetime.fromisoformat(value.replace(" ", "T"))
    except ValueError:
        return None


def _matches_date_filters(
    row: dict[str, Any],
    *,
    date_from: str | None,
    date_to: str | None,
) -> bool:
    event_time = _parse_start_time(row.get("start_time"))
    if event_time is None:
        return date_from is None and date_to is None

    if date_from:
        start_boundary = datetime.fromisoformat(f"{date_from}T00:00:00")
        if event_time < start_boundary:
            return False
    if date_to:
        end_boundary = datetime.fromisoformat(f"{date_to}T23:59:59")
        if event_time > end_boundary:
            return False
    return True


def _matches_scope(country_code: str, scope: MapScope) -> bool:
    if scope == "all":
        return True
    if scope == "morocco":
        return country_code == "MA"
    return country_code != "MA" and country_code != ""


def _resolve_city(city_name: str | None, country_name: str | None) -> MoroccoCityReference | None:
    country_code = _normalize_country(country_name)
    if country_code != "MA":
        return None
    return CITY_INDEX.get(_normalize_key(city_name))


def _build_unknown_location(
    row: dict[str, Any],
    *,
    location_field: str,
    country_field: str,
    reason: str,
) -> dict[str, Any]:
    return {
        "cdr_row_id": row["cdr_row_id"],
        "field": location_field,
        "raw_value": row.get(location_field) or "",
        "country": row.get(country_field) or "",
        "reason": reason,
    }


def get_cdr_map_data(
    *,
    mode: str | None = None,
    scope: str | None = None,
    operator: str | None = None,
    department: str | None = None,
    risk_level: str | None = None,
    fraud_severity: str | None = None,
    region: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> dict[str, Any]:
    selected_mode = _normalize_mode(mode)
    selected_scope = _normalize_scope(scope)
    normalized_region = _normalize_key(region)

    rows = [
        row
        for row in get_cdr_rows()
        if (operator is None or row["operator_maroc"] == operator)
        and (department is None or row["department"] == department)
        and (risk_level is None or row["severity"] == risk_level)
        and (fraud_severity is None or row["fraud_severity"] == fraud_severity)
        and _matches_date_filters(row, date_from=date_from, date_to=date_to)
    ]

    point_aggregates: dict[tuple[str, str], dict[str, Any]] = {}
    flow_aggregates: dict[tuple[str, str], dict[str, Any]] = {}
    unknown_locations: list[dict[str, Any]] = []
    recognized_city_count = 0
    ignored_points = 0

    for row in rows:
        origin_country = _normalize_country(row.get("country_origin"))
        destination_country = _normalize_country(row.get("country_dest"))
        origin_city = _resolve_city(row.get("location_origin"), row.get("country_origin"))
        destination_city = _resolve_city(row.get("location_dest"), row.get("country_dest"))

        if selected_mode == "origins":
            if not _matches_scope(origin_country, selected_scope):
                ignored_points += 1
                continue
            if origin_city is None:
                unknown_locations.append(
                    _build_unknown_location(
                        row,
                        location_field="location_origin",
                        country_field="country_origin",
                        reason="Ville marocaine non reconnue ou hors perimetre cartographique.",
                    )
                )
                ignored_points += 1
                continue
            if normalized_region and _normalize_key(origin_city.region) != normalized_region:
                ignored_points += 1
                continue

            aggregate = point_aggregates.setdefault(
                (origin_city.label, "MA"),
                {
                    "city": origin_city.label,
                    "country": "MA",
                    "region": origin_city.region,
                    "latitude": origin_city.latitude,
                    "longitude": origin_city.longitude,
                    "count": 0,
                    "alerts": 0,
                    "risk_score_total": 0.0,
                    "estimated_loss_mad": 0.0,
                    "top_recommendation": row["recommendation"],
                },
            )
            aggregate["count"] += 1
            aggregate["alerts"] += 1 if row["is_alert"] else 0
            aggregate["risk_score_total"] += row["fraud_risk_score_100"]
            aggregate["estimated_loss_mad"] += row["estimated_financial_loss"]
            recognized_city_count += 1
            continue

        if selected_mode == "destinations":
            if not _matches_scope(destination_country, selected_scope):
                ignored_points += 1
                continue
            if destination_city is None:
                unknown_locations.append(
                    _build_unknown_location(
                        row,
                        location_field="location_dest",
                        country_field="country_dest",
                        reason="Destination non geocodee dans le referentiel marocain.",
                    )
                )
                ignored_points += 1
                continue
            if normalized_region and _normalize_key(destination_city.region) != normalized_region:
                ignored_points += 1
                continue

            aggregate = point_aggregates.setdefault(
                (destination_city.label, "MA"),
                {
                    "city": destination_city.label,
                    "country": "MA",
                    "region": destination_city.region,
                    "latitude": destination_city.latitude,
                    "longitude": destination_city.longitude,
                    "count": 0,
                    "alerts": 0,
                    "risk_score_total": 0.0,
                    "estimated_loss_mad": 0.0,
                    "top_recommendation": row["recommendation"],
                },
            )
            aggregate["count"] += 1
            aggregate["alerts"] += 1 if row["is_alert"] else 0
            aggregate["risk_score_total"] += row["fraud_risk_score_100"]
            aggregate["estimated_loss_mad"] += row["estimated_financial_loss"]
            recognized_city_count += 1
            continue

        if not _matches_scope(origin_country, selected_scope):
            ignored_points += 1
            continue
        if origin_city is None or destination_city is None:
            if origin_city is None:
                unknown_locations.append(
                    _build_unknown_location(
                        row,
                        location_field="location_origin",
                        country_field="country_origin",
                        reason="Origine non geocodee pour le trace de flux.",
                    )
                )
            if destination_city is None:
                unknown_locations.append(
                    _build_unknown_location(
                        row,
                        location_field="location_dest",
                        country_field="country_dest",
                        reason="Destination non geocodee pour le trace de flux.",
                    )
                )
            ignored_points += 1
            continue
        if normalized_region and _normalize_key(origin_city.region) != normalized_region:
            ignored_points += 1
            continue

        aggregate = flow_aggregates.setdefault(
            (origin_city.label, destination_city.label),
            {
                "origin_city": origin_city.label,
                "origin_country": "MA",
                "origin_region": origin_city.region,
                "origin_latitude": origin_city.latitude,
                "origin_longitude": origin_city.longitude,
                "destination_city": destination_city.label,
                "destination_country": "MA",
                "destination_region": destination_city.region,
                "destination_latitude": destination_city.latitude,
                "destination_longitude": destination_city.longitude,
                "count": 0,
                "alerts": 0,
                "risk_score_total": 0.0,
                "estimated_loss_mad": 0.0,
            },
        )
        aggregate["count"] += 1
        aggregate["alerts"] += 1 if row["is_alert"] else 0
        aggregate["risk_score_total"] += row["fraud_risk_score_100"]
        aggregate["estimated_loss_mad"] += row["estimated_financial_loss"]
        recognized_city_count += 1

    points = [
        {
            "city": aggregate["city"],
            "country": aggregate["country"],
            "region": aggregate["region"],
            "latitude": aggregate["latitude"],
            "longitude": aggregate["longitude"],
            "count": aggregate["count"],
            "alerts": aggregate["alerts"],
            "risk_score": round(
                aggregate["risk_score_total"] / aggregate["count"],
                2,
            ),
            "estimated_loss_mad": round(aggregate["estimated_loss_mad"], 2),
            "top_recommendation": aggregate["top_recommendation"],
        }
        for aggregate in sorted(
            point_aggregates.values(),
            key=lambda item: (item["alerts"], item["estimated_loss_mad"], item["count"]),
            reverse=True,
        )
    ]

    flows = [
        {
            "origin_city": aggregate["origin_city"],
            "origin_country": aggregate["origin_country"],
            "origin_region": aggregate["origin_region"],
            "origin_latitude": aggregate["origin_latitude"],
            "origin_longitude": aggregate["origin_longitude"],
            "destination_city": aggregate["destination_city"],
            "destination_country": aggregate["destination_country"],
            "destination_region": aggregate["destination_region"],
            "destination_latitude": aggregate["destination_latitude"],
            "destination_longitude": aggregate["destination_longitude"],
            "count": aggregate["count"],
            "alerts": aggregate["alerts"],
            "risk_score": round(
                aggregate["risk_score_total"] / aggregate["count"],
                2,
            ),
            "estimated_loss_mad": round(aggregate["estimated_loss_mad"], 2),
        }
        for aggregate in sorted(
            flow_aggregates.values(),
            key=lambda item: (item["alerts"], item["estimated_loss_mad"], item["count"]),
            reverse=True,
        )
    ]

    deduplicated_unknown_locations = list(
        {
            (
                item["cdr_row_id"],
                item["field"],
                item["raw_value"],
                item["country"],
                item["reason"],
            ): item
            for item in unknown_locations
        }.values()
    )

    CDR_MAP_LOGGER.info(
        "event=cdr_map_generated mode=%s scope=%s rows=%s recognized=%s unknown=%s displayed_points=%s displayed_flows=%s ignored=%s region=%s",
        selected_mode,
        selected_scope,
        len(rows),
        recognized_city_count,
        len(deduplicated_unknown_locations),
        len(points),
        len(flows),
        ignored_points,
        region,
    )

    return {
        "mode": selected_mode,
        "scope": selected_scope,
        "center": MOROCCO_CENTER,
        "zoom": MOROCCO_DEFAULT_ZOOM,
        "points": points,
        "flows": flows,
        "unknown_locations": deduplicated_unknown_locations,
        "filters": {
            "operators": sorted({row["operator_maroc"] for row in rows}),
            "departments": sorted({row["department"] for row in rows}),
            "risk_levels": ["critique", "eleve", "moyen", "faible"],
            "fraud_severities": ["critique", "eleve", "moyen", "faible"],
            "regions": sorted({city.region for city in MOROCCO_CITIES}),
            "modes": ["origins", "destinations", "flows"],
            "scopes": ["morocco", "international", "all"],
        },
    }

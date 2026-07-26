# ruff: noqa: E501
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.models.phone_line import PhoneLine
from app.services.cdr_analytics_service import clear_cdr_analytics_cache

CSV_CONTENT = """start_time;duration_sec;call_type;location_origin;country_origin;location_dest;country_dest;is_night_call;transaction_status;fraud_type;operator_maroc;department;call_zone;roaming_flag;call_cost_mad;high_cost_flag;long_duration_flag;international_flag;fraud_flag;fraud_risk_proba;fraud_risk_score_100;risk_level;alert_flag;fraud_severity_score;fraud_severity;investigation_priority;estimated_financial_loss;ai_recommendation_priority;recommendation;phone_number;latitude;longitude;gps_consent;mcc
2025-05-31 16:09:56;293;local;Kampala;UG;Johannesburg;ZA;0;Genuine;none;Maroc Telecom;Commercial;National;0;102.55;0;0;0;0;0.352;35.2;Faible;0;35.2;Faible;P4;102.55;Low;RAS;+212600000001;;;;641
2025-05-31 16:09:57;14;international;Nairobi;KE;Addis Ababa;ET;0;Fraudulent;sim_box_fraud;Orange Maroc;RH;International;0;16.8;0;0;1;1;0.91713184;91.7;Critique;1;96.5;Critique;P1;8500;Immediate;Bloquer la SIM et ouvrir une investigation fraude;+212600000002;;;;639
2025-05-31 16:09:58;213;international;Meknes;MA;Madrid;ES;0;Fraudulent;roaming_abuse;inwi;Finance;Roaming;1;532.5;1;0;0;1;0.672;67.2;Eleve;1;72.4;Eleve;P2;4500;High;Verifier le roaming et restreindre l'itinerance si necessaire;+212600000003;;;;0;604
2025-05-31 16:09:59;480;local;Casablanca;MA;Rabat;MA;1;Fraudulent;none;Maroc Telecom;IT;National;0;250.0;0;1;0;1;0.452;45.2;Moyen;1;51.0;Moyen;P3;1900;Medium;Examiner la duree de l'appel et confirmer l'usage;+212600000004;;;;604
"""


@pytest.fixture
def cdr_analytics_csv(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    csv_path = tmp_path / "cdr_analytics.csv"
    csv_path.write_text(CSV_CONTENT, encoding="utf-8")

    monkeypatch.setenv("CDR_ANALYTICS_CSV_PATH", str(csv_path))
    get_settings.cache_clear()
    clear_cdr_analytics_cache()

    yield csv_path

    clear_cdr_analytics_cache()
    get_settings.cache_clear()


@pytest.fixture
def missing_cdr_analytics_csv(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    csv_path = tmp_path / "missing_cdr_analytics.csv"

    monkeypatch.setenv("CDR_ANALYTICS_CSV_PATH", str(csv_path))
    get_settings.cache_clear()
    clear_cdr_analytics_cache()

    yield csv_path

    clear_cdr_analytics_cache()
    get_settings.cache_clear()


def test_cdr_analytics_requires_authentication(client: TestClient, cdr_analytics_csv: Path) -> None:
    response = client.get("/api/v1/cdr-analytics/overview")

    assert response.status_code == 401


def test_cdr_analytics_overview_returns_expected_schema(
    client: TestClient,
    admin_headers: dict[str, str],
    cdr_analytics_csv: Path,
) -> None:
    response = client.get("/api/v1/cdr-analytics/overview", headers=admin_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["kpis"]["total_calls"] == 4
    assert payload["kpis"]["suspicious_calls"] == 3
    assert payload["kpis"]["critical_alerts"] == 1
    assert payload["top_risky_calls"][0]["cdr_row_id"] == 2
    assert payload["top_risky_calls"][0]["risk_id"] == "cdr-fraud-2"
    assert payload["top_risky_calls"][0]["ai_recommendation"]
    assert payload["top_risky_calls"][0]["suggested_action"]
    assert payload["top_risky_calls"][0]["investigation_priority"] == "P1"
    assert payload["top_risky_calls"][0]["estimated_financial_loss"] == 8500.0


def test_cdr_analytics_returns_empty_payload_when_csv_is_missing(
    client: TestClient,
    admin_headers: dict[str, str],
    missing_cdr_analytics_csv: Path,
) -> None:
    overview_response = client.get("/api/v1/cdr-analytics/overview", headers=admin_headers)
    filters_response = client.get("/api/v1/cdr-analytics/filters", headers=admin_headers)
    recommendations_response = client.get(
        "/api/v1/cdr-analytics/recommendations",
        headers=admin_headers,
    )

    assert overview_response.status_code == 200
    overview_payload = overview_response.json()
    assert overview_payload["kpis"]["total_calls"] == 0
    assert overview_payload["kpis"]["suspicious_calls"] == 0
    assert overview_payload["top_risky_calls"] == []
    assert overview_payload["priority_alerts"] == []

    assert filters_response.status_code == 200
    filters_payload = filters_response.json()
    assert filters_payload["operators"] == []
    assert filters_payload["departments"] == []
    assert filters_payload["call_zones"] == []
    assert filters_payload["severities"] == ["critique", "eleve", "moyen", "faible"]

    assert recommendations_response.status_code == 200
    recommendations_payload = recommendations_response.json()
    assert recommendations_payload["total"] == 0
    assert recommendations_payload["items"] == []


def test_cdr_analytics_alerts_support_filters_and_pagination(
    client: TestClient,
    admin_headers: dict[str, str],
    cdr_analytics_csv: Path,
) -> None:
    response = client.get(
        "/api/v1/cdr-analytics/alerts",
        headers=admin_headers,
        params={"severity": "eleve", "limit": 1},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["limit"] == 1
    assert payload["items"][0]["cdr_row_id"] == 3
    assert payload["items"][0]["severity"] == "eleve"
    assert payload["items"][0]["confidence_score"] == 0.672
    assert payload["items"][0]["investigation_priority"] == "P2"


def test_cdr_analytics_alert_detail_returns_404_for_non_alert(
    client: TestClient,
    admin_headers: dict[str, str],
    cdr_analytics_csv: Path,
) -> None:
    response = client.get("/api/v1/cdr-analytics/alerts/1", headers=admin_headers)

    assert response.status_code == 404


def test_cdr_analytics_filters_return_distinct_values(
    client: TestClient,
    admin_headers: dict[str, str],
    cdr_analytics_csv: Path,
) -> None:
    response = client.get("/api/v1/cdr-analytics/filters", headers=admin_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["operators"] == ["Maroc Telecom", "Orange Maroc", "inwi"]
    assert payload["severities"] == ["critique", "eleve", "moyen", "faible"]


def test_roaming_map_returns_estimated_position_with_privacy_fallback(
    client: TestClient,
    admin_headers: dict[str, str],
    db_session,
    cdr_analytics_csv: Path,
) -> None:
    db_session.add(
        PhoneLine(
            phone_number="+212600000003",
            operator_name="inwi",
            plan_name="Business XL",
            assigned_to="Imane B.",
            department="Finance",
            status="active",
            current_data_usage_gb=18.4,
            previous_data_usage_gb=14.9,
        )
    )
    db_session.commit()

    response = client.get(
        "/api/v1/cdr-analytics/roaming-map",
        headers=admin_headers,
        params={"country": "Espagne"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["stats"]["roaming_devices"] == 1
    assert payload["stats"]["estimated_location_count"] == 1
    assert payload["stats"]["exact_gps_count"] == 0
    assert payload["privacy_notice"]
    assert payload["filters"]["countries"] == ["Espagne"]

    point = payload["points"][0]
    assert point["phone_number"] == "+212600000003"
    assert point["employee_name"] == "Imane B."
    assert point["country"] == "Espagne"
    assert point["city"] == "Madrid"
    assert point["location_source"] == "estimated_cdr"
    assert point["location_precision_label"] == "Localisation estimee via roaming/CDR"
    assert point["line_assignment_source"] == "direct"
    assert point["risk_level"] == "high"
    assert point["roaming_cost_mad"] == 532.5
    assert point["position_disclaimer"] == "Position estimee a partir des donnees roaming/CDR."


def test_cdr_map_returns_morocco_points_and_region_filter(
    client: TestClient,
    admin_headers: dict[str, str],
    cdr_analytics_csv: Path,
) -> None:
    response = client.get(
        "/api/v1/cdr-analytics/map",
        headers=admin_headers,
        params={"mode": "origins", "scope": "morocco"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["center"] == [31.7917, -7.0926]
    assert payload["zoom"] == 6
    assert {point["city"] for point in payload["points"]} == {"Casablanca", "Meknes"}
    assert payload["unknown_locations"] == []

    region_response = client.get(
        "/api/v1/cdr-analytics/map",
        headers=admin_headers,
        params={"mode": "origins", "scope": "morocco", "region": "Fes-Meknes"},
    )

    assert region_response.status_code == 200
    region_payload = region_response.json()
    assert [point["city"] for point in region_payload["points"]] == ["Meknes"]


def test_cdr_map_flows_ignores_unknown_international_destinations(
    client: TestClient,
    admin_headers: dict[str, str],
    cdr_analytics_csv: Path,
) -> None:
    response = client.get(
        "/api/v1/cdr-analytics/map",
        headers=admin_headers,
        params={"mode": "flows", "scope": "morocco"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["flows"]) == 1
    assert payload["flows"][0]["origin_city"] == "Casablanca"
    assert payload["flows"][0]["destination_city"] == "Rabat"
    assert any(item["raw_value"] == "Madrid" for item in payload["unknown_locations"])

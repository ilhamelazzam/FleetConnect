# ruff: noqa: E501
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.services.cdr_analytics_service import clear_cdr_analytics_cache

CSV_CONTENT = """start_time;duration_sec;call_type;location_origin;country_origin;location_dest;country_dest;is_night_call;transaction_status;fraud_type;operator_maroc;department;call_zone;roaming_flag;call_cost_mad;high_cost_flag;long_duration_flag;international_flag;fraud_flag;fraud_risk_proba;fraud_risk_score_100
2025-05-31 16:09:56;293;local;Kampala;UG;Johannesburg;ZA;0;Genuine;none;Maroc Telecom;Commercial;National;0;102.55;0;0;0;0;0.352;35.2
2025-05-31 16:09:57;14;international;Nairobi;KE;Addis Ababa;ET;0;Fraudulent;sim_box_fraud;Orange Maroc;RH;International;0;16.8;0;0;1;1;0.91713184;91.7
2025-05-31 16:09:58;213;international;Cairo;EG;Lagos;NG;0;Fraudulent;roaming_abuse;inwi;Finance;Roaming;1;532.5;1;0;0;1;0.672;67.2
2025-05-31 16:09:59;480;local;Casablanca;MA;Rabat;MA;1;Fraudulent;none;Maroc Telecom;IT;National;0;250.0;0;1;0;1;0.452;45.2
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

import os
import time
from pathlib import Path

import pytest

from app.core.config import get_settings
from app.services.cdr_analytics_service import (
    clear_cdr_analytics_cache,
    get_cdr_alert_detail,
    get_cdr_filters,
    get_cdr_overview,
    list_cdr_alerts,
    list_cdr_recommendations,
)

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


def test_get_cdr_overview_returns_expected_aggregations(cdr_analytics_csv: Path) -> None:
    overview = get_cdr_overview()

    assert overview["kpis"]["total_calls"] == 4
    assert overview["kpis"]["suspicious_calls"] == 3
    assert overview["kpis"]["critical_alerts"] == 1
    assert overview["kpis"]["average_cost_mad"] == 225.46
    assert overview["kpis"]["average_risk_score"] == 59.83
    assert overview["kpis"]["suspicious_cost_exposure_mad"] == 799.3
    assert overview["risk_distribution"] == [
        {"severity": "critique", "count": 1},
        {"severity": "eleve", "count": 1},
        {"severity": "moyen", "count": 1},
        {"severity": "faible", "count": 1},
    ]
    assert overview["top_risky_calls"][0]["cdr_row_id"] == 2
    assert overview["priority_alerts"][1]["cdr_row_id"] == 3


def test_alert_detail_and_recommendations_are_derived_from_flags(cdr_analytics_csv: Path) -> None:
    alerts = list_cdr_alerts(limit=10)
    recommendations = list_cdr_recommendations(limit=10)
    detail = get_cdr_alert_detail(2)

    assert alerts["total"] == 3
    assert recommendations["items"][0]["recommendation"].startswith("Bloquer la SIM")
    assert detail is not None
    assert detail["severity"] == "critique"
    assert detail["fraud_type"] == "sim_box_fraud"
    assert "Fraude SIM box detectee" in detail["rule_matches"]
    assert detail["recommendation_reason"].startswith("La combinaison du type de fraude")


def test_get_cdr_filters_lists_expected_values(cdr_analytics_csv: Path) -> None:
    filters = get_cdr_filters()

    assert filters["operators"] == ["Maroc Telecom", "Orange Maroc", "inwi"]
    assert filters["departments"] == ["Commercial", "Finance", "IT", "RH"]
    assert filters["call_zones"] == ["International", "National", "Roaming"]
    assert filters["severities"] == ["critique", "eleve", "moyen", "faible"]


def test_cache_refreshes_when_csv_changes(cdr_analytics_csv: Path) -> None:
    first_overview = get_cdr_overview()
    assert first_overview["kpis"]["total_calls"] == 4

    replacement_content = """start_time;duration_sec;call_type;location_origin;country_origin;location_dest;country_dest;is_night_call;transaction_status;fraud_type;operator_maroc;department;call_zone;roaming_flag;call_cost_mad;high_cost_flag;long_duration_flag;international_flag;fraud_flag;fraud_risk_proba;fraud_risk_score_100
2025-05-31 16:10:01;60;international;Paris;FR;Madrid;ES;0;Fraudulent;sim_box_fraud;Orange Maroc;Direction;International;0;1000;1;0;1;1;0.95;95
"""

    cdr_analytics_csv.write_text(replacement_content, encoding="utf-8")
    next_timestamp = time.time() + 2
    os.utime(cdr_analytics_csv, (next_timestamp, next_timestamp))

    refreshed_overview = get_cdr_overview()
    assert refreshed_overview["kpis"]["total_calls"] == 1
    assert refreshed_overview["kpis"]["suspicious_calls"] == 1


def test_cdr_overview_returns_empty_payload_when_csv_is_missing(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    missing_csv = tmp_path / "missing_cdr.csv"

    monkeypatch.setenv("CDR_ANALYTICS_CSV_PATH", str(missing_csv))
    get_settings.cache_clear()
    clear_cdr_analytics_cache()

    overview = get_cdr_overview()

    assert overview["kpis"]["total_calls"] == 0
    assert [item["count"] for item in overview["risk_distribution"]] == [0, 0, 0, 0]

    clear_cdr_analytics_cache()
    get_settings.cache_clear()

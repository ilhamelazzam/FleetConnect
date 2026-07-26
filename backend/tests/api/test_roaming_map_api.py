# ruff: noqa: E501
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.models.phone_line import PhoneLine
from app.services.cdr_analytics_service import clear_cdr_analytics_cache

CDR_CSV_CONTENT = """start_time;duration_sec;call_type;location_origin;country_origin;location_dest;country_dest;is_night_call;transaction_status;fraud_type;operator_maroc;department;call_zone;roaming_flag;call_cost_mad;high_cost_flag;long_duration_flag;international_flag;fraud_flag;fraud_risk_proba;fraud_risk_score_100;phone_number;latitude;longitude;gps_consent;mcc
2025-05-31 16:09:58;213;international;Meknès;MA;Madrid;ES;0;Fraudulent;roaming_abuse;inwi;Finance;Roaming;1;532.5;1;0;1;1;0.672;67.2;+212600000003;;;;0;604
"""

FLEET_CSV_CONTENT = """gender;SeniorCitizen;Partner;Dependents;tenure;PhoneService;MultipleLines;InternetService;OnlineSecurity;OnlineBackup;DeviceProtection;TechSupport;StreamingTV;StreamingMovies;Contract;PaperlessBilling;PaymentMethod;MonthlyCharges;TotalCharges;Churn;operator;department;monthly_cost_mad;total_cost_mad;plan;roaming_flag;data_usage_gb;quota_gb;over_quota_flag;anomaly_flag;risk_proba;risk_score_100;risk_level;future_cost_mad;future_cost_pred_mad;alert_flag;recommendation
Male;0;No;No;2;Yes;No;DSL;Yes;Yes;No;No;No;No;Month-to-month;Yes;Mailed check;53.85;108.15;1;inwi;Finance;538.5;1081.5;XL;1;30.95;50;1;1;0.81;81.0;Critique;641.54;615.74;1;Activer forfait Europe
"""

MOBILE_CSV_CONTENT = """operator,department,employee_profile,device_category,estimated_price_mad,budget_risk_score,risk_level,alert_flag,recommendation,real_price_range,real_price_label,predicted_price_range,predicted_price_label,prediction_confidence
inwi,Finance,Usage intensif,Haut de gamme,4500,63.3,Eleve,1,Verifier la pertinence budgetaire pour roaming,2,Haut de gamme,2,Haut de gamme,0.7111
"""


@pytest.fixture
def roaming_data_files(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> tuple[Path, Path, Path]:
    cdr_path = tmp_path / "cdr_analytics.csv"
    fleet_path = tmp_path / "fleet_ai_results.csv"
    mobile_path = tmp_path / "mobile_fleet.csv"

    cdr_path.write_text(CDR_CSV_CONTENT, encoding="utf-8")
    fleet_path.write_text(FLEET_CSV_CONTENT, encoding="utf-8")
    mobile_path.write_text(MOBILE_CSV_CONTENT, encoding="utf-8")

    monkeypatch.setenv("CDR_ANALYTICS_CSV_PATH", str(cdr_path))
    monkeypatch.setenv("CUSTOMER_CHURN_OUTPUT_CSV_PATH", str(fleet_path))
    monkeypatch.setenv("MOBILE_FLEET_CSV_PATH", str(mobile_path))
    get_settings.cache_clear()
    clear_cdr_analytics_cache()

    yield cdr_path, fleet_path, mobile_path

    clear_cdr_analytics_cache()
    get_settings.cache_clear()


def test_roaming_intelligence_map_returns_enriched_geospatial_payload(
    client: TestClient,
    admin_headers: dict[str, str],
    db_session,
    roaming_data_files: tuple[Path, Path, Path],
) -> None:
    db_session.add(
        PhoneLine(
            phone_number="+212600000003",
            operator_name="inwi",
            plan_name="Business XL",
            assigned_to="Ahmed F.",
            department="Finance",
            status="active",
            current_data_usage_gb=18.4,
            previous_data_usage_gb=14.9,
        )
    )
    db_session.commit()

    response = client.get(
        "/api/v1/roaming/map",
        headers=admin_headers,
        params={"country": "Espagne", "fraud_only": "true"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["live_supported"] is True
    assert payload["live_refresh_interval_seconds"] == 12
    assert payload["stats"]["active_roaming_devices"] == 1
    assert payload["stats"]["fraud_roaming_detected"] == 1
    assert payload["stats"]["highest_risk_country"] == "Espagne"
    assert payload["filters"]["countries"] == ["Espagne"]
    assert payload["filters"]["anomaly_types"] == ["fraude"]
    assert payload["movement_flows"]
    assert payload["heatmap"]
    assert payload["critical_zones"]
    assert payload["country_insights"][0]["country"] == "Espagne"

    device = payload["devices"][0]
    assert device["phone_number"] == "+212600000003"
    assert device["employee"] == "Ahmed F."
    assert device["country"] == "Espagne"
    assert device["city"] == "Madrid"
    assert device["location_source"] == "estimated_cdr"
    assert device["location_notice"] == "Position estimee a partir des donnees roaming/CDR."
    assert device["roaming_cost"] == 532.5
    assert device["fraud_signals"] == 1
    assert device["anomaly_type"] == "fraude"
    assert device["recommendation"] == "Activer forfait Europe"
    assert device["ai_reasoning"]
    assert device["call_zone"] == "Roaming"
    assert device["fraud_flag"] is True
    assert device["call_cost_mad"] == 532.5
    assert device["fraud_risk_score_100"] == 67.2
    assert device["location_origin"] == "Meknès"
    assert device["country_origin"] == "MA"
    assert device["location_dest"] == "Madrid"
    assert device["country_dest"] == "ES"

    critical_zone = payload["critical_zones"][0]
    assert critical_zone["latitude"] == pytest.approx(40.4168, abs=0.2)
    assert critical_zone["longitude"] == pytest.approx(-3.7038, abs=0.2)
    assert critical_zone["intensity"] > 0

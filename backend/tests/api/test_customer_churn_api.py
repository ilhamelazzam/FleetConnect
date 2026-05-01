# ruff: noqa: E501
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.services.customer_churn_service import clear_customer_churn_cache

RAW_CSV_CONTENT = """customerID,gender,SeniorCitizen,Partner,Dependents,tenure,PhoneService,MultipleLines,InternetService,OnlineSecurity,OnlineBackup,DeviceProtection,TechSupport,StreamingTV,StreamingMovies,Contract,PaperlessBilling,PaymentMethod,MonthlyCharges,TotalCharges,Churn
0001-AAAAA,Female,0,Yes,No,1,Yes,No,Fiber optic,No,Yes,No,No,No,No,Month-to-month,Yes,Electronic check,90.00,90.00,Yes
0002-BBBBB,Male,1,No,No,50,Yes,Yes,DSL,Yes,No,Yes,Yes,No,No,Two year,No,Bank transfer (automatic),55.00,2750.00,No
0003-CCCCC,Female,0,Yes,Yes,20,Yes,No,No,No internet service,No internet service,No internet service,No internet service,No internet service,No internet service,One year,Yes,Mailed check,35.00,700.00,No
"""

OUTPUT_CSV_CONTENT = """gender;SeniorCitizen;Partner;Dependents;tenure;PhoneService;MultipleLines;InternetService;OnlineSecurity;OnlineBackup;DeviceProtection;TechSupport;StreamingTV;StreamingMovies;Contract;PaperlessBilling;PaymentMethod;MonthlyCharges;TotalCharges;Churn;operator;department;monthly_cost_mad;total_cost_mad;plan;roaming_flag;data_usage_gb;quota_gb;over_quota_flag;anomaly_flag;risk_proba;risk_score_100;risk_level;future_cost_mad;future_cost_pred_mad;alert_flag;recommendation
Female;0;Yes;No;1;Yes;No;Fiber optic;No;Yes;No;No;No;No;Month-to-month;Yes;Electronic check;90.00;90.00;1;Maroc Telecom;Commercial;900.0;900.0;XL;1;25.0;20;1;1;0.88;88.0;Critique;990.0;1010.0;1;Offrir remise de retention immediate
Male;1;No;No;50;Yes;Yes;DSL;Yes;No;Yes;Yes;No;No;Two year;No;Bank transfer (automatic);55.00;2750.00;0;Orange Maroc;Finance;550.0;27500.0;L;0;9.0;20;0;0;0.12;12.0;Faible;560.0;555.0;0;RAS
Female;0;Yes;Yes;20;Yes;No;No;No internet service;No internet service;No internet service;No internet service;No internet service;No internet service;One year;Yes;Mailed check;35.00;700.00;0;inwi;Support;350.0;7000.0;M;0;5.0;10;0;0;0.46;46.0;Moyen;365.0;390.0;1;Proposer support client cible
"""


@pytest.fixture
def customer_churn_csvs(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> tuple[Path, Path]:
    input_csv_path = tmp_path / "customer_churn_input.csv"
    output_csv_path = tmp_path / "customer_churn_output.csv"
    input_csv_path.write_text(RAW_CSV_CONTENT, encoding="utf-8")
    output_csv_path.write_text(OUTPUT_CSV_CONTENT, encoding="utf-8")

    monkeypatch.setenv("CUSTOMER_CHURN_INPUT_CSV_PATH", str(input_csv_path))
    monkeypatch.setenv("CUSTOMER_CHURN_OUTPUT_CSV_PATH", str(output_csv_path))
    get_settings.cache_clear()
    clear_customer_churn_cache()

    yield input_csv_path, output_csv_path

    clear_customer_churn_cache()
    get_settings.cache_clear()


def test_customer_churn_requires_authentication(
    client: TestClient,
    customer_churn_csvs: tuple[Path, Path],
) -> None:
    response = client.get("/api/v1/customer-churn/overview")

    assert response.status_code == 401


def test_customer_churn_overview_returns_expected_payload(
    client: TestClient,
    admin_headers: dict[str, str],
    customer_churn_csvs: tuple[Path, Path],
) -> None:
    response = client.get("/api/v1/customer-churn/overview", headers=admin_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["kpis"]["total_customers"] == 3
    assert payload["kpis"]["high_risk_customers"] == 2
    assert payload["top_at_risk_customers"][0]["customer_id"] == "0001-AAAAA"
    assert payload["top_at_risk_customers"][0]["risk_id"] == "customer-churn-1"
    assert payload["top_at_risk_customers"][0]["ai_recommendation"]
    assert payload["top_at_risk_customers"][0]["suggested_action"]


def test_customer_churn_customers_filters_and_pagination_work(
    client: TestClient,
    admin_headers: dict[str, str],
    customer_churn_csvs: tuple[Path, Path],
) -> None:
    response = client.get(
        "/api/v1/customer-churn/customers",
        headers=admin_headers,
        params={"contract": "Month-to-month", "limit": 1},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["items"][0]["customer_id"] == "0001-AAAAA"


def test_customer_churn_predictions_and_recommendations_return_priority_customers(
    client: TestClient,
    admin_headers: dict[str, str],
    customer_churn_csvs: tuple[Path, Path],
) -> None:
    predictions_response = client.get("/api/v1/customer-churn/predictions", headers=admin_headers)
    recommendations_response = client.get(
        "/api/v1/customer-churn/recommendations",
        headers=admin_headers,
    )

    assert predictions_response.status_code == 200
    assert recommendations_response.status_code == 200
    assert predictions_response.json()["total"] == 2
    assert recommendations_response.json()["items"][0]["risk_level"] == "Critique"
    assert recommendations_response.json()["items"][0]["confidence_score"] == 0.88


def test_customer_churn_filters_return_expected_values(
    client: TestClient,
    admin_headers: dict[str, str],
    customer_churn_csvs: tuple[Path, Path],
) -> None:
    response = client.get("/api/v1/customer-churn/filters", headers=admin_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["operators"] == ["Maroc Telecom", "Orange Maroc", "inwi"]
    assert payload["contracts"] == ["Month-to-month", "One year", "Two year"]
    assert payload["prediction_statuses"] == ["Yes", "No"]

import os
import time
from pathlib import Path

import pytest

from app.core.config import get_settings
from app.services.customer_churn_service import (
    clear_customer_churn_cache,
    get_customer_churn_filters,
    get_customer_churn_overview,
    get_customer_churn_reports,
    list_customer_churn_customers,
    list_customer_churn_predictions,
    list_customer_churn_recommendations,
)

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


def test_customer_churn_overview_returns_expected_kpis(customer_churn_csvs: tuple[Path, Path]) -> None:
    overview = get_customer_churn_overview()

    assert overview["kpis"]["total_customers"] == 3
    assert overview["kpis"]["actual_churn_customers"] == 1
    assert overview["kpis"]["churn_rate_pct"] == 33.33
    assert overview["kpis"]["high_risk_customers"] == 2
    assert overview["kpis"]["revenue_at_risk_mad"] == 1250.0
    assert overview["top_at_risk_customers"][0]["customer_id"] == "0001-AAAAA"


def test_customer_churn_lists_are_sorted_and_filtered(customer_churn_csvs: tuple[Path, Path]) -> None:
    customers = list_customer_churn_customers(limit=10)
    predictions = list_customer_churn_predictions(limit=10)
    recommendations = list_customer_churn_recommendations(limit=10)

    assert customers["items"][0]["customer_id"] == "0001-AAAAA"
    assert predictions["total"] == 2
    assert predictions["items"][0]["risk_level"] == "Critique"
    assert recommendations["items"][1]["customer_id"] == "0003-CCCCC"


def test_customer_churn_reports_and_filters_return_expected_groups(
    customer_churn_csvs: tuple[Path, Path],
) -> None:
    reports = get_customer_churn_reports()
    filters = get_customer_churn_filters()

    assert reports["churn_by_contract"][0]["label"] == "Month-to-month"
    assert reports["risk_by_department"][0]["label"] == "Commercial"
    assert reports["top_revenue_at_risk"][0]["customer_id"] == "0001-AAAAA"
    assert filters["risk_levels"] == ["Critique", "Eleve", "Moyen", "Faible"]
    assert filters["price_ranges"] == [
        "Moins de 400 MAD",
        "400-599 MAD",
        "600-799 MAD",
        "800 MAD et plus",
    ]


def test_customer_churn_cache_refreshes_when_csv_changes(
    customer_churn_csvs: tuple[Path, Path],
) -> None:
    _, output_csv_path = customer_churn_csvs
    first_overview = get_customer_churn_overview()
    assert first_overview["kpis"]["total_customers"] == 3

    replacement_content = """gender;SeniorCitizen;Partner;Dependents;tenure;PhoneService;MultipleLines;InternetService;OnlineSecurity;OnlineBackup;DeviceProtection;TechSupport;StreamingTV;StreamingMovies;Contract;PaperlessBilling;PaymentMethod;MonthlyCharges;TotalCharges;Churn;operator;department;monthly_cost_mad;total_cost_mad;plan;roaming_flag;data_usage_gb;quota_gb;over_quota_flag;anomaly_flag;risk_proba;risk_score_100;risk_level;future_cost_mad;future_cost_pred_mad;alert_flag;recommendation
Male;1;No;No;6;Yes;Yes;Fiber optic;No;No;No;No;Yes;Yes;Month-to-month;Yes;Electronic check;95.00;570.00;1;Orange Maroc;Direction;950.0;5700.0;XL;1;31.0;20;1;1;0.91;91.0;Critique;1040.0;1110.0;1;Intervention retention executive
"""

    output_csv_path.write_text(replacement_content, encoding="utf-8")
    next_timestamp = time.time() + 2
    os.utime(output_csv_path, (next_timestamp, next_timestamp))

    refreshed_overview = get_customer_churn_overview()
    assert refreshed_overview["kpis"]["total_customers"] == 1
    assert refreshed_overview["kpis"]["high_risk_customers"] == 1

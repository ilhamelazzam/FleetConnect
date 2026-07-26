import os
import time
from pathlib import Path

import pytest

from app.core.config import get_settings
from app.services.mobile_fleet_advanced_kpi_service import (
    clear_mobile_fleet_advanced_kpi_cache,
    get_mobile_fleet_advanced_kpis,
)
from app.services.mobile_fleet_service import (
    clear_mobile_fleet_cache,
    get_mobile_fleet_consumption,
    get_mobile_fleet_filters,
    get_mobile_fleet_overview,
    get_mobile_fleet_reports,
    list_mobile_fleet_devices,
    list_mobile_fleet_recommendations,
)

CSV_CONTENT = """operator,department,employee_profile,device_category,estimated_price_mad,budget_risk_score,risk_level,alert_flag,recommendation,real_price_range,real_price_label,predicted_price_range,predicted_price_label,prediction_confidence
Maroc Telecom,Finance,Usage standard,Milieu de gamme,2500,42.0,Moyen,0,Appareil conforme au besoin,1,Milieu de gamme,1,Milieu de gamme,0.9622
inwi,Finance,Usage intensif,Haut de gamme,4500,63.3,Élevé,1,Vérifier la pertinence budgétaire pour ce département,2,Haut de gamme,2,Haut de gamme,0.7111
Orange Maroc,Direction,Usage premium,Premium,6500,85.0,Critique,1,Optimiser l'affectation premium pour la direction,3,Premium,3,Premium,0.9810
Orange Maroc,Support,Usage basique,Entrée de gamme,1700,21.0,Faible,0,Appareil conforme au besoin,0,Entrée de gamme,0,Entrée de gamme,0.9950
"""

ADVANCED_KPI_CSV_CONTENT = """Nombre total d'appareils;Budget total estimé MAD;TCO total 12 mois MAD;Fleet Health Score;Score moyen d'adéquation;Appareils adaptés;Appareils inadaptés;Appareils surdimensionnés;Appareils sous-dimensionnés;Économie potentielle MAD;Alertes
342;855000;10260000;91;87.5;288;54;20;34;126500;34 alertes budget, 12 anomalies, 8 fraudes
"""


@pytest.fixture
def mobile_fleet_csv(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    csv_path = tmp_path / "mobile_fleet.csv"
    csv_path.write_text(CSV_CONTENT, encoding="utf-8")

    monkeypatch.setenv("MOBILE_FLEET_CSV_PATH", str(csv_path))
    get_settings.cache_clear()
    clear_mobile_fleet_cache()

    yield csv_path

    clear_mobile_fleet_cache()
    get_settings.cache_clear()


@pytest.fixture
def mobile_fleet_advanced_kpi_csv(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> Path:
    csv_path = tmp_path / "mobile_fleet_advanced_kpi.csv"
    csv_path.write_text(ADVANCED_KPI_CSV_CONTENT, encoding="utf-8")

    monkeypatch.setenv("MOBILE_FLEET_ADVANCED_KPI_CSV_PATH", str(csv_path))
    get_settings.cache_clear()
    clear_mobile_fleet_advanced_kpi_cache()

    yield csv_path

    clear_mobile_fleet_advanced_kpi_cache()
    get_settings.cache_clear()


def test_mobile_fleet_overview_returns_expected_kpis(mobile_fleet_csv: Path) -> None:
    overview = get_mobile_fleet_overview()

    assert overview["kpis"]["total_devices"] == 4
    assert overview["kpis"]["total_estimated_budget_mad"] == 15200.0
    assert overview["kpis"]["average_estimated_price_mad"] == 3800.0
    assert overview["kpis"]["average_budget_risk_score"] == 52.83
    assert overview["kpis"]["alert_devices"] == 2
    assert overview["kpis"]["critical_risks"] == 1
    assert overview["kpis"]["premium_devices"] == 1
    assert overview["risk_distribution"] == [
        {"label": "Critique", "count": 1},
        {"label": "Eleve", "count": 1},
        {"label": "Moyen", "count": 1},
        {"label": "Faible", "count": 1},
    ]


def test_mobile_fleet_devices_and_recommendations_are_sorted_by_priority(mobile_fleet_csv: Path) -> None:
    devices = list_mobile_fleet_devices(limit=10)
    recommendations = list_mobile_fleet_recommendations(limit=10)

    assert devices["items"][0]["fleet_row_id"] == 3
    assert devices["items"][0]["risk_level"] == "Critique"
    assert recommendations["total"] == 2
    assert recommendations["items"][0]["fleet_row_id"] == 3
    assert recommendations["items"][1]["fleet_row_id"] == 2


def test_mobile_fleet_consumption_and_reports_return_budget_breakdowns(mobile_fleet_csv: Path) -> None:
    consumption = get_mobile_fleet_consumption()
    reports = get_mobile_fleet_reports()
    filters = get_mobile_fleet_filters()

    assert consumption["budget_by_operator"][0]["label"] == "Orange Maroc"
    assert consumption["top_expensive_devices"][0]["fleet_row_id"] == 3
    assert reports["recommendations_by_department"][0]["department"] == "Direction"
    assert filters["risk_levels"] == ["Critique", "Eleve", "Moyen", "Faible"]


def test_mobile_fleet_cache_refreshes_when_csv_changes(mobile_fleet_csv: Path) -> None:
    first_overview = get_mobile_fleet_overview()
    assert first_overview["kpis"]["total_devices"] == 4

    replacement_content = """operator,department,employee_profile,device_category,estimated_price_mad,budget_risk_score,risk_level,alert_flag,recommendation,real_price_range,real_price_label,predicted_price_range,predicted_price_label,prediction_confidence
Orange Maroc,IT,Usage intensif,Premium,7200,92.0,Critique,1,Optimiser immédiatement l'affectation premium,3,Premium,3,Premium,0.9970
"""

    mobile_fleet_csv.write_text(replacement_content, encoding="utf-8")
    next_timestamp = time.time() + 2
    os.utime(mobile_fleet_csv, (next_timestamp, next_timestamp))

    refreshed_overview = get_mobile_fleet_overview()
    assert refreshed_overview["kpis"]["total_devices"] == 1
    assert refreshed_overview["kpis"]["critical_risks"] == 1


def test_mobile_fleet_overview_returns_empty_payload_when_csv_is_missing(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    missing_csv = tmp_path / "missing_mobile_fleet.csv"

    monkeypatch.setenv("MOBILE_FLEET_CSV_PATH", str(missing_csv))
    get_settings.cache_clear()
    clear_mobile_fleet_cache()

    overview = get_mobile_fleet_overview()

    assert overview["kpis"]["total_devices"] == 0
    assert overview["top_devices"] == []

    clear_mobile_fleet_cache()
    get_settings.cache_clear()


def test_mobile_fleet_overview_supports_semicolon_delimited_csv(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    csv_path = tmp_path / "mobile_fleet_semicolon.csv"
    csv_path.write_text(
        """operator;department;employee_profile;device_category;estimated_price_mad;budget_risk_score;risk_level;alert_flag;recommendation;real_price_range;real_price_label;predicted_price_range;predicted_price_label;prediction_confidence
Maroc Telecom;Finance;Usage standard;Milieu de gamme;2500;42.0;Moyen;0;Appareil conforme au besoin;1;Milieu de gamme;1;Milieu de gamme;0.9622
Orange Maroc;Direction;Usage premium;Premium;6500;85.0;Critique;1;Optimiser l'affectation premium pour la direction;3;Premium;3;Premium;0.9810
""",
        encoding="utf-8",
    )

    monkeypatch.setenv("MOBILE_FLEET_CSV_PATH", str(csv_path))
    get_settings.cache_clear()
    clear_mobile_fleet_cache()

    overview = get_mobile_fleet_overview()

    assert overview["kpis"]["total_devices"] == 2
    assert overview["kpis"]["critical_risks"] == 1

    clear_mobile_fleet_cache()
    get_settings.cache_clear()


def test_mobile_fleet_advanced_kpis_returns_expected_payload(
    mobile_fleet_advanced_kpi_csv: Path,
) -> None:
    payload = get_mobile_fleet_advanced_kpis()

    assert payload["total_devices"] == 342
    assert payload["fleet_health_score"] == 91
    assert payload["average_fit_score"] == 87.5
    assert payload["potential_savings_mad"] == 126500.0
    assert payload["fit_rate_pct"] == 84.21
    assert payload["optimization_rate_pct"] == 15.79
    assert "fraudes" in payload["alerts_summary"]

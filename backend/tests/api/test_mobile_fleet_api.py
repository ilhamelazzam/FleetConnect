# ruff: noqa: E501
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.services.mobile_fleet_service import clear_mobile_fleet_cache

CSV_CONTENT = """operator,department,employee_profile,device_category,estimated_price_mad,budget_risk_score,risk_level,alert_flag,recommendation,real_price_range,real_price_label,predicted_price_range,predicted_price_label,prediction_confidence
Maroc Telecom,Finance,Usage standard,Milieu de gamme,2500,42.0,Moyen,0,Appareil conforme au besoin,1,Milieu de gamme,1,Milieu de gamme,0.9622
inwi,Finance,Usage intensif,Haut de gamme,4500,63.3,Élevé,1,Vérifier la pertinence budgétaire pour ce département,2,Haut de gamme,2,Haut de gamme,0.7111
Orange Maroc,Direction,Usage premium,Premium,6500,85.0,Critique,1,Optimiser l'affectation premium pour la direction,3,Premium,3,Premium,0.9810
Orange Maroc,Support,Usage basique,Entrée de gamme,1700,21.0,Faible,0,Appareil conforme au besoin,0,Entrée de gamme,0,Entrée de gamme,0.9950
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


def test_mobile_fleet_requires_authentication(client: TestClient, mobile_fleet_csv: Path) -> None:
    response = client.get("/api/v1/mobile-fleet/overview")

    assert response.status_code == 401


def test_mobile_fleet_overview_returns_expected_payload(
    client: TestClient,
    admin_headers: dict[str, str],
    mobile_fleet_csv: Path,
) -> None:
    response = client.get("/api/v1/mobile-fleet/overview", headers=admin_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["kpis"]["total_devices"] == 4
    assert payload["kpis"]["alert_devices"] == 2
    assert payload["top_devices"][0]["fleet_row_id"] == 3
    assert payload["top_devices"][0]["risk_id"] == "mobile-fleet-3"
    assert payload["top_devices"][0]["ai_recommendation"]
    assert payload["top_devices"][0]["suggested_action"]


def test_mobile_fleet_devices_filters_and_pagination_work(
    client: TestClient,
    admin_headers: dict[str, str],
    mobile_fleet_csv: Path,
) -> None:
    response = client.get(
        "/api/v1/mobile-fleet/devices",
        headers=admin_headers,
        params={"department": "Finance", "limit": 1},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 2
    assert payload["items"][0]["department"] == "Finance"


def test_mobile_fleet_recommendations_return_priority_devices(
    client: TestClient,
    admin_headers: dict[str, str],
    mobile_fleet_csv: Path,
) -> None:
    response = client.get("/api/v1/mobile-fleet/recommendations", headers=admin_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 2
    assert payload["items"][0]["risk_level"] == "Critique"
    assert payload["items"][0]["title"] == "Risque budget appareil-3"
    assert payload["items"][0]["confidence_score"] == 0.981


def test_mobile_fleet_filters_return_expected_values(
    client: TestClient,
    admin_headers: dict[str, str],
    mobile_fleet_csv: Path,
) -> None:
    response = client.get("/api/v1/mobile-fleet/filters", headers=admin_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["operators"] == ["Maroc Telecom", "Orange Maroc", "inwi"]
    assert payload["device_categories"] == ["Entrée de gamme", "Haut de gamme", "Milieu de gamme", "Premium"]

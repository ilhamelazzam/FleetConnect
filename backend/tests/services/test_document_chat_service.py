from io import BytesIO
import logging

import pandas as pd
import pytest
from openpyxl import Workbook

from app.services.document_chat_service import (
    _analyze_dataframe,
    _detect_business_columns,
    _load_csv_dataframe,
    _load_excel_dataframe,
    _series_to_numeric,
)
from app.services.business_answer_quality_service import polish_business_text


@pytest.mark.parametrize(
    ("payload", "expected_encoding", "expected_separator"),
    [
        (
            b"Collaborateur;Departement;Cout mensuel MAD;Data usage GB;Quota data GB\nAndre\xe9;Finance;1200;2;20\n",
            "latin1",
            ";",
        ),
        (
            b"Collaborateur\tDepartement\tCout mensuel MAD\tData usage GB\tQuota data GB\nAmina\tIT\t980\t6\t15\n",
            "utf-8",
            "tabulation",
        ),
    ],
)
def test_load_csv_dataframe_detects_separator_and_encoding(
    payload: bytes,
    expected_encoding: str,
    expected_separator: str,
    caplog,
) -> None:
    with caplog.at_level(logging.INFO, logger="app.chat.document"):
        loaded = _load_csv_dataframe(payload)

    assert list(loaded.dataframe.columns) == [
        "Collaborateur",
        "Departement",
        "Cout mensuel MAD",
        "Data usage GB",
        "Quota data GB",
    ]
    assert expected_encoding in (loaded.parse_notice or "")
    assert expected_separator in (loaded.parse_notice or "")
    assert any(
        "event=document_csv_selected" in record.message and expected_encoding in record.message
        for record in caplog.records
    )


def test_load_csv_dataframe_detects_header_after_preamble() -> None:
    payload = (
        "Rapport exporte le 2026-05-24;;;;\n"
        "Source;ERP Finance;;;;\n"
        "Collaborateur;Departement;Montant facture MAD;Revenue MAD;Incident Count\n"
        "Amina;Finance;1250;4100;0\n"
        "Yassine;Commercial;1780;5200;2\n"
    ).encode("utf-8")

    loaded = _load_csv_dataframe(payload)

    assert list(loaded.dataframe.columns) == [
        "Collaborateur",
        "Departement",
        "Montant facture MAD",
        "Revenue MAD",
        "Incident Count",
    ]
    assert loaded.parse_debug["header_detected"] is True
    assert (loaded.parse_debug["header_row"] or 0) >= 2


def test_load_excel_dataframe_selects_best_sheet_and_detects_header() -> None:
    workbook = Workbook()
    cover = workbook.active
    cover.title = "Cover"
    cover.append(["Rapport mensuel"])
    cover.append(["Genere automatiquement"])

    fleet = workbook.create_sheet("Fleet")
    fleet.append(["Export flotte telecom mai 2026"])
    fleet.append(
        [
            "Operateur",
            "Departement",
            "Cout mensuel MAD",
            "Data usage GB",
            "Quota data GB",
            "Status",
        ]
    )
    fleet.append(["Orange", "IT", 1800, 12, 15, "active"])
    fleet.append(["Maroc Telecom", "Finance", 950, 3, 10, "inactive"])

    buffer = BytesIO()
    workbook.save(buffer)

    loaded = _load_excel_dataframe(buffer.getvalue(), "xlsx")

    assert loaded.selected_sheet == "Fleet"
    assert list(loaded.dataframe.columns) == [
        "Operateur",
        "Departement",
        "Cout mensuel MAD",
        "Data usage GB",
        "Quota data GB",
        "Status",
    ]
    assert "Feuille analysee: Fleet." in (loaded.parse_notice or "")
    assert loaded.parse_debug["header_detected"] is True
    assert (loaded.parse_debug["header_row"] or 0) >= 2


def test_detect_business_columns_maps_telecom_fields() -> None:
    dataframe = pd.DataFrame(
        {
            "Collaborateur": ["Amina", "Yassine"],
            "Departement": ["Finance", "Commercial"],
            "Forfait Business": ["Premium", "Standard"],
            "Cout mensuel MAD": [2200, 980],
            "Data usage GB": [4, 18],
            "Quota data GB": [20, 25],
            "Roaming actif": [1, 0],
            "Numero telephone": ["0612345678", "0623456789"],
        }
    )
    numeric_series_by_column = {
        column_name: _series_to_numeric(dataframe[column_name])
        for column_name in dataframe.columns
    }

    mapping = _detect_business_columns(dataframe, numeric_series_by_column)

    assert "Cout mensuel MAD" in mapping["cout_total"]
    assert "Data usage GB" in mapping["consommation_data"]
    assert "Quota data GB" in mapping["quota_data"]
    assert "Roaming actif" in mapping["roaming"]
    assert "Departement" in mapping["departement"]
    assert "Forfait Business" in mapping["forfait"]
    assert "Collaborateur" in mapping["utilisateur"]
    assert "Numero telephone" in mapping["telephone"]


def test_detect_business_columns_avoids_false_positive_service_and_profile_fields() -> None:
    dataframe = pd.DataFrame(
        {
            "PhoneService": ["Yes", "No"],
            "InternetService": ["Fiber", "DSL"],
            "employee_profile": ["Usage standard", "Usage intensif"],
            "department": ["Finance", "Commercial"],
            "monthly_cost_mad": [1200, 1800],
        }
    )
    numeric_series_by_column = {
        column_name: _series_to_numeric(dataframe[column_name])
        for column_name in dataframe.columns
    }

    mapping = _detect_business_columns(dataframe, numeric_series_by_column)

    assert mapping["departement"] == ["department"]
    assert mapping["utilisateur"] == []
    assert "PhoneService" not in mapping["telephone"]
    assert "InternetService" not in mapping["departement"]


def test_detect_business_columns_does_not_confuse_quota_flags_with_real_quota() -> None:
    dataframe = pd.DataFrame(
        {
            "quota_gb": [20, 25],
            "over_quota_flag": [0, 1],
            "data_usage_gb": [12, 30],
            "monthly_cost_mad": [400, 900],
        }
    )
    numeric_series_by_column = {
        column_name: _series_to_numeric(dataframe[column_name])
        for column_name in dataframe.columns
    }

    mapping = _detect_business_columns(dataframe, numeric_series_by_column)

    assert mapping["quota_data"] == ["quota_gb"]
    assert "over_quota_flag" not in mapping["quota_data"]
    assert mapping["depassement_quota"] == ["over_quota_flag"]


def test_detect_business_columns_maps_finance_and_log_fields() -> None:
    dataframe = pd.DataFrame(
        {
            "Invoice Number": ["INV-001", "INV-002"],
            "Revenue MAD": [12000, 9400],
            "Montant facture MAD": [8200, 6100],
            "Incident Type": ["Latency", "Authentication error"],
            "Severity Level": ["medium", "critical"],
            "Event Timestamp": ["2026-05-20 08:10:00", "2026-05-20 09:10:00"],
            "Department": ["Support", "IT"],
        }
    )
    numeric_series_by_column = {
        column_name: _series_to_numeric(dataframe[column_name])
        for column_name in dataframe.columns
    }

    mapping = _detect_business_columns(dataframe, numeric_series_by_column)

    assert "Invoice Number" in mapping["facture"]
    assert "Revenue MAD" in mapping["revenu"]
    assert "Montant facture MAD" in mapping["cout_total"]
    assert "Incident Type" in mapping["incident"]
    assert "Severity Level" in mapping["gravite"]
    assert "Event Timestamp" in mapping["horodatage"]


def test_analyze_dataframe_computes_business_metrics_and_recommendations() -> None:
    dataframe = pd.DataFrame(
        {
            "Collaborateur": ["Amina", "Yassine", "Salma", "Nora"],
            "Departement": ["Commercial", "Finance", "IT", "Support"],
            "Forfait": ["Business Premium", "Business Premium", "Standard", "Travel Max"],
            "Cout mensuel MAD": [4500, 1800, 900, 2200],
            "Data usage GB": [3, 2, 18, 0],
            "Quota data GB": [20, 15, 15, 10],
            "Roaming actif": [1, 0, 0, 1],
            "Roaming cost MAD": [0, 0, 0, 0],
            "Over quota flag": [0, 0, 1, 0],
            "Risk score 100": [86, 20, 52, 91],
            "Status": ["active", "active", "active", "inactive"],
        }
    )

    insights = _analyze_dataframe(dataframe)

    assert insights.primary_cost_column == "Cout mensuel MAD"
    assert insights.total_primary_cost == pytest.approx(9400.0)
    assert insights.underutilized_count == 3
    assert insights.oversized_plan_count == 2
    assert insights.useless_roaming_count == 2
    assert insights.over_quota_count == 1
    assert insights.inactive_billed_count == 1
    assert insights.high_risk_count == 2
    assert insights.top_department == "Commercial"
    assert insights.top_plan == "Business Premium"
    assert insights.top_user == "Amina"
    assert insights.estimated_savings_mad is not None
    assert insights.estimated_savings_mad > 0
    assert insights.optimization_score >= 60
    assert insights.cost_score >= 50
    assert any("roaming" in recommendation.title.lower() for recommendation in insights.decision_recommendations)
    assert any("Risque optimisation" in item for item in insights.detected_kpis)
    assert any("20%" in item.lower() for item in insights.detected_anomalies)
    assert "exposition financiere" in insights.business_answer.lower()
    assert "synthese direction" in insights.business_answer.lower()
    assert "legende risque" in insights.business_answer.lower()


def test_analyze_dataframe_logs_ignored_columns_and_skips_generic_profiles(
    caplog,
) -> None:
    dataframe = pd.DataFrame(
        {
            "operator": ["Maroc Telecom", "Orange"],
            "department": ["Finance", "Commercial"],
            "employee_profile": ["Usage standard", "Usage intensif"],
            "estimated_price_mad": [2500, 4500],
            "budget_risk_score": [42, 83],
            "alert_flag": [0, 1],
        }
    )

    with caplog.at_level(logging.INFO, logger="app.chat.document"):
        insights = _analyze_dataframe(dataframe)

    assert insights.top_user is None
    assert any("ignored_columns" in record.message for record in caplog.records)


def test_analyze_dataframe_builds_generic_finance_and_log_insights() -> None:
    dataframe = pd.DataFrame(
        {
            "Invoice Number": ["INV-001", "INV-002", "INV-003", "INV-004"],
            "Department": ["Finance", "Commercial", "IT", "IT"],
            "Montant facture MAD": [1200, 1800, 9200, 400],
            "Revenue MAD": [6200, 7100, 9800, 1400],
            "Incident Type": ["none", "quota", "fraud", "none"],
            "Severity Level": ["low", "medium", "critical", "low"],
            "Event Timestamp": [
                "2026-05-20 08:10:00",
                "2026-05-20 09:10:00",
                "2026-05-20 10:10:00",
                "2026-05-20 11:10:00",
            ],
            "Risk score 100": [18, 41, 96, 12],
        }
    )

    insights = _analyze_dataframe(dataframe)

    assert insights.document_profile in {"finance_operations", "logs_incidents"}
    assert insights.primary_cost_column == "Montant facture MAD"
    assert insights.critical_incident_count == 1
    assert insights.incident_count >= 2
    assert insights.anomaly_score >= 40
    assert any("Incidents critiques" in item for item in insights.detected_kpis)
    assert any("severite critique" in item.lower() for item in insights.detected_anomalies)
    assert any("incidents critiques" in recommendation.title.lower() for recommendation in insights.decision_recommendations)
    assert "incidents" in insights.business_answer.lower()


def test_polish_business_text_fixes_french_and_smooths_extreme_scores() -> None:
    raw_text = "\n".join(
        [
            "L'analyse revele 14 lignes utilisent moins de 20% de leur capacite.",
            "1 ressources inactives restent facturees.",
            "8 forfaits ou allocations apparaissent surdimensionnes.",
            "1 forfaits sont probablement surdimensionnes au regard de l'usage observe.",
            "1 lignes conservent le roaming sans trafic reel detecte.",
            "1 profils cumulent des signaux de fraude ou de comportement suspect.",
            "Les annotations visuelles restent secondaires.",
            "Risque global: 99/100 (Critique).",
            "Risque fraude: 96/100 (Critique).",
            "Risque anomalie: 94/100 (Critique).",
            "Une optimisation ciblee permettrait de reduire les depenses.",
            "Une optimisation ciblee permettrait de reduire les depenses.",
        ]
    )

    polished = polish_business_text(raw_text)

    assert "L'analyse revele que 14 lignes utilisent moins de 20% de leur capacite." in polished
    assert "1 ressource inactive reste facturee." in polished
    assert "8 forfaits apparaissent surdimensionnes par rapport a l'usage reel observe." in polished
    assert "1 forfait apparait surdimensionne par rapport a l'usage reel observe." in polished
    assert "1 ligne conserve le roaming sans trafic reel detecte." in polished
    assert "1 profil cumule des signaux de fraude ou de comportement suspect." in polished
    assert "annotations visuelles" not in polished.lower()
    assert "99/100" not in polished
    assert "96/100" not in polished
    assert "94/100" in polished
    assert "91/100" in polished
    assert polished.count("Une optimisation ciblee permettrait de reduire les depenses.") == 1


def test_analyze_dataframe_limits_non_exceptional_risk_scores() -> None:
    dataframe = pd.DataFrame(
        {
            "Collaborateur": ["Amina", "Yassine", "Salma", "Nora"],
            "Departement": ["Commercial", "Finance", "IT", "Support"],
            "Forfait": ["Premium", "Premium", "Premium", "Premium"],
            "Cout mensuel MAD": [5400, 5100, 5200, 5300],
            "Data usage GB": [1, 1, 2, 1],
            "Quota data GB": [25, 25, 25, 25],
            "Roaming actif": [1, 1, 0, 1],
            "Roaming cost MAD": [0, 0, 0, 0],
            "Over quota flag": [0, 0, 0, 0],
            "Risk score 100": [100, 99, 98, 100],
            "Status": ["active", "inactive", "active", "inactive"],
        }
    )

    insights = _analyze_dataframe(dataframe)
    scores = [
        insights.cost_score,
        insights.anomaly_score,
        insights.fraud_score,
        insights.optimization_score,
        insights.underutilization_score,
        insights.profitability_score,
    ]

    assert max(scores) <= 95
    assert "100/100" not in insights.business_answer
    assert "71-95 = critique" in insights.business_answer.lower()
    assert "100 = cas exceptionnel" in insights.business_answer.lower()

from io import BytesIO
import json

from fastapi.testclient import TestClient
from openpyxl import Workbook


CSV_CONTENT = """Nom complet;Email;Departement;Fonction;Statut;Matricule
Imane El Idrissi;imane.elidrissi@bcskills.ma;Commercial;Commercial terrain;Actif;EMP-001
Sara Bennani;SARA.BENNANI@bcskills.ma;Finance;Controleuse de gestion;Active;EMP-002
Sara Bennani;sara.bennani@bcskills.ma;Finance;Controleuse de gestion;Active;EMP-002
;support.ops;Support;Support client;Actif;EMP-003
"""

CSV_WITH_MANUAL_MAPPING = """Collaborateur;Contact pro;Equipe
ali el mansouri;ali.elmansouri(at)bcskills.ma;
nour bakkali;nour.bakkali@bcskills.ma;
"""


def _xlsx_payload() -> bytes:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.append(["Nom complet", "Identifiant", "Service", "Profil", "Statut", "Matricule"])
    worksheet.append(["Youssef Lahlou", "youssef.lahlou", "IT", "Support IT", "Actif", "EMP-010"])
    worksheet.append(["Leila Saaidi", "leila.saaidi@bcskills.ma", "Direction", "Executive", "Suspendu", "EMP-011"])

    buffer = BytesIO()
    workbook.save(buffer)
    workbook.close()
    return buffer.getvalue()


def test_manager_can_preview_and_import_employee_csv(
    client: TestClient,
    manager_headers: dict[str, str],
) -> None:
    preview_response = client.post(
        "/api/v1/employees/import/preview",
        headers=manager_headers,
        files={"file": ("employees.csv", CSV_CONTENT.encode("utf-8"), "text/csv")},
    )

    assert preview_response.status_code == 200
    preview_body = preview_response.json()
    assert preview_body["detected_format"] == "csv"
    assert preview_body["total_rows"] == 4
    assert preview_body["valid_rows"] == 2
    assert preview_body["ready_rows"] == 2
    assert preview_body["incomplete_rows"] == 0
    assert preview_body["duplicate_rows"] == 1
    assert preview_body["invalid_rows"] == 1
    assert preview_body["error_rows"] == 2
    assert preview_body["anomalies_count"] == 2
    assert any(item["field_name"] == "full_name" for item in preview_body["recognized_columns"])
    assert "Doublon" in (preview_body["preview_rows"][2]["duplicate_reason"] or "")
    assert preview_body["preview_rows"][0]["row_status"] == "importable"
    assert preview_body["preview_rows"][3]["row_status"] == "error"

    import_response = client.post(
        "/api/v1/employees/import",
        headers=manager_headers,
        files={"file": ("employees.csv", CSV_CONTENT.encode("utf-8"), "text/csv")},
    )

    assert import_response.status_code == 200
    import_body = import_response.json()
    assert import_body["imported_count"] == 2
    assert import_body["incomplete_count"] == 0
    assert import_body["duplicate_count"] == 1
    assert import_body["invalid_count"] == 1
    assert import_body["skipped_count"] == 2
    assert import_body["rejected_count"] == 2

    list_response = client.get("/api/v1/employees?search=finance", headers=manager_headers)

    assert list_response.status_code == 200
    list_body = list_response.json()
    assert list_body["total"] == 1
    assert list_body["items"][0]["full_name"] == "Sara Bennani"
    assert list_body["items"][0]["status"] == "active"


def test_import_returns_zero_imported_when_everything_is_duplicate(
    client: TestClient,
    manager_headers: dict[str, str],
) -> None:
    first_import = client.post(
        "/api/v1/employees/import",
        headers=manager_headers,
        files={"file": ("employees.csv", CSV_CONTENT.encode("utf-8"), "text/csv")},
    )
    assert first_import.status_code == 200

    second_import = client.post(
        "/api/v1/employees/import",
        headers=manager_headers,
        files={"file": ("employees.csv", CSV_CONTENT.encode("utf-8"), "text/csv")},
    )

    assert second_import.status_code == 200
    body = second_import.json()
    assert body["imported_count"] == 0
    assert body["duplicate_count"] == 3
    assert body["invalid_count"] == 1
    assert any("Aucun employe supplementaire" in warning for warning in body["warnings"])


def test_manager_can_preview_excel_employee_file(
    client: TestClient,
    manager_headers: dict[str, str],
) -> None:
    response = client.post(
        "/api/v1/employees/import/preview",
        headers=manager_headers,
        files={
            "file": (
                "employees.xlsx",
                _xlsx_payload(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["detected_format"] == "xlsx"
    assert body["valid_rows"] == 2
    assert body["incomplete_rows"] == 1
    assert body["duplicate_rows"] == 0
    assert any(item["field_name"] == "employee_identifier" for item in body["recognized_columns"])


def test_preview_and_import_accept_manual_mapping_and_auto_fix_options(
    client: TestClient,
    manager_headers: dict[str, str],
) -> None:
    options = {
        "mapping_overrides": {
            "email": "Contact pro",
        },
        "default_values": {
            "department_name": "IT",
            "job_profile": "Support",
        },
        "auto_fix_enabled": True,
    }

    preview_response = client.post(
        "/api/v1/employees/import/preview",
        headers=manager_headers,
        data={"options_json": json.dumps(options)},
        files={"file": ("manual-mapping.csv", CSV_WITH_MANUAL_MAPPING.encode("utf-8"), "text/csv")},
    )

    assert preview_response.status_code == 200
    preview_body = preview_response.json()
    assert preview_body["valid_rows"] == 2
    assert preview_body["ready_rows"] == 2
    assert preview_body["quality_score"] >= 90
    assert preview_body["field_mappings"][1]["source_column"] == "Contact pro"
    assert preview_body["preview_rows"][0]["email"] == "ali.elmansouri@bcskills.ma"
    assert preview_body["preview_rows"][0]["department_name"] == "IT"
    assert preview_body["preview_rows"][0]["job_profile"] == "Support"

    import_response = client.post(
        "/api/v1/employees/import",
        headers=manager_headers,
        data={"options_json": json.dumps(options)},
        files={"file": ("manual-mapping.csv", CSV_WITH_MANUAL_MAPPING.encode("utf-8"), "text/csv")},
    )

    assert import_response.status_code == 200
    import_body = import_response.json()
    assert import_body["imported_count"] == 2
    assert import_body["incomplete_count"] == 0


def test_analyst_cannot_import_or_list_employees(
    client: TestClient,
    analyst_headers: dict[str, str],
) -> None:
    list_response = client.get("/api/v1/employees", headers=analyst_headers)
    preview_response = client.post(
        "/api/v1/employees/import/preview",
        headers=analyst_headers,
        files={"file": ("employees.csv", CSV_CONTENT.encode("utf-8"), "text/csv")},
    )

    assert list_response.status_code == 403
    assert preview_response.status_code == 403

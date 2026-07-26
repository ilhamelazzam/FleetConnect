from pathlib import Path

from app.core.config import Settings


def test_resolve_path_builds_absolute_project_path() -> None:
    settings = Settings()

    resolved_path = settings.resolve_path("ai/data/output/fleet_ai_results_morocco.csv")

    assert isinstance(resolved_path, Path)
    assert resolved_path is not None
    assert resolved_path.is_absolute()
    assert resolved_path.as_posix().endswith("ai/data/output/fleet_ai_results_morocco.csv")


def test_resolve_cdr_analytics_source_prefers_existing_enriched_file() -> None:
    settings = Settings()

    source = settings.resolve_cdr_analytics_source()

    assert source.label == "telecom_cdr_fraud_fleetconnect_enriched.csv"
    assert source.path is not None
    assert source.path.exists()


def test_resolve_mobile_fleet_source_targets_single_official_output() -> None:
    settings = Settings()

    source = settings.resolve_mobile_fleet_source()

    assert source.preferred_name == "mobile_fleet_xgboost_output.csv"
    assert [path.name for path in source.searched_paths] == [
        "mobile_fleet_xgboost_output.csv",
        "fleetconnect_ai_output.csv",
        "mobile_fleet_project_ready.csv",
    ]

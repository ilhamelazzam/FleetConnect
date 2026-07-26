from app.services.chat_service import DataSummary, SummaryMetric
from app.services.live_monitoring_service import LiveMonitoringManager


def _build_summary() -> DataSummary:
    return DataSummary(
        prompt_context="",
        sources=["simulation:test"],
        updated_at="2026-05-11T08:00:00+00:00",
        signature="summary-test",
        total_lines=360,
        active_lines=310,
        free_lines=18,
        assigned_lines=274,
        in_progress_lines=12,
        suspended_lines=8,
        inactive_lines=26,
        total_monthly_cost_mad=248000.0,
        projected_monthly_cost_mad=279000.0,
        alert_count=29,
        critical_alert_count=9,
        budget_alert_count=11,
        mobile_alert_count=8,
        mobile_device_total=104,
        mobile_critical_count=12,
        fraud_alert_count=6,
        total_call_count=740,
        suspicious_call_count=52,
        suspicious_call_cost_mad=21800.0,
        high_cost_call_count=29,
        over_quota_count=10,
        anomaly_count=7,
        roaming_line_count=29,
        roaming_alert_count=8,
        expensive_operators=[
            SummaryMetric(label="Maroc Telecom", monthly_cost_mad=116000.0, risk_score=72.0, alert_count=9),
            SummaryMetric(label="Orange", monthly_cost_mad=79000.0, risk_score=63.0, alert_count=7),
            SummaryMetric(label="Inwi", monthly_cost_mad=53000.0, risk_score=58.0, alert_count=5),
        ],
        risky_departments=[
            SummaryMetric(label="IT", monthly_cost_mad=84000.0, risk_score=77.0, alert_count=8),
            SummaryMetric(label="Finance", monthly_cost_mad=62000.0, risk_score=66.0, alert_count=6),
            SummaryMetric(label="Support", monthly_cost_mad=43000.0, risk_score=59.0, alert_count=4),
        ],
        expensive_plans=[],
        critical_lines=[],
        recommendations=["Verifier le roaming", "Traiter les forfaits critiques"],
    )


def test_live_monitoring_manager_builds_snapshot() -> None:
    manager = LiveMonitoringManager()
    manager._baseline_summary = _build_summary()  # noqa: SLF001
    snapshot = manager._build_snapshot()  # noqa: SLF001

    assert snapshot.active is True
    assert snapshot.mode == "simulation"
    assert snapshot.live_cost_mad > 0
    assert snapshot.data_consumption_tb > 0
    assert snapshot.suspicious_calls > 0
    assert snapshot.fleet_health_score >= 0
    assert snapshot.priority_alerts
    assert snapshot.top_departments[0].department == "IT"
    assert snapshot.top_operators[0].operator == "Maroc Telecom"
    assert snapshot.critical_equipments
    assert snapshot.critical_workflows
    assert snapshot.recommendations


def test_live_monitoring_manager_builds_prompt_context_from_snapshot() -> None:
    manager = LiveMonitoringManager()
    manager._baseline_summary = _build_summary()  # noqa: SLF001
    manager._snapshot = manager._build_snapshot()  # noqa: SLF001

    prompt_context = manager.build_prompt_context()

    assert prompt_context is not None
    assert "Surveillance live active" in prompt_context
    assert "Scores live" in prompt_context

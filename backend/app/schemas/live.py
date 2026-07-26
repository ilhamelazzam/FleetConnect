from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

LiveSeverity = Literal["low", "medium", "high", "critical"]


class LiveMonitoringStatusResponse(BaseModel):
    active: bool = True
    mode: Literal["simulation", "hybrid"] = "simulation"
    monitoring_label: str
    connected_clients: int = Field(default=0, ge=0)
    latest_tick: int = Field(default=0, ge=0)
    latest_tick_at: str
    simulator_enabled: bool = True
    websocket_path: str = "/api/v1/live/stream"


class LiveAlertResponse(BaseModel):
    alert_id: str
    title: str
    severity: LiveSeverity
    category: str
    message: str
    recommendation: str
    detected_at: str
    score: int = Field(ge=0, le=100)
    department: str | None = None
    operator: str | None = None
    equipment_label: str | None = None
    delta_pct: float | None = None
    estimated_cost_mad: float | None = Field(default=None, ge=0.0)


class LiveDepartmentResponse(BaseModel):
    department: str
    risk_score: int = Field(ge=0, le=100)
    live_cost_mad: float = Field(ge=0.0)
    delta_pct: float
    alert_count: int = Field(default=0, ge=0)
    roaming_pct: float = Field(default=0.0, ge=0.0)


class LiveOperatorResponse(BaseModel):
    operator: str
    live_cost_mad: float = Field(ge=0.0)
    anomaly_score: int = Field(ge=0, le=100)
    roaming_cost_mad: float = Field(ge=0.0)
    suspicious_calls: int = Field(default=0, ge=0)
    delta_pct: float


class LiveEquipmentResponse(BaseModel):
    label: str
    site: str | None = None
    health_score: int = Field(ge=0, le=100)
    temperature_c: float
    severity: LiveSeverity
    issue: str


class LiveWorkflowResponse(BaseModel):
    name: str
    criticality_score: int = Field(ge=0, le=100)
    waiting_steps: int = Field(default=0, ge=0)
    bottleneck: str


class LiveChartPoint(BaseModel):
    label: str
    value: float
    secondary_value: float | None = None


class LiveMonitoringSnapshotResponse(BaseModel):
    generated_at: str
    tick: int = Field(ge=0)
    mode: Literal["simulation", "hybrid"] = "simulation"
    active: bool = True
    monitoring_label: str
    executive_summary: str
    fleet_health_score: int = Field(ge=0, le=100)
    risk_score: int = Field(ge=0, le=100)
    fraud_score: int = Field(ge=0, le=100)
    optimization_score: int = Field(ge=0, le=100)
    equipment_score: int = Field(ge=0, le=100)
    live_cost_mad: float = Field(ge=0.0)
    live_cost_delta_pct: float
    data_consumption_tb: float = Field(ge=0.0)
    data_delta_pct: float
    roaming_cost_mad: float = Field(ge=0.0)
    suspicious_calls: int = Field(ge=0)
    fraud_exposure_mad: float = Field(ge=0.0)
    overage_lines: int = Field(ge=0)
    inactive_lines: int = Field(ge=0)
    equipment_alerts: int = Field(ge=0)
    workflow_critical_count: int = Field(ge=0)
    operator_anomaly_count: int = Field(ge=0)
    source_status: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    priority_alerts: list[LiveAlertResponse] = Field(default_factory=list)
    recent_alerts: list[LiveAlertResponse] = Field(default_factory=list)
    top_departments: list[LiveDepartmentResponse] = Field(default_factory=list)
    top_operators: list[LiveOperatorResponse] = Field(default_factory=list)
    critical_equipments: list[LiveEquipmentResponse] = Field(default_factory=list)
    critical_workflows: list[LiveWorkflowResponse] = Field(default_factory=list)
    cost_series: list[LiveChartPoint] = Field(default_factory=list)
    risk_series: list[LiveChartPoint] = Field(default_factory=list)
    alerts_series: list[LiveChartPoint] = Field(default_factory=list)
    operator_heatmap: list[LiveChartPoint] = Field(default_factory=list)

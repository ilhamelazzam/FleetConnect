from typing import Literal

from pydantic import BaseModel, Field


FleetHealthLevel = Literal["excellent", "bon", "moyen", "eleve", "critique"]
FleetRiskLevel = Literal["low", "medium", "high", "critical"]
FleetTrend = Literal["improving", "stable", "declining"]


class FleetHealthScoreBreakdownItem(BaseModel):
    label: str
    value: int = Field(ge=0, le=100)


class FleetHealthFactor(BaseModel):
    label: str
    category: str
    value: str
    impact_score: int = Field(ge=0, le=100)
    severity: FleetRiskLevel
    evidence: str


class FleetHealthScores(BaseModel):
    cost_score: int = Field(ge=0, le=100)
    fraud_score: int = Field(ge=0, le=100)
    anomaly_score: int = Field(ge=0, le=100)
    optimization_score: int = Field(ge=0, le=100)
    equipment_score: int = Field(ge=0, le=100)
    workflow_score: int = Field(ge=0, le=100)
    risk_score: int = Field(ge=0, le=100)
    roaming_score: int = Field(ge=0, le=100)


class FleetHealthScoreRead(BaseModel):
    fleet_health_score: int = Field(ge=0, le=100)
    fleet_health_level: FleetHealthLevel
    global_risk: FleetRiskLevel
    trend: FleetTrend
    scores: FleetHealthScores
    risk_score: int = Field(ge=0, le=100)
    cost_score: int = Field(ge=0, le=100)
    fraud_score: int = Field(ge=0, le=100)
    optimization_score: int = Field(ge=0, le=100)
    anomaly_score: int = Field(ge=0, le=100)
    equipment_score: int = Field(ge=0, le=100)
    workflow_score: int = Field(ge=0, le=100)
    roaming_score: int = Field(ge=0, le=100)
    main_risks: list[str] = Field(default_factory=list)
    main_strengths: list[str] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    explanation: str
    score_breakdown: list[FleetHealthScoreBreakdownItem] = Field(default_factory=list)
    key_factors: list[FleetHealthFactor] = Field(default_factory=list)
    summary_updated_at: str
    sources: list[str] = Field(default_factory=list)
    cached: bool = False
    fallback_used: bool = False
    duration_ms: int | None = None

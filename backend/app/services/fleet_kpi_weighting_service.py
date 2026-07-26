from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class WeightedKpi:
    key: str
    label: str
    category: str
    value: float
    threshold: float
    weight: float
    display_value: str
    evidence: str


@dataclass(frozen=True)
class KpiContribution:
    key: str
    label: str
    category: str
    display_value: str
    evidence: str
    normalized_pressure: float
    weighted_pressure: float
    impact_score: int


def clamp_score(value: float) -> int:
    return max(0, min(int(round(value)), 100))


def severity_from_pressure(value: float) -> str:
    if value >= 0.95:
        return "critical"
    if value >= 0.7:
        return "high"
    if value >= 0.4:
        return "medium"
    return "low"


def _normalized_pressure(value: float, threshold: float) -> float:
    if threshold <= 0:
        return 0.0
    return min(max(value / threshold, 0.0), 1.35)


def score_weighted_kpis(kpis: list[WeightedKpi]) -> tuple[int, list[KpiContribution]]:
    if not kpis:
        return 100, []

    total_weight = sum(max(kpi.weight, 0.0) for kpi in kpis) or 1.0
    total_pressure = 0.0
    contributions: list[KpiContribution] = []

    for kpi in kpis:
        pressure = _normalized_pressure(kpi.value, kpi.threshold)
        weighted_pressure = pressure * (max(kpi.weight, 0.0) / total_weight)
        total_pressure += weighted_pressure
        contributions.append(
            KpiContribution(
                key=kpi.key,
                label=kpi.label,
                category=kpi.category,
                display_value=kpi.display_value,
                evidence=kpi.evidence,
                normalized_pressure=pressure,
                weighted_pressure=weighted_pressure,
                impact_score=clamp_score(pressure * 75),
            )
        )

    score = clamp_score(100 - (total_pressure * 100))
    return score, contributions

from __future__ import annotations


def clamp_score(value: float) -> int:
    return max(0, min(int(round(value)), 100))


def health_level_from_score(score: int) -> str:
    if score >= 90:
        return "excellent"
    if score >= 75:
        return "bon"
    if score >= 60:
        return "moyen"
    if score >= 45:
        return "eleve"
    return "critique"


def global_risk_from_health_score(score: int) -> str:
    pressure = 100 - score
    if pressure >= 55:
        return "critical"
    if pressure >= 38:
        return "high"
    if pressure >= 22:
        return "medium"
    return "low"


def factor_severity_from_score(score: int) -> str:
    if score <= 35:
        return "critical"
    if score <= 55:
        return "high"
    if score <= 75:
        return "medium"
    return "low"


def blend_health_scores(
    base_score: int,
    live_score: int | None,
    *,
    live_weight: float = 0.24,
) -> int:
    if live_score is None:
        return base_score
    return clamp_score((base_score * (1 - live_weight)) + (live_score * live_weight))


def aggregate_health_scores(weighted_scores: list[tuple[int, float]]) -> int:
    if not weighted_scores:
        return 100

    total_weight = sum(weight for _, weight in weighted_scores) or 1.0
    aggregate = sum(score * weight for score, weight in weighted_scores)
    return clamp_score(aggregate / total_weight)


def trend_from_signals(
    *,
    projected_gap_ratio: float,
    live_cost_delta_pct: float | None = None,
) -> str:
    pressure = projected_gap_ratio * 100
    if live_cost_delta_pct is not None:
        pressure = (pressure * 0.55) + (max(live_cost_delta_pct, -12.0) * 0.45)

    if pressure >= 10:
        return "declining"
    if pressure <= 2:
        return "improving"
    return "stable"

from __future__ import annotations

import re
from dataclasses import dataclass
from statistics import mean
from typing import TYPE_CHECKING

from app.services.fleet_scoring_service import build_fleet_health_payload
from app.services.ocr_service import OcrExtractionResult
from app.services.vision_service import VisionAnalysisResult

if TYPE_CHECKING:
    from app.services.chat_service import DataSummary


AXIS_DEFINITIONS: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("cost_score", "Couts", ("couts", "cout", "cost", "costs", "budget")),
    ("fraud_score", "Fraude", ("fraude", "fraud")),
    ("anomaly_score", "Anomalies", ("anomalies", "anomalie", "alerts", "alertes")),
    ("optimization_score", "Optimisation", ("optimisation", "optimization", "optim")),
    ("equipment_score", "Equipements", ("equipements", "equipement", "equipment", "materiel")),
    ("workflow_score", "Workflow", ("workflow", "workflows", "processus")),
    ("risk_score", "Risque", ("risque", "risk", "risks")),
    ("roaming_score", "Roaming", ("roaming", "itinérance", "itinerance")),
)

AXIS_LABELS = {axis_key: axis_label for axis_key, axis_label, _aliases in AXIS_DEFINITIONS}
ALIAS_TO_AXIS = {
    alias.lower(): axis_key
    for axis_key, _axis_label, aliases in AXIS_DEFINITIONS
    for alias in aliases
}


@dataclass(frozen=True)
class DashboardAxisScore:
    key: str
    label: str
    value: int
    source: str
    level: str


@dataclass(frozen=True)
class DashboardAnalysisResult:
    widget_types: list[str]
    chart_types: list[str]
    visible_kpis: list[str]
    radar_axes: list[DashboardAxisScore]
    dominant_axes: list[str]
    weak_axes: list[str]
    medium_axes: list[str]
    asymmetry_score: int
    balance_score: int
    global_score: int | None
    critical_zones: list[str]
    business_risks: list[str]
    recommendations: list[str]
    explainability_points: list[str]
    evidence: list[str]
    text_readability_notice: str | None
    used_business_scores: bool
    confidence: float


def _clamp_score(value: float) -> int:
    return max(0, min(int(round(value)), 100))


def _dedupe(values: list[str], limit: int) -> list[str]:
    items: list[str] = []
    seen = set()
    for value in values:
        cleaned_value = " ".join(value.split()).strip()
        key = cleaned_value.lower()
        if not cleaned_value or key in seen:
            continue
        seen.add(key)
        items.append(cleaned_value)
    return items[:limit]


def _normalize_label(value: str) -> str:
    return (
        value.strip()
        .lower()
        .replace("é", "e")
        .replace("è", "e")
        .replace("ê", "e")
        .replace("û", "u")
        .replace("ô", "o")
    )


def _score_level(value: int) -> str:
    if value >= 85:
        return "tres eleve"
    if value >= 70:
        return "eleve"
    if value >= 55:
        return "moyen"
    if value >= 35:
        return "faible"
    return "tres faible"


def _axis_from_label(label: str) -> str | None:
    normalized_label = _normalize_label(label)
    for alias, axis_key in ALIAS_TO_AXIS.items():
        if alias in normalized_label:
            return axis_key
    return None


def _extract_axis_scores_from_text(text: str, *, source: str) -> dict[str, DashboardAxisScore]:
    if not text.strip():
        return {}

    axis_scores: dict[str, DashboardAxisScore] = {}
    compact_text = " \n ".join(line.strip() for line in text.splitlines())

    for axis_key, axis_label, aliases in AXIS_DEFINITIONS:
        patterns = [
            rf"(?:{'|'.join(re.escape(alias) for alias in aliases)})\s*[:=|-]?\s*(\d{{1,3}})(?:/100|%)?",
            rf"(\d{{1,3}})(?:/100|%)?\s*(?:{'|'.join(re.escape(alias) for alias in aliases)})",
        ]
        for pattern in patterns:
            match = re.search(pattern, compact_text, flags=re.IGNORECASE)
            if not match:
                continue
            try:
                raw_value = int(match.group(1))
            except ValueError:
                continue
            value = _clamp_score(raw_value)
            axis_scores[axis_key] = DashboardAxisScore(
                key=axis_key,
                label=axis_label,
                value=value,
                source=source,
                level=_score_level(value),
            )
            break

    return axis_scores


def _extract_widget_types(ocr_result: OcrExtractionResult, vision_result: VisionAnalysisResult) -> list[str]:
    widget_types: list[str] = []
    combined_text = " ".join(
        [
            *vision_result.widgets,
            *vision_result.charts,
            *(ocr_result.ui_details.visible_kpis if ocr_result.ui_details is not None else []),
            ocr_result.text,
            vision_result.analysis,
        ]
    ).lower()

    widget_rules = (
        ("radar chart", ("radar", "spider chart")),
        ("bar chart", ("bar chart", "histogramme", "barre")),
        ("line chart", ("line chart", "courbe", "line")),
        ("kpi cards", ("kpi", "score", "fleet health")),
        ("gauge", ("gauge", "jauge", "score global")),
        ("alert cards", ("alert", "alerte", "critical")),
        ("table", ("table", "tableau")),
    )
    for label, keywords in widget_rules:
        if any(keyword in combined_text for keyword in keywords):
            widget_types.append(label)

    return _dedupe([*widget_types, *vision_result.widgets], 8)


def _extract_chart_types(vision_result: VisionAnalysisResult) -> list[str]:
    return _dedupe([*vision_result.charts, *vision_result.widgets], 6)


def _text_readability_notice(ocr_result: OcrExtractionResult) -> str | None:
    readable_length = len(ocr_result.text.strip())
    if (
        ocr_result.kpis
        or ocr_result.amounts_mad
        or ocr_result.alerts
        or (readable_length >= 120 and (ocr_result.confidence or 0.0) >= 0.6)
    ):
        return None
    return "Le texte exploitable reste trop limite pour consolider davantage de KPI documentaires."


def _score_visible_dashboard_kpi(line: str) -> int:
    normalized_line = _normalize_label(line)
    score = 0
    if re.search(r"\b\d{1,3}(?:[ .]\d{3})*(?:[.,]\d+)?\s*(?:mad|dhs|dh)\b", line, flags=re.IGNORECASE):
        score += 90
    if re.search(r"\b\d{1,3}\s*/\s*100\b", line, flags=re.IGNORECASE):
        score += 86
    if re.search(r"\b\d{1,3}(?:[.,]\d{1,2})?\s*%\b", line, flags=re.IGNORECASE):
        score += 82
    if any(keyword in normalized_line for keyword in ("impact", "exposition", "portefeuille", "budget", "cout", "roaming")):
        score += 16
    if any(keyword in normalized_line for keyword in ("score fraude", "fraude", "score anomal", "anomal", "score risque", "fleet health")):
        score += 14
    if any(keyword in normalized_line for keyword in ("alertes", "alerte", "depassement", "volume", "lignes")):
        score += 10
    return score


def _prioritize_visible_dashboard_kpis(
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
    sorted_axes: list[DashboardAxisScore],
) -> list[str]:
    visible_candidates = _dedupe(
        [
            *ocr_result.kpis,
            *vision_result.detected_kpis,
            *(ocr_result.ui_details.visible_kpis if ocr_result.ui_details is not None else []),
            *[
                " ".join(line.split()).strip()
                for line in ocr_result.lines
                if len(" ".join(line.split()).strip()) <= 140
            ],
        ],
        30,
    )
    prioritized_candidates = sorted(
        [item for item in visible_candidates if _score_visible_dashboard_kpi(item) > 0],
        key=lambda item: (_score_visible_dashboard_kpi(item), -len(item)),
        reverse=True,
    )
    axis_candidates = [f"{axis.label} {axis.value}/100" for axis in sorted_axes]
    return _dedupe([*prioritized_candidates[:6], *axis_candidates, *vision_result.critical_zones], 10)


def _resolve_focus_label(ocr_result: OcrExtractionResult, summary: "DataSummary") -> str | None:
    if ocr_result.departments:
        return ocr_result.departments[0]
    if ocr_result.operators:
        return ocr_result.operators[0]
    if summary.risky_departments:
        return summary.risky_departments[0].label
    if summary.expensive_operators:
        return summary.expensive_operators[0].label
    return None


def _derive_visual_governance_signals(
    *,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
    summary: "DataSummary",
) -> tuple[list[str], list[str], list[str], list[str]]:
    critical_zones: list[str] = []
    business_risks: list[str] = []
    recommendations: list[str] = []
    explainability_points: list[str] = []

    widget_types = _extract_widget_types(ocr_result, vision_result)
    chart_types = _extract_chart_types(vision_result)
    combined_text = " ".join(
        [
            ocr_result.text,
            vision_result.analysis,
            " ".join(vision_result.widgets),
            " ".join(vision_result.charts),
        ]
    ).lower()
    focus_label = _resolve_focus_label(ocr_result, summary)
    ui_details = ocr_result.ui_details

    if "line chart" in widget_types or "line chart" in chart_types:
        if any(keyword in combined_text for keyword in ("pic", "spike", "rupture", "alerte", "critique", "anomal")):
            critical_zones.append(
                "Les courbes visibles suggerent des ruptures ou des pics qui meritent une verification "
                "prioritaire sur la periode observee."
            )
            business_risks.append(
                "Des variations brusques sur les courbes peuvent traduire une degradation rapide, une "
                "anomalie recurrente ou une surcharge non absorbee."
            )
            recommendations.append(
                "Isoler les courbes qui presentent les ruptures les plus nettes et verifier si elles "
                "correspondent a des alertes deja remontees."
            )
            explainability_points.append(
                "Presence de courbes avec ruptures ou pics visibles dans la lecture temporelle."
            )
        elif any(keyword in combined_text for keyword in ("hausse", "augmentation", "progression", "evolution", "tendance")):
            critical_zones.append(
                "Les courbes suggerent une dynamique haussiere sur certains indicateurs, avec un risque "
                "de degradation progressive si la tendance se confirme."
            )
            business_risks.append(
                "Une trajectoire haussiere sur les courbes peut annoncer une escalation des couts, des alertes "
                "ou des incidents si elle n'est pas stoppee en amont."
            )
            recommendations.append(
                "Verifier les indicateurs en hausse continue et qualifier rapidement l'origine de la derive."
            )
            explainability_points.append(
                "Lecture temporelle appuyee sur des courbes montrant une tendance ascendante."
            )
        else:
            explainability_points.append(
                "Presence de courbes de suivi utiles pour juger la stabilite des indicateurs dans le temps."
            )

    if "bar chart" in widget_types or "bar chart" in chart_types:
        if focus_label:
            critical_zones.append(
                f"La distribution en barres semble concentrer une partie de la pression visible sur {focus_label}."
            )
            business_risks.append(
                f"Une concentration visuelle autour de {focus_label} peut signaler un desequilibre de cout, "
                "de risque ou de supervision."
            )
            recommendations.append(
                f"Comparer en priorite {focus_label} au reste du parc pour confirmer l'ecart reel et sa cause."
            )
        else:
            critical_zones.append(
                "Les barres visibles montrent une concentration non uniforme, signe d'ecarts probablement "
                "significatifs entre les zones ou populations suivies."
            )
            business_risks.append(
                "Une distribution trop concentree sur quelques barres peut masquer un risque budgetaire ou "
                "operationnel localise."
            )
            recommendations.append(
                "Identifier les barres dominantes et verifier si elles correspondent aux postes de cout ou "
                "aux populations les plus sensibles."
            )
        explainability_points.append(
            "Lecture comparative appuyee sur une distribution en barres et sur les ecarts visibles entre segments."
        )

    if ui_details is not None and (ui_details.density_score <= 52 or ui_details.dense_zones):
        critical_zones.append(
            "La densite visuelle du dashboard peut ralentir la priorisation et noyer les KPI critiques dans "
            "un ensemble trop charge."
        )
        business_risks.append(
            "Une surcharge visuelle augmente le risque de sous-prioriser les alertes majeures ou de lire trop "
            "tard les zones en decrochage."
        )
        recommendations.append(
            "Hierarchiser les KPI critiques et alleger les widgets secondaires pour accelerer la lecture "
            "decisionnelle."
        )
        explainability_points.append(
            "La structure visuelle presente plusieurs zones denses ou un empilement important de widgets."
        )

    if ui_details is not None and ui_details.readability_score <= 58:
        business_risks.append(
            "Une lisibilite insuffisante peut retarder la detection des seuils critiques, des alertes et des "
            "indicateurs a suivre en premier."
        )
        recommendations.append(
            "Renforcer le contraste et la lisibilite des indicateurs les plus decisifs pour fiabiliser la "
            "prise de decision."
        )
        explainability_points.append(
            "Le niveau de lisibilite de l'interface a ete pris en compte dans l'evaluation."
        )

    if ui_details is not None and ui_details.ux_score <= 60:
        recommendations.append(
            "Rendre le dashboard plus directif autour des zones a risque pour limiter les hesitations de lecture."
        )
        explainability_points.append(
            "La qualite UX influence la vitesse de lecture et la priorisation des risques."
        )

    return (
        _dedupe(critical_zones, 4),
        _dedupe(business_risks, 4),
        _dedupe(recommendations, 4),
        _dedupe(explainability_points, 5),
    )


def _build_base_scores(summary: "DataSummary") -> tuple[dict[str, int], int]:
    fleet_payload = build_fleet_health_payload(summary)
    raw_scores = fleet_payload.get("scores")
    raw_global = fleet_payload.get("fleet_health_score")
    if not isinstance(raw_scores, dict):
        return {}, 0
    scores = {
        axis_key: _clamp_score(raw_scores.get(axis_key, 0))
        for axis_key in AXIS_LABELS
    }
    return scores, _clamp_score(raw_global if isinstance(raw_global, (int, float)) else 0)


def _is_dashboard_candidate(
    *,
    question: str,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
) -> bool:
    combined_text = " ".join(
        [
            question,
            ocr_result.text,
            vision_result.image_type,
            vision_result.analysis,
            " ".join(vision_result.widgets),
            " ".join(vision_result.charts),
        ]
    ).lower()
    axis_hits = sum(
        1
        for _axis_key, _axis_label, aliases in AXIS_DEFINITIONS
        if any(alias in combined_text for alias in aliases)
    )
    return (
        vision_result.image_type in {"dashboard", "graphe", "tableau", "capture_interface"}
        or "dashboard" in combined_text
        or "tableau de bord" in combined_text
        or axis_hits >= 2
        or "fleet health" in combined_text
    )


def _merge_axis_scores(
    *,
    question: str,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
    summary: "DataSummary",
) -> tuple[list[DashboardAxisScore], bool, int | None]:
    ocr_scores = _extract_axis_scores_from_text(
        "\n".join(
            [
                *ocr_result.lines,
                *ocr_result.visible_tables,
                *(ocr_result.ui_details.visible_kpis if ocr_result.ui_details is not None else []),
            ]
        ),
        source="ocr",
    )
    vision_scores = {
        axis.key: DashboardAxisScore(
            key=axis.key,
            label=axis.label,
            value=axis.value,
            source="vision",
            level=_score_level(axis.value),
        )
        for axis in vision_result.radar_axes
        if axis.value is not None
    }
    parsed_vision_scores = _extract_axis_scores_from_text(vision_result.raw_output, source="vision")
    base_scores, base_global_score = _build_base_scores(summary)
    combined_text = " ".join([question, ocr_result.text, vision_result.analysis]).lower()
    dashboard_label_hits = sum(
        1
        for _axis_key, _axis_label, aliases in AXIS_DEFINITIONS
        if any(alias in combined_text for alias in aliases)
    )
    use_business_scores = bool(base_scores) and (
        vision_result.image_type == "dashboard" or dashboard_label_hits >= 3
    )

    merged_scores: list[DashboardAxisScore] = []
    for axis_key, axis_label, _aliases in AXIS_DEFINITIONS:
        if axis_key in ocr_scores:
            merged_scores.append(ocr_scores[axis_key])
            continue
        if axis_key in vision_scores:
            merged_scores.append(vision_scores[axis_key])
            continue
        if axis_key in parsed_vision_scores:
            merged_scores.append(parsed_vision_scores[axis_key])
            continue
        if use_business_scores and axis_key in base_scores:
            value = base_scores[axis_key]
            merged_scores.append(
                DashboardAxisScore(
                    key=axis_key,
                    label=axis_label,
                    value=value,
                    source="fleet_health",
                    level=_score_level(value),
                )
            )

    global_score = None
    if use_business_scores:
        global_score = base_global_score
    elif merged_scores:
        global_score = _clamp_score(mean(axis.value for axis in merged_scores))
    return merged_scores, use_business_scores, global_score


def _risk_from_weak_axis(axis_key: str, axis_label: str) -> str:
    risk_map = {
        "equipment_score": (
            "La dimension Equipements reste faible, ce qui peut indiquer une supervision "
            "materielle insuffisante ou des incidents peu qualifies."
        ),
        "fraud_score": (
            "La dimension Fraude reste tres basse, avec un risque de sous-detection des usages "
            "anormaux ou des signaux CDR critiques."
        ),
        "roaming_score": (
            "Le roaming apparait peu maitrise ou peu supervise, avec un risque de couts "
            "internationaux non anticipes."
        ),
        "cost_score": (
            "La maitrise des couts reste inegale, ce qui augmente le risque de depassement "
            "budgetaire ou de forfaits mal calibres."
        ),
        "anomaly_score": (
            "Le score Anomalies est bas, ce qui peut traduire une faible couverture des signaux "
            "de surconsommation et des ecarts terrain."
        ),
        "optimization_score": (
            "Le potentiel d'optimisation reste insuffisamment exploite sur les lignes, les forfaits "
            "et les ressources peu actives."
        ),
        "risk_score": (
            "Le niveau de risque reste mal absorbe, avec une exposition encore forte sur les "
            "departements ou operateurs sensibles."
        ),
    }
    return risk_map.get(
        axis_key,
        f"La dimension {axis_label} reste faible et doit etre renforcee en priorite.",
    )


def _recommendation_from_axis(axis_key: str) -> str:
    recommendation_map = {
        "equipment_score": "Renforcer la supervision equipements et consolider les alertes materiel.",
        "fraud_score": "Durcir les regles de detection fraude et croiser les signaux avec les CDR prioritaires.",
        "roaming_score": "Activer un monitoring roaming temps reel avec seuils d'alerte plus precoces.",
        "cost_score": "Recaler les forfaits et cibler d'abord les operateurs ou departements les plus couteux.",
        "anomaly_score": "Traiter les anomalies repetitives avant qu'elles ne degradent les autres dimensions.",
        "optimization_score": "Nettoyer les lignes inactives et revoir les forfaits sous-utilises ou surdimensionnes.",
        "risk_score": "Prioriser les departements les plus exposes pour faire baisser le risque global.",
        "workflow_score": "Cartographier les validations et simplifier les etapes les plus lourdes du workflow.",
    }
    return recommendation_map.get(axis_key, "Confirmer la dimension faible puis lancer un plan correctif cible.")


def analyze_dashboard_image(
    *,
    question: str,
    ocr_result: OcrExtractionResult,
    vision_result: VisionAnalysisResult,
    summary: "DataSummary",
) -> DashboardAnalysisResult | None:
    if not _is_dashboard_candidate(
        question=question,
        ocr_result=ocr_result,
        vision_result=vision_result,
    ):
        return None

    radar_axes, used_business_scores, global_score = _merge_axis_scores(
        question=question,
        ocr_result=ocr_result,
        vision_result=vision_result,
        summary=summary,
    )
    if not radar_axes:
        return None

    sorted_axes = sorted(radar_axes, key=lambda axis: axis.value, reverse=True)
    axis_values = [axis.value for axis in sorted_axes]
    average_score = mean(axis_values)
    highest_axis = sorted_axes[0]
    lowest_axis = sorted_axes[-1]
    asymmetry_score = max(axis_values) - min(axis_values)
    balance_score = _clamp_score(100 - (asymmetry_score * 1.2))

    dominant_axes = [
        f"{axis.label} {axis.value}/100"
        for axis in sorted_axes
        if axis.value >= max(70, average_score + 6)
    ][:3]
    if not dominant_axes:
        dominant_axes = [f"{axis.label} {axis.value}/100" for axis in sorted_axes[:2]]

    weak_axis_items = sorted(
        [
            axis
            for axis in sorted_axes
            if axis.value <= 45 or axis.value <= average_score - 12
        ],
        key=lambda axis: axis.value,
    )
    weak_axes = [f"{axis.label} {axis.value}/100" for axis in weak_axis_items[:4]]
    medium_axes = [
        f"{axis.label} {axis.value}/100"
        for axis in sorted_axes
        if axis not in weak_axis_items and axis.value < 70
    ][:3]

    critical_zones = [
        _risk_from_weak_axis(axis.key, axis.label)
        for axis in weak_axis_items[:4]
    ]
    if highest_axis.key == "workflow_score" and asymmetry_score >= 28:
        critical_zones.append(
            "Le radar montre un desequilibre important autour du Workflow, beaucoup plus haut "
            "que les autres dimensions. Cela peut traduire un pilotage tres procedural ou une "
            "complexite operationnelle disproportionnee."
        )
    if highest_axis.value - lowest_axis.value >= 32:
        critical_zones.append(
            f"L'ecart entre {highest_axis.label} ({highest_axis.value}/100) et "
            f"{lowest_axis.label} ({lowest_axis.value}/100) est tres marque, ce qui traduit "
            "un desequilibre net de pilotage entre les dimensions suivies."
        )

    business_risks = []
    if weak_axis_items:
        business_risks.append("Sous-supervision probable sur les dimensions les plus faibles du radar.")
    if any(axis.key == "fraud_score" and axis.value <= 35 for axis in weak_axis_items):
        business_risks.append("Risque de fraude sous-detectee ou de couverture CDR insuffisante.")
    if any(axis.key == "equipment_score" and axis.value <= 35 for axis in weak_axis_items):
        business_risks.append("Risque de faible visibilite sur l'etat reel des equipements critiques.")
    if any(axis.key == "roaming_score" and axis.value <= 35 for axis in weak_axis_items):
        business_risks.append("Risque de surcout roaming ou d'alerte tardive sur les usages internationaux.")
    if asymmetry_score >= 30:
        business_risks.append("Le desequilibre entre axes peut fausser la priorisation si aucun reequilibrage n'est lance.")

    recommendations = [
        *[_recommendation_from_axis(axis.key) for axis in weak_axis_items[:4]],
    ]
    if highest_axis.key == "workflow_score" and asymmetry_score >= 28:
        recommendations.append(
            "Analyser la surcharge workflow pour distinguer efficacite reelle et complexite organisationnelle."
        )
    if not recommendations:
        recommendations.append(
            "Conserver le monitoring actuel et verifier en continu les axes qui commencent a decrocher."
        )
    visual_critical_zones, visual_business_risks, visual_recommendations, visual_explainability = (
        _derive_visual_governance_signals(
            ocr_result=ocr_result,
            vision_result=vision_result,
            summary=summary,
        )
    )
    critical_zones.extend(visual_critical_zones)
    business_risks.extend(visual_business_risks)
    recommendations.extend(visual_recommendations)
    recommendations = _dedupe(recommendations, 6)

    visible_kpis = _prioritize_visible_dashboard_kpis(ocr_result, vision_result, sorted_axes)
    evidence = _dedupe(
        [
            *[f"Axe radar {axis.label}: {axis.value}/100 ({axis.source})" for axis in sorted_axes[:6]],
            *[f"Widget detecte: {item}" for item in _extract_widget_types(ocr_result, vision_result)],
            *[f"Graphique detecte: {item}" for item in _extract_chart_types(vision_result)],
            *[f"KPI visible: {item}" for item in visible_kpis[:4]],
        ],
        10,
    )
    explainability_points = _dedupe(
        [
            (
                "Facteurs visuels consideres: "
                + ", ".join(_extract_widget_types(ocr_result, vision_result)[:5])
            ),
            "Axes radar dominants: " + ", ".join(dominant_axes[:3]),
            "Axes radar faibles: " + ", ".join(weak_axes[:4]) if weak_axes else "",
            "Zones critiques observees: " + "; ".join(critical_zones[:3]) if critical_zones else "",
            "KPI visibles: " + ", ".join(visible_kpis[:4]) if visible_kpis else "",
            *visual_explainability,
        ],
        7,
    )

    confidence = 0.52
    confidence += min(len(radar_axes), 6) * 0.045
    confidence += 0.12 if vision_result.widgets or vision_result.charts else 0.0
    confidence += 0.08 if len(ocr_result.kpis) >= 2 else 0.0
    confidence += 0.06 if used_business_scores else 0.0
    confidence += min(max(ocr_result.confidence, 0.0), 1.0) * 0.12
    confidence = max(0.45, min(confidence, 0.93))

    return DashboardAnalysisResult(
        widget_types=_extract_widget_types(ocr_result, vision_result),
        chart_types=_extract_chart_types(vision_result),
        visible_kpis=visible_kpis,
        radar_axes=sorted_axes,
        dominant_axes=dominant_axes,
        weak_axes=weak_axes,
        medium_axes=medium_axes,
        asymmetry_score=_clamp_score(asymmetry_score),
        balance_score=balance_score,
        global_score=global_score,
        critical_zones=_dedupe(critical_zones, 5),
        business_risks=_dedupe(business_risks, 5),
        recommendations=recommendations,
        explainability_points=explainability_points,
        evidence=evidence,
        text_readability_notice=_text_readability_notice(ocr_result),
        used_business_scores=used_business_scores,
        confidence=confidence,
    )

from __future__ import annotations

import re
import unicodedata

from app.schemas.chat import (
    ChatAlertIntelligence,
    ChatAlertTimelineItem,
    ChatDecisionRecommendation,
    ChatEquipmentDetails,
    ChatImageAnalysisMetadata,
    ChatImageResponse,
    ChatIncidentDetails,
    ChatInvoiceDetails,
    ChatUiDetails,
    ChatWorkflowDetails,
)

GENERIC_BUSINESS_SNIPPETS = (
    "annotations confirment les points de vigilance",
    "les annotations confirment",
    "annotations visuelles restent secondaires",
    "annotations visuelles",
    "analyse reste fondee sur les indicateurs detectes",
    "capture conserve des kpi visibles",
    "texte de l image reste insuffisant",
    "metriques verifiees restent stables",
    "analyse se limite aux indicateurs visibles",
    "synthese approfondie a ete raccourcie",
    "la lecture approfondie a ete raccourcie",
    "la synthese approfondie a ete raccourcie",
    "lecture decisionnelle priorisee",
    "lecture visuelle",
    "analyse exploitable",
)
ALLOWED_BUSINESS_OPENINGS = (
    "voici une lecture visuelle prudente des equipements visibles",
)
SCORE_PATTERN = re.compile(r"(?P<score>\d{1,3})\s*/\s*100\b")


def _normalize_quality_text(value: str) -> str:
    normalized_value = unicodedata.normalize("NFD", (value or "").lower())
    normalized_value = "".join(
        character for character in normalized_value if unicodedata.category(character) != "Mn"
    )
    return re.sub(r"[^a-z0-9%/]+", " ", normalized_value).strip()


def is_generic_business_phrase(value: str | None) -> bool:
    normalized_value = _normalize_quality_text(value or "")
    if not normalized_value:
        return False
    if any(allowed_opening in normalized_value for allowed_opening in ALLOWED_BUSINESS_OPENINGS):
        return False
    return any(snippet in normalized_value for snippet in GENERIC_BUSINESS_SNIPPETS)


def normalize_business_risk_score(
    value: int | float | None,
    *,
    exceptional: bool = False,
) -> int | None:
    if value is None:
        return None
    score = max(0, min(100, int(round(float(value)))))
    if exceptional and score >= 99:
        return 100
    if score >= 98:
        return 94
    if score >= 95:
        return 91
    return score


def normalize_business_score_label(
    value: str | None,
    *,
    exceptional: bool = False,
) -> str | None:
    if value is None:
        return None
    cleaned_value = " ".join(value.split()).strip()
    if not cleaned_value:
        return None

    def _replace_score(match: re.Match[str]) -> str:
        normalized_score = normalize_business_risk_score(
            int(match.group("score")),
            exceptional=exceptional,
        )
        return f"{normalized_score}/100" if normalized_score is not None else match.group(0)

    if SCORE_PATTERN.fullmatch(cleaned_value):
        return SCORE_PATTERN.sub(_replace_score, cleaned_value)

    normalized_context = _normalize_quality_text(cleaned_value)
    if any(
        keyword in normalized_context
        for keyword in ("risque", "fraude", "anomal", "critique", "profil", "utilisateur", "ligne", "incident")
    ):
        return SCORE_PATTERN.sub(_replace_score, cleaned_value)
    return cleaned_value


def _polish_business_line(
    line: str,
    *,
    exceptional_scores: bool = False,
) -> str:
    cleaned_line = " ".join(line.split()).strip()
    if not cleaned_line:
        return ""
    if is_generic_business_phrase(cleaned_line):
        return ""

    cleaned_line = normalize_business_score_label(
        cleaned_line,
        exceptional=exceptional_scores,
    ) or ""
    if not cleaned_line:
        return ""

    replacement_rules: tuple[tuple[str, str], ...] = (
        (r"\bL'analyse revele (\d+)\b", r"L'analyse revele que \1"),
        (r"\b1 ressources inactives restent facturees\b", "1 ressource inactive reste facturee"),
        (r"\b1 ressources inactives continuent d'etre facturees\b", "1 ressource inactive continue d'etre facturee"),
        (r"\b1 ressources restent\b", "1 ressource reste"),
        (r"\b1 ressources utilisent\b", "1 ressource utilise"),
        (r"\b1 lignes restent\b", "1 ligne reste"),
        (r"\b1 lignes utilisent\b", "1 ligne utilise"),
        (r"\b1 lignes affichent\b", "1 ligne affiche"),
        (r"\b1 lignes depassent\b", "1 ligne depasse"),
        (r"\b1 lignes utilisent moins de 20% de leur capacite\b", "1 ligne utilise moins de 20% de sa capacite"),
        (r"\b1 lignes depassent leur quota ou leur seuil\b", "1 ligne depasse son quota ou son seuil"),
        (
            r"\b1 lignes conservent du roaming sans usage reel exploitable\b",
            "1 ligne conserve du roaming sans usage reel exploitable",
        ),
        (
            r"\b1 lignes inactives continuent de porter du cout\b",
            "1 ligne inactive continue de generer du cout",
        ),
        (
            r"\b1 enregistrements cumulent des signaux d'anomalie ou de risque\b",
            "1 enregistrement cumule des signaux d'anomalie ou de risque",
        ),
        (
            r"\b1 incidents portent une severite critique ou haute\b",
            "1 incident porte une severite critique ou haute",
        ),
        (
            r"\b1 forfaits ou allocations apparaissent surdimensionnes\b",
            "1 forfait apparait surdimensionne par rapport a l'usage reel observe",
        ),
        (
            r"\b1 forfaits sont probablement surdimensionnes au regard de l'usage observe\b",
            "1 forfait apparait surdimensionne par rapport a l'usage reel observe",
        ),
        (
            r"\b(\d+) forfaits ou allocations apparaissent surdimensionnes\b",
            r"\1 forfaits apparaissent surdimensionnes par rapport a l'usage reel observe",
        ),
        (
            r"\b(\d+) forfaits ou allocations paraissent surdimensionnes\b",
            r"\1 forfaits apparaissent surdimensionnes par rapport a l'usage reel observe",
        ),
        (
            r"\b1 lignes conservent le roaming sans trafic reel detecte\b",
            "1 ligne conserve le roaming sans trafic reel detecte",
        ),
        (
            r"\b1 lignes atteignent un score de risque superieur ou egal a 80/100\b",
            "1 ligne atteint un score de risque superieur ou egal a 80/100",
        ),
        (r"\bscore de risque maximal de (\d+/100)\b", r"score de risque de \1"),
        (r"\bniveau de risque maximal\b", "niveau de risque critique"),
        (
            r"\b1 profils cumulent des signaux de fraude ou de comportement suspect\b",
            "1 profil cumule des signaux de fraude ou de comportement suspect",
        ),
        (
            r"\b1 incidents ou logs portent une severite critique ou haute\b",
            "1 incident ou log porte une severite critique ou haute",
        ),
        (
            r"\b1 evenements sont horodates et peuvent etre traces dans la colonne ([^.]+)\b",
            r"1 evenement est horodate et peut etre trace dans la colonne \1",
        ),
        (r"\b1 lignes\b", "1 ligne"),
        (r"\b1 ressources\b", "1 ressource"),
        (r"\b1 forfaits\b", "1 forfait"),
        (r"\b1 profils\b", "1 profil"),
        (r"\b1 utilisateurs\b", "1 utilisateur"),
        (r"\b1 incidents\b", "1 incident"),
        (r"\b1 evenements\b", "1 evenement"),
        (r"\b1 enregistrements\b", "1 enregistrement"),
        (r"\b1 alertes\b", "1 alerte"),
        (r"\b1 allocations\b", "1 allocation"),
        (r"\b ;", ";"),
        (r"\s+([,.:%;])", r"\1"),
        (r"([.:])([A-Za-z0-9])", r"\1 \2"),
    )
    for pattern, replacement in replacement_rules:
        cleaned_line = re.sub(pattern, replacement, cleaned_line)

    cleaned_line = re.sub(r"\s{2,}", " ", cleaned_line).strip()
    cleaned_line = cleaned_line.replace("..", ".")
    if not cleaned_line.lstrip().startswith("- "):
        sentence_parts = re.split(r"(?<=[.!?])\s+", cleaned_line)
        deduped_sentence_parts: list[str] = []
        seen_sentence_parts = set()
        for sentence_part in sentence_parts:
            normalized_sentence = _normalize_quality_text(sentence_part)
            if not normalized_sentence or normalized_sentence in seen_sentence_parts:
                continue
            seen_sentence_parts.add(normalized_sentence)
            deduped_sentence_parts.append(sentence_part.strip())
        if deduped_sentence_parts:
            cleaned_line = " ".join(deduped_sentence_parts)
    return cleaned_line


def polish_business_text(
    value: str | None,
    *,
    exceptional_scores: bool = False,
) -> str:
    if not value:
        return ""
    polished_lines: list[str] = []
    seen_lines = set()
    for raw_line in value.splitlines():
        polished_line = _polish_business_line(raw_line, exceptional_scores=exceptional_scores)
        if not polished_line:
            continue
        normalized_line = _normalize_quality_text(polished_line)
        if normalized_line in seen_lines:
            continue
        seen_lines.add(normalized_line)
        polished_lines.append(polished_line)
    return "\n".join(polished_lines).strip()


def polish_business_items(
    values: list[str],
    *,
    limit: int,
    exceptional_scores: bool = False,
) -> list[str]:
    polished_items: list[str] = []
    seen_items = set()
    for value in values:
        polished_value = polish_business_text(value, exceptional_scores=exceptional_scores)
        if not polished_value:
            continue
        normalized_value = _normalize_quality_text(polished_value)
        if not normalized_value or normalized_value in seen_items:
            continue
        seen_items.add(normalized_value)
        polished_items.append(polished_value)
        if len(polished_items) >= limit:
            break
    return polished_items


def _polish_optional_text(
    value: str | None,
    *,
    exceptional_scores: bool = False,
) -> str | None:
    if value is None:
        return None
    polished_value = polish_business_text(value, exceptional_scores=exceptional_scores)
    if polished_value:
        return polished_value

    cleaned_value = " ".join(value.split()).strip()
    if not cleaned_value or is_generic_business_phrase(cleaned_value):
        return None
    return normalize_business_score_label(
        cleaned_value,
        exceptional=exceptional_scores,
    ) or cleaned_value


def _polish_optional_items(
    values: list[str] | None,
    *,
    exceptional_scores: bool = False,
) -> list[str]:
    if not values:
        return []
    return polish_business_items(
        list(values),
        limit=max(len(values), 1),
        exceptional_scores=exceptional_scores,
    )


def polish_business_decision_recommendations(
    recommendations: list[ChatDecisionRecommendation],
    *,
    exceptional_scores: bool = False,
) -> list[ChatDecisionRecommendation]:
    polished_recommendations: list[ChatDecisionRecommendation] = []
    seen_recommendations = set()

    for recommendation in recommendations:
        polished_title = _polish_optional_text(
            recommendation.title,
            exceptional_scores=exceptional_scores,
        ) or "Action prioritaire"
        polished_reason = _polish_optional_text(
            recommendation.reason,
            exceptional_scores=exceptional_scores,
        ) or polished_title
        polished_estimated_saving = _polish_optional_text(
            recommendation.estimated_saving,
            exceptional_scores=exceptional_scores,
        )
        dedupe_key = (
            _normalize_quality_text(polished_title),
            _normalize_quality_text(polished_reason),
        )
        if dedupe_key in seen_recommendations:
            continue
        seen_recommendations.add(dedupe_key)
        polished_recommendations.append(
            recommendation.model_copy(
                update={
                    "title": polished_title,
                    "reason": polished_reason,
                    "estimated_saving": polished_estimated_saving,
                }
            )
        )

    return polished_recommendations


def _polish_analysis_metadata(
    metadata: ChatImageAnalysisMetadata | None,
    *,
    exceptional_scores: bool = False,
) -> ChatImageAnalysisMetadata | None:
    if metadata is None:
        return None
    return metadata.model_copy(
        update={
            "visible_kpis_used": _polish_optional_items(
                metadata.visible_kpis_used,
                exceptional_scores=exceptional_scores,
            ),
            "removed_unverified_claims": _polish_optional_items(
                metadata.removed_unverified_claims,
                exceptional_scores=exceptional_scores,
            ),
            "filtered_numbers": _polish_optional_items(
                metadata.filtered_numbers,
                exceptional_scores=exceptional_scores,
            ),
        }
    )


def _polish_invoice_details(
    invoice_details: ChatInvoiceDetails | None,
    *,
    exceptional_scores: bool = False,
) -> ChatInvoiceDetails | None:
    if invoice_details is None:
        return None
    return invoice_details.model_copy(
        update={
            "additional_fees": _polish_optional_items(
                invoice_details.additional_fees,
                exceptional_scores=exceptional_scores,
            ),
            "overage_items": _polish_optional_items(
                invoice_details.overage_items,
                exceptional_scores=exceptional_scores,
            ),
            "anomalies": _polish_optional_items(
                invoice_details.anomalies,
                exceptional_scores=exceptional_scores,
            ),
            "primary_risk": _polish_optional_text(
                invoice_details.primary_risk,
                exceptional_scores=exceptional_scores,
            ),
            "estimated_savings": _polish_optional_text(
                invoice_details.estimated_savings,
                exceptional_scores=exceptional_scores,
            ),
        }
    )


def _polish_incident_details(
    incident_details: ChatIncidentDetails | None,
    *,
    exceptional_scores: bool = False,
) -> ChatIncidentDetails | None:
    if incident_details is None:
        return None
    return incident_details.model_copy(
        update={
            "error_message": _polish_optional_text(
                incident_details.error_message,
                exceptional_scores=exceptional_scores,
            ),
            "summary": _polish_optional_text(
                incident_details.summary,
                exceptional_scores=exceptional_scores,
            ),
            "department_risk": _polish_optional_text(
                incident_details.department_risk,
                exceptional_scores=exceptional_scores,
            ),
            "contract_exposed": _polish_optional_text(
                incident_details.contract_exposed,
                exceptional_scores=exceptional_scores,
            ),
            "fraud_score_visible": normalize_business_score_label(
                incident_details.fraud_score_visible,
                exceptional=exceptional_scores,
            ),
            "anomaly_score_visible": normalize_business_score_label(
                incident_details.anomaly_score_visible,
                exceptional=exceptional_scores,
            ),
            "optimization_score_visible": normalize_business_score_label(
                incident_details.optimization_score_visible,
                exceptional=exceptional_scores,
            ),
            "cost_score_visible": normalize_business_score_label(
                incident_details.cost_score_visible,
                exceptional=exceptional_scores,
            ),
            "risk_score": normalize_business_score_label(
                incident_details.risk_score,
                exceptional=exceptional_scores,
            ),
            "max_risk_scores": _polish_optional_items(
                incident_details.max_risk_scores,
                exceptional_scores=exceptional_scores,
            ),
            "risky_entities": _polish_optional_items(
                incident_details.risky_entities,
                exceptional_scores=exceptional_scores,
            ),
            "repeated_anomalies": _polish_optional_items(
                incident_details.repeated_anomalies,
                exceptional_scores=exceptional_scores,
            ),
            "visible_statuses": _polish_optional_items(
                incident_details.visible_statuses,
                exceptional_scores=exceptional_scores,
            ),
            "critical_signals": _polish_optional_items(
                incident_details.critical_signals,
                exceptional_scores=exceptional_scores,
            ),
            "probable_causes": _polish_optional_items(
                incident_details.probable_causes,
                exceptional_scores=exceptional_scores,
            ),
        }
    )


def _polish_alert_timeline_items(
    alert_timeline: list[ChatAlertTimelineItem],
    *,
    exceptional_scores: bool = False,
) -> list[ChatAlertTimelineItem]:
    polished_items: list[ChatAlertTimelineItem] = []
    seen_items = set()
    for item in alert_timeline:
        label = _polish_optional_text(item.label, exceptional_scores=exceptional_scores) or item.label
        detail = _polish_optional_text(item.detail, exceptional_scores=exceptional_scores) or item.detail
        dedupe_key = (_normalize_quality_text(label), _normalize_quality_text(detail))
        if dedupe_key in seen_items:
            continue
        seen_items.add(dedupe_key)
        polished_items.append(item.model_copy(update={"label": label, "detail": detail}))
    return polished_items


def _polish_alert_intelligence(
    alert_intelligence: ChatAlertIntelligence | None,
    *,
    exceptional_scores: bool = False,
) -> ChatAlertIntelligence | None:
    if alert_intelligence is None:
        return None
    return alert_intelligence.model_copy(
        update={
            "ai_risk_score": normalize_business_risk_score(
                alert_intelligence.ai_risk_score,
                exceptional=exceptional_scores,
            ),
            "executive_summary": _polish_optional_text(
                alert_intelligence.executive_summary,
                exceptional_scores=exceptional_scores,
            ),
            "business_risk": _polish_optional_text(
                alert_intelligence.business_risk,
                exceptional_scores=exceptional_scores,
            ),
            "priority_kpis": _polish_optional_items(
                alert_intelligence.priority_kpis,
                exceptional_scores=exceptional_scores,
            ),
            "visible_evidence": _polish_optional_items(
                alert_intelligence.visible_evidence,
                exceptional_scores=exceptional_scores,
            ),
            "at_risk_entities": _polish_optional_items(
                alert_intelligence.at_risk_entities,
                exceptional_scores=exceptional_scores,
            ),
            "immediate_actions": _polish_optional_items(
                alert_intelligence.immediate_actions,
                exceptional_scores=exceptional_scores,
            ),
            "recommended_controls": _polish_optional_items(
                alert_intelligence.recommended_controls,
                exceptional_scores=exceptional_scores,
            ),
            "alert_timeline": _polish_alert_timeline_items(
                alert_intelligence.alert_timeline,
                exceptional_scores=exceptional_scores,
            ),
            "audit_focus": _polish_optional_text(
                alert_intelligence.audit_focus,
                exceptional_scores=exceptional_scores,
            ),
        }
    )


def _polish_workflow_details(
    workflow_details: ChatWorkflowDetails | None,
    *,
    exceptional_scores: bool = False,
) -> ChatWorkflowDetails | None:
    if workflow_details is None:
        return None
    return workflow_details.model_copy(
        update={
            "critical_steps": _polish_optional_items(
                workflow_details.critical_steps,
                exceptional_scores=exceptional_scores,
            ),
            "detected_departments": _polish_optional_items(
                workflow_details.detected_departments,
                exceptional_scores=exceptional_scores,
            ),
            "detected_roles": _polish_optional_items(
                workflow_details.detected_roles,
                exceptional_scores=exceptional_scores,
            ),
            "automation_opportunities": _polish_optional_items(
                workflow_details.automation_opportunities,
                exceptional_scores=exceptional_scores,
            ),
            "bottlenecks": _polish_optional_items(
                workflow_details.bottlenecks,
                exceptional_scores=exceptional_scores,
            ),
            "repeated_validations": _polish_optional_items(
                workflow_details.repeated_validations,
                exceptional_scores=exceptional_scores,
            ),
            "summary": _polish_optional_text(
                workflow_details.summary,
                exceptional_scores=exceptional_scores,
            ),
        }
    )


def _polish_equipment_details(
    equipment_details: ChatEquipmentDetails | None,
    *,
    exceptional_scores: bool = False,
) -> ChatEquipmentDetails | None:
    if equipment_details is None:
        return None
    return equipment_details.model_copy(
        update={
            "usage_summary": _polish_optional_text(
                equipment_details.usage_summary,
                exceptional_scores=exceptional_scores,
            ),
            "detected_issues": _polish_optional_items(
                equipment_details.detected_issues,
                exceptional_scores=exceptional_scores,
            ),
            "maintenance_recommendations": _polish_optional_items(
                equipment_details.maintenance_recommendations,
                exceptional_scores=exceptional_scores,
            ),
            "summary": _polish_optional_text(
                equipment_details.summary,
                exceptional_scores=exceptional_scores,
            ),
        }
    )


def _polish_ui_details(
    ui_details: ChatUiDetails | None,
    *,
    exceptional_scores: bool = False,
) -> ChatUiDetails | None:
    if ui_details is None:
        return None
    return ui_details.model_copy(
        update={
            "detected_issues": _polish_optional_items(
                ui_details.detected_issues,
                exceptional_scores=exceptional_scores,
            ),
            "recommendations": _polish_optional_items(
                ui_details.recommendations,
                exceptional_scores=exceptional_scores,
            ),
            "strong_points": _polish_optional_items(
                ui_details.strong_points,
                exceptional_scores=exceptional_scores,
            ),
            "summary": _polish_optional_text(
                ui_details.summary,
                exceptional_scores=exceptional_scores,
            ),
        }
    )


def polish_chat_image_response(
    response: ChatImageResponse,
    *,
    exceptional_scores: bool = False,
) -> ChatImageResponse:
    return response.model_copy(
        update={
            "answer": _polish_optional_text(
                response.answer,
                exceptional_scores=exceptional_scores,
            )
            or response.answer,
            "vision_analysis": _polish_optional_text(
                response.vision_analysis,
                exceptional_scores=exceptional_scores,
            )
            or response.vision_analysis,
            "processing_message": _polish_optional_text(
                response.processing_message,
                exceptional_scores=exceptional_scores,
            ),
            "processing_notices": _polish_optional_items(
                response.processing_notices,
                exceptional_scores=exceptional_scores,
            ),
            "warning": _polish_optional_text(
                response.warning,
                exceptional_scores=exceptional_scores,
            ),
            "fallback_answer": _polish_optional_text(
                response.fallback_answer,
                exceptional_scores=exceptional_scores,
            ),
            "detected_kpis": _polish_optional_items(
                response.detected_kpis,
                exceptional_scores=exceptional_scores,
            ),
            "recommendations": _polish_optional_items(
                response.recommendations,
                exceptional_scores=exceptional_scores,
            ),
            "detected_anomalies": _polish_optional_items(
                response.detected_anomalies,
                exceptional_scores=exceptional_scores,
            ),
            "analysis_metadata": _polish_analysis_metadata(
                response.analysis_metadata,
                exceptional_scores=exceptional_scores,
            ),
            "invoice_details": _polish_invoice_details(
                response.invoice_details,
                exceptional_scores=exceptional_scores,
            ),
            "incident_details": _polish_incident_details(
                response.incident_details,
                exceptional_scores=exceptional_scores,
            ),
            "alert_intelligence": _polish_alert_intelligence(
                response.alert_intelligence,
                exceptional_scores=exceptional_scores,
            ),
            "workflow_details": _polish_workflow_details(
                response.workflow_details,
                exceptional_scores=exceptional_scores,
            ),
            "equipment_details": _polish_equipment_details(
                response.equipment_details,
                exceptional_scores=exceptional_scores,
            ),
            "ui_details": _polish_ui_details(
                response.ui_details,
                exceptional_scores=exceptional_scores,
            ),
            "decision_recommendations": polish_business_decision_recommendations(
                response.decision_recommendations,
                exceptional_scores=exceptional_scores,
            ),
            "recommendation_notice": _polish_optional_text(
                response.recommendation_notice,
                exceptional_scores=exceptional_scores,
            ),
            "optimization_score": normalize_business_risk_score(
                response.optimization_score,
                exceptional=exceptional_scores,
            ),
            "anomaly_score": normalize_business_risk_score(
                response.anomaly_score,
                exceptional=exceptional_scores,
            ),
            "fraud_score": normalize_business_risk_score(
                response.fraud_score,
                exceptional=exceptional_scores,
            ),
            "cost_score": normalize_business_risk_score(
                response.cost_score,
                exceptional=exceptional_scores,
            ),
        }
    )

from __future__ import annotations

import csv
import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import AI_OUTPUT_DIR, get_settings
from app.models.phone_line import PhoneLine
from app.models.plan import Plan
from app.services.phone_line_service import compute_occupation_status

if TYPE_CHECKING:
    from app.schemas.chat import ChatContextMessage
    from app.services.chat_service import DataSummary

FLEET_RESULTS_FILE = AI_OUTPUT_DIR / "fleet_ai_results_morocco.csv"
MOBILE_FLEET_FILE = AI_OUTPUT_DIR / "fleetconnect_ai_output.csv"
FRAUD_RESULTS_FILE = AI_OUTPUT_DIR / "telecom_cdr_fraud_fleetconnect_enriched.csv"


@dataclass(frozen=True)
class ScopedReasoningMetric:
    label: str
    monthly_cost_mad: float
    projected_monthly_cost_mad: float
    risk_score: float
    alert_count: int
    line_count: int
    over_quota_count: int
    anomaly_count: int
    roaming_count: int
    suspicious_call_count: int
    suspicious_call_cost_mad: float
    equipment_alert_count: int


@dataclass(frozen=True)
class PlanReasoningMetric:
    label: str
    operator: str
    average_cost_mad: float
    total_cost_mad: float
    line_count: int
    alert_count: int
    over_quota_count: int
    average_usage_ratio: float


@dataclass(frozen=True)
class CountryReasoningMetric:
    label: str
    total_cost_mad: float
    alert_count: int
    suspicious_call_count: int
    event_count: int


@dataclass(frozen=True)
class DeviceCategoryReasoningMetric:
    label: str
    estimated_cost_mad: float
    average_risk_score: float
    alert_count: int
    critical_count: int
    device_count: int


@dataclass(frozen=True)
class LineReasoningMetric:
    label: str
    operator: str
    department: str
    plan: str
    status: str
    monthly_cost_mad: float
    risk_score: float
    usage_gb: float
    quota_gb: float | None
    roaming: bool


@dataclass(frozen=True)
class BusinessReasoningSnapshot:
    operators: dict[str, ScopedReasoningMetric]
    departments: dict[str, ScopedReasoningMetric]
    plans: dict[str, PlanReasoningMetric]
    countries: dict[str, CountryReasoningMetric]
    lines: dict[str, LineReasoningMetric]
    device_categories: dict[str, DeviceCategoryReasoningMetric] = field(default_factory=dict)


@dataclass(frozen=True)
class EntityMatch:
    kind: Literal["operator", "department", "plan", "country", "line"]
    label: str
    score: float


@dataclass(frozen=True)
class BusinessReasoningResult:
    answer: str
    primary_domain: str
    request_type: str | None = None
    strategy_key: str = "general:summary"
    response_shape: str = "summary"
    selected_sources: list[str] = field(default_factory=list)
    entities: list[str] = field(default_factory=list)
    needs_inference: bool = False
    validation_passed: bool = False
    confidence: float = 0.0
    analysis_mode: str | None = None
    requested_limit: int | None = None
    intent_category: str | None = None
    intent_handler: str | None = None
    intent_fallback_used: bool = False
    intent_match_mode: str | None = None
    intent_confidence: float = 0.0
    analysis_strategy: str | None = None
    business_goal: str | None = None
    detail_level: str | None = None
    context_scope: str | None = None
    secondary_domains: list[str] = field(default_factory=list)
    secondary_request_types: list[str] = field(default_factory=list)
    source_reasons: list[str] = field(default_factory=list)
    applied_criteria: list[str] = field(default_factory=list)
    data_gaps: list[str] = field(default_factory=list)
    strategy_confidence: float = 0.0

    def __post_init__(self) -> None:
        resolved_request_type = self.request_type or self.analysis_mode or "summary"
        object.__setattr__(self, "request_type", resolved_request_type)
        object.__setattr__(self, "analysis_mode", self.analysis_mode or resolved_request_type)


@dataclass(frozen=True)
class DecisionActionItem:
    priority: Literal["low", "medium", "high", "critical"]
    title: str
    justification: str
    expected_gain: str
    horizon: Literal["court_terme", "moyen_terme", "long_terme"] | None = None


@dataclass(frozen=True)
class IntentDefinition:
    key: str
    handler_name: str
    default_domain: str
    default_request_type: str
    keywords: tuple[str, ...]
    examples: tuple[str, ...]
    domain_hints: tuple[str, ...] = field(default_factory=tuple)
    request_hints: tuple[str, ...] = field(default_factory=tuple)
    entity_kinds: tuple[str, ...] = field(default_factory=tuple)
    response_shape: str | None = None


@dataclass(frozen=True)
class IntentClassification:
    key: str
    handler_name: str
    primary_domain: str
    request_type: str
    response_shape: str
    confidence: float
    matched_by: Literal["lexical", "semantic", "domain_request_fallback", "generic_fallback"]
    fallback_used: bool = False


@dataclass(frozen=True)
class SemanticProfile:
    description: str
    examples: tuple[str, ...] = field(default_factory=tuple)
    related_terms: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class StrategyDefinition:
    key: str
    label: str
    description: str
    objective: str
    response_shape: str
    preferred_request_types: tuple[str, ...] = field(default_factory=tuple)
    preferred_domains: tuple[str, ...] = field(default_factory=tuple)
    preferred_entity_kinds: tuple[str, ...] = field(default_factory=tuple)
    preferred_capabilities: tuple[str, ...] = field(default_factory=tuple)
    preferred_intents: tuple[str, ...] = field(default_factory=tuple)
    preferred_detail_levels: tuple[str, ...] = field(default_factory=tuple)
    examples: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class ReasoningSourceProfile:
    key: str
    description: str
    domains: tuple[str, ...]
    capabilities: tuple[str, ...]
    evidence_volume: int
    quality_score: float
    available: bool = True


@dataclass(frozen=True)
class SourceSelection:
    key: str
    reason: str
    confidence: float


@dataclass(frozen=True)
class StrategySelection:
    key: str
    label: str
    objective: str
    response_shape: str
    confidence: float
    preferred_intents: tuple[str, ...]
    preferred_capabilities: tuple[str, ...]
    reason: str


@dataclass(frozen=True)
class BusinessQuestionUnderstanding:
    primary_domain: str
    secondary_domains: tuple[str, ...]
    request_type: str
    secondary_request_types: tuple[str, ...]
    detail_level: Literal["executive", "standard", "deep"]
    context_scope: str
    business_goal: str
    analysis_strategy: str
    strategy_label: str
    strategy_confidence: float
    selected_sources: tuple[str, ...]
    source_reasons: tuple[str, ...]
    applied_criteria: tuple[str, ...]
    data_gaps: tuple[str, ...]


_REASONING_SNAPSHOT_CACHE: BusinessReasoningSnapshot | None = None
_REASONING_SNAPSHOT_SIGNATURE: str | None = None


def _resolve_fleet_results_file() -> Path:
    source = get_settings().resolve_customer_churn_output_source()
    return source.path or source.configured_path or FLEET_RESULTS_FILE


def _resolve_mobile_fleet_file() -> Path:
    source = get_settings().resolve_mobile_fleet_source()
    return source.path or source.configured_path or MOBILE_FLEET_FILE


def _resolve_fraud_results_file() -> Path:
    source = get_settings().resolve_cdr_analytics_source()
    return source.path or source.configured_path or FRAUD_RESULTS_FILE


def _mobile_fleet_source_key() -> str:
    return get_settings().resolve_mobile_fleet_source().label


def _cdr_analytics_source_key() -> str:
    return get_settings().resolve_cdr_analytics_source().label


DOMAIN_LEXICONS: dict[str, tuple[str, ...]] = {
    "budget": (
        "budget",
        "cout",
        "depense",
        "facture",
        "surcout",
        "econom",
        "tarif",
        "cout global",
    ),
    "cost": (
        "cout",
        "couts",
        "facture",
        "tarification",
    ),
    "fraud": (
        "fraude",
        "suspect",
        "frauduleux",
        "appel",
        "cdr",
        "haut cout",
        "arnaque",
    ),
    "roaming": (
        "roaming",
        "international",
        "etranger",
        "voyage",
        "hors maroc",
        "zone internationale",
        "pays",
        "region",
    ),
    "equipment": (
        "equipement",
        "terminal",
        "appareil",
        "device",
        "smartphone",
        "modem",
        "routeur",
        "sim",
        "materiel",
    ),
    "users": (
        "utilisateur",
        "utilisateurs",
        "collaborateur",
        "employe",
        "profil utilisateur",
    ),
    "departments": (
        "departement",
        "departements",
        "service",
        "business unit",
    ),
    "operators": (
        "operateur",
        "operateurs",
        "maroc telecom",
        "orange",
        "inwi",
    ),
    "kpi": (
        "kpi",
        "indicateur",
        "indicateurs",
        "metrique",
        "metriques",
    ),
    "lines": (
        "ligne",
        "numero",
        "msisdn",
        "attribution",
        "libre",
        "inactive",
        "suspendue",
    ),
    "consumption": (
        "consommation",
        "usage",
        "quota",
        "depassement",
        "surconsommation",
        "donnee",
        "data",
        "go",
        "volume",
    ),
    "maintenance": (
        "maintenance",
        "remplacement",
        "renouvellement",
        "obsolescence",
        "panne",
    ),
    "inventory": (
        "inventaire",
        "liste",
        "stock",
        "parc",
    ),
    "compliance": (
        "conformite",
        "compliance",
        "politique",
        "controle",
        "verification",
    ),
    "performance": (
        "performance",
        "efficacite",
        "rendement",
        "fleet health",
        "score global",
        "etat global",
        "sante de la flotte",
        "sante globale",
    ),
    "plans": (
        "forfait",
        "offre",
        "plan",
        "allocation",
        "package",
    ),
    "pilotage": (
        "pilotage",
        "que faire",
        "priorites",
        "priorite",
        "plan d action",
        "plan d'action",
    ),
    "risk": (
        "risque",
        "alerte",
        "criticite",
        "anomalie",
        "anomalies",
        "prioritaire",
    ),
}

REQUEST_TYPE_LEXICONS: dict[str, tuple[str, ...]] = {
    "summary": (
        "resume",
        "synthese",
        "vue d ensemble",
        "vue globale",
        "en bref",
    ),
    "optimization": (
        "optimisation",
        "optimiser",
        "reduire",
        "rationaliser",
        "arbitrer",
        "surdimensionne",
        "sous utilise",
    ),
    "comparison": (
        "compare",
        "comparaison",
        "vs",
        "versus",
        "entre",
        "plus que",
        "moins que",
    ),
    "ranking": (
        "classement",
        "classer",
        "ordre",
        "meilleurs",
        "pires",
        "plus couteux",
        "plus exposes",
    ),
    "top_n": ("top",),
    "statistics": (
        "statistique",
        "statistiques",
        "kpi",
        "indicateur",
        "indicateurs",
        "ratio",
        "taux",
        "repartition",
        "distribution",
    ),
    "diagnostic": (
        "pourquoi",
        "cause",
        "raison",
        "diagnostic",
        "origine",
    ),
    "explanation": (
        "explique",
        "expliquer",
        "explication",
        "comprendre",
        "detaille",
        "detaillee",
    ),
    "recommendation": (
        "recommandation",
        "recommande",
        "recommander",
        "conseille",
        "que faire",
        "priorite",
        "action",
    ),
    "planning": (
        "planifier",
        "planification",
        "hebdomadaire",
        "cette semaine",
        "semaine",
        "roadmap",
        "plan d action",
        "plan d'action",
    ),
    "forecast": (
        "prevision",
        "projection",
        "futur",
        "prochain",
        "atterrissage",
        "deraper",
    ),
    "simulation": (
        "simulation",
        "scenario",
        "si on",
        "si je",
        "que se passe",
        "impact de",
    ),
    "opportunities": (
        "opportunite",
        "opportunites",
        "levier",
        "leviers",
        "gisement",
        "quick win",
    ),
    "trends": (
        "tendance",
        "evolution",
        "derive",
        "hausse",
        "baisse",
        "trajectoire",
    ),
    "risk_analysis": (
        "analyse de risque",
        "exposition",
        "risque",
        "menace",
    ),
    "estimation": (
        "estimation",
        "estimer",
        "estime",
        "combien",
        "approximation",
    ),
    "inventory": (
        "inventaire",
        "liste",
        "etat des",
        "quelles",
        "quels",
        "montre",
        "combien",
    ),
    "audit": (
        "audit",
        "controle",
        "verification",
        "conformite",
    ),
}

REQUEST_TYPE_ALIASES: dict[str, str] = {
    "explanation": "diagnostic",
    "top_n": "ranking",
    "opportunities": "optimization",
}

DOMAIN_ALIASES: dict[str, str] = {
    "cost": "budget",
    "operators": "budget",
    "departments": "budget",
    "kpi": "performance",
    "maintenance": "equipment",
    "inventory": "equipment",
    "compliance": "audit",
    "pilotage": "planning",
}

REQUEST_TYPE_RESPONSE_SHAPES: dict[str, str] = {
    "summary": "summary",
    "optimization": "recommendation",
    "comparison": "comparison",
    "ranking": "ranking",
    "statistics": "statistics",
    "diagnostic": "diagnostic",
    "recommendation": "recommendation",
    "planning": "action_plan",
    "forecast": "projection",
    "simulation": "projection",
    "trends": "projection",
    "risk_analysis": "diagnostic",
    "estimation": "projection",
    "inventory": "inventory",
    "audit": "audit",
}

INTENT_DEFINITIONS: tuple[IntentDefinition, ...] = (
    IntentDefinition(
        key="cost_optimization",
        handler_name="handle_cost_optimization_intent",
        default_domain="budget",
        default_request_type="optimization",
        keywords=(
            "optimisation des couts",
            "optimiser le budget",
            "reduire la facture",
            "reduire les depenses",
            "rationaliser les couts",
            "maitriser le budget telecom",
        ),
        examples=(
            "Comment optimiser le budget telecom ?",
            "Ou dois-je reduire les couts de la flotte ?",
            "Quels leviers pour baisser la facture mobile ?",
        ),
        domain_hints=("budget", "plans", "consumption"),
        request_hints=("optimization", "recommendation"),
        entity_kinds=("operator", "department", "plan"),
    ),
    IntentDefinition(
        key="potential_savings",
        handler_name="handle_potential_savings_intent",
        default_domain="budget",
        default_request_type="optimization",
        keywords=(
            "economies potentielles",
            "economies possibles",
            "gains potentiels",
            "quick wins",
            "economiser",
            "economie annuelle",
        ),
        examples=(
            "Quelles economies potentielles vois-tu ?",
            "Combien puis-je economiser sur la flotte ?",
            "Quels gains rapides sur les forfaits et les lignes ?",
        ),
        domain_hints=("budget", "plans", "consumption"),
        request_hints=("optimization", "estimation", "recommendation"),
        entity_kinds=("operator", "department", "plan"),
    ),
    IntentDefinition(
        key="oversized_plans",
        handler_name="handle_oversized_plans_intent",
        default_domain="plans",
        default_request_type="optimization",
        keywords=(
            "forfaits surdimensionnes",
            "forfait surdimensionne",
            "abonnement surdimensionne",
            "plan trop grand",
            "forfait trop large",
            "forfaits sous utilises",
        ),
        examples=(
            "Quels forfaits sont surdimensionnes ?",
            "Quels abonnements paraissent trop larges pour l usage ?",
            "Montre les plans sous utilises a rationaliser.",
        ),
        domain_hints=("plans", "consumption", "budget"),
        request_hints=("optimization", "diagnostic", "ranking"),
        entity_kinds=("plan", "operator"),
    ),
    IntentDefinition(
        key="quota_overruns",
        handler_name="handle_quota_overruns_intent",
        default_domain="consumption",
        default_request_type="diagnostic",
        keywords=(
            "depassements de quota",
            "depassement de quota",
            "hors forfait",
            "surconsommation",
            "quota depasse",
            "consommation excessive",
        ),
        examples=(
            "Quelles lignes depassent leur quota ?",
            "Montre les depassements de forfait a traiter.",
            "Ou sont les surconsommations data ?",
        ),
        domain_hints=("consumption", "plans", "budget"),
        request_hints=("diagnostic", "ranking", "statistics"),
        entity_kinds=("line", "plan", "department"),
    ),
    IntentDefinition(
        key="fraud",
        handler_name="handle_fraud_intent",
        default_domain="fraud",
        default_request_type="risk_analysis",
        keywords=(
            "fraude",
            "frauduleux",
            "arnaque",
            "abus",
            "usage suspect",
        ),
        examples=(
            "Quel est le niveau de fraude actuel ?",
            "Analyse les signaux de fraude sur la flotte.",
            "Ou vois-tu des comportements frauduleux ?",
        ),
        domain_hints=("fraud", "risk"),
        request_hints=("risk_analysis", "diagnostic", "statistics"),
        entity_kinds=("operator", "department"),
    ),
    IntentDefinition(
        key="suspicious_calls",
        handler_name="handle_suspicious_calls_intent",
        default_domain="fraud",
        default_request_type="ranking",
        keywords=(
            "appels suspects",
            "communications suspectes",
            "appels a haut cout",
            "haut cout",
            "cdr suspects",
        ),
        examples=(
            "Montre les appels suspects.",
            "Quels appels a haut cout dois-je auditer ?",
            "Classe les communications anormales.",
        ),
        domain_hints=("fraud", "risk"),
        request_hints=("ranking", "diagnostic", "statistics"),
        entity_kinds=("operator", "department"),
    ),
    IntentDefinition(
        key="roaming",
        handler_name="handle_roaming_intent",
        default_domain="roaming",
        default_request_type="risk_analysis",
        keywords=(
            "roaming",
            "itineraire international",
            "itinerance",
            "voyage",
            "etranger",
            "international",
        ),
        examples=(
            "Quel risque roaming vois-tu ?",
            "Ou se concentre le roaming international ?",
            "Analyse les couts de roaming par pays.",
        ),
        domain_hints=("roaming",),
        request_hints=("risk_analysis", "diagnostic", "ranking", "statistics", "comparison", "optimization", "estimation"),
        entity_kinds=("country", "operator", "department"),
    ),
    IntentDefinition(
        key="maintenance",
        handler_name="handle_maintenance_intent",
        default_domain="equipment",
        default_request_type="optimization",
        keywords=(
            "maintenance",
            "renouvellement",
            "remplacement",
            "obsolescence",
            "sante du parc",
            "appareils a remplacer",
        ),
        examples=(
            "Quel est l etat de maintenance du parc ?",
            "Quels equipements doivent etre renouveles ?",
            "Ou vois-tu de l obsolescence materielle ?",
        ),
        domain_hints=("equipment", "maintenance"),
        request_hints=("optimization", "diagnostic"),
        entity_kinds=(),
    ),
    IntentDefinition(
        key="equipment",
        handler_name="handle_equipment_intent",
        default_domain="equipment",
        default_request_type="inventory",
        keywords=(
            "equipements",
            "equipement",
            "materiel",
            "terminaux",
            "appareils",
            "parc mobile",
        ),
        examples=(
            "Donne moi l inventaire des equipements.",
            "Quels appareils sont suivis dans le parc ?",
            "Classe les categories d equipements critiques.",
        ),
        domain_hints=("equipment", "inventory", "maintenance"),
        request_hints=("inventory", "ranking", "statistics"),
        entity_kinds=(),
    ),
    IntentDefinition(
        key="consumption",
        handler_name="handle_consumption_intent",
        default_domain="consumption",
        default_request_type="summary",
        keywords=(
            "consommation",
            "usage",
            "data",
            "voix",
            "sms",
            "volume consomme",
        ),
        examples=(
            "Analyse la consommation des lignes.",
            "Comment evolue l usage data de la flotte ?",
            "Quelles lignes consomment le plus ?",
        ),
        domain_hints=("consumption", "plans", "lines"),
        request_hints=("summary", "ranking", "diagnostic", "statistics"),
        entity_kinds=("line", "plan", "department"),
    ),
    IntentDefinition(
        key="operators",
        handler_name="handle_operators_intent",
        default_domain="budget",
        default_request_type="summary",
        keywords=(
            "operateur",
            "operateurs",
            "maroc telecom",
            "orange",
            "inwi",
        ),
        examples=(
            "Quel operateur coute le plus cher ?",
            "Compare les operateurs de la flotte.",
            "Quel est l operateur le plus risque ?",
        ),
        domain_hints=("budget", "operators"),
        request_hints=("summary", "comparison", "ranking", "diagnostic"),
        entity_kinds=("operator",),
    ),
    IntentDefinition(
        key="departments",
        handler_name="handle_departments_intent",
        default_domain="budget",
        default_request_type="summary",
        keywords=(
            "departement",
            "departements",
            "service",
            "business unit",
            "equipe",
        ),
        examples=(
            "Quel departement consomme le plus ?",
            "Compare Finance et IT.",
            "Quels services concentrent le risque ?",
        ),
        domain_hints=("budget", "departments"),
        request_hints=("summary", "comparison", "ranking", "diagnostic"),
        entity_kinds=("department",),
    ),
    IntentDefinition(
        key="trends",
        handler_name="handle_trends_intent",
        default_domain="budget",
        default_request_type="trends",
        keywords=(
            "tendance",
            "evolution",
            "trajectoire",
            "derive",
            "hausse",
            "baisse",
        ),
        examples=(
            "Quelle tendance vois-tu sur la flotte ?",
            "Comment evoluent les couts telecom ?",
            "Y a-t-il une derive de consommation ?",
        ),
        domain_hints=("budget", "consumption", "roaming", "fraud", "performance"),
        request_hints=("trends", "statistics", "estimation"),
        entity_kinds=("operator", "department"),
    ),
    IntentDefinition(
        key="forecasts",
        handler_name="handle_forecasts_intent",
        default_domain="budget",
        default_request_type="estimation",
        keywords=(
            "prevision",
            "projection",
            "mois prochain",
            "atterrissage",
            "forecast",
            "futur",
        ),
        examples=(
            "Quelle prevision budgetaire pour le mois prochain ?",
            "Projette les couts de la flotte.",
            "Quel atterrissage financier anticipes-tu ?",
        ),
        domain_hints=("budget", "consumption", "roaming", "performance"),
        request_hints=("estimation", "forecast", "simulation"),
        entity_kinds=("operator", "department", "plan"),
    ),
    IntentDefinition(
        key="comparison",
        handler_name="handle_comparison_intent",
        default_domain="budget",
        default_request_type="comparison",
        keywords=(
            "comparaison",
            "compare",
            "versus",
            "vs",
            "ecart entre",
        ),
        examples=(
            "Compare Finance et IT.",
            "Orange vs Maroc Telecom.",
            "Quel ecart entre deux forfaits premium ?",
        ),
        domain_hints=("budget", "roaming", "plans", "consumption", "departments", "operators"),
        request_hints=("comparison",),
        entity_kinds=("operator", "department", "plan", "country"),
        response_shape="comparison",
    ),
    IntentDefinition(
        key="kpi",
        handler_name="handle_kpi_intent",
        default_domain="performance",
        default_request_type="statistics",
        keywords=(
            "kpi",
            "indicateur",
            "indicateurs",
            "statistiques",
            "ratio",
            "repartition",
        ),
        examples=(
            "Donne les KPI de la flotte.",
            "Quels indicateurs dois-je suivre ?",
            "Resume les statistiques telecom.",
        ),
        domain_hints=("performance", "kpi", "budget"),
        request_hints=("statistics", "summary"),
        entity_kinds=(),
        response_shape="statistics",
    ),
    IntentDefinition(
        key="recommendations",
        handler_name="handle_recommendations_intent",
        default_domain="planning",
        default_request_type="recommendation",
        keywords=(
            "recommandation",
            "recommandations",
            "que recommandes tu",
            "actions conseillees",
            "quoi faire",
        ),
        examples=(
            "Quelles recommandations prioritaires proposes-tu ?",
            "Que recommandes-tu sur cette flotte ?",
            "Donne les actions conseillees.",
        ),
        domain_hints=("planning", "budget", "roaming", "fraud", "equipment"),
        request_hints=("recommendation", "optimization", "planning"),
        entity_kinds=("operator", "department", "plan"),
    ),
    IntentDefinition(
        key="prioritization",
        handler_name="handle_prioritization_intent",
        default_domain="planning",
        default_request_type="ranking",
        keywords=(
            "priorisation",
            "prioriser",
            "ordre de traitement",
            "actions prioritaires",
            "classe les actions",
        ),
        examples=(
            "Quelles actions dois-je traiter en premier ?",
            "Priorise les risques de la flotte.",
            "Classe les actions a lancer cette semaine.",
        ),
        domain_hints=("planning", "risk", "budget"),
        request_hints=("ranking", "planning", "recommendation"),
        entity_kinds=("operator", "department", "line"),
    ),
    IntentDefinition(
        key="action_plan",
        handler_name="handle_action_plan_intent",
        default_domain="planning",
        default_request_type="planning",
        keywords=(
            "plan d action",
            "plan d'action",
            "roadmap",
            "cette semaine",
            "prochaines actions",
            "planifier",
        ),
        examples=(
            "Que dois-je faire cette semaine ?",
            "Genere un plan d action pour la flotte.",
            "Donne une roadmap de remediation.",
        ),
        domain_hints=("planning", "performance"),
        request_hints=("planning",),
        entity_kinds=(),
        response_shape="action_plan",
    ),
    IntentDefinition(
        key="audit",
        handler_name="handle_audit_intent",
        default_domain="audit",
        default_request_type="audit",
        keywords=(
            "audit",
            "revue",
            "controle",
            "verification",
            "inspection",
        ),
        examples=(
            "Lance un audit telecom cible.",
            "Quels controles faut-il mener ?",
            "Ou concentrer la revue des usages ?",
        ),
        domain_hints=("audit", "risk", "budget"),
        request_hints=("audit", "diagnostic"),
        entity_kinds=("operator", "department"),
        response_shape="audit",
    ),
    IntentDefinition(
        key="compliance",
        handler_name="handle_compliance_intent",
        default_domain="audit",
        default_request_type="audit",
        keywords=(
            "conformite",
            "compliance",
            "hors politique",
            "politique telecom",
            "regle interne",
            "non conforme",
        ),
        examples=(
            "Y a-t-il un risque de conformite sur la flotte ?",
            "Quels usages semblent hors politique telecom ?",
            "Analyse la compliance des lignes et forfaits.",
        ),
        domain_hints=("audit", "risk", "budget"),
        request_hints=("audit", "diagnostic"),
        entity_kinds=("operator", "department", "line"),
        response_shape="audit",
    ),
)


DOMAIN_SEMANTIC_PROFILES: dict[str, SemanticProfile] = {
    "budget": SemanticProfile(
        description="Analyse financiere de la flotte telecom: budget, couts, depenses, arbitrages et economie.",
        examples=(
            "Que doit retenir la finance de la flotte ?",
            "Ou se situe la derive budgetaire du parc ?",
            "Quels leviers d'economie voyez-vous sur la facture telecom ?",
        ),
        related_terms=("budget", "cout", "depense", "facture", "economie", "finance"),
    ),
    "plans": SemanticProfile(
        description="Lecture des forfaits et abonnements: adequation entre offre souscrite, cout et usage reel.",
        examples=(
            "Quels forfaits paraissent trop larges ?",
            "Les abonnements sont-ils adaptes a l'usage ?",
            "Comment rationaliser les plans telecom ?",
        ),
        related_terms=("forfait", "plan", "abonnement", "allocation", "offre"),
    ),
    "consumption": SemanticProfile(
        description="Analyse de consommation telecom: usage data, quotas, depassements et intensite d'usage.",
        examples=(
            "Comment evolue la consommation des lignes ?",
            "Quelles lignes depassent leur quota ?",
            "Ou se concentre la surconsommation data ?",
        ),
        related_terms=("consommation", "usage", "quota", "data", "depassement"),
    ),
    "fraud": SemanticProfile(
        description="Investigation des risques de fraude: appels suspects, anomalies, exposition et signaux d'abus.",
        examples=(
            "Quels signaux de fraude remonte la flotte ?",
            "Ou faut-il auditer les communications suspectes ?",
            "Quel est le niveau de risque fraude actuel ?",
        ),
        related_terms=("fraude", "suspect", "anomalie", "haut cout", "abus"),
    ),
    "roaming": SemanticProfile(
        description="Analyse des usages en roaming: geographie, couts internationaux, alertes et lignes en deplacement.",
        examples=(
            "Quel risque roaming voyez-vous ?",
            "Dans quels pays le roaming est-il le plus cher ?",
            "Ou se concentrent les surcouts internationaux ?",
        ),
        related_terms=("roaming", "international", "etranger", "pays", "voyage"),
    ),
    "equipment": SemanticProfile(
        description="Lecture du parc equipement: inventaire, sante, criticite et renouvellement des terminaux.",
        examples=(
            "Quels equipements faut-il renouveler ?",
            "Quel est l'etat du parc mobile ?",
            "Montrez l'inventaire et la criticite du materiel.",
        ),
        related_terms=("equipement", "materiel", "terminal", "appareil", "parc"),
    ),
    "performance": SemanticProfile(
        description="Vue de pilotage de la flotte: KPI, performance globale, tendance et qualite de service.",
        examples=(
            "Quels KPI faut-il suivre ?",
            "Quel est l'etat global de la flotte ?",
            "Resume les indicateurs telecom utiles au pilotage.",
        ),
        related_terms=("kpi", "performance", "pilotage", "indicateur", "score"),
    ),
    "planning": SemanticProfile(
        description="Aide a la decision et a la planification: priorites, recommandations et plan d'action.",
        examples=(
            "Que dois-je faire cette semaine ?",
            "Quelles actions faut-il prioriser ?",
            "Donne un plan d'action oriente decision.",
        ),
        related_terms=("priorite", "plan", "action", "recommandation", "roadmap"),
    ),
    "audit": SemanticProfile(
        description="Revue de controle et de conformite: audit telecom, verification de politique et controles.",
        examples=(
            "Lance un audit telecom.",
            "Quels usages paraissent hors politique ?",
            "Que faut-il verifier en priorite ?",
        ),
        related_terms=("audit", "conformite", "controle", "verification", "politique"),
    ),
    "lines": SemanticProfile(
        description="Analyse operationnelle des lignes: statut, attribution, activite et occupation du parc.",
        examples=(
            "Quelles lignes sont libres ou suspendues ?",
            "Montre les lignes a regulariser.",
            "Quel est l'etat d'occupation des lignes ?",
        ),
        related_terms=("ligne", "numero", "msisdn", "suspendue", "inactive"),
    ),
}


REQUEST_TYPE_SEMANTIC_PROFILES: dict[str, SemanticProfile] = {
    "summary": SemanticProfile(
        description="Synthese executive et vue d'ensemble pour decideur.",
        examples=(
            "Que doit retenir un DAF avant la revue mensuelle ?",
            "Fais une synthese de la flotte.",
            "Donne-moi une vue d'ensemble utile a la decision.",
        ),
    ),
    "optimization": SemanticProfile(
        description="Recherche de leviers d'optimisation, d'economie ou d'efficacite.",
        examples=(
            "Ou faut-il agir pour reduire la derive ?",
            "Quels leviers d'optimisation sont les plus rentables ?",
            "Comment mieux allouer les ressources telecom ?",
        ),
    ),
    "comparison": SemanticProfile(
        description="Comparaison de plusieurs perimetres pour arbitrage.",
        examples=(
            "Compare Finance et IT.",
            "Quel ecart entre deux operateurs ?",
            "Quel perimetre est le plus tendu ?",
        ),
    ),
    "ranking": SemanticProfile(
        description="Classement des priorites, des risques ou des perimetres a traiter.",
        examples=(
            "Que faut-il traiter en premier ?",
            "Classe les perimetres les plus exposes.",
            "Montre le top des sujets critiques.",
            "Quel operateur coute le plus cher ?",
            "Quel departement consomme le plus ?",
        ),
    ),
    "statistics": SemanticProfile(
        description="Consolidation d'indicateurs, de statistiques et de repartitions.",
        examples=(
            "Quels indicateurs faut-il suivre ?",
            "Donne les KPI de la flotte.",
            "Resume les statistiques telecom importantes.",
        ),
    ),
    "diagnostic": SemanticProfile(
        description="Explication et diagnostic des causes dominantes.",
        examples=(
            "Pourquoi ce perimetre est-il plus risque ?",
            "Explique la derive observee.",
            "D'ou vient le probleme principal ?",
        ),
    ),
    "recommendation": SemanticProfile(
        description="Recommandations argumentees et orientees decision.",
        examples=(
            "Que recommandes-tu ?",
            "Quelles actions conseilles-tu ?",
            "Quelle decision est la plus pertinente ?",
        ),
    ),
    "planning": SemanticProfile(
        description="Sequencement et planification d'actions a court, moyen et long terme.",
        examples=(
            "Que dois-je faire cette semaine ?",
            "Donne un plan d'action priorise.",
            "Comment organiser la remediation ?",
        ),
    ),
    "forecast": SemanticProfile(
        description="Projection future, anticipation et prevision a court terme.",
        examples=(
            "Que peut-on anticiper le mois prochain ?",
            "Projette l'atterrissage budgetaire.",
            "Quelle prevision fais-tu sur la trajectoire ?",
        ),
    ),
    "simulation": SemanticProfile(
        description="Simulation d'impact et lecture de scenarios.",
        examples=(
            "Que se passe-t-il si on change les forfaits ?",
            "Quel impact si on coupe le roaming ?",
            "Fais un scenario d'arbitrage.",
        ),
    ),
    "trends": SemanticProfile(
        description="Lecture de tendance et d'evolution.",
        examples=(
            "Quelle tendance se dessine ?",
            "Comment evoluent les couts ?",
            "Vois-tu une derive structurelle ?",
        ),
    ),
    "risk_analysis": SemanticProfile(
        description="Evaluation du risque, de l'exposition et des signaux d'alerte.",
        examples=(
            "Quel risque vois-tu ?",
            "Ou est la plus forte exposition ?",
            "Quels signaux d'alerte dominent ?",
        ),
    ),
    "estimation": SemanticProfile(
        description="Estimation prudente quand la valeur exacte n'est pas directement mesuree.",
        examples=(
            "Quelle estimation fais-tu ?",
            "Combien cela pourrait-il couter ?",
            "Donne un ordre de grandeur.",
        ),
    ),
    "inventory": SemanticProfile(
        description="Inventaire et lecture d'etat du parc ou des ressources.",
        examples=(
            "Montre l'inventaire des equipements.",
            "Quelles lignes sont actives ?",
            "Quel est l'etat du parc ?",
        ),
    ),
    "audit": SemanticProfile(
        description="Revue de controle, audit et conformite.",
        examples=(
            "Lance un audit cible.",
            "Que faut-il verifier ?",
            "Analyse la conformite du perimetre.",
        ),
    ),
}


DETAIL_LEVEL_PROFILES: dict[str, SemanticProfile] = {
    "executive": SemanticProfile(
        description="Reponse concise, executive, utile a un decideur ou a une revue de direction.",
        examples=(
            "Que doit retenir un DAF ?",
            "En bref pour un comite de direction.",
            "Fais une synthese executive.",
        ),
    ),
    "standard": SemanticProfile(
        description="Reponse structuree avec quelques chiffres clefs et recommandations principales.",
        examples=(
            "Analyse cette situation.",
            "Que vois-tu sur la flotte ?",
            "Donne une lecture metier exploitable.",
        ),
    ),
    "deep": SemanticProfile(
        description="Reponse detaillee, justifiee, avec causes, criteres et nuances d'estimation.",
        examples=(
            "Explique en detail pourquoi.",
            "Fais un diagnostic complet et justifie.",
            "Donne un audit detaille.",
        ),
    ),
}


STRATEGY_DEFINITIONS: tuple[StrategyDefinition, ...] = (
    StrategyDefinition(
        key="executive_summary",
        label="Synthese executive",
        description="Condense la situation en quelques enseignements directement actionnables pour un decideur.",
        objective="donner une lecture decisionnelle rapide sans perdre les signaux financiers et de risque dominants",
        response_shape="summary",
        preferred_request_types=("summary", "recommendation", "statistics"),
        preferred_domains=("budget", "performance", "planning", "audit"),
        preferred_capabilities=("cost", "alerts", "kpi", "projection", "priority"),
        preferred_intents=("kpi", "recommendations", "cost_optimization"),
        preferred_detail_levels=("executive", "standard"),
        examples=(
            "Que doit retenir la direction de la flotte ?",
            "Fais une synthese pour un DAF.",
        ),
    ),
    StrategyDefinition(
        key="optimization_plan",
        label="Optimisation orientee gains",
        description="Cherche les meilleurs leviers d'economie, de reallocation ou de rationalisation.",
        objective="identifier les gains attendus, les poches d'inefficacite et l'ordre d'action le plus rentable",
        response_shape="recommendation",
        preferred_request_types=("optimization", "recommendation", "planning"),
        preferred_domains=("budget", "plans", "consumption", "equipment", "planning"),
        preferred_capabilities=("cost", "plans", "quota", "usage", "renewal", "priority"),
        preferred_intents=("potential_savings", "cost_optimization", "oversized_plans", "maintenance", "recommendations"),
        preferred_detail_levels=("standard", "deep"),
        examples=(
            "Ou faut-il agir pour reduire la derive ?",
            "Quels leviers d'optimisation prioriser ?",
        ),
    ),
    StrategyDefinition(
        key="comparative_analysis",
        label="Comparaison et arbitrage",
        description="Met en regard plusieurs perimetres comparables pour aider a arbitrer.",
        objective="faire ressortir les ecarts de cout, de risque ou de charge entre plusieurs perimetres",
        response_shape="comparison",
        preferred_request_types=("comparison", "ranking"),
        preferred_domains=("budget", "plans", "consumption", "roaming", "performance"),
        preferred_entity_kinds=("operator", "department", "plan", "country"),
        preferred_capabilities=("comparison", "operators", "departments", "plans", "countries"),
        preferred_intents=("comparison", "operators", "departments"),
        preferred_detail_levels=("standard", "deep"),
        examples=(
            "Compare Finance et IT.",
            "Quel ecart entre Orange et Maroc Telecom ?",
        ),
    ),
    StrategyDefinition(
        key="risk_investigation",
        label="Investigation du risque",
        description="Explique les signaux d'exposition, d'anomalie, de fraude ou de roaming sensible.",
        objective="qualifier la cause probable du risque et identifier les cas qui meritent un audit immediat",
        response_shape="diagnostic",
        preferred_request_types=("diagnostic", "risk_analysis", "audit"),
        preferred_domains=("fraud", "roaming", "audit", "consumption", "budget"),
        preferred_capabilities=("suspicious_calls", "roaming", "alerts", "anomalies", "countries"),
        preferred_intents=("fraud", "suspicious_calls", "roaming", "compliance", "audit"),
        preferred_detail_levels=("deep", "standard"),
        examples=(
            "Pourquoi ce perimetre est-il plus risque ?",
            "Ou faut-il investiguer en premier ?",
        ),
    ),
    StrategyDefinition(
        key="forecast_projection",
        label="Projection et anticipation",
        description="Projette la trajectoire probable et chiffre l'impact a court terme.",
        objective="anticiper les couts, les risques ou les depassements a partir des signaux deja visibles",
        response_shape="projection",
        preferred_request_types=("forecast", "estimation", "simulation", "trends"),
        preferred_domains=("budget", "consumption", "roaming", "performance", "planning"),
        preferred_capabilities=("projection", "cost", "quota", "alerts", "trend"),
        preferred_intents=("forecasts", "trends", "potential_savings"),
        preferred_detail_levels=("standard", "deep"),
        examples=(
            "Que peut-on anticiper pour le mois prochain ?",
            "Projette la trajectoire budgetaire.",
        ),
    ),
    StrategyDefinition(
        key="statistical_overview",
        label="Vue statistique",
        description="Consolide les indicateurs, les volumes et les repartitions les plus utiles.",
        objective="donner une lecture factuelle des indicateurs sans forcer une recommandation excessive",
        response_shape="statistics",
        preferred_request_types=("statistics", "summary"),
        preferred_domains=("performance", "budget", "consumption", "equipment"),
        preferred_capabilities=("kpi", "distribution", "counts", "alerts", "inventory"),
        preferred_intents=("kpi", "consumption", "equipment"),
        preferred_detail_levels=("executive", "standard"),
        examples=(
            "Quels KPI faut-il suivre ?",
            "Resume les statistiques importantes.",
        ),
    ),
    StrategyDefinition(
        key="action_prioritization",
        label="Priorisation d'actions",
        description="Transforme les signaux disponibles en ordre de traitement et en plan d'execution.",
        objective="sequencer les actions pour securiser le risque d'abord puis les gains structurels",
        response_shape="action_plan",
        preferred_request_types=("planning", "recommendation", "ranking"),
        preferred_domains=("planning", "budget", "fraud", "roaming", "equipment", "audit"),
        preferred_capabilities=("priority", "alerts", "cost", "risk", "decision"),
        preferred_intents=("prioritization", "action_plan", "recommendations"),
        preferred_detail_levels=("standard", "deep"),
        examples=(
            "Que dois-je faire cette semaine ?",
            "Priorise les actions de remediation.",
        ),
    ),
    StrategyDefinition(
        key="inventory_health",
        label="Inventaire et sante",
        description="Dresse l'etat du parc, sa criticite et les besoins de renouvellement.",
        objective="donner une lecture exploitable du parc et isoler les besoins de maintenance ou de regularisation",
        response_shape="inventory",
        preferred_request_types=("inventory", "summary", "diagnostic"),
        preferred_domains=("equipment", "lines", "consumption", "plans"),
        preferred_capabilities=("inventory", "equipment", "health", "status", "quota", "renewal"),
        preferred_intents=("equipment", "maintenance", "consumption"),
        preferred_detail_levels=("standard", "deep"),
        examples=(
            "Quel est l'etat du parc ?",
            "Montre l'inventaire et la sante des equipements.",
        ),
    ),
    StrategyDefinition(
        key="compliance_review",
        label="Revue de conformite",
        description="Cherche les usages hors politique, les controles manquants et les poches de non-conformite.",
        objective="securiser la conformite et objectiver les controles a lancer avec les donnees disponibles",
        response_shape="audit",
        preferred_request_types=("audit", "diagnostic", "risk_analysis"),
        preferred_domains=("audit", "fraud", "roaming", "budget"),
        preferred_capabilities=("controls", "alerts", "policy", "suspicious_calls", "roaming"),
        preferred_intents=("compliance", "audit", "fraud"),
        preferred_detail_levels=("deep", "standard"),
        examples=(
            "Analyse la conformite du parc.",
            "Quels controles prioriser ?",
        ),
    ),
)


def _normalize_text(value: str | None) -> str:
    normalized_value = unicodedata.normalize("NFD", (value or "").lower())
    normalized_value = "".join(
        character for character in normalized_value if unicodedata.category(character) != "Mn"
    )
    normalized_value = re.sub(r"[^a-z0-9\s+]", " ", normalized_value)
    return " ".join(normalized_value.split())


def _clean_label(value: str | None, fallback: str = "Non renseigne") -> str:
    cleaned_value = " ".join((value or "").split()).strip()
    return cleaned_value or fallback


def _to_float(value: str | None) -> float:
    if value is None:
        return 0.0
    normalized_value = value.strip().replace(" ", "").replace(",", ".")
    if not normalized_value:
        return 0.0
    try:
        return float(normalized_value)
    except ValueError:
        return 0.0


def _is_truthy_flag(value: str | None) -> bool:
    return _normalize_text(value) in {"1", "true", "yes", "oui"}


def _format_mad(value: float) -> str:
    return f"{value:,.0f} MAD".replace(",", " ")


def _format_score(value: float) -> str:
    return f"{round(value)}/100"


def _format_usage(current_usage_gb: float, quota_gb: float | None) -> str:
    if quota_gb in (None, 0):
        return f"{current_usage_gb:.1f} Go"
    return f"{current_usage_gb:.1f}/{quota_gb:.1f} Go"


def _detect_csv_delimiter(sample: str) -> str:
    try:
        return csv.Sniffer().sniff(sample, delimiters=";,").delimiter
    except csv.Error:
        return ";" if sample.count(";") >= sample.count(",") else ","


def _read_csv_rows(path: Path, *, allow_missing: bool = False) -> list[dict[str, str]]:
    if allow_missing and not path.exists():
        return []

    with path.open("r", encoding="utf-8-sig", errors="ignore", newline="") as file_handle:
        sample = file_handle.read(4096)
        file_handle.seek(0)
        delimiter = _detect_csv_delimiter(sample)
        reader = csv.DictReader(file_handle, delimiter=delimiter)
        return [
            {str(key): (value or "").strip() for key, value in row.items() if key is not None}
            for row in reader
        ]


def _history_text(history: list["ChatContextMessage"]) -> str:
    if not history:
        return ""
    return " ".join(message.text for message in history[-4:])


def _contains_candidate(text: str, candidate: str) -> bool:
    if not candidate:
        return False
    if len(candidate) <= 3:
        return re.search(rf"\b{re.escape(candidate)}\b", text) is not None
    return candidate in text


def _score_lexicon(text: str, lexicon: tuple[str, ...], weight: float) -> float:
    score = 0.0
    for phrase in lexicon:
        normalized_phrase = _normalize_text(phrase)
        if not normalized_phrase:
            continue
        if _contains_candidate(text, normalized_phrase):
            score += weight if " " in normalized_phrase else weight * 0.75
    return score


SEMANTIC_STOPWORDS = {
    "a",
    "au",
    "aux",
    "ce",
    "ces",
    "cette",
    "comment",
    "dans",
    "de",
    "des",
    "dois",
    "du",
    "en",
    "est",
    "et",
    "je",
    "la",
    "le",
    "les",
    "me",
    "moi",
    "mon",
    "ou",
    "par",
    "pour",
    "qu",
    "que",
    "niveau",
    "quel",
    "quelle",
    "quelles",
    "quels",
    "sur",
    "ta",
    "tes",
    "ton",
    "tu",
    "un",
    "une",
    "actuel",
    "actuelle",
    "vos",
    "votre",
    "y",
}

NON_DATA_FOCUS_TOKENS = SEMANTIC_STOPWORDS | {
    "agir",
    "aider",
    "ameliorer",
    "analyse",
    "analyser",
    "anticiper",
    "arbitrage",
    "avant",
    "besoin",
    "brief",
    "bref",
    "comite",
    "complet",
    "comprendre",
    "court",
    "coute",
    "daf",
    "decision",
    "decisionnel",
    "detail",
    "detaille",
    "detaillee",
    "direction",
    "doivent",
    "donne",
    "doit",
    "dsi",
    "etude",
    "faire",
    "faut",
    "global",
    "globale",
    "justifie",
    "justifier",
    "mensuelle",
    "mensuel",
    "metier",
    "mieux",
    "mois",
    "moisci",
    "parc",
    "point",
    "plus",
    "preparer",
    "premier",
    "premiere",
    "priorise",
    "prioriser",
    "question",
    "rapport",
    "recap",
    "reponse",
    "recommandation",
    "recommandations",
    "prioritaire",
    "prioritaires",
    "propose",
    "proposes",
    "retenir",
    "revue",
    "risque",
    "semaine",
    "situation",
    "strategie",
    "suivi",
    "telecom",
    "consomme",
    "actions",
    "cher",
    "trimestre",
    "utile",
    "vision",
    "voir",
}


def _semantic_tokens(value: str) -> set[str]:
    return {
        token
        for token in _normalize_text(value).split()
        if token and token not in SEMANTIC_STOPWORDS and len(token) > 2
    }


def _char_ngrams(value: str, *, size: int = 3) -> set[str]:
    compact_value = _normalize_text(value).replace(" ", "")
    if len(compact_value) < size:
        return {compact_value} if compact_value else set()
    return {compact_value[index : index + size] for index in range(len(compact_value) - size + 1)}


def _jaccard_similarity(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    intersection = len(left & right)
    union = len(left | right)
    if union == 0:
        return 0.0
    return intersection / union


def _semantic_similarity(left: str, right: str) -> float:
    if not left or not right:
        return 0.0
    left_tokens = _semantic_tokens(left)
    right_tokens = _semantic_tokens(right)
    token_score = _jaccard_similarity(left_tokens, right_tokens)
    ngram_score = _jaccard_similarity(_char_ngrams(left), _char_ngrams(right))
    substring_bonus = 0.16 if _normalize_text(left) in _normalize_text(right) or _normalize_text(right) in _normalize_text(left) else 0.0
    if token_score == 0.0 and substring_bonus == 0.0:
        return min(0.18, round(ngram_score * 0.3, 4))
    return min(1.0, round((token_score * 0.68) + (ngram_score * 0.24) + substring_bonus, 4))


def _semantic_profile_score(
    text: str,
    profile: SemanticProfile,
    *,
    direct_weight: float = 2.2,
    example_weight: float = 1.6,
    term_weight: float = 0.45,
) -> float:
    if not text:
        return 0.0
    description_score = _semantic_similarity(text, profile.description) * direct_weight
    example_score = max((_semantic_similarity(text, example) for example in profile.examples), default=0.0) * example_weight
    term_score = _score_lexicon(text, profile.related_terms, term_weight) if profile.related_terms else 0.0
    return description_score + example_score + term_score


def _sorted_positive_scores(scores: dict[str, float]) -> list[tuple[str, float]]:
    return sorted(
        ((key, score) for key, score in scores.items() if score > 0),
        key=lambda item: item[1],
        reverse=True,
    )


def _aggregate_canonical_scores(
    scores: dict[str, float],
    aliases: dict[str, str],
) -> dict[str, float]:
    aggregated_scores: dict[str, float] = defaultdict(float)
    for key, score in scores.items():
        if score <= 0:
            continue
        aggregated_scores[aliases.get(key, key)] += score
    return dict(aggregated_scores)


def _top_ranked_keys(
    ranked_scores: list[tuple[str, float]],
    *,
    limit: int = 3,
    minimum_score: float = 0.55,
    relative_floor: float = 0.52,
) -> tuple[str, ...]:
    if not ranked_scores:
        return ()
    best_score = ranked_scores[0][1]
    retained_keys = [
        key
        for key, score in ranked_scores[:limit]
        if score >= minimum_score and score >= best_score * relative_floor
    ]
    if retained_keys:
        return tuple(retained_keys)
    return (ranked_scores[0][0],)


def _rank_request_type_candidates(
    question: str,
    history: list["ChatContextMessage"],
    entities: list[EntityMatch],
) -> list[tuple[str, float]]:
    question_text = _normalize_text(question)
    history_text = _normalize_text(_history_text(history))
    request_scores = {
        request_type: (
            _score_lexicon(question_text, lexicon, 1.0)
            + _score_lexicon(history_text, lexicon, 0.35)
        )
        for request_type, lexicon in REQUEST_TYPE_LEXICONS.items()
    }
    for request_type, profile in REQUEST_TYPE_SEMANTIC_PROFILES.items():
        request_scores[request_type] = request_scores.get(request_type, 0.0) + _semantic_profile_score(question_text, profile)
        request_scores[request_type] += _semantic_profile_score(
            history_text,
            profile,
            direct_weight=0.9,
            example_weight=0.55,
            term_weight=0.18,
        )

    requested_limit = _extract_requested_limit(question)
    kind_counts: dict[str, int] = defaultdict(int)
    for entity in entities:
        kind_counts[entity.kind] += 1
    explicit_comparison = (
        any(token in question_text for token in ("compare", "comparaison", "versus", "vs"))
        or (kind_counts and max(kind_counts.values()) >= 2)
    )

    if kind_counts and max(kind_counts.values()) >= 2:
        request_scores["comparison"] += 1.6
    if question_text.startswith("pourquoi") or "explique" in question_text:
        request_scores["diagnostic"] += 1.2
    if "que faire" in question_text or "priorite" in question_text:
        request_scores["planning"] += 1.0
        request_scores["recommendation"] += 1.0
    if requested_limit is not None:
        request_scores["top_n"] += 1.4
        request_scores["ranking"] += 1.0
    if (
        re.search(r"\b(le|la)\s+plus\b", question_text)
        or "plus cher" in question_text
        or "plus couteux" in question_text
        or "plus expose" in question_text
        or "plus risque" in question_text
        or "plus consomme" in question_text
    ):
        request_scores["ranking"] += 1.35
        if not explicit_comparison:
            request_scores["comparison"] = max(0.0, request_scores["comparison"] - 0.55)
    if "classement" in question_text or "classer" in question_text:
        request_scores["ranking"] += 1.3
    if "simulation" in question_text or "scenario" in question_text:
        request_scores["simulation"] += 1.2
    if "tendance" in question_text or "evolution" in question_text:
        request_scores["trends"] += 1.2
    if "audit" in question_text or "conformite" in question_text:
        request_scores["audit"] += 1.3
    if "estimation" in question_text or "estimer" in question_text or "estime" in question_text:
        request_scores["estimation"] += 0.4
    if (
        request_scores.get("estimation", 0.0) > 0
        and request_scores.get("forecast", 0.0) > 0
        and "prevision" not in question_text
        and "projection" not in question_text
    ):
        request_scores["estimation"] += 0.25
    if "combien" in question_text and "top" not in question_text:
        request_scores["estimation"] += 0.7
        request_scores["inventory"] += 0.3
    if not explicit_comparison:
        request_scores["comparison"] *= 0.72

    aggregated_scores = _aggregate_canonical_scores(request_scores, REQUEST_TYPE_ALIASES)
    return _sorted_positive_scores(aggregated_scores)


def _rank_primary_domain_candidates(
    question: str,
    history: list["ChatContextMessage"],
    entities: list[EntityMatch],
) -> list[tuple[str, float]]:
    question_text = _normalize_text(question)
    history_text = _normalize_text(_history_text(history))
    domain_scores = {
        domain: _score_lexicon(question_text, lexicon, 1.0) + _score_lexicon(history_text, lexicon, 0.35)
        for domain, lexicon in DOMAIN_LEXICONS.items()
    }
    for domain, profile in DOMAIN_SEMANTIC_PROFILES.items():
        domain_scores[domain] = domain_scores.get(domain, 0.0) + _semantic_profile_score(question_text, profile)
        domain_scores[domain] += _semantic_profile_score(
            history_text,
            profile,
            direct_weight=0.85,
            example_weight=0.45,
            term_weight=0.12,
        )

    if any(entity.kind == "plan" for entity in entities):
        domain_scores["plans"] += 1.0
        domain_scores["consumption"] += 0.4
        domain_scores["budget"] += 0.3
    if any(entity.kind == "line" for entity in entities):
        domain_scores["lines"] += 1.1
        domain_scores["risk"] += 0.3
    if any(entity.kind == "country" for entity in entities):
        domain_scores["roaming"] += 1.2
    if any(entity.kind in {"operator", "department"} for entity in entities):
        domain_scores["budget"] += 0.6
        domain_scores["risk"] += 0.4
    if "departement" in question_text:
        domain_scores["departments"] += 1.2
    if "operateur" in question_text:
        domain_scores["operators"] += 1.2
    if "utilisateur" in question_text or "collaborateur" in question_text:
        domain_scores["users"] += 1.2
    if "kpi" in question_text or "indicateur" in question_text:
        domain_scores["kpi"] += 1.2
    if "inventaire" in question_text:
        domain_scores["inventory"] += 1.2
    if "maintenance" in question_text or "remplacement" in question_text:
        domain_scores["maintenance"] += 1.2
    if "conformite" in question_text or "compliance" in question_text:
        domain_scores["compliance"] += 1.2
    if "pilotage" in question_text or "plan d action" in question_text or "plan d'action" in question_text:
        domain_scores["pilotage"] += 1.2
    if "performance" in question_text or "fleet health" in question_text:
        domain_scores["performance"] += 1.2

    aggregated_scores = _aggregate_canonical_scores(domain_scores, DOMAIN_ALIASES)
    return _sorted_positive_scores(aggregated_scores)


def _infer_detail_level(
    question: str,
    history: list["ChatContextMessage"],
    request_type: str,
    entities: list[EntityMatch],
) -> Literal["executive", "standard", "deep"]:
    question_text = _normalize_text(question)
    history_text = _normalize_text(_history_text(history))
    detail_scores = {
        detail_level: _semantic_profile_score(
            question_text,
            profile,
            direct_weight=1.85,
            example_weight=1.25,
            term_weight=0.32,
        )
        + _semantic_profile_score(
            history_text,
            profile,
            direct_weight=0.6,
            example_weight=0.35,
            term_weight=0.12,
        )
        for detail_level, profile in DETAIL_LEVEL_PROFILES.items()
    }
    detail_scores["standard"] += 0.9
    if request_type in {"comparison", "diagnostic", "audit", "risk_analysis"}:
        detail_scores["deep"] += 0.8
    if request_type in {"summary", "statistics"}:
        detail_scores["executive"] += 0.45
    if request_type in {"planning", "recommendation", "optimization"}:
        detail_scores["standard"] += 0.35
    if len(question_text.split()) >= 14:
        detail_scores["deep"] += 0.25
    if len(entities) >= 2:
        detail_scores["deep"] += 0.35
    return max(detail_scores.items(), key=lambda item: item[1])[0]


def _estimate_source_quality(evidence_volume: int, *, floor: float = 0.46, ceiling: float = 0.94) -> float:
    bounded_ratio = min(1.0, max(0.0, evidence_volume / 24))
    return round(max(floor, min(ceiling, floor + (bounded_ratio * 0.42))), 2)


def _build_reasoning_source_profiles(
    summary: "DataSummary",
    snapshot: BusinessReasoningSnapshot,
    history: list["ChatContextMessage"],
) -> tuple[ReasoningSourceProfile, ...]:
    fleet_evidence = (
        summary.total_lines
        + summary.alert_count
        + len(summary.expensive_operators)
        + len(summary.risky_departments)
        + len(summary.expensive_plans)
    )
    line_evidence = len(snapshot.lines) + summary.active_lines + summary.suspended_lines + summary.free_lines
    plan_evidence = len(snapshot.plans) + summary.over_quota_count + len(summary.expensive_plans)
    equipment_evidence = summary.mobile_device_total + summary.mobile_alert_count + len(snapshot.device_categories)
    fraud_evidence = (
        summary.suspicious_call_count
        + summary.fraud_alert_count
        + summary.roaming_alert_count
        + len(snapshot.countries)
    )
    return (
        ReasoningSourceProfile(
            key="fleet_ai_results_morocco.csv",
            description="Vue consolidee des couts, alertes, projections budgetaires, operateurs, departements et KPI.",
            domains=("budget", "consumption", "performance", "planning", "audit"),
            capabilities=("cost", "alerts", "projection", "operators", "departments", "plans", "kpi", "priority", "trend", "comparison"),
            evidence_volume=fleet_evidence,
            quality_score=_estimate_source_quality(fleet_evidence),
        ),
        ReasoningSourceProfile(
            key="phone_lines",
            description="Etat des lignes, statuts d'occupation, quotas, usages et affectations.",
            domains=("consumption", "plans", "lines", "budget"),
            capabilities=("lines", "status", "usage", "quota", "comparison", "inventory"),
            evidence_volume=line_evidence,
            quality_score=_estimate_source_quality(line_evidence),
        ),
        ReasoningSourceProfile(
            key="plans",
            description="Vue des forfaits, de leur cout moyen, de leur volumetrie et de leur adequation d'usage.",
            domains=("plans", "budget", "consumption"),
            capabilities=("plans", "cost", "quota", "usage", "comparison", "optimization"),
            evidence_volume=plan_evidence,
            quality_score=_estimate_source_quality(plan_evidence),
        ),
        ReasoningSourceProfile(
            key=_mobile_fleet_source_key(),
            description="Inventaire mobile, categories d'equipements, criticite et sante du parc.",
            domains=("equipment", "planning"),
            capabilities=("equipment", "inventory", "health", "renewal", "criticality"),
            evidence_volume=equipment_evidence,
            quality_score=_estimate_source_quality(equipment_evidence),
            available=equipment_evidence > 0,
        ),
        ReasoningSourceProfile(
            key=_cdr_analytics_source_key(),
            description="Signaux de fraude, appels suspects, roaming et geographie de risque.",
            domains=("fraud", "roaming", "audit"),
            capabilities=("suspicious_calls", "roaming", "anomalies", "countries", "alerts", "risk"),
            evidence_volume=fraud_evidence,
            quality_score=_estimate_source_quality(fraud_evidence),
            available=fraud_evidence > 0,
        ),
        ReasoningSourceProfile(
            key="aggregated_kpis",
            description="Vue transversale des indicateurs consolides et des volumes de pilotage.",
            domains=("performance", "budget", "planning"),
            capabilities=("kpi", "counts", "distribution", "comparison", "trend"),
            evidence_volume=summary.total_lines + summary.alert_count,
            quality_score=_estimate_source_quality(summary.total_lines + summary.alert_count, floor=0.5),
        ),
        ReasoningSourceProfile(
            key="comparative_aggregation",
            description="Aggregation comparative multi-perimetre pour arbitrages.",
            domains=("budget", "roaming", "performance"),
            capabilities=("comparison", "operators", "departments", "plans", "countries"),
            evidence_volume=len(snapshot.operators) + len(snapshot.departments) + len(snapshot.plans) + len(snapshot.countries),
            quality_score=_estimate_source_quality(
                len(snapshot.operators) + len(snapshot.departments) + len(snapshot.plans) + len(snapshot.countries),
                floor=0.48,
            ),
        ),
        ReasoningSourceProfile(
            key="decision_prioritization",
            description="Synthese des priorites entre cout, risque, criticite et plan d'action.",
            domains=("planning", "budget", "fraud", "roaming", "equipment", "audit"),
            capabilities=("priority", "decision", "risk", "cost", "alerts"),
            evidence_volume=summary.critical_alert_count + summary.alert_count + summary.budget_alert_count,
            quality_score=_estimate_source_quality(summary.critical_alert_count + summary.alert_count + summary.budget_alert_count, floor=0.52),
        ),
        ReasoningSourceProfile(
            key="conversation_context",
            description="Historique recent pour conserver le contexte implicite de la demande.",
            domains=("planning", "performance", "budget", "audit"),
            capabilities=("context", "decision", "scope"),
            evidence_volume=len(history),
            quality_score=0.62 if history else 0.0,
            available=bool(history),
        ),
    )


def _score_source_profile(
    profile: ReasoningSourceProfile,
    *,
    primary_domain: str,
    secondary_domains: tuple[str, ...],
    request_type: str,
    secondary_request_types: tuple[str, ...],
    strategy_selection: StrategySelection,
    entities: list[EntityMatch],
) -> float:
    if not profile.available:
        return 0.0

    entity_capabilities = {
        "operator": "operators",
        "department": "departments",
        "plan": "plans",
        "country": "countries",
        "line": "lines",
    }
    score = 0.0
    if primary_domain in profile.domains:
        score += 1.25
    score += sum(0.32 for domain in secondary_domains if domain in profile.domains)
    if request_type in profile.capabilities:
        score += 0.7
    score += sum(0.18 for request in secondary_request_types if request in profile.capabilities)
    score += min(
        sum(0.34 for capability in strategy_selection.preferred_capabilities if capability in profile.capabilities),
        1.7,
    )
    if any(entity_capabilities.get(entity.kind) in profile.capabilities for entity in entities):
        score += 0.46
    score += profile.quality_score * 0.85
    score += min(profile.evidence_volume / 20, 1.0) * 0.72
    return round(score, 4)


def _explain_source_selection(
    profile: ReasoningSourceProfile,
    *,
    primary_domain: str,
    strategy_selection: StrategySelection,
) -> str:
    capability_slice = ", ".join(profile.capabilities[:3])
    if primary_domain in profile.domains:
        return f"{profile.key} couvre directement {primary_domain} et apporte {capability_slice}"
    if any(capability in profile.capabilities for capability in strategy_selection.preferred_capabilities[:2]):
        return f"{profile.key} renforce la strategie {strategy_selection.label.lower()} avec {capability_slice}"
    return f"{profile.key} complete la reponse avec {capability_slice}"


def _select_reasoning_sources(
    source_profiles: tuple[ReasoningSourceProfile, ...],
    *,
    primary_domain: str,
    secondary_domains: tuple[str, ...],
    request_type: str,
    secondary_request_types: tuple[str, ...],
    detail_level: Literal["executive", "standard", "deep"],
    strategy_selection: StrategySelection,
    entities: list[EntityMatch],
) -> tuple[SourceSelection, ...]:
    scored_profiles = sorted(
        (
            (
                _score_source_profile(
                    profile,
                    primary_domain=primary_domain,
                    secondary_domains=secondary_domains,
                    request_type=request_type,
                    secondary_request_types=secondary_request_types,
                    strategy_selection=strategy_selection,
                    entities=entities,
                ),
                profile,
            )
            for profile in source_profiles
        ),
        key=lambda item: item[0],
        reverse=True,
    )
    best_score = scored_profiles[0][0] if scored_profiles else 0.0
    selection_limit = 4 if detail_level == "deep" or secondary_domains else 3
    selected: list[SourceSelection] = []
    for score, profile in scored_profiles:
        if score <= 0:
            continue
        if score < 1.05 and selected:
            continue
        if score < best_score * 0.56:
            continue
        selected.append(
            SourceSelection(
                key=profile.key,
                reason=_explain_source_selection(
                    profile,
                    primary_domain=primary_domain,
                    strategy_selection=strategy_selection,
                ),
                confidence=max(0.24, min(0.99, round(0.28 + (score * 0.1), 2))),
            )
        )
        if len(selected) >= selection_limit:
            break
    return tuple(selected[:selection_limit])


def _infer_context_scope(
    entities: list[EntityMatch],
    primary_domain: str,
) -> str:
    if len(entities) >= 2:
        return f"Comparaison ciblee sur {entities[0].label} et {entities[1].label}"
    if entities:
        first_entity = entities[0]
        return f"Perimetre cible: {first_entity.label} ({first_entity.kind})"
    if primary_domain == "planning":
        return "Pilotage transverse de la flotte"
    if primary_domain == "audit":
        return "Revue transverse des controles telecom"
    return "Vue globale de la flotte"


def _build_applied_criteria(
    *,
    primary_domain: str,
    request_type: str,
    selected_sources: tuple[SourceSelection, ...],
    source_profiles: tuple[ReasoningSourceProfile, ...],
    entities: list[EntityMatch],
) -> tuple[str, ...]:
    profile_by_key = {profile.key: profile for profile in source_profiles}
    selected_capabilities: set[str] = set()
    for selection in selected_sources:
        profile = profile_by_key.get(selection.key)
        if profile is not None:
            selected_capabilities.update(profile.capabilities)

    criteria: list[str] = []
    if "cost" in selected_capabilities:
        criteria.append("cout actuel vs projection budgetaire")
    if {"quota", "usage"} & selected_capabilities:
        criteria.append("quota souscrit vs usage reel")
    if "suspicious_calls" in selected_capabilities:
        criteria.append("volume d'appels suspects vs exposition financiere")
    if {"roaming", "countries"} & selected_capabilities:
        criteria.append("geographie roaming vs alertes et signaux associes")
    if {"equipment", "health", "criticality"} & selected_capabilities:
        criteria.append("criticite du parc vs volume d'equipements")
    if request_type == "comparison":
        criteria.append("ecarts relatifs entre perimetres comparables")
    if request_type in {"audit", "diagnostic", "risk_analysis"}:
        criteria.append("coherence entre alertes, usages et signaux de risque")
    if request_type in {"forecast", "estimation", "simulation", "trends"}:
        criteria.append("projection prudente a partir des signaux deja visibles")
    if entities:
        criteria.append(f"priorisation sur {', '.join(entity.label for entity in entities[:2])}")
    if primary_domain == "performance":
        criteria.append("lecture croisee des KPI, volumes et alertes")

    deduped_criteria: list[str] = []
    seen_criteria: set[str] = set()
    for criterion in criteria:
        normalized_criterion = _normalize_text(criterion)
        if not normalized_criterion or normalized_criterion in seen_criteria:
            continue
        seen_criteria.add(normalized_criterion)
        deduped_criteria.append(criterion)
    return tuple(deduped_criteria[:4])


def _score_strategy_definition(
    definition: StrategyDefinition,
    *,
    question_text: str,
    history_text: str,
    primary_domain: str,
    secondary_domains: tuple[str, ...],
    request_type: str,
    secondary_request_types: tuple[str, ...],
    detail_level: Literal["executive", "standard", "deep"],
    entities: list[EntityMatch],
    source_profiles: tuple[ReasoningSourceProfile, ...],
) -> float:
    semantic_score = _semantic_similarity(question_text, definition.description) * 2.5
    semantic_score += max((_semantic_similarity(question_text, example) for example in definition.examples), default=0.0) * 1.9
    semantic_score += max((_semantic_similarity(history_text, example) for example in definition.examples), default=0.0) * 0.55
    request_score = 0.95 if request_type in definition.preferred_request_types else 0.0
    request_score += sum(0.18 for request in secondary_request_types if request in definition.preferred_request_types)
    domain_score = 0.95 if primary_domain in definition.preferred_domains else 0.0
    domain_score += sum(0.22 for domain in secondary_domains if domain in definition.preferred_domains)
    detail_score = 0.48 if detail_level in definition.preferred_detail_levels else 0.0
    entity_score = 0.52 if any(entity.kind in definition.preferred_entity_kinds for entity in entities) else 0.0

    relevant_capabilities: set[str] = set()
    for profile in source_profiles:
        if not profile.available:
            continue
        if primary_domain in profile.domains or any(domain in profile.domains for domain in secondary_domains):
            relevant_capabilities.update(profile.capabilities)
    capability_score = min(
        sum(0.24 for capability in definition.preferred_capabilities if capability in relevant_capabilities),
        1.5,
    )
    return semantic_score + request_score + domain_score + detail_score + entity_score + capability_score


def _build_strategy_confidence(best_score: float, second_score: float) -> float:
    score_gap = max(0.0, best_score - second_score)
    return max(0.22, min(0.99, round(0.34 + (best_score * 0.08) + (score_gap * 0.16), 2)))


def _fallback_strategy_definition(
    primary_domain: str,
    request_type: str,
) -> StrategyDefinition:
    if request_type == "comparison":
        return next(definition for definition in STRATEGY_DEFINITIONS if definition.key == "comparative_analysis")
    if request_type in {"forecast", "estimation", "simulation", "trends"}:
        return next(definition for definition in STRATEGY_DEFINITIONS if definition.key == "forecast_projection")
    if request_type == "inventory" or primary_domain in {"equipment", "lines"}:
        return next(definition for definition in STRATEGY_DEFINITIONS if definition.key == "inventory_health")
    if request_type == "audit" or primary_domain == "audit":
        return next(definition for definition in STRATEGY_DEFINITIONS if definition.key == "compliance_review")
    if request_type in {"planning", "ranking"} or primary_domain == "planning":
        return next(definition for definition in STRATEGY_DEFINITIONS if definition.key == "action_prioritization")
    if primary_domain in {"fraud", "roaming"} or request_type == "risk_analysis":
        return next(definition for definition in STRATEGY_DEFINITIONS if definition.key == "risk_investigation")
    if request_type == "statistics" or primary_domain == "performance":
        return next(definition for definition in STRATEGY_DEFINITIONS if definition.key == "statistical_overview")
    if request_type in {"optimization", "recommendation"}:
        return next(definition for definition in STRATEGY_DEFINITIONS if definition.key == "optimization_plan")
    return next(definition for definition in STRATEGY_DEFINITIONS if definition.key == "executive_summary")


def _select_strategy(
    question: str,
    history: list["ChatContextMessage"],
    *,
    primary_domain: str,
    secondary_domains: tuple[str, ...],
    request_type: str,
    secondary_request_types: tuple[str, ...],
    detail_level: Literal["executive", "standard", "deep"],
    entities: list[EntityMatch],
    source_profiles: tuple[ReasoningSourceProfile, ...],
) -> StrategySelection:
    question_text = _normalize_text(question)
    history_text = _normalize_text(_history_text(history))
    scored_strategies = sorted(
        (
            (
                _score_strategy_definition(
                    definition,
                    question_text=question_text,
                    history_text=history_text,
                    primary_domain=primary_domain,
                    secondary_domains=secondary_domains,
                    request_type=request_type,
                    secondary_request_types=secondary_request_types,
                    detail_level=detail_level,
                    entities=entities,
                    source_profiles=source_profiles,
                ),
                definition,
            )
            for definition in STRATEGY_DEFINITIONS
        ),
        key=lambda item: item[0],
        reverse=True,
    )
    best_score, best_definition = scored_strategies[0]
    second_score = scored_strategies[1][0] if len(scored_strategies) > 1 else 0.0
    if best_score < 1.3:
        fallback_definition = _fallback_strategy_definition(primary_domain, request_type)
        return StrategySelection(
            key=fallback_definition.key,
            label=fallback_definition.label,
            objective=fallback_definition.objective,
            response_shape=fallback_definition.response_shape,
            confidence=max(0.38, round(_build_strategy_confidence(best_score, second_score) - 0.08, 2)),
            preferred_intents=fallback_definition.preferred_intents,
            preferred_capabilities=fallback_definition.preferred_capabilities,
            reason="strategie selectionnee par proximitie entre l'objectif, le domaine et le type de decision demande",
        )

    return StrategySelection(
        key=best_definition.key,
        label=best_definition.label,
        objective=best_definition.objective,
        response_shape=best_definition.response_shape,
        confidence=_build_strategy_confidence(best_score, second_score),
        preferred_intents=best_definition.preferred_intents,
        preferred_capabilities=best_definition.preferred_capabilities,
        reason="strategie retenue pour son alignement avec l'objectif implicite, le niveau de detail et les donnees disponibles",
    )


def _infer_data_gaps(
    question: str,
    *,
    primary_domain: str,
    request_type: str,
    selected_sources: tuple[SourceSelection, ...],
    source_profiles: tuple[ReasoningSourceProfile, ...],
    entities: list[EntityMatch],
    summary: "DataSummary",
) -> tuple[str, ...]:
    profile_by_key = {profile.key: profile for profile in source_profiles}
    coverage_terms: set[str] = set()
    for selection in selected_sources:
        profile = profile_by_key.get(selection.key)
        if profile is None:
            continue
        coverage_terms.update(profile.domains)
        coverage_terms.update(profile.capabilities)
        coverage_terms.update(_semantic_tokens(profile.description))

    entity_tokens = {
        token
        for entity in entities
        for token in _semantic_tokens(entity.label)
    }
    focus_tokens = [
        token
        for token in _semantic_tokens(question)
        if token not in NON_DATA_FOCUS_TOKENS and token not in entity_tokens and len(token) >= 4
    ]
    missing_tokens: list[str] = []
    for token in focus_tokens:
        if any(
            token == coverage
            or token.rstrip("s") == coverage.rstrip("s")
            or _semantic_similarity(token, coverage) >= 0.76
            for coverage in coverage_terms
        ):
            continue
        missing_tokens.append(token)

    gaps: list[str] = []
    if not selected_sources:
        gaps.append("Aucune source specialisee n'a pu etre retenue avec suffisamment de confiance.")
    if primary_domain == "general":
        gaps.append("La demande ne se rattache pas clairement a un domaine couvert; la lecture repose sur la synthese disponible.")
    if request_type in {"forecast", "estimation", "simulation", "trends"} and summary.projected_monthly_cost_mad <= 0:
        gaps.append("La projection exploite peu de signaux prospectifs natifs; elle reste prudente.")
    if primary_domain == "equipment" and summary.mobile_device_total <= 0:
        gaps.append("Le parc equipement est faiblement documente dans les donnees actuellement chargees.")
    if missing_tokens:
        gaps.append(
            f"Les sources actuelles ne documentent pas explicitement: {', '.join(missing_tokens[:2])}."
        )

    deduped_gaps: list[str] = []
    seen_gaps: set[str] = set()
    for gap in gaps:
        normalized_gap = _normalize_text(gap)
        if not normalized_gap or normalized_gap in seen_gaps:
            continue
        seen_gaps.add(normalized_gap)
        deduped_gaps.append(gap)
    return tuple(deduped_gaps[:2])


def _understand_business_question(
    question: str,
    history: list["ChatContextMessage"],
    summary: "DataSummary",
    snapshot: BusinessReasoningSnapshot,
    entities: list[EntityMatch],
) -> BusinessQuestionUnderstanding:
    ranked_domains = _rank_primary_domain_candidates(question, history, entities)
    ranked_request_types = _rank_request_type_candidates(question, history, entities)

    primary_domain = ranked_domains[0][0] if ranked_domains else "general"
    request_type = ranked_request_types[0][0] if ranked_request_types else "summary"
    secondary_domains = tuple(
        domain
        for domain in _top_ranked_keys(ranked_domains, limit=3)
        if domain != primary_domain
    )
    secondary_request_types = tuple(
        candidate
        for candidate in _top_ranked_keys(ranked_request_types, limit=3)
        if candidate != request_type
    )
    detail_level = _infer_detail_level(question, history, request_type, entities)
    context_scope = _infer_context_scope(entities, primary_domain)
    source_profiles = _build_reasoning_source_profiles(summary, snapshot, history)
    strategy_selection = _select_strategy(
        question,
        history,
        primary_domain=primary_domain,
        secondary_domains=secondary_domains,
        request_type=request_type,
        secondary_request_types=secondary_request_types,
        detail_level=detail_level,
        entities=entities,
        source_profiles=source_profiles,
    )
    source_selection = _select_reasoning_sources(
        source_profiles,
        primary_domain=primary_domain,
        secondary_domains=secondary_domains,
        request_type=request_type,
        secondary_request_types=secondary_request_types,
        detail_level=detail_level,
        strategy_selection=strategy_selection,
        entities=entities,
    )
    applied_criteria = _build_applied_criteria(
        primary_domain=primary_domain,
        request_type=request_type,
        selected_sources=source_selection,
        source_profiles=source_profiles,
        entities=entities,
    )
    data_gaps = _infer_data_gaps(
        question,
        primary_domain=primary_domain,
        request_type=request_type,
        selected_sources=source_selection,
        source_profiles=source_profiles,
        entities=entities,
        summary=summary,
    )
    uncovered_gap_detected = any("ne documentent pas explicitement" in gap for gap in data_gaps)
    if uncovered_gap_detected and not entities and strategy_selection.confidence <= 0.58:
        fallback_strategy = _fallback_strategy_definition("general", "summary")
        return BusinessQuestionUnderstanding(
            primary_domain="general",
            secondary_domains=(),
            request_type="summary",
            secondary_request_types=(),
            detail_level=detail_level,
            context_scope="Vue globale de la flotte",
            business_goal="produire la meilleure lecture possible a partir de la synthese disponible en l'absence de couverture specialisee",
            analysis_strategy=fallback_strategy.key,
            strategy_label=fallback_strategy.label,
            strategy_confidence=0.38,
            selected_sources=("fleet_ai_results_morocco.csv", "aggregated_kpis"),
            source_reasons=(
                "fleet_ai_results_morocco.csv apporte la synthese la plus large disponible",
                "aggregated_kpis apporte une lecture transversale des volumes visibles",
            ),
            applied_criteria=("lecture prudente des couts, alertes et volumes disponibles",),
            data_gaps=data_gaps,
        )
    return BusinessQuestionUnderstanding(
        primary_domain=primary_domain,
        secondary_domains=secondary_domains,
        request_type=request_type,
        secondary_request_types=secondary_request_types,
        detail_level=detail_level,
        context_scope=context_scope,
        business_goal=strategy_selection.objective,
        analysis_strategy=strategy_selection.key,
        strategy_label=strategy_selection.label,
        strategy_confidence=strategy_selection.confidence,
        selected_sources=tuple(selection.key for selection in source_selection),
        source_reasons=tuple(selection.reason for selection in source_selection),
        applied_criteria=applied_criteria,
        data_gaps=data_gaps,
    )


def _append_reasoning_trace_block(
    answer: str,
    *,
    understanding: BusinessQuestionUnderstanding,
) -> str:
    detail_labels = {
        "executive": "Executif",
        "standard": "Standard",
        "deep": "Detaille",
    }
    trace_lines = [
        f"Objectif decisionnel: {understanding.business_goal}",
        f"Strategie retenue: {understanding.strategy_label}",
        f"Niveau de detail: {detail_labels.get(understanding.detail_level, understanding.detail_level)}",
        f"Perimetre: {understanding.context_scope}",
        f"Sources mobilisees: {', '.join(understanding.selected_sources) if understanding.selected_sources else 'synthese disponible uniquement'}",
    ]
    if understanding.applied_criteria:
        trace_lines.append(f"Criteres appliques: {'; '.join(understanding.applied_criteria)}")
    if len(understanding.selected_sources) > 1 and understanding.source_reasons:
        trace_lines.append(f"Fusion des sources: {' | '.join(understanding.source_reasons[:2])}")
    if understanding.data_gaps:
        trace_lines.append(f"Donnees partielles: {understanding.data_gaps[0]}")
    return f"{answer}\n\nCadre d'analyse\n" + "\n".join(trace_lines)


def _build_scope_metric(accumulator: dict[str, float | int | str]) -> ScopedReasoningMetric:
    risk_count = float(accumulator["risk_count"])
    line_count = int(max(accumulator["live_line_count"], accumulator["observed_line_count"]))
    return ScopedReasoningMetric(
        label=str(accumulator["label"]),
        monthly_cost_mad=float(accumulator["monthly_cost_mad"]),
        projected_monthly_cost_mad=float(accumulator["projected_monthly_cost_mad"]),
        risk_score=(float(accumulator["risk_sum"]) / risk_count) if risk_count else 0.0,
        alert_count=int(accumulator["alert_count"]),
        line_count=line_count,
        over_quota_count=int(accumulator["over_quota_count"]),
        anomaly_count=int(accumulator["anomaly_count"]),
        roaming_count=int(accumulator["roaming_count"]),
        suspicious_call_count=int(accumulator["suspicious_call_count"]),
        suspicious_call_cost_mad=float(accumulator["suspicious_call_cost_mad"]),
        equipment_alert_count=int(accumulator["equipment_alert_count"]),
    )


def _build_plan_metric(accumulator: dict[str, float | int | str]) -> PlanReasoningMetric:
    usage_count = float(accumulator["usage_count"])
    line_count = int(max(accumulator["live_line_count"], accumulator["observed_line_count"]))
    average_cost = (
        float(accumulator["total_cost_mad"]) / line_count
        if line_count
        else float(accumulator["average_cost_mad"])
    )
    return PlanReasoningMetric(
        label=str(accumulator["label"]),
        operator=str(accumulator["operator"]),
        average_cost_mad=average_cost,
        total_cost_mad=float(accumulator["total_cost_mad"]),
        line_count=line_count,
        alert_count=int(accumulator["alert_count"]),
        over_quota_count=int(accumulator["over_quota_count"]),
        average_usage_ratio=(float(accumulator["usage_ratio_sum"]) / usage_count) if usage_count else 0.0,
    )


def _empty_scope_accumulator(label: str) -> dict[str, float | int | str]:
    return {
        "label": label,
        "monthly_cost_mad": 0.0,
        "projected_monthly_cost_mad": 0.0,
        "risk_sum": 0.0,
        "risk_count": 0.0,
        "alert_count": 0,
        "observed_line_count": 0,
        "live_line_count": 0,
        "over_quota_count": 0,
        "anomaly_count": 0,
        "roaming_count": 0,
        "suspicious_call_count": 0,
        "suspicious_call_cost_mad": 0.0,
        "equipment_alert_count": 0,
    }


def _empty_plan_accumulator(label: str, operator: str) -> dict[str, float | int | str]:
    return {
        "label": label,
        "operator": operator,
        "average_cost_mad": 0.0,
        "total_cost_mad": 0.0,
        "observed_line_count": 0,
        "live_line_count": 0,
        "alert_count": 0,
        "over_quota_count": 0,
        "usage_ratio_sum": 0.0,
        "usage_count": 0.0,
    }


def _build_plan_price_map(plans: list[Plan]) -> dict[tuple[str, str], float]:
    plan_price_map: dict[tuple[str, str], float] = {}
    for plan in plans:
        key = (_normalize_text(plan.operator_name), _normalize_text(plan.name))
        plan_price_map[key] = float(plan.monthly_price)
    return plan_price_map


def _snapshot_keyed_label(value: str) -> str:
    return _normalize_text(value)


def _build_snapshot(summary: "DataSummary", db: Session) -> BusinessReasoningSnapshot:
    fleet_rows = _read_csv_rows(_resolve_fleet_results_file())
    mobile_rows = _read_csv_rows(_resolve_mobile_fleet_file(), allow_missing=True)
    fraud_rows = _read_csv_rows(_resolve_fraud_results_file(), allow_missing=True)
    phone_lines = list(db.scalars(select(PhoneLine)))
    plans = list(db.scalars(select(Plan)))
    plan_price_map = _build_plan_price_map(plans)

    operator_accumulators: dict[str, dict[str, float | int | str]] = {}
    department_accumulators: dict[str, dict[str, float | int | str]] = {}
    plan_accumulators: dict[str, dict[str, float | int | str]] = {}
    country_accumulators: dict[str, dict[str, float | int | str]] = {}
    line_metrics: dict[str, LineReasoningMetric] = {}
    device_category_accumulators: dict[str, dict[str, float | int | str]] = {}

    def get_scope_accumulator(
        collection: dict[str, dict[str, float | int | str]],
        label: str,
    ) -> dict[str, float | int | str]:
        key = _snapshot_keyed_label(label)
        if key not in collection:
            collection[key] = _empty_scope_accumulator(label)
        return collection[key]

    for row in fleet_rows:
        operator = _clean_label(row.get("operator"))
        department = _clean_label(row.get("department"), "Sans departement")
        plan = _clean_label(row.get("plan"))
        monthly_cost = _to_float(row.get("monthly_cost_mad"))
        projected_cost = _to_float(row.get("future_cost_pred_mad") or row.get("future_cost_mad"))
        risk_score = _to_float(row.get("risk_score_100"))
        is_alert = _is_truthy_flag(row.get("alert_flag"))
        is_over_quota = _is_truthy_flag(row.get("over_quota_flag"))
        is_anomaly = _is_truthy_flag(row.get("anomaly_flag"))
        is_roaming = _is_truthy_flag(row.get("roaming_flag"))
        usage_gb = _to_float(row.get("data_usage_gb"))
        quota_gb = _to_float(row.get("quota_gb"))

        for label, collection in (
            (operator, operator_accumulators),
            (department, department_accumulators),
        ):
            accumulator = get_scope_accumulator(collection, label)
            accumulator["monthly_cost_mad"] = float(accumulator["monthly_cost_mad"]) + monthly_cost
            accumulator["projected_monthly_cost_mad"] = (
                float(accumulator["projected_monthly_cost_mad"]) + projected_cost
            )
            accumulator["risk_sum"] = float(accumulator["risk_sum"]) + risk_score
            accumulator["risk_count"] = float(accumulator["risk_count"]) + 1
            accumulator["alert_count"] = int(accumulator["alert_count"]) + int(is_alert or is_over_quota or is_anomaly)
            accumulator["observed_line_count"] = int(accumulator["observed_line_count"]) + 1
            accumulator["over_quota_count"] = int(accumulator["over_quota_count"]) + int(is_over_quota)
            accumulator["anomaly_count"] = int(accumulator["anomaly_count"]) + int(is_anomaly)
            accumulator["roaming_count"] = int(accumulator["roaming_count"]) + int(is_roaming)

        plan_key = f"{_snapshot_keyed_label(operator)}::{_snapshot_keyed_label(plan)}"
        if plan_key not in plan_accumulators:
            plan_accumulators[plan_key] = _empty_plan_accumulator(plan, operator)
        plan_accumulator = plan_accumulators[plan_key]
        plan_accumulator["average_cost_mad"] = float(plan_accumulator["average_cost_mad"]) + monthly_cost
        plan_accumulator["total_cost_mad"] = float(plan_accumulator["total_cost_mad"]) + monthly_cost
        plan_accumulator["observed_line_count"] = int(plan_accumulator["observed_line_count"]) + 1
        plan_accumulator["alert_count"] = int(plan_accumulator["alert_count"]) + int(is_alert or is_over_quota)
        plan_accumulator["over_quota_count"] = int(plan_accumulator["over_quota_count"]) + int(is_over_quota)
        if quota_gb > 0:
            plan_accumulator["usage_ratio_sum"] = float(plan_accumulator["usage_ratio_sum"]) + (usage_gb / quota_gb)
            plan_accumulator["usage_count"] = float(plan_accumulator["usage_count"]) + 1

    for row in mobile_rows:
        operator = _clean_label(row.get("operator"))
        department = _clean_label(row.get("department"), "Sans departement")
        device_category = _clean_label(row.get("device_category"), "Non renseigne")
        risk_score = _to_float(row.get("budget_risk_score"))
        is_alert = _is_truthy_flag(row.get("alert_flag"))
        estimated_price_mad = _to_float(row.get("estimated_price_mad"))
        risk_level = _normalize_text(row.get("risk_level"))

        for label, collection in (
            (operator, operator_accumulators),
            (department, department_accumulators),
        ):
            accumulator = get_scope_accumulator(collection, label)
            accumulator["risk_sum"] = float(accumulator["risk_sum"]) + risk_score
            accumulator["risk_count"] = float(accumulator["risk_count"]) + 1
            accumulator["alert_count"] = int(accumulator["alert_count"]) + int(is_alert)
            accumulator["equipment_alert_count"] = int(accumulator["equipment_alert_count"]) + int(is_alert)

        device_key = _snapshot_keyed_label(device_category)
        if device_key not in device_category_accumulators:
            device_category_accumulators[device_key] = {
                "label": device_category,
                "estimated_cost_mad": 0.0,
                "risk_sum": 0.0,
                "risk_count": 0.0,
                "alert_count": 0,
                "critical_count": 0,
                "device_count": 0,
            }
        device_accumulator = device_category_accumulators[device_key]
        device_accumulator["estimated_cost_mad"] = (
            float(device_accumulator["estimated_cost_mad"]) + estimated_price_mad
        )
        device_accumulator["risk_sum"] = float(device_accumulator["risk_sum"]) + risk_score
        device_accumulator["risk_count"] = float(device_accumulator["risk_count"]) + 1
        device_accumulator["alert_count"] = int(device_accumulator["alert_count"]) + int(is_alert)
        device_accumulator["critical_count"] = int(device_accumulator["critical_count"]) + int(
            is_alert and (risk_level in {"eleve", "critical", "critique"} or risk_score >= 75)
        )
        device_accumulator["device_count"] = int(device_accumulator["device_count"]) + 1

    for row in fraud_rows:
        operator = _clean_label(row.get("operator_maroc"))
        department = _clean_label(row.get("department"), "Sans departement")
        call_cost_mad = _to_float(row.get("call_cost_mad"))
        fraud_risk_score = _to_float(row.get("fraud_risk_score_100"))
        is_fraud_flag = _is_truthy_flag(row.get("fraud_flag"))
        is_high_cost_flag = _is_truthy_flag(row.get("high_cost_flag"))
        is_roaming_flag = _is_truthy_flag(row.get("roaming_flag")) or _normalize_text(row.get("call_zone")) == "roaming"
        is_suspicious = is_fraud_flag or is_high_cost_flag

        for label, collection in (
            (operator, operator_accumulators),
            (department, department_accumulators),
        ):
            accumulator = get_scope_accumulator(collection, label)
            accumulator["risk_sum"] = float(accumulator["risk_sum"]) + fraud_risk_score
            accumulator["risk_count"] = float(accumulator["risk_count"]) + 1
            accumulator["alert_count"] = int(accumulator["alert_count"]) + int(is_suspicious)
            accumulator["roaming_count"] = int(accumulator["roaming_count"]) + int(is_roaming_flag)
            accumulator["suspicious_call_count"] = int(accumulator["suspicious_call_count"]) + int(is_suspicious)
            if is_suspicious:
                accumulator["suspicious_call_cost_mad"] = (
                    float(accumulator["suspicious_call_cost_mad"]) + call_cost_mad
                )

        if is_roaming_flag:
            country = _clean_label(
                row.get("country_dest") or row.get("country_origin"),
                "Inconnu",
            )
            country_key = _snapshot_keyed_label(country)
            if country_key not in country_accumulators:
                country_accumulators[country_key] = {
                    "label": country,
                    "total_cost_mad": 0.0,
                    "alert_count": 0,
                    "suspicious_call_count": 0,
                    "event_count": 0,
                }
            country_accumulator = country_accumulators[country_key]
            country_accumulator["total_cost_mad"] = float(country_accumulator["total_cost_mad"]) + call_cost_mad
            country_accumulator["event_count"] = int(country_accumulator["event_count"]) + 1
            country_accumulator["alert_count"] = int(country_accumulator["alert_count"]) + int(is_suspicious)
            country_accumulator["suspicious_call_count"] = (
                int(country_accumulator["suspicious_call_count"]) + int(is_suspicious)
            )

    for phone_line in phone_lines:
        operator = _clean_label(phone_line.operator_name)
        department = _clean_label(phone_line.department, "Sans departement")
        plan_name = _clean_label(phone_line.plan_name)
        status = compute_occupation_status(phone_line)
        monthly_cost_mad = plan_price_map.get(
            (_snapshot_keyed_label(operator), _snapshot_keyed_label(plan_name)),
            0.0,
        )
        usage_ratio = (
            float(phone_line.current_data_usage_gb) / float(phone_line.monthly_limit)
            if phone_line.monthly_limit not in (None, 0)
            else None
        )
        risk_score = min(
            100.0,
            round(
                (usage_ratio or 0.0) * 70
                + (18 if phone_line.status == "suspended" else 0)
                + (10 if phone_line.status == "inactive" else 0),
                1,
            ),
        )

        for label, collection in (
            (operator, operator_accumulators),
            (department, department_accumulators),
        ):
            accumulator = get_scope_accumulator(collection, label)
            accumulator["live_line_count"] = int(accumulator["live_line_count"]) + 1

        plan_key = f"{_snapshot_keyed_label(operator)}::{_snapshot_keyed_label(plan_name)}"
        if plan_key not in plan_accumulators:
            plan_accumulators[plan_key] = _empty_plan_accumulator(plan_name, operator)
        plan_accumulator = plan_accumulators[plan_key]
        plan_accumulator["total_cost_mad"] = float(plan_accumulator["total_cost_mad"]) + monthly_cost_mad
        plan_accumulator["live_line_count"] = int(plan_accumulator["live_line_count"]) + 1
        if usage_ratio is not None:
            plan_accumulator["usage_ratio_sum"] = float(plan_accumulator["usage_ratio_sum"]) + usage_ratio
            plan_accumulator["usage_count"] = float(plan_accumulator["usage_count"]) + 1

        line_metrics[_snapshot_keyed_label(phone_line.phone_number)] = LineReasoningMetric(
            label=phone_line.phone_number,
            operator=operator,
            department=department,
            plan=plan_name,
            status=status,
            monthly_cost_mad=monthly_cost_mad,
            risk_score=risk_score,
            usage_gb=float(phone_line.current_data_usage_gb),
            quota_gb=float(phone_line.monthly_limit) if phone_line.monthly_limit is not None else None,
            roaming=False,
        )

    return BusinessReasoningSnapshot(
        operators={
            key: _build_scope_metric(value)
            for key, value in sorted(operator_accumulators.items())
        },
        departments={
            key: _build_scope_metric(value)
            for key, value in sorted(department_accumulators.items())
        },
        plans={
            key: _build_plan_metric(value)
            for key, value in sorted(plan_accumulators.items())
        },
        countries={
            key: CountryReasoningMetric(
                label=str(value["label"]),
                total_cost_mad=float(value["total_cost_mad"]),
                alert_count=int(value["alert_count"]),
                suspicious_call_count=int(value["suspicious_call_count"]),
                event_count=int(value["event_count"]),
            )
            for key, value in sorted(country_accumulators.items())
        },
        lines=line_metrics,
        device_categories={
            key: DeviceCategoryReasoningMetric(
                label=str(value["label"]),
                estimated_cost_mad=float(value["estimated_cost_mad"]),
                average_risk_score=(
                    float(value["risk_sum"]) / float(value["risk_count"])
                    if float(value["risk_count"])
                    else 0.0
                ),
                alert_count=int(value["alert_count"]),
                critical_count=int(value["critical_count"]),
                device_count=int(value["device_count"]),
            )
            for key, value in sorted(device_category_accumulators.items())
        },
    )


def _get_snapshot(summary: "DataSummary", db: Session) -> BusinessReasoningSnapshot:
    global _REASONING_SNAPSHOT_CACHE, _REASONING_SNAPSHOT_SIGNATURE

    if _REASONING_SNAPSHOT_CACHE is not None and _REASONING_SNAPSHOT_SIGNATURE == summary.signature:
        return _REASONING_SNAPSHOT_CACHE

    snapshot = _build_snapshot(summary, db)
    _REASONING_SNAPSHOT_CACHE = snapshot
    _REASONING_SNAPSHOT_SIGNATURE = summary.signature
    return snapshot


def _extract_entities(
    question: str,
    history: list["ChatContextMessage"],
    snapshot: BusinessReasoningSnapshot,
) -> list[EntityMatch]:
    question_text = _normalize_text(question)
    history_text = _normalize_text(_history_text(history))
    collected: dict[tuple[str, str], EntityMatch] = {}

    def register_matches(
        candidates: dict[str, object],
        kind: Literal["operator", "department", "plan", "country", "line"],
        current_score: float,
        historical_score: float,
        *,
        minimum_length: int = 2,
    ) -> None:
        for normalized_label, candidate in candidates.items():
            label = getattr(candidate, "label")
            normalized_candidate = _normalize_text(label)
            if len(normalized_candidate) < minimum_length:
                continue
            matched_score = 0.0
            if _contains_candidate(question_text, normalized_candidate):
                matched_score = current_score
            elif history_text and _contains_candidate(history_text, normalized_candidate):
                matched_score = historical_score
            if matched_score <= 0:
                continue
            key = (kind, normalized_candidate)
            previous_match = collected.get(key)
            if previous_match is None or matched_score > previous_match.score:
                collected[key] = EntityMatch(kind=kind, label=label, score=matched_score)

    register_matches(snapshot.operators, "operator", 1.0, 0.45, minimum_length=3)
    register_matches(snapshot.departments, "department", 1.0, 0.45, minimum_length=2)
    register_matches(snapshot.plans, "plan", 0.92, 0.4, minimum_length=3)
    register_matches(snapshot.countries, "country", 0.88, 0.35, minimum_length=2)
    register_matches(snapshot.lines, "line", 1.0, 0.3, minimum_length=8)

    return sorted(collected.values(), key=lambda match: (-match.score, match.label))


def _extract_requested_limit(question: str) -> int | None:
    normalized_question = _normalize_text(question)
    top_match = re.search(r"\btop\s+(\d{1,2})\b", normalized_question)
    if top_match is not None:
        return max(1, min(int(top_match.group(1)), 10))

    first_number_match = re.search(r"\b(\d{1,2})\b", normalized_question)
    if first_number_match is not None and any(
        keyword in normalized_question for keyword in ("top", "classement", "classer", "premiers", "plus")
    ):
        return max(1, min(int(first_number_match.group(1)), 10))

    return None


def _canonicalize_request_type(request_type: str) -> str:
    return REQUEST_TYPE_ALIASES.get(request_type, request_type)


def _detect_request_type(
    question: str,
    history: list["ChatContextMessage"],
    entities: list[EntityMatch],
) -> tuple[str, int | None]:
    requested_limit = _extract_requested_limit(question)
    ranked_request_types = _rank_request_type_candidates(question, history, entities)
    if not ranked_request_types:
        return "summary", requested_limit
    return ranked_request_types[0][0], requested_limit


def _detect_primary_domain(
    question: str,
    history: list["ChatContextMessage"],
    entities: list[EntityMatch],
) -> str:
    ranked_domains = _rank_primary_domain_candidates(question, history, entities)
    if not ranked_domains:
        return "general"
    return ranked_domains[0][0]


def _select_sources(
    primary_domain: str,
    request_type: str,
    history: list["ChatContextMessage"],
) -> list[str]:
    sources: list[str] = []

    def add_source(label: str) -> None:
        if label not in sources:
            sources.append(label)

    if primary_domain in {
        "general",
        "budget",
        "consumption",
        "plans",
        "lines",
        "risk",
        "performance",
        "operators",
        "departments",
        "users",
        "audit",
    }:
        add_source("fleet_ai_results_morocco.csv")
        add_source("phone_lines")
        add_source("plans")

    if primary_domain in {"equipment", "maintenance", "inventory", "users"}:
        add_source(_mobile_fleet_source_key())

    if primary_domain in {"fraud", "roaming", "risk", "audit"}:
        add_source(_cdr_analytics_source_key())

    if request_type == "comparison":
        add_source("comparative_aggregation")
    if request_type in {"ranking", "statistics"}:
        add_source("aggregated_kpis")
    if request_type == "planning":
        add_source("decision_prioritization")
    if history:
        add_source("conversation_context")

    return sources


def _score_intent_definition(
    definition: IntentDefinition,
    *,
    question_text: str,
    history_text: str,
    primary_domain: str,
    request_type: str,
    entities: list[EntityMatch],
    strategy_hint: str | None = None,
    preferred_intents: tuple[str, ...] = (),
    secondary_domains: tuple[str, ...] = (),
    secondary_request_types: tuple[str, ...] = (),
) -> float:
    lexical_score = _score_lexicon(question_text, definition.keywords, 1.15) + _score_lexicon(
        history_text,
        definition.keywords,
        0.35,
    )
    semantic_examples = [
        _semantic_similarity(question_text, example)
        for example in definition.examples
    ]
    semantic_score = (max(semantic_examples) if semantic_examples else 0.0) * 3.1
    history_semantic_examples = [
        _semantic_similarity(history_text, example)
        for example in definition.examples
    ]
    semantic_score += (max(history_semantic_examples) if history_semantic_examples else 0.0) * 0.9

    domain_score = 0.85 if primary_domain in definition.domain_hints else 0.0
    request_score = 0.75 if request_type in definition.request_hints else 0.0
    entity_score = 0.55 if any(entity.kind in definition.entity_kinds for entity in entities) else 0.0
    secondary_domain_score = 0.24 if any(domain in definition.domain_hints for domain in secondary_domains) else 0.0
    secondary_request_score = 0.18 if any(request in definition.request_hints for request in secondary_request_types) else 0.0
    strategy_score = 0.72 if definition.key in preferred_intents else 0.0
    if strategy_hint == "inventory_health" and definition.key in {"equipment", "maintenance", "consumption"}:
        strategy_score += 0.22
    if strategy_hint == "risk_investigation" and definition.key in {"fraud", "suspicious_calls", "roaming", "audit", "compliance"}:
        strategy_score += 0.24
    if strategy_hint == "forecast_projection" and definition.key in {"forecasts", "trends", "potential_savings"}:
        strategy_score += 0.2
    multi_word_bonus = 0.0
    for keyword in definition.keywords:
        normalized_keyword = _normalize_text(keyword)
        if " " in normalized_keyword and _contains_candidate(question_text, normalized_keyword):
            multi_word_bonus += 0.2

    return (
        lexical_score
        + semantic_score
        + domain_score
        + request_score
        + entity_score
        + secondary_domain_score
        + secondary_request_score
        + strategy_score
        + min(multi_word_bonus, 0.6)
    )


def _resolve_intent_request_type(
    definition: IntentDefinition,
    detected_request_type: str,
) -> str:
    if definition.key == "prioritization" and detected_request_type == "planning":
        return definition.default_request_type
    if detected_request_type in definition.request_hints:
        return detected_request_type
    return definition.default_request_type


def _resolve_intent_domain(
    definition: IntentDefinition,
    detected_primary_domain: str,
) -> str:
    if definition.key == "consumption" and detected_primary_domain == "lines":
        return definition.default_domain
    if detected_primary_domain in definition.domain_hints:
        return detected_primary_domain
    return definition.default_domain


def _build_intent_confidence(best_score: float, second_score: float) -> float:
    score_gap = max(0.0, best_score - second_score)
    return max(0.18, min(0.99, round(0.36 + (best_score * 0.08) + (score_gap * 0.14), 2)))


def _fallback_intent_from_domain_request(
    primary_domain: str,
    request_type: str,
) -> IntentDefinition | None:
    if request_type == "comparison":
        return next(definition for definition in INTENT_DEFINITIONS if definition.key == "comparison")
    if request_type == "planning":
        return next(definition for definition in INTENT_DEFINITIONS if definition.key == "action_plan")
    if request_type == "ranking":
        if primary_domain in {"fraud", "risk"}:
            return next(definition for definition in INTENT_DEFINITIONS if definition.key == "prioritization")
        if primary_domain == "roaming":
            return next(definition for definition in INTENT_DEFINITIONS if definition.key == "roaming")
        if primary_domain in {"departments"}:
            return next(definition for definition in INTENT_DEFINITIONS if definition.key == "departments")
        if primary_domain in {"operators"}:
            return next(definition for definition in INTENT_DEFINITIONS if definition.key == "operators")
    if request_type in {"estimation", "forecast", "simulation"}:
        return next(definition for definition in INTENT_DEFINITIONS if definition.key == "forecasts")
    if request_type == "trends":
        return next(definition for definition in INTENT_DEFINITIONS if definition.key == "trends")
    if request_type == "statistics":
        return next(definition for definition in INTENT_DEFINITIONS if definition.key == "kpi")
    if request_type == "audit" or primary_domain == "audit":
        return next(definition for definition in INTENT_DEFINITIONS if definition.key == "audit")
    if primary_domain == "roaming":
        return next(definition for definition in INTENT_DEFINITIONS if definition.key == "roaming")
    if primary_domain in {"fraud", "risk"}:
        return next(definition for definition in INTENT_DEFINITIONS if definition.key == "fraud")
    if primary_domain in {"equipment", "maintenance"}:
        if request_type == "inventory":
            return next(definition for definition in INTENT_DEFINITIONS if definition.key == "equipment")
        return next(definition for definition in INTENT_DEFINITIONS if definition.key == "maintenance")
    if primary_domain in {"plans"}:
        return next(definition for definition in INTENT_DEFINITIONS if definition.key == "oversized_plans")
    if primary_domain in {"consumption", "lines"}:
        return next(definition for definition in INTENT_DEFINITIONS if definition.key == "consumption")
    if primary_domain in {"operators"}:
        return next(definition for definition in INTENT_DEFINITIONS if definition.key == "operators")
    if primary_domain in {"departments"}:
        return next(definition for definition in INTENT_DEFINITIONS if definition.key == "departments")
    if primary_domain in {"performance", "kpi"}:
        return next(definition for definition in INTENT_DEFINITIONS if definition.key == "kpi")
    if primary_domain == "budget":
        if request_type in {"optimization", "recommendation"}:
            return next(definition for definition in INTENT_DEFINITIONS if definition.key == "cost_optimization")
        if request_type in {"diagnostic", "risk_analysis"}:
            return next(definition for definition in INTENT_DEFINITIONS if definition.key == "recommendations")
        return next(definition for definition in INTENT_DEFINITIONS if definition.key == "cost_optimization")
    return None


def _classify_business_intent(
    question: str,
    history: list["ChatContextMessage"],
    *,
    entities: list[EntityMatch],
    primary_domain: str,
    request_type: str,
    understanding: BusinessQuestionUnderstanding | None = None,
) -> IntentClassification:
    question_text = _normalize_text(question)
    history_text = _normalize_text(_history_text(history))
    strategy_hint = understanding.analysis_strategy if understanding is not None else None
    strategy_preferred_intents = ()
    if (
        understanding is not None
        and understanding.primary_domain == "general"
        and understanding.data_gaps
        and understanding.strategy_confidence <= 0.4
    ):
        return IntentClassification(
            key="generic_summary",
            handler_name="handle_generic_summary_intent",
            primary_domain="general",
            request_type="summary",
            response_shape="summary",
            confidence=max(0.28, understanding.strategy_confidence),
            matched_by="generic_fallback",
            fallback_used=True,
        )
    if understanding is not None:
        strategy_preferred_intents = tuple(
            definition.preferred_intents
            for definition in STRATEGY_DEFINITIONS
            if definition.key == understanding.analysis_strategy
        )
        strategy_preferred_intents = strategy_preferred_intents[0] if strategy_preferred_intents else ()
    scored_definitions = sorted(
        (
            (
                _score_intent_definition(
                    definition,
                    question_text=question_text,
                    history_text=history_text,
                    primary_domain=primary_domain,
                    request_type=request_type,
                    entities=entities,
                    strategy_hint=strategy_hint,
                    preferred_intents=strategy_preferred_intents,
                    secondary_domains=understanding.secondary_domains if understanding is not None else (),
                    secondary_request_types=understanding.secondary_request_types if understanding is not None else (),
                ),
                definition,
            )
            for definition in INTENT_DEFINITIONS
        ),
        key=lambda item: item[0],
        reverse=True,
    )
    best_score, best_definition = scored_definitions[0]
    second_score = scored_definitions[1][0] if len(scored_definitions) > 1 else 0.0
    best_confidence = _build_intent_confidence(best_score, second_score)

    if best_score >= 1.45:
        match_mode: Literal["lexical", "semantic", "domain_request_fallback", "generic_fallback"] = (
            "lexical" if _score_lexicon(question_text, best_definition.keywords, 1.0) >= 0.75 else "semantic"
        )
        resolved_domain = _resolve_intent_domain(best_definition, primary_domain)
        resolved_request_type = _resolve_intent_request_type(best_definition, request_type)
        return IntentClassification(
            key=best_definition.key,
            handler_name=best_definition.handler_name,
            primary_domain=resolved_domain,
            request_type=resolved_request_type,
            response_shape=best_definition.response_shape or _resolve_response_shape(resolved_request_type),
            confidence=best_confidence,
            matched_by=match_mode,
            fallback_used=False,
        )

    fallback_definition = _fallback_intent_from_domain_request(primary_domain, request_type)
    if fallback_definition is not None:
        resolved_domain = _resolve_intent_domain(fallback_definition, primary_domain)
        resolved_request_type = _resolve_intent_request_type(fallback_definition, request_type)
        return IntentClassification(
            key=fallback_definition.key,
            handler_name=fallback_definition.handler_name,
            primary_domain=resolved_domain,
            request_type=resolved_request_type,
            response_shape=fallback_definition.response_shape or _resolve_response_shape(resolved_request_type),
            confidence=max(0.42, round(best_confidence - 0.08, 2)),
            matched_by="domain_request_fallback",
            fallback_used=False,
        )

    if strategy_preferred_intents:
        for strategy_intent_key in strategy_preferred_intents:
            strategy_definition = next(
                (definition for definition in INTENT_DEFINITIONS if definition.key == strategy_intent_key),
                None,
            )
            if strategy_definition is None:
                continue
            resolved_domain = _resolve_intent_domain(strategy_definition, primary_domain)
            resolved_request_type = _resolve_intent_request_type(strategy_definition, request_type)
            return IntentClassification(
                key=strategy_definition.key,
                handler_name=strategy_definition.handler_name,
                primary_domain=resolved_domain,
                request_type=resolved_request_type,
                response_shape=strategy_definition.response_shape or _resolve_response_shape(resolved_request_type),
                confidence=max(0.44, round(best_confidence - 0.04, 2)),
                matched_by="domain_request_fallback",
                fallback_used=False,
            )

    return IntentClassification(
        key="generic_summary",
        handler_name="handle_generic_summary_intent",
        primary_domain=primary_domain if primary_domain != "general" else "general",
        request_type=request_type if request_type != "summary" else "summary",
        response_shape="summary",
        confidence=max(0.18, round(best_confidence - 0.18, 2)),
        matched_by="generic_fallback",
        fallback_used=True,
    )


def _build_structured_answer(
    heading: str,
    metrics: list[str],
    analysis: str,
    recommendation: str,
) -> str:
    normalized_heading = _normalize_text(heading)
    cleaned_metrics = [" ".join(metric.split()).strip() for metric in metrics if metric and metric.strip()]
    cleaned_analysis = " ".join(analysis.split()).strip()
    cleaned_recommendation = " ".join(recommendation.split()).strip()

    def build_section(title: str, lines: list[str]) -> str:
        cleaned_lines = [" ".join(line.split()).strip() for line in lines if line and line.strip()]
        if not cleaned_lines:
            return ""
        return "\n".join([title, *cleaned_lines])

    def detect_response_family() -> str:
        if "comparaison" in normalized_heading:
            return "comparison"
        if normalized_heading.startswith("top ") or "classement" in normalized_heading:
            return "ranking"
        if "plan d action" in normalized_heading:
            return "planning"
        if "inventaire" in normalized_heading or "equipement" in normalized_heading:
            return "inventory"
        if "statistique" in normalized_heading or "kpi" in normalized_heading:
            return "statistics"
        if "estimation" in normalized_heading or "projection" in normalized_heading:
            return "projection"
        if "optimisation" in normalized_heading or "actions recommandees" in normalized_heading:
            return "optimization"
        if "risque" in normalized_heading or "diagnostic" in normalized_heading or "analyse" in normalized_heading:
            return "diagnostic"
        return "summary"

    def extract_amounts(lines: list[str]) -> list[float]:
        amounts: list[float] = []
        for line in lines:
            for match in re.finditer(r"(\d[\d ]*)\s*MAD", line):
                normalized_value = match.group(1).replace(" ", "")
                try:
                    amounts.append(float(normalized_value))
                except ValueError:
                    continue
        return amounts

    def extract_count(lines: list[str], keywords: tuple[str, ...]) -> int | None:
        for line in lines:
            normalized_line = _normalize_text(line)
            if not any(keyword in normalized_line for keyword in keywords):
                continue
            match = re.search(r"\b(\d{1,4})\b", normalized_line)
            if match is not None:
                return int(match.group(1))
        return None

    def format_priority_label(priority: Literal["low", "medium", "high", "critical"]) -> str:
        return {
            "critical": "Critique",
            "high": "Haute",
            "medium": "Moyenne",
            "low": "Faible",
        }[priority]

    def annualize(amount: float) -> str:
        return _format_mad(amount * 12)

    def derive_priority(family: str) -> Literal["low", "medium", "high", "critical"]:
        if any(token in normalized_heading for token in ("fraude", "critique", "alerte", "roaming", "risque")):
            return "critical"
        if family in {"planning", "diagnostic", "projection"}:
            return "high"
        if family in {"comparison", "ranking", "optimization"}:
            return "medium"
        return "low"

    def derive_gain_hint(family: str) -> str:
        metric_pool = cleaned_metrics + ([cleaned_analysis] if cleaned_analysis else [])
        amounts = extract_amounts(metric_pool)
        gap_amount = next(
            (
                amount
                for line in metric_pool
                for amount in extract_amounts([line])
                if any(keyword in _normalize_text(line) for keyword in ("ecart", "projete", "requalifier"))
            ),
            None,
        )
        primary_amount = gap_amount if gap_amount is not None else (max(amounts) if amounts else None)
        alert_count = extract_count(metric_pool, ("alerte", "alertes", "suspect", "suspects", "depassement"))
        if family in {"projection", "optimization", "summary"} and primary_amount is not None:
            return f"jusqu'a {_format_mad(primary_amount)} par mois, soit {annualize(primary_amount)} sur un an"
        if family == "comparison" and primary_amount is not None:
            return f"arbitrage prioritaire sur un enjeu de {_format_mad(primary_amount)}"
        if family == "ranking" and alert_count is not None:
            return f"traitement cible d'au moins {alert_count} signal(s) prioritaires"
        if family == "inventory" and alert_count is not None:
            return f"reduction du risque sur {alert_count} alerte(s) equipement ou budget mobile"
        if "fraude" in normalized_heading and primary_amount is not None:
            return f"reduction d'une exposition de {_format_mad(primary_amount)}"
        if "roaming" in normalized_heading and primary_amount is not None:
            return f"limitation d'une exposition roaming de {_format_mad(primary_amount)}"
        if alert_count is not None:
            return f"reduction du risque sur {alert_count} signal(s) visibles"
        return "pilotage plus rapide et reduction du risque operationnel"

    def derive_executive_summary(family: str) -> str:
        primary_metric = cleaned_metrics[0] if cleaned_metrics else heading
        secondary_metric = cleaned_metrics[1] if len(cleaned_metrics) > 1 else ""
        if family == "comparison":
            comparison_focus = secondary_metric or primary_metric
            return (
                f"{primary_metric}. {comparison_focus}. {cleaned_analysis or 'Le comparatif isole le perimetre le plus tendu.'}"
            ).strip()
        if family == "ranking":
            return (
                f"{heading} met en avant les poches les plus exposees. {primary_metric}. "
                f"{cleaned_analysis or 'Le classement facilite la priorisation immediate.'}"
            ).strip()
        if family == "planning":
            planning_default_analysis = "Le sequencing propose vise a securiser le risque avant l'optimisation."
            return (
                f"La priorite immediate ressort de {primary_metric.lower() if primary_metric else heading.lower()}. "
                f"{cleaned_analysis or planning_default_analysis}"
            ).strip()
        if family == "statistics":
            return (
                f"{primary_metric}. {secondary_metric or cleaned_analysis or 'Les indicateurs confirment la tendance la plus visible.'}"
            ).strip()
        if family == "inventory":
            return (
                f"{primary_metric}. {cleaned_analysis or 'Le parc doit etre lu a la fois par le volume, la criticite et le renouvellement.'}"
            ).strip()
        if family == "projection":
            projection_default_analysis = "La projection chiffre l'impact a court terme."
            return (
                f"{primary_metric}. {secondary_metric or cleaned_analysis or projection_default_analysis}"
            ).strip()
        return (
            f"{primary_metric}. {cleaned_analysis or 'Les donnees pointent un enjeu decisionnel prioritaire sur ce perimetre.'}"
        ).strip()

    def resolve_detail_title(family: str) -> str:
        if family == "comparison":
            return "Tableau comparatif"
        if family == "ranking":
            return "Classement prioritaire"
        if family == "planning":
            return "Plan priorise"
        if family == "statistics":
            return "Indicateurs et tendances"
        if family == "inventory":
            return "Inventaire et sante"
        if family == "projection":
            return "Projection et impact"
        if family == "optimization":
            return "Leviers d'optimisation"
        if family == "diagnostic":
            return "Analyse detaillee"
        return heading

    def build_actions(family: str) -> list[DecisionActionItem]:
        priority = derive_priority(family)
        first_justification = cleaned_metrics[0] if cleaned_metrics else cleaned_analysis or heading
        actions = [
            DecisionActionItem(
                priority=priority,
                title=cleaned_recommendation or heading,
                justification=f"{first_justification}. {cleaned_analysis or 'Cette action cible le signal le plus visible.'}",
                expected_gain=derive_gain_hint(family),
                horizon="court_terme",
            )
        ]
        if family in {"optimization", "planning", "summary", "projection"}:
            secondary_metric = cleaned_metrics[1] if len(cleaned_metrics) > 1 else first_justification
            actions.append(
                DecisionActionItem(
                    priority="medium" if priority in {"critical", "high"} else "low",
                    title="Mettre en place un suivi hebdomadaire cible",
                    justification=f"{secondary_metric}. Le suivi permet de confirmer la trajectoire avant un arbitrage plus large.",
                    expected_gain="stabilisation des couts, du risque et de la disponibilite sur le perimetre surveille",
                    horizon="moyen_terme",
                )
            )
        if family in {"optimization", "planning"}:
            actions.append(
                DecisionActionItem(
                    priority="low",
                    title="Consolider la gouvernance telecom et les regles de controle",
                    justification="La repetition des signaux justifie une action plus structurelle au-dela du correctif immediate.",
                    expected_gain="baisse durable du risque et meilleure prevision budgetaire",
                    horizon="long_terme",
                )
            )
        return actions[:3]

    def render_action(action: DecisionActionItem) -> str:
        return (
            f"{format_priority_label(action.priority)} | {action.title} | "
            f"Pourquoi: {action.justification} | Gain attendu: {action.expected_gain}"
        )

    def build_strategy_lines(actions: list[DecisionActionItem], family: str) -> list[str]:
        if family not in {"optimization", "planning", "summary", "projection"}:
            return []
        horizon_labels = {
            "court_terme": "Court terme",
            "moyen_terme": "Moyen terme",
            "long_terme": "Long terme",
        }
        strategy_lines: list[str] = []
        for horizon in ("court_terme", "moyen_terme", "long_terme"):
            action = next((item for item in actions if item.horizon == horizon), None)
            if action is None:
                continue
            strategy_lines.append(
                f"{horizon_labels[horizon]} | {action.title} | Impact vise: {action.expected_gain}"
            )
        return strategy_lines

    response_family = detect_response_family()
    actions = build_actions(response_family)
    detail_title = resolve_detail_title(response_family)
    detail_lines = cleaned_metrics or [heading]
    if heading and _normalize_text(heading) != _normalize_text(detail_title):
        detail_lines = [heading, *detail_lines]

    sections = [
        build_section("Resume executif", [derive_executive_summary(response_family)]),
        build_section(detail_title, detail_lines),
        build_section("Analyse et justification", [cleaned_analysis or "Les donnees confirment un enjeu prioritaire sur le perimetre demande."]),
        build_section("Actions recommandees", [render_action(action) for action in actions]),
        build_section("Vision strategique", build_strategy_lines(actions, response_family)),
    ]
    rendered_sections = [section for section in sections if section]
    rendered_sections.append(f"Recommandation: {cleaned_recommendation or heading}")
    return "\n\n".join(rendered_sections)


def _resolve_limit(requested_limit: int | None, *, default: int = 3, maximum: int = 5) -> int:
    if requested_limit is None:
        return default
    return max(1, min(requested_limit, maximum))


def _get_primary_scope_entity(
    entities: list[EntityMatch],
    *kinds: Literal["operator", "department", "plan", "country", "line"],
) -> EntityMatch | None:
    return next((entity for entity in entities if entity.kind in kinds), None)


def _get_scope_metric(
    snapshot: BusinessReasoningSnapshot,
    scope_entity: EntityMatch | None,
) -> ScopedReasoningMetric | None:
    if scope_entity is None:
        return None
    collection = snapshot.operators if scope_entity.kind == "operator" else snapshot.departments
    return collection.get(_snapshot_keyed_label(scope_entity.label))


def _filter_scope_lines(
    snapshot: BusinessReasoningSnapshot,
    scope_entity: EntityMatch | None = None,
) -> list[LineReasoningMetric]:
    lines = list(snapshot.lines.values())
    if scope_entity is None:
        return lines
    if scope_entity.kind == "operator":
        return [line for line in lines if _normalize_text(line.operator) == _snapshot_keyed_label(scope_entity.label)]
    if scope_entity.kind == "department":
        return [line for line in lines if _normalize_text(line.department) == _snapshot_keyed_label(scope_entity.label)]
    if scope_entity.kind == "line":
        return [line for line in lines if _normalize_text(line.label) == _snapshot_keyed_label(scope_entity.label)]
    return lines


def _filter_scope_plans(
    snapshot: BusinessReasoningSnapshot,
    scope_entity: EntityMatch | None = None,
) -> list[PlanReasoningMetric]:
    plans = list(snapshot.plans.values())
    if scope_entity is None:
        return plans
    if scope_entity.kind == "operator":
        return [plan for plan in plans if _normalize_text(plan.operator) == _snapshot_keyed_label(scope_entity.label)]
    if scope_entity.kind == "plan":
        return [plan for plan in plans if _normalize_text(plan.label) == _snapshot_keyed_label(scope_entity.label)]
    return plans


def _rank_underused_lines(
    snapshot: BusinessReasoningSnapshot,
    scope_entity: EntityMatch | None = None,
) -> list[LineReasoningMetric]:
    candidates = []
    for line in _filter_scope_lines(snapshot, scope_entity):
        if line.quota_gb in (None, 0):
            continue
        usage_ratio = line.usage_gb / line.quota_gb
        if usage_ratio <= 0.35 or line.status in {"libre", "inactive", "suspendue"}:
            candidates.append(line)
    return sorted(
        candidates,
        key=lambda line: (
            line.monthly_cost_mad,
            1 - ((line.usage_gb / line.quota_gb) if line.quota_gb not in (None, 0) else 0.0),
            line.risk_score,
        ),
        reverse=True,
    )


def _rank_critical_lines(
    snapshot: BusinessReasoningSnapshot,
    scope_entity: EntityMatch | None = None,
) -> list[LineReasoningMetric]:
    return sorted(
        _filter_scope_lines(snapshot, scope_entity),
        key=lambda line: (line.risk_score, line.monthly_cost_mad, line.usage_gb),
        reverse=True,
    )


def _build_general_answer(summary: "DataSummary") -> str:
    top_operator = summary.expensive_operators[0] if summary.expensive_operators else None
    top_department = summary.risky_departments[0] if summary.risky_departments else None
    top_signal = (
        f"{top_operator.label} concentre encore le premier poste de cout"
        if top_operator is not None
        else "la pression se diffuse entre couts, alertes et usages"
    )
    recommendation = (
        f"Commencer par {top_department.label} puis arbitrer les forfaits les plus chers."
        if top_department is not None
        else "Commencer par les alertes critiques puis les forfaits les plus chers."
    )
    return _build_structured_answer(
        "Synthese copilote",
        [
            f"{summary.total_lines} lignes suivies dont {summary.free_lines} libres et {summary.suspended_lines} suspendues",
            f"Budget actuel {_format_mad(summary.total_monthly_cost_mad)} avec projection a {_format_mad(summary.projected_monthly_cost_mad)}",
            f"{summary.alert_count} alertes dont {summary.critical_alert_count} critiques",
            f"{summary.suspicious_call_count} appels suspects pour {_format_mad(summary.suspicious_call_cost_mad)}",
        ],
        f"Selon les donnees disponibles, {top_signal}.",
        recommendation,
    )


def _build_budget_summary_answer(
    summary: "DataSummary",
    entities: list[EntityMatch],
    snapshot: BusinessReasoningSnapshot,
) -> tuple[str, bool]:
    scope_entity = _get_primary_scope_entity(entities, "operator", "department")
    scope_metric = _get_scope_metric(snapshot, scope_entity)
    if scope_entity is not None and scope_metric is not None:
        projected_gap = max(scope_metric.projected_monthly_cost_mad - scope_metric.monthly_cost_mad, 0.0)
        return (
            _build_structured_answer(
                f"Resume budgetaire - {scope_entity.label}",
                [
                    f"Cout estime {_format_mad(scope_metric.monthly_cost_mad)} sur {scope_metric.line_count} lignes",
                    f"Projection {_format_mad(scope_metric.projected_monthly_cost_mad)} et ecart {_format_mad(projected_gap)}",
                    f"Risque moyen {_format_score(scope_metric.risk_score)} avec {scope_metric.alert_count} alertes",
                    f"{scope_metric.over_quota_count} depassements et {scope_metric.anomaly_count} anomalies visibles",
                ],
                "Le budget reste surtout pilote par la concentration des couts et des alertes sur ce perimetre.",
                f"Suivre {scope_entity.label} chaque semaine avant tout arbitrage global.",
            ),
            False,
        )

    projected_gap = max(summary.projected_monthly_cost_mad - summary.total_monthly_cost_mad, 0.0)
    top_operator = summary.expensive_operators[0] if summary.expensive_operators else None
    top_department = summary.risky_departments[0] if summary.risky_departments else None
    recommendation = (
        f"Prioriser {top_department.label} puis {top_operator.label} pour contenir le budget."
        if top_operator is not None and top_department is not None
        else "Prioriser les forfaits les plus chers et les lignes en depassement."
    )
    return (
        _build_structured_answer(
            "Synthese budgetaire",
            [
                f"Cout actuel {_format_mad(summary.total_monthly_cost_mad)}",
                f"Projection {_format_mad(summary.projected_monthly_cost_mad)}",
                f"Ecart potentiel {_format_mad(projected_gap)}",
                f"{summary.budget_alert_count} alertes budget et {summary.over_quota_count} depassements de quota",
            ],
            "Le budget reste surtout tire par les operateurs, departements et forfaits deja les plus exposes.",
            recommendation,
        ),
        False,
    )


def _build_budget_optimization_answer(
    summary: "DataSummary",
    entities: list[EntityMatch],
    snapshot: BusinessReasoningSnapshot,
) -> tuple[str, bool]:
    scope_entity = _get_primary_scope_entity(entities, "operator", "department")
    scope_lines = _rank_underused_lines(snapshot, scope_entity)
    scope_plans = sorted(
        _filter_scope_plans(snapshot, scope_entity),
        key=lambda plan: (plan.average_cost_mad, plan.line_count, 1 - plan.average_usage_ratio),
        reverse=True,
    )
    target_lines = scope_lines[:3]
    target_plans = [plan for plan in scope_plans if plan.average_usage_ratio <= 0.7][:2] or scope_plans[:2]
    requalifiable_cost = sum(line.monthly_cost_mad for line in target_lines)
    scope_label = scope_entity.label if scope_entity is not None else "la flotte"
    primary_plan = target_plans[0] if target_plans else None

    metrics = []
    if primary_plan is not None:
        metrics.append(
            f"Forfait a arbitrer: {primary_plan.label} ({primary_plan.operator}) | cout moyen {_format_mad(primary_plan.average_cost_mad)} | usage {round(primary_plan.average_usage_ratio * 100)} %"
        )
    if target_lines:
        metrics.append(
            f"{len(target_lines)} lignes sous-utilisees ou inactives representent {_format_mad(requalifiable_cost)} de cout a requalifier"
        )
        metrics.extend(
            f"{line.label} | {line.operator} | {line.plan} | usage {_format_usage(line.usage_gb, line.quota_gb)}"
            for line in target_lines[:2]
        )
    else:
        metrics.append("Aucune ligne clairement sous-utilisee n'apparait sur le perimetre cible")
        if primary_plan is not None:
            metrics.append(
                f"{primary_plan.line_count} lignes restent rattachees au forfait {primary_plan.label}"
            )

    analysis = (
        "L'optimisation vient d'abord des lignes peu consommatrices et des forfaits dont le cout moyen reste eleve."
    )
    recommendation = (
        f"Commencer par les lignes sous-utilisees de {scope_label} puis resegmenter le forfait {primary_plan.label}."
        if primary_plan is not None and target_lines
        else f"Verifier les lignes libres, suspendues ou sous-utilisees sur {scope_label} avant tout nouvel achat."
    )
    return _build_structured_answer(
        f"Optimisation budgetaire - {scope_label}",
        metrics,
        analysis,
        recommendation,
    ), False


def _build_budget_estimation_answer(
    summary: "DataSummary",
    entities: list[EntityMatch],
    snapshot: BusinessReasoningSnapshot,
) -> tuple[str, bool]:
    scope_entity = _get_primary_scope_entity(entities, "operator", "department")
    scope_metric = _get_scope_metric(snapshot, scope_entity)
    if scope_entity is not None and scope_metric is not None:
        projected_gap = max(scope_metric.projected_monthly_cost_mad - scope_metric.monthly_cost_mad, 0.0)
        pressure_driver = (
            "les depassements de quota"
            if scope_metric.over_quota_count >= scope_metric.anomaly_count
            else "les anomalies et alertes"
        )
        return (
            _build_structured_answer(
                f"Estimation budgetaire - {scope_entity.label}",
                [
                    f"Cout actuel {_format_mad(scope_metric.monthly_cost_mad)}",
                    f"Projection {_format_mad(scope_metric.projected_monthly_cost_mad)}",
                    f"Ecart projete {_format_mad(projected_gap)}",
                    f"{scope_metric.alert_count} alertes avec driver principal: {pressure_driver}",
                ],
                "La projection est surtout utile pour anticiper le prochain point de derapage sur ce perimetre.",
                f"Verifier {scope_entity.label} avant cloture de periode si l'ecart projete continue d'augmenter.",
            ),
            False,
        )

    projected_gap = max(summary.projected_monthly_cost_mad - summary.total_monthly_cost_mad, 0.0)
    return (
        _build_structured_answer(
            "Estimation budgetaire",
            [
                f"Cout actuel {_format_mad(summary.total_monthly_cost_mad)}",
                f"Projection {_format_mad(summary.projected_monthly_cost_mad)}",
                f"Ecart projete {_format_mad(projected_gap)}",
                f"{summary.over_quota_count} depassements et {summary.anomaly_count} anomalies nourrissent la projection",
            ],
            "La trajectoire budgetaire indique si la flotte va rester stable ou deriver au prochain cycle.",
            "Prioriser les perimetres qui cumulent a la fois projection haute et alertes actives.",
        ),
        False,
    )


def _build_budget_diagnostic_answer(
    summary: "DataSummary",
    entities: list[EntityMatch],
    snapshot: BusinessReasoningSnapshot,
) -> tuple[str, bool]:
    scope_entity = _get_primary_scope_entity(entities, "operator", "department")
    scope_metric = _get_scope_metric(snapshot, scope_entity)
    if scope_entity is not None and scope_metric is not None:
        dominant_driver = "depassements de quota" if scope_metric.over_quota_count >= scope_metric.anomaly_count else "anomalies et alertes"
        return (
            _build_structured_answer(
                f"Diagnostic budgetaire - {scope_entity.label}",
                [
                    f"Cout estime {_format_mad(scope_metric.monthly_cost_mad)}",
                    f"Risque {_format_score(scope_metric.risk_score)} et {scope_metric.alert_count} alertes",
                    f"{scope_metric.over_quota_count} depassements, {scope_metric.anomaly_count} anomalies, {scope_metric.suspicious_call_count} appels suspects",
                ],
                f"La derive budgetaire vient surtout de {dominant_driver} sur ce perimetre.",
                f"Auditer {scope_entity.label} en priorite puis corriger les lignes et forfaits les plus couteux.",
            ),
            False,
        )

    return (
        _build_structured_answer(
            "Diagnostic budgetaire",
            [
                f"{summary.budget_alert_count} alertes budget visibles",
                f"{summary.over_quota_count} depassements et {summary.anomaly_count} anomalies",
                f"{summary.suspicious_call_count} appels suspects pouvant aggraver la facture",
            ],
            "Le budget derape generalement quand usage, anomalies et concentration des couts se renforcent mutuellement.",
            "Diagnostiquer d'abord les perimetres a forte concentration de cout et d'alertes.",
        ),
        False,
    )


def _build_budget_ranking_answer(
    question: str,
    summary: "DataSummary",
    snapshot: BusinessReasoningSnapshot,
    *,
    requested_limit: int | None,
) -> tuple[str, bool]:
    normalized_question = _normalize_text(question)
    limit = _resolve_limit(requested_limit)

    if "forfait" in normalized_question or "plan" in normalized_question:
        ranked_plans = sorted(
            snapshot.plans.values(),
            key=lambda plan: (plan.average_cost_mad, plan.line_count, plan.alert_count),
            reverse=True,
        )[:limit]
        return (
            _build_structured_answer(
                f"Top {len(ranked_plans)} forfaits budget",
                [
                    f"{index}. {plan.operator} / {plan.label} | cout moyen {_format_mad(plan.average_cost_mad)} | {plan.line_count} lignes | {plan.alert_count} alertes"
                    for index, plan in enumerate(ranked_plans, start=1)
                ],
                "Le classement isole les forfaits dont le cout unitaire combine volume et alertes.",
                "Examiner les deux premiers forfaits avant de lancer une optimisation plus large.",
            ),
            False,
        )

    if "departement" in normalized_question:
        ranked_departments = sorted(
            snapshot.departments.values(),
            key=lambda metric: (metric.monthly_cost_mad, metric.risk_score, metric.alert_count),
            reverse=True,
        )[:limit]
        return (
            _build_structured_answer(
                f"Top {len(ranked_departments)} departements budget",
                [
                    f"{index}. {metric.label} | {_format_mad(metric.monthly_cost_mad)} | risque {_format_score(metric.risk_score)} | {metric.alert_count} alertes"
                    for index, metric in enumerate(ranked_departments, start=1)
                ],
                "Le classement departemental montre ou la pression budgetaire est la plus dense.",
                "Traiter les premiers departements du classement avant les arbitrages transverses.",
            ),
            False,
        )

    ranked_operators = sorted(
        snapshot.operators.values(),
        key=lambda metric: (metric.monthly_cost_mad, metric.risk_score, metric.alert_count),
        reverse=True,
    )[:limit]
    return (
        _build_structured_answer(
            f"Top {len(ranked_operators)} operateurs budget",
            [
                f"{index}. {metric.label} | {_format_mad(metric.monthly_cost_mad)} | risque {_format_score(metric.risk_score)} | {metric.alert_count} alertes"
                for index, metric in enumerate(ranked_operators, start=1)
            ],
            "Le classement operateur permet de prioriser les renegociations et arbitrages de portefeuille.",
            "Commencer par l'operateur en tete du classement puis mesurer l'effet sur le budget global.",
        ),
        False,
    )


def _build_comparison_answer(
    question: str,
    entities: list[EntityMatch],
    snapshot: BusinessReasoningSnapshot,
) -> tuple[str, bool] | None:
    if len(entities) < 2:
        normalized_question = _normalize_text(question)
        if "departement" in normalized_question:
            auto_entities = [
                EntityMatch(kind="department", label=metric.label, score=1.0)
                for metric in sorted(
                    snapshot.departments.values(),
                    key=lambda value: (value.monthly_cost_mad, value.risk_score),
                    reverse=True,
                )[:2]
            ]
            entities = auto_entities
        elif "operateur" in normalized_question:
            auto_entities = [
                EntityMatch(kind="operator", label=metric.label, score=1.0)
                for metric in sorted(
                    snapshot.operators.values(),
                    key=lambda value: (value.monthly_cost_mad, value.risk_score),
                    reverse=True,
                )[:2]
            ]
            entities = auto_entities
        elif "forfait" in normalized_question or "plan" in normalized_question:
            auto_entities = [
                EntityMatch(kind="plan", label=metric.label, score=1.0)
                for metric in sorted(
                    snapshot.plans.values(),
                    key=lambda value: (value.average_cost_mad, value.line_count, value.alert_count),
                    reverse=True,
                )[:2]
            ]
            entities = auto_entities
        elif "pays" in normalized_question or "roaming" in normalized_question:
            auto_entities = [
                EntityMatch(kind="country", label=metric.label, score=1.0)
                for metric in sorted(
                    snapshot.countries.values(),
                    key=lambda value: (value.total_cost_mad, value.alert_count),
                    reverse=True,
                )[:2]
            ]
            entities = auto_entities
        else:
            return None

    for kind, collection in (
        ("operator", snapshot.operators),
        ("department", snapshot.departments),
        ("country", snapshot.countries),
        ("plan", snapshot.plans),
    ):
        same_kind_entities = [entity for entity in entities if entity.kind == kind][:2]
        if len(same_kind_entities) < 2:
            continue

        left_entity, right_entity = same_kind_entities[0], same_kind_entities[1]
        left_metric = collection.get(_snapshot_keyed_label(left_entity.label))
        right_metric = collection.get(_snapshot_keyed_label(right_entity.label))
        if left_metric is None or right_metric is None:
            continue

        if isinstance(left_metric, CountryReasoningMetric) and isinstance(right_metric, CountryReasoningMetric):
            cost_gap = abs(left_metric.total_cost_mad - right_metric.total_cost_mad)
            leading_label = (
                left_metric.label if left_metric.total_cost_mad >= right_metric.total_cost_mad else right_metric.label
            )
            return (
                _build_structured_answer(
                    f"Comparaison roaming - {left_metric.label} vs {right_metric.label}",
                    [
                        f"{left_metric.label}: {_format_mad(left_metric.total_cost_mad)} sur {left_metric.event_count} signaux",
                        f"{right_metric.label}: {_format_mad(right_metric.total_cost_mad)} sur {right_metric.event_count} signaux",
                        f"Ecart de cout {_format_mad(cost_gap)}",
                        f"Pays le plus sensible actuellement: {leading_label}",
                    ],
                    "Le pays le plus cher n'est pas forcement le plus frequente; il faut croiser cout et alertes.",
                    f"Verifier d'abord le roaming sur {leading_label} et ajuster les options de voyage associees.",
                ),
                False,
            )

        if isinstance(left_metric, ScopedReasoningMetric) and isinstance(right_metric, ScopedReasoningMetric):
            cost_gap = abs(left_metric.monthly_cost_mad - right_metric.monthly_cost_mad)
            risk_leader = left_metric.label if left_metric.risk_score >= right_metric.risk_score else right_metric.label
            kind_label = {
                "operator": "operateurs",
                "department": "departements",
            }.get(kind, kind)
            return (
                _build_structured_answer(
                    f"Comparaison {kind_label} - {left_metric.label} vs {right_metric.label}",
                    [
                        f"{left_metric.label}: {_format_mad(left_metric.monthly_cost_mad)} | risque {_format_score(left_metric.risk_score)} | {left_metric.alert_count} alertes",
                        f"{right_metric.label}: {_format_mad(right_metric.monthly_cost_mad)} | risque {_format_score(right_metric.risk_score)} | {right_metric.alert_count} alertes",
                        f"Ecart budgetaire {_format_mad(cost_gap)}",
                        f"Perimetre le plus tendu: {risk_leader}",
                    ],
                    "La bonne priorite comparee est le couple cout + criticite, pas seulement le volume de lignes.",
                    f"Traiter d'abord {risk_leader}, puis consolider l'autre perimetre pour eviter un report de risque.",
                ),
                False,
            )

        if isinstance(left_metric, PlanReasoningMetric) and isinstance(right_metric, PlanReasoningMetric):
            cost_gap = abs(left_metric.average_cost_mad - right_metric.average_cost_mad)
            risk_leader = (
                left_metric.label
                if (left_metric.alert_count, left_metric.average_usage_ratio)
                >= (right_metric.alert_count, right_metric.average_usage_ratio)
                else right_metric.label
            )
            return (
                _build_structured_answer(
                    f"Comparaison forfaits - {left_metric.label} vs {right_metric.label}",
                    [
                        f"{left_metric.operator} / {left_metric.label}: cout moyen {_format_mad(left_metric.average_cost_mad)} | {left_metric.line_count} lignes | usage {round(left_metric.average_usage_ratio * 100)} %",
                        f"{right_metric.operator} / {right_metric.label}: cout moyen {_format_mad(right_metric.average_cost_mad)} | {right_metric.line_count} lignes | usage {round(right_metric.average_usage_ratio * 100)} %",
                        f"Ecart de cout moyen {_format_mad(cost_gap)}",
                        f"Forfait le plus sensible actuellement: {risk_leader}",
                    ],
                    "La bonne comparaison forfaitaire croise cout unitaire, volume de lignes et usage reel.",
                    f"Verifier d'abord {risk_leader} avant toute migration de masse.",
                ),
                False,
            )

    return None


def _build_plan_answer(
    summary: "DataSummary",
    entities: list[EntityMatch],
    snapshot: BusinessReasoningSnapshot,
) -> tuple[str, bool]:
    plan_entity = next((entity for entity in entities if entity.kind == "plan"), None)
    if plan_entity is not None:
        metric = snapshot.plans.get(_snapshot_keyed_label(plan_entity.label))
        if metric is not None:
            usage_pct = round(metric.average_usage_ratio * 100)
            recommendation = (
                "Verifier l'adequation entre quota et usage reel avant toute migration."
                if usage_pct >= 70
                else "Ce forfait semble surdimensionne; il peut etre arbitre sans forte rupture de service."
            )
            return (
                _build_structured_answer(
                    f"Analyse forfait - {metric.label}",
                    [
                        f"{metric.operator} | {metric.line_count} lignes | total {_format_mad(metric.total_cost_mad)}",
                        f"Cout moyen {_format_mad(metric.average_cost_mad)} par ligne",
                        f"Usage moyen observe {usage_pct} % du quota",
                        f"{metric.alert_count} alertes et {metric.over_quota_count} depassements associes",
                    ],
                    "Le meilleur arbitrage forfaitaire depend du decalage entre cout unitaire et usage reel.",
                    recommendation,
                ),
                False,
            )

    if summary.expensive_plans:
        top_plan = summary.expensive_plans[0]
        return (
            _build_structured_answer(
                "Forfaits a arbitrer",
                [
                    f"{top_plan.operator} / {top_plan.plan}: cout moyen {_format_mad(top_plan.average_cost_mad)}",
                    f"{top_plan.line_count} lignes et {top_plan.alert_count} alertes associees",
                    f"{summary.over_quota_count} depassements de quota visibles sur la flotte",
                ],
                "Les forfaits premium deviennent prioritaires quand le cout moyen reste eleve malgre des alertes repetees.",
                "Commencer par les forfaits a cout moyen eleve avec usage reel modere.",
            ),
            False,
        )

    return _build_general_answer(summary), True


def _build_budget_comparison_answer(
    question: str,
    entities: list[EntityMatch],
    snapshot: BusinessReasoningSnapshot,
) -> tuple[str, bool]:
    return _build_comparison_answer(question, entities, snapshot) or (
        _build_structured_answer(
            "Comparaison budgetaire",
            ["Les entites a comparer ne sont pas assez explicites dans la question."],
            "Le moteur a besoin d'au moins deux perimetres comparables ou d'un axe de comparaison explicite.",
            "Preciser deux operateurs, deux departements ou deux forfaits pour obtenir un comparatif cible.",
        ),
        True,
    )


def _build_budget_risk_answer(
    summary: "DataSummary",
    entities: list[EntityMatch],
    snapshot: BusinessReasoningSnapshot,
) -> tuple[str, bool]:
    scope_entity = _get_primary_scope_entity(entities, "operator", "department")
    scope_metric = _get_scope_metric(snapshot, scope_entity)
    if scope_entity is not None and scope_metric is not None:
        return (
            _build_structured_answer(
                f"Risque budgetaire - {scope_entity.label}",
                [
                    f"Risque moyen {_format_score(scope_metric.risk_score)}",
                    f"{scope_metric.alert_count} alertes actives",
                    f"{scope_metric.over_quota_count} depassements, {scope_metric.anomaly_count} anomalies",
                    f"Exposition appels suspects {_format_mad(scope_metric.suspicious_call_cost_mad)}",
                ],
                "Le risque budgetaire augmente quand alertes, usages hors quota et signaux suspects s'accumulent.",
                f"Traiter d'abord {scope_entity.label} sur les lignes a risque avant d'etendre l'analyse au reste de la flotte.",
            ),
            False,
        )

    return (
        _build_structured_answer(
            "Risque budgetaire",
            [
                f"{summary.critical_alert_count} alertes critiques visibles",
                f"{summary.over_quota_count} depassements de quota",
                f"{summary.suspicious_call_count} appels suspects",
                f"Projection budgetaire {_format_mad(summary.projected_monthly_cost_mad)}",
            ],
            "Le risque budgetaire vient surtout des poches qui cumulent projection haute, depassements et anomalies.",
            "Prioriser les perimetres combines les plus exposes avant toute action generaliste.",
        ),
        False,
    )


def _build_roaming_answer(
    summary: "DataSummary",
    entities: list[EntityMatch],
    snapshot: BusinessReasoningSnapshot,
) -> tuple[str, bool]:
    country_entity = next((entity for entity in entities if entity.kind == "country"), None)
    if country_entity is not None:
        metric = snapshot.countries.get(_snapshot_keyed_label(country_entity.label))
        if metric is not None:
            return (
                _build_structured_answer(
                    f"Analyse roaming - {metric.label}",
                    [
                        f"Cout roaming {_format_mad(metric.total_cost_mad)}",
                        f"{metric.event_count} signaux et {metric.alert_count} alertes",
                        f"{metric.suspicious_call_count} appels suspects relies a cette zone",
                    ],
                    "Le risque roaming augmente vite quand les couts unitaires et les alertes se concentrent sur le meme pays.",
                    f"Verifier la legitimite des voyages et activer des options roaming ciblees pour {metric.label}.",
                ),
                False,
            )

    top_country = max(
        snapshot.countries.values(),
        key=lambda item: (item.total_cost_mad, item.alert_count, item.event_count),
        default=None,
    )
    analysis = (
        f"Le pays le plus expose est {top_country.label}."
        if top_country is not None
        else "Les signaux roaming visibles restent disperses."
    )
    recommendation = (
        f"Commencer par {top_country.label} pour verifier couts, options et legitimite d'usage."
        if top_country is not None
        else "Verifier les lignes en roaming avant tout arbitrage forfaitaire."
    )
    return (
        _build_structured_answer(
            "Synthese roaming",
            [
                f"{summary.roaming_line_count} lignes en roaming",
                f"{summary.roaming_alert_count} alertes roaming",
                f"{summary.suspicious_call_count} appels suspects sur la flotte",
            ],
            analysis,
            recommendation,
        ),
        top_country is None,
    )


def _build_roaming_ranking_answer(
    snapshot: BusinessReasoningSnapshot,
    *,
    requested_limit: int | None,
) -> tuple[str, bool]:
    ranked_countries = sorted(
        snapshot.countries.values(),
        key=lambda country: (country.total_cost_mad, country.alert_count, country.suspicious_call_count),
        reverse=True,
    )[: _resolve_limit(requested_limit)]
    return (
        _build_structured_answer(
            f"Top {len(ranked_countries)} pays roaming",
            [
                f"{index}. {country.label} | {_format_mad(country.total_cost_mad)} | {country.event_count} signaux | {country.alert_count} alertes"
                for index, country in enumerate(ranked_countries, start=1)
            ],
            "Le classement roaming permet d'isoler les zones ou le cout et le risque montent en meme temps.",
            "Commencer par les premiers pays du classement pour ajuster options, seuils et politiques voyage.",
        ),
        False,
    )


def _build_roaming_optimization_answer(
    summary: "DataSummary",
    entities: list[EntityMatch],
    snapshot: BusinessReasoningSnapshot,
) -> tuple[str, bool]:
    country_entity = _get_primary_scope_entity(entities, "country")
    if country_entity is not None:
        metric = snapshot.countries.get(_snapshot_keyed_label(country_entity.label))
        if metric is not None:
            return (
                _build_structured_answer(
                    f"Optimisation roaming - {metric.label}",
                    [
                        f"Cout roaming {_format_mad(metric.total_cost_mad)}",
                        f"{metric.alert_count} alertes pour {metric.event_count} signaux",
                        f"{metric.suspicious_call_count} appels suspects dans cette zone",
                    ],
                    "L'optimisation roaming passe d'abord par les zones ou les couts unitaires restent eleves a faible controle.",
                    f"Poser un seuil de validation et une option roaming ciblee pour {metric.label} avant le prochain voyage.",
                ),
                False,
            )

    top_country = max(
        snapshot.countries.values(),
        key=lambda item: (item.total_cost_mad, item.alert_count, item.suspicious_call_count),
        default=None,
    )
    recommendation = (
        f"Definir des seuils et une politique roaming prioritairement sur {top_country.label}."
        if top_country is not None
        else "Mettre en place des seuils roaming et des options de voyage par defaut."
    )
    return (
        _build_structured_answer(
            "Optimisation roaming",
            [
                f"{summary.roaming_line_count} lignes roaming actuellement visibles",
                f"{summary.roaming_alert_count} alertes roaming",
                f"{summary.suspicious_call_count} appels suspects associes",
            ],
            "La reduction roaming vient surtout d'une meilleure politique de seuils, d'options de voyage et de validation des usages.",
            recommendation,
        ),
        top_country is None,
    )


def _build_roaming_statistics_answer(
    summary: "DataSummary",
    snapshot: BusinessReasoningSnapshot,
) -> tuple[str, bool]:
    top_country = max(snapshot.countries.values(), key=lambda item: item.total_cost_mad, default=None)
    return (
        _build_structured_answer(
            "Statistiques roaming",
            [
                f"{summary.roaming_line_count} lignes roaming",
                f"{summary.roaming_alert_count} alertes roaming",
                f"{len(snapshot.countries)} pays visibles dans les signaux roaming",
                f"Pays principal: {top_country.label} ({_format_mad(top_country.total_cost_mad)})" if top_country is not None else "Aucun pays dominant visible",
            ],
            "Les statistiques roaming servent surtout a mesurer la concentration geographique du risque.",
            "Suivre l'evolution des pays dominants et des alertes pour ajuster la politique voyage.",
        ),
        False,
    )


def _build_fraud_answer(
    summary: "DataSummary",
    entities: list[EntityMatch],
    snapshot: BusinessReasoningSnapshot,
) -> tuple[str, bool]:
    scope_entity = next((entity for entity in entities if entity.kind in {"operator", "department"}), None)
    if scope_entity is not None:
        collection = snapshot.operators if scope_entity.kind == "operator" else snapshot.departments
        metric = collection.get(_snapshot_keyed_label(scope_entity.label))
        if metric is not None and metric.suspicious_call_count > 0:
            return (
                _build_structured_answer(
                    f"Risque fraude - {scope_entity.label}",
                    [
                        f"{metric.suspicious_call_count} appels suspects",
                        f"Exposition estimee {_format_mad(metric.suspicious_call_cost_mad)}",
                        f"{metric.alert_count} alertes et risque moyen {_format_score(metric.risk_score)}",
                    ],
                    "Les signaux de fraude sont credibles quand appels suspects, couts et alertes convergent sur le meme perimetre.",
                    f"Auditer rapidement {scope_entity.label} puis verifier les usages internationaux ou a haut cout.",
                ),
                False,
            )

    return (
        _build_structured_answer(
            "Synthese fraude et anomalies",
            [
                f"{summary.suspicious_call_count} appels suspects sur {summary.total_call_count} appels",
                f"Exposition visible {_format_mad(summary.suspicious_call_cost_mad)}",
                f"{summary.fraud_alert_count} alertes fraude ou haut cout",
                f"{summary.high_cost_call_count} appels a cout eleve",
            ],
            "Les appels suspects constituent le meilleur signal de fraude immediate dans les donnees disponibles.",
            "Prioriser les appels a haut cout puis verifier les cas de roaming et de repetition nocturne.",
        ),
        False,
    )


def _build_fraud_ranking_answer(
    snapshot: BusinessReasoningSnapshot,
    *,
    requested_limit: int | None,
) -> tuple[str, bool]:
    ranked_scopes = sorted(
        snapshot.departments.values(),
        key=lambda metric: (metric.suspicious_call_count, metric.suspicious_call_cost_mad, metric.alert_count),
        reverse=True,
    )[: _resolve_limit(requested_limit)]
    return (
        _build_structured_answer(
            f"Top {len(ranked_scopes)} perimetres fraude",
            [
                f"{index}. {metric.label} | {metric.suspicious_call_count} appels suspects | {_format_mad(metric.suspicious_call_cost_mad)} | {metric.alert_count} alertes"
                for index, metric in enumerate(ranked_scopes, start=1)
            ],
            "Le classement fraude permet de cibler les poches ou le volume suspect se convertit le plus vite en cout.",
            "Traiter en priorite les premiers perimetres du classement avec revue des appels et controles renforces.",
        ),
        False,
    )


def _build_fraud_risk_answer(
    summary: "DataSummary",
    entities: list[EntityMatch],
    snapshot: BusinessReasoningSnapshot,
) -> tuple[str, bool]:
    scope_entity = _get_primary_scope_entity(entities, "operator", "department")
    scope_metric = _get_scope_metric(snapshot, scope_entity)
    if scope_entity is not None and scope_metric is not None:
        return (
            _build_structured_answer(
                f"Analyse de risque fraude - {scope_entity.label}",
                [
                    f"{scope_metric.suspicious_call_count} appels suspects",
                    f"Exposition {_format_mad(scope_metric.suspicious_call_cost_mad)}",
                    f"Risque {_format_score(scope_metric.risk_score)} et {scope_metric.alert_count} alertes",
                ],
                "Le risque fraude est eleve quand les appels suspects se repetent avec un impact financier visible.",
                f"Renforcer les controles d'usage et les seuils d'alerte sur {scope_entity.label}.",
            ),
            False,
        )

    return (
        _build_structured_answer(
            "Analyse de risque fraude",
            [
                f"{summary.suspicious_call_count} appels suspects",
                f"{summary.fraud_alert_count} alertes fraude ou haut cout",
                f"Exposition {_format_mad(summary.suspicious_call_cost_mad)}",
                f"{summary.high_cost_call_count} appels a cout eleve",
            ],
            "Le niveau de risque fraude depend surtout de l'intensite des signaux suspects et de leur cout potentiel.",
            "Prioriser les perimetres a forte exposition puis verifier les patterns internationaux et roaming.",
        ),
        False,
    )


def _build_lines_answer(
    summary: "DataSummary",
    entities: list[EntityMatch],
    snapshot: BusinessReasoningSnapshot,
) -> tuple[str, bool]:
    line_entity = next((entity for entity in entities if entity.kind == "line"), None)
    if line_entity is not None:
        metric = snapshot.lines.get(_snapshot_keyed_label(line_entity.label))
        if metric is not None:
            return (
                _build_structured_answer(
                    f"Ligne cible - {metric.label}",
                    [
                        f"Operateur {metric.operator} | departement {metric.department}",
                        f"Statut {metric.status} | usage {_format_usage(metric.usage_gb, metric.quota_gb)}",
                        f"Cout estime {_format_mad(metric.monthly_cost_mad)} | risque {_format_score(metric.risk_score)}",
                    ],
                    "Une ligne devient prioritaire quand statut, usage et cout indiquent un risque de sous-usage ou de depassement.",
                    "Verifier l'attribution, l'usage reel et l'adequation du forfait avant toute nouvelle depense.",
                ),
                False,
            )

    return (
        _build_structured_answer(
            "Etat des lignes",
            [
                f"{summary.total_lines} lignes au total",
                f"{summary.free_lines} libres, {summary.assigned_lines} attribuees, {summary.in_progress_lines} en cours",
                f"{summary.suspended_lines} suspendues et {summary.inactive_lines} inactives",
                f"{len(summary.critical_lines)} lignes critiques actuellement visibles",
            ],
            "La meilleure reserve d'optimisation immediate reste la reaffectation des lignes libres ou peu saines.",
            "Traiter d'abord les lignes suspendues et inactives, puis recycler les lignes libres premium.",
        ),
        False,
    )


def _build_lines_optimization_answer(
    summary: "DataSummary",
    entities: list[EntityMatch],
    snapshot: BusinessReasoningSnapshot,
) -> tuple[str, bool]:
    scope_entity = _get_primary_scope_entity(entities, "operator", "department")
    underused_lines = _rank_underused_lines(snapshot, scope_entity)[:3]
    scope_label = scope_entity.label if scope_entity is not None else "la flotte"
    if underused_lines:
        return (
            _build_structured_answer(
                f"Optimisation lignes - {scope_label}",
                [
                    f"{line.label} | {line.operator} | {line.plan} | {_format_mad(line.monthly_cost_mad)} | usage {_format_usage(line.usage_gb, line.quota_gb)}"
                    for line in underused_lines
                ],
                "Les lignes a faible usage, libres ou suspendues sont le premier levier de reaffectation sans depense additionnelle.",
                f"Reallouer ou degrader d'abord ces lignes sur {scope_label} avant toute ouverture de nouvelle ligne.",
            ),
            False,
        )

    return _build_lines_answer(summary, entities, snapshot)


def _build_lines_ranking_answer(
    snapshot: BusinessReasoningSnapshot,
    entities: list[EntityMatch],
    *,
    requested_limit: int | None,
) -> tuple[str, bool]:
    scope_entity = _get_primary_scope_entity(entities, "operator", "department")
    ranked_lines = _rank_critical_lines(snapshot, scope_entity)[: _resolve_limit(requested_limit)]
    scope_label = scope_entity.label if scope_entity is not None else "la flotte"
    return (
        _build_structured_answer(
            f"Top {len(ranked_lines)} lignes critiques - {scope_label}",
            [
                f"{index}. {line.label} | {line.operator} | {line.plan} | risque {_format_score(line.risk_score)} | {_format_usage(line.usage_gb, line.quota_gb)}"
                for index, line in enumerate(ranked_lines, start=1)
            ],
            "Le classement permet de prioriser les lignes qui combinent surcout, criticite et usage sensible.",
            "Traiter d'abord les premieres lignes du classement avant une action plus globale.",
        ),
        False,
    )


def _build_equipment_answer(summary: "DataSummary") -> tuple[str, bool]:
    return (
        _build_structured_answer(
            "Inventaire et equipements",
            [
                f"{summary.mobile_device_total} equipements suivis",
                f"{summary.mobile_critical_count} equipements ou profils critiques",
                f"{summary.mobile_alert_count} alertes materiel ou budget mobile",
                f"{summary.free_lines} lignes libres pouvant absorber de nouveaux besoins",
            ],
            "Selon les donnees disponibles, la priorite equipement se lit surtout via les alertes budget mobile et la capacite libre de la flotte.",
            "Verifier les profils critiques, les terminaux surdimensionnes et les lignes libres premium avant tout renouvellement.",
        ),
        True,
    )


def _build_equipment_inventory_answer(
    summary: "DataSummary",
    snapshot: BusinessReasoningSnapshot,
    *,
    requested_limit: int | None,
) -> tuple[str, bool]:
    ranked_categories = sorted(
        snapshot.device_categories.values(),
        key=lambda category: (category.device_count, category.estimated_cost_mad, category.alert_count),
        reverse=True,
    )[: _resolve_limit(requested_limit)]
    return (
        _build_structured_answer(
            "Inventaire equipements",
            [
                f"{index}. {category.label} | {category.device_count} equipements | {_format_mad(category.estimated_cost_mad)} | {category.alert_count} alertes"
                for index, category in enumerate(ranked_categories, start=1)
            ]
            or [f"{summary.mobile_device_total} equipements suivis"],
            "L'inventaire met en evidence les categories qui concentrent volume, cout et exposition.",
            "Verifier d'abord les categories les plus representees et les plus alertantes du parc.",
        ),
        False,
    )


def _build_equipment_optimization_answer(
    summary: "DataSummary",
    snapshot: BusinessReasoningSnapshot,
) -> tuple[str, bool]:
    ranked_categories = sorted(
        snapshot.device_categories.values(),
        key=lambda category: (category.critical_count, category.average_risk_score, category.estimated_cost_mad),
        reverse=True,
    )
    top_category = ranked_categories[0] if ranked_categories else None
    return (
        _build_structured_answer(
            "Optimisation equipements",
            [
                f"{summary.mobile_critical_count} equipements ou profils critiques",
                f"{summary.mobile_alert_count} alertes materiel ou budget mobile",
                f"Priorite categorie: {top_category.label} | risque {_format_score(top_category.average_risk_score)} | {top_category.critical_count} critiques"
                if top_category is not None
                else "Aucune categorie dominante visible",
            ],
            "L'optimisation equipement repose sur le renouvellement cible des categories les plus couteuses et les plus risquees.",
            f"Planifier en premier le renouvellement ou l'audit de {top_category.label}."
            if top_category is not None
            else "Prioriser les equipements les plus critiques avant toute extension du parc.",
        ),
        top_category is None,
    )


def _build_equipment_ranking_answer(
    snapshot: BusinessReasoningSnapshot,
    *,
    requested_limit: int | None,
) -> tuple[str, bool]:
    ranked_categories = sorted(
        snapshot.device_categories.values(),
        key=lambda category: (category.average_risk_score, category.critical_count, category.alert_count),
        reverse=True,
    )[: _resolve_limit(requested_limit)]
    return (
        _build_structured_answer(
            f"Top {len(ranked_categories)} categories equipement",
            [
                f"{index}. {category.label} | risque {_format_score(category.average_risk_score)} | {category.critical_count} critiques | {category.device_count} equipements"
                for index, category in enumerate(ranked_categories, start=1)
            ],
            "Le classement permet de cibler d'abord les categories qui combinent risque et densite de parc.",
            "Traiter les premieres categories avant d'elargir le plan de renouvellement.",
        ),
        False,
    )


def _build_statistics_answer(summary: "DataSummary") -> tuple[str, bool]:
    return (
        _build_structured_answer(
            "KPI flotte",
            [
                f"Budget {_format_mad(summary.total_monthly_cost_mad)} | projection {_format_mad(summary.projected_monthly_cost_mad)}",
                f"{summary.alert_count} alertes dont {summary.critical_alert_count} critiques",
                f"{summary.over_quota_count} depassements de quota et {summary.anomaly_count} anomalies",
                f"{summary.roaming_line_count} lignes roaming et {summary.suspicious_call_count} appels suspects",
            ],
            "Ces KPI montrent une flotte ou couts, usages et risque restent relies entre eux.",
            "Suivre en priorite les KPI qui montent simultanement: projection budgetaire, alertes critiques et appels suspects.",
        ),
        False,
    )


def _build_recommendation_answer(summary: "DataSummary") -> tuple[str, bool]:
    if summary.recommendations:
        return (
            _build_structured_answer(
                "Actions recommandees",
                summary.recommendations[:3],
                "Les recommandations repetitives signalent les leviers d'optimisation les plus actionnables a court terme.",
                summary.recommendations[0],
            ),
            False,
        )

    return _build_general_answer(summary), True


def _build_audit_answer(
    summary: "DataSummary",
    entities: list[EntityMatch],
    snapshot: BusinessReasoningSnapshot,
) -> tuple[str, bool]:
    scope_entity = next((entity for entity in entities if entity.kind in {"operator", "department"}), None)
    if scope_entity is not None:
        collection = snapshot.operators if scope_entity.kind == "operator" else snapshot.departments
        metric = collection.get(_snapshot_keyed_label(scope_entity.label))
        if metric is not None:
            return (
                _build_structured_answer(
                    f"Angle d'audit - {scope_entity.label}",
                    [
                        f"{metric.alert_count} alertes visibles",
                        f"Risque moyen {_format_score(metric.risk_score)}",
                        f"{metric.over_quota_count} depassements et {metric.suspicious_call_count} appels suspects",
                    ],
                    "Un audit prioritaire doit viser le perimetre ou cout, alertes et signaux suspects s'additionnent.",
                    f"Auditer d'abord {scope_entity.label} sur les usages hors politique, le roaming et les lignes a cout anormal.",
                ),
                False,
            )

    return (
        _build_structured_answer(
            "Synthese audit et conformite",
            [
                f"{summary.alert_count} alertes a verifier",
                f"{summary.roaming_alert_count} signaux roaming",
                f"{summary.suspicious_call_count} appels suspects",
                f"{summary.free_lines + summary.inactive_lines} lignes disponibles ou a requalifier",
            ],
            "Les indicateurs suggerent que les controles doivent prioriser usages, roaming et lignes a faible valeur ajoutee.",
            "Lancer un audit cible sur les lignes critiques, le roaming a cout eleve et les forfaits surdimensionnes.",
        ),
        True,
    )


def _build_planning_answer(summary: "DataSummary") -> tuple[str, bool]:
    top_line = summary.critical_lines[0] if summary.critical_lines else None
    top_operator = summary.expensive_operators[0] if summary.expensive_operators else None
    top_department = summary.risky_departments[0] if summary.risky_departments else None
    metrics = []
    if top_line is not None:
        metrics.append(
            f"J1 - securiser {top_line.label} ({top_line.operator}) | score {_format_score(top_line.risk_score)} | {top_line.usage_label}"
        )
    if top_department is not None:
        metrics.append(
            f"J2 - auditer {top_department.label} | {_format_mad(top_department.monthly_cost_mad)} | {top_department.alert_count} alertes"
        )
    if top_operator is not None:
        metrics.append(
            f"J3 - arbitrer {top_operator.label} | {_format_mad(top_operator.monthly_cost_mad)} | risque {_format_score(top_operator.risk_score)}"
        )
    if summary.roaming_geo_highlights:
        metrics.append(f"J4 - verifier roaming: {summary.roaming_geo_highlights[0]}")

    return (
        _build_structured_answer(
            "Plan d'action priorise",
            metrics or ["Aucune priorite critique detectee cette semaine"],
            "La planification doit d'abord traiter le risque immediat, puis les poches de cout et enfin les leviers d'optimisation.",
            "Executer les actions dans cet ordre pour maximiser l'impact la premiere semaine.",
        ),
        False,
    )


def _format_pct(value: float) -> str:
    return f"{round(value * 100)} %"


def _build_potential_savings_answer(
    summary: "DataSummary",
    entities: list[EntityMatch],
    snapshot: BusinessReasoningSnapshot,
) -> tuple[str, bool]:
    scope_entity = _get_primary_scope_entity(entities, "operator", "department")
    candidate_lines = _rank_underused_lines(snapshot, scope_entity)[:4]
    monthly_savings = sum(line.monthly_cost_mad for line in candidate_lines)
    if monthly_savings <= 0:
        scope_metric = _get_scope_metric(snapshot, scope_entity)
        monthly_savings = max(
            (scope_metric.projected_monthly_cost_mad - scope_metric.monthly_cost_mad) if scope_metric is not None else 0.0,
            summary.projected_monthly_cost_mad - summary.total_monthly_cost_mad,
        )
    annual_savings = monthly_savings * 12
    scope_label = scope_entity.label if scope_entity is not None else "la flotte"
    metrics = [
        f"Economies mensuelles potentielles {_format_mad(monthly_savings)}",
        f"Projection annuelle {_format_mad(annual_savings)}",
    ]
    if candidate_lines:
        metrics.append(f"{len(candidate_lines)} lignes sous-utilisees concentrent ce gisement")
        metrics.extend(
            f"{line.label} | {line.plan} | {_format_mad(line.monthly_cost_mad)} | usage {_format_usage(line.usage_gb, line.quota_gb)}"
            for line in candidate_lines[:2]
        )
    return (
        _build_structured_answer(
            f"Economies potentielles - {scope_label}",
            metrics,
            "Le gisement d'economies repose d'abord sur les lignes sous-utilisees, les forfaits premium et l'ecart projete entre cout actuel et trajectoire a venir.",
            f"Arbitrer en premier les lignes et forfaits les moins utilises sur {scope_label} pour capturer rapidement les economies identifiees.",
        ),
        False,
    )


def _build_oversized_plan_answer(
    summary: "DataSummary",
    entities: list[EntityMatch],
    snapshot: BusinessReasoningSnapshot,
) -> tuple[str, bool]:
    scope_entity = _get_primary_scope_entity(entities, "operator", "plan")
    candidate_plans = [
        plan
        for plan in _filter_scope_plans(snapshot, scope_entity)
        if plan.average_usage_ratio <= 0.8
    ]
    candidate_plans = sorted(
        candidate_plans,
        key=lambda plan: (1 - plan.average_usage_ratio, plan.average_cost_mad, plan.line_count),
        reverse=True,
    )
    if not candidate_plans:
        candidate_plans = sorted(
            _filter_scope_plans(snapshot, scope_entity),
            key=lambda plan: (plan.average_cost_mad, 1 - plan.average_usage_ratio, plan.line_count),
            reverse=True,
        )[:3]
    scope_label = scope_entity.label if scope_entity is not None else "la flotte"
    return (
        _build_structured_answer(
            f"Forfaits surdimensionnes - {scope_label}",
            [
                f"{index}. {plan.operator} / {plan.label} | cout moyen {_format_mad(plan.average_cost_mad)} | usage moyen {_format_pct(plan.average_usage_ratio)} | {plan.line_count} lignes"
                for index, plan in enumerate(candidate_plans[:3], start=1)
            ] or [f"{summary.expensive_plans[0].plan} reste le forfait le plus couteux visible"] if summary.expensive_plans else [],
            "Un forfait devient surdimensionne quand le cout moyen reste eleve alors que l'usage moyen du quota reste durablement inferieur au besoin reel.",
            "Reviser en priorite les plans dont l'usage moyen reste inferieur a 80% du quota et dont le cout unitaire reste dans le haut du portefeuille.",
        ),
        False,
    )


def _build_quota_overrun_answer(
    summary: "DataSummary",
    entities: list[EntityMatch],
    snapshot: BusinessReasoningSnapshot,
) -> tuple[str, bool]:
    scope_entity = _get_primary_scope_entity(entities, "operator", "department")
    risky_lines = [
        line
        for line in _rank_critical_lines(snapshot, scope_entity)
        if line.quota_gb not in (None, 0) and (line.usage_gb / line.quota_gb) >= 0.9
    ][:3]
    scope_label = scope_entity.label if scope_entity is not None else "la flotte"
    metrics = [
        f"{summary.over_quota_count} depassements de quota visibles",
        f"{summary.critical_alert_count} alertes critiques reliees aux usages sensibles",
    ]
    if risky_lines:
        metrics.extend(
            f"{line.label} | {line.plan} | usage {_format_usage(line.usage_gb, line.quota_gb)} | risque {_format_score(line.risk_score)}"
            for line in risky_lines
        )
    return (
        _build_structured_answer(
            f"Depassements de quota - {scope_label}",
            metrics,
            "Les depassements se concentrent d'abord sur les lignes qui approchent ou depassent structurellement leur enveloppe, ce qui alimente les surcouts et les alertes.",
            f"Traiter immediatement les lignes en depassement recurrent sur {scope_label}, puis ajuster le forfait ou la politique d'usage.",
        ),
        False,
    )


def _build_suspicious_calls_answer(
    summary: "DataSummary",
    entities: list[EntityMatch],
    snapshot: BusinessReasoningSnapshot,
) -> tuple[str, bool]:
    scope_entity = _get_primary_scope_entity(entities, "operator", "department")
    scope_metric = _get_scope_metric(snapshot, scope_entity)
    if scope_metric is not None:
        return (
            _build_structured_answer(
                f"Classement prioritaire - appels suspects - {scope_entity.label}",
                [
                    f"{scope_metric.suspicious_call_count} appels suspects",
                    f"Exposition estimee {_format_mad(scope_metric.suspicious_call_cost_mad)}",
                    f"{scope_metric.alert_count} alertes et {scope_metric.roaming_count} signaux roaming associes",
                ],
                "Les communications suspectes deviennent prioritaires quand elles combinent repetition, cout eleve et convergence avec d'autres alertes de risque.",
                f"Auditer rapidement les appels suspects de {scope_entity.label}, en priorite sur les cas a haut cout ou lies au roaming.",
            ),
            False,
        )

    return (
        _build_structured_answer(
            "Classement prioritaire - appels suspects",
            [
                f"{summary.suspicious_call_count} appels suspects detectes",
                f"Exposition visible {_format_mad(summary.suspicious_call_cost_mad)}",
                f"{summary.high_cost_call_count} appels a cout eleve",
            ],
            "Le volume suspect doit etre lu avec son exposition financiere pour isoler les cas qui meritent un audit immediat.",
            "Traiter d'abord les communications a haut cout et celles qui se repetent sur le meme perimetre.",
        ),
        False,
    )


def _build_maintenance_answer(
    summary: "DataSummary",
    snapshot: BusinessReasoningSnapshot,
) -> tuple[str, bool]:
    ranked_categories = sorted(
        snapshot.device_categories.values(),
        key=lambda category: (category.critical_count, category.average_risk_score, category.estimated_cost_mad),
        reverse=True,
    )
    top_category = ranked_categories[0] if ranked_categories else None
    return (
        _build_structured_answer(
            "Maintenance et sante du parc",
            [
                f"{summary.mobile_device_total} equipements suivis",
                f"{summary.mobile_critical_count} equipements ou profils critiques",
                f"{summary.mobile_alert_count} alertes materiel ou budget mobile",
                f"Priorite maintenance: {top_category.label} | risque {_format_score(top_category.average_risk_score)} | {top_category.critical_count} critiques"
                if top_category is not None
                else "Aucune categorie critique dominante n'apparait",
            ],
            "La maintenance doit cibler en premier les categories qui cumulent criticite, anciennete probable et poids financier dans le parc.",
            f"Lancer un audit de maintenance sur {top_category.label} avant un renouvellement plus large."
            if top_category is not None
            else "Prioriser les equipements critiques avant toute extension du parc.",
        ),
        top_category is None,
    )


def _build_consumption_answer(
    summary: "DataSummary",
    entities: list[EntityMatch],
    snapshot: BusinessReasoningSnapshot,
    *,
    requested_limit: int | None,
) -> tuple[str, bool]:
    scope_entity = _get_primary_scope_entity(entities, "operator", "department", "line", "plan")
    critical_lines = _rank_critical_lines(snapshot, scope_entity)[: _resolve_limit(requested_limit)]
    scope_label = scope_entity.label if scope_entity is not None else "la flotte"
    return (
        _build_structured_answer(
            f"Consommation telecom - {scope_label}",
            [
                f"{index}. {line.label} | {line.plan} | usage {_format_usage(line.usage_gb, line.quota_gb)} | risque {_format_score(line.risk_score)}"
                for index, line in enumerate(critical_lines, start=1)
            ]
            or [
                f"{summary.over_quota_count} depassements de quota",
                f"{summary.anomaly_count} anomalies de consommation",
            ],
            "L'analyse de consommation doit rapprocher usage reel, quota souscrit et criticite pour detecter les lignes qui derapent ou restent sous-utilisees.",
            f"Suivre d'abord les lignes les plus consommatrices sur {scope_label}, puis ajuster les forfaits ou plafonds associes.",
        ),
        False,
    )


def _build_operator_intent_answer(
    question: str,
    summary: "DataSummary",
    entities: list[EntityMatch],
    snapshot: BusinessReasoningSnapshot,
    *,
    requested_limit: int | None,
) -> tuple[str, bool]:
    normalized_question = _normalize_text(question)
    if "compare" in normalized_question or "comparaison" in normalized_question or len([entity for entity in entities if entity.kind == "operator"]) >= 2:
        return _build_budget_comparison_answer(question, entities, snapshot)
    return _build_budget_ranking_answer(
        "operateur " + question if "operateur" not in normalized_question else question,
        summary,
        snapshot,
        requested_limit=requested_limit,
    )


def _build_department_intent_answer(
    question: str,
    summary: "DataSummary",
    entities: list[EntityMatch],
    snapshot: BusinessReasoningSnapshot,
    *,
    requested_limit: int | None,
) -> tuple[str, bool]:
    normalized_question = _normalize_text(question)
    if "compare" in normalized_question or "comparaison" in normalized_question or len([entity for entity in entities if entity.kind == "department"]) >= 2:
        return _build_budget_comparison_answer(question, entities, snapshot)
    return _build_budget_ranking_answer(
        "departement " + question if "departement" not in normalized_question else question,
        summary,
        snapshot,
        requested_limit=requested_limit,
    )


def _build_trends_answer(
    summary: "DataSummary",
    entities: list[EntityMatch],
    snapshot: BusinessReasoningSnapshot,
    *,
    primary_domain: str,
) -> tuple[str, bool]:
    if primary_domain == "roaming":
        return _build_roaming_statistics_answer(summary, snapshot)
    if primary_domain in {"fraud", "risk"}:
        return _build_fraud_risk_answer(summary, entities, snapshot)
    return _build_budget_estimation_answer(summary, entities, snapshot)


def _build_forecast_answer(
    summary: "DataSummary",
    entities: list[EntityMatch],
    snapshot: BusinessReasoningSnapshot,
    *,
    primary_domain: str,
) -> tuple[str, bool]:
    if primary_domain == "roaming":
        return _build_roaming_statistics_answer(summary, snapshot)
    return _build_budget_estimation_answer(summary, entities, snapshot)


def _build_recommendations_intent_answer(
    summary: "DataSummary",
    entities: list[EntityMatch],
    snapshot: BusinessReasoningSnapshot,
    *,
    primary_domain: str,
) -> tuple[str, bool]:
    if primary_domain == "roaming":
        return _build_roaming_optimization_answer(summary, entities, snapshot)
    if primary_domain in {"fraud", "risk"}:
        return _build_fraud_risk_answer(summary, entities, snapshot)
    if primary_domain in {"equipment", "maintenance"}:
        return _build_equipment_optimization_answer(summary, snapshot)
    if primary_domain in {"plans", "consumption"}:
        return _build_plan_answer(summary, entities, snapshot)
    return _build_recommendation_answer(summary)


def _build_prioritization_answer(summary: "DataSummary") -> tuple[str, bool]:
    top_line = summary.critical_lines[0] if summary.critical_lines else None
    top_department = summary.risky_departments[0] if summary.risky_departments else None
    top_operator = summary.expensive_operators[0] if summary.expensive_operators else None
    metrics = []
    if top_line is not None:
        metrics.append(
            f"1. {top_line.label} | {top_line.operator} | risque {_format_score(top_line.risk_score)} | {top_line.usage_label}"
        )
    if top_department is not None:
        metrics.append(
            f"2. {top_department.label} | {_format_mad(top_department.monthly_cost_mad)} | {top_department.alert_count} alertes"
        )
    if top_operator is not None:
        metrics.append(
            f"3. {top_operator.label} | {_format_mad(top_operator.monthly_cost_mad)} | risque {_format_score(top_operator.risk_score)}"
        )
    return (
        _build_structured_answer(
            "Classement prioritaire - actions",
            metrics or ["Aucune priorite evidente n'apparait dans les donnees disponibles"],
            "La priorisation doit securiser d'abord le risque immediat, puis la poche budgetaire la plus dense, puis les leviers structurels.",
            "Traiter les actions dans cet ordre pour maximiser l'impact de la prochaine revue telecome.",
        ),
        False,
    )


def _build_compliance_answer(
    summary: "DataSummary",
    entities: list[EntityMatch],
    snapshot: BusinessReasoningSnapshot,
) -> tuple[str, bool]:
    scope_entity = _get_primary_scope_entity(entities, "operator", "department")
    scope_metric = _get_scope_metric(snapshot, scope_entity)
    scope_label = scope_entity.label if scope_entity is not None else "la flotte"
    metrics = []
    if scope_metric is not None:
        metrics.extend(
            [
                f"{scope_metric.alert_count} alertes a verifier",
                f"{scope_metric.over_quota_count} depassements et {scope_metric.suspicious_call_count} appels suspects",
                f"{scope_metric.roaming_count} signaux roaming hors perimetre habituel",
            ]
        )
    else:
        metrics.extend(
            [
                f"{summary.alert_count} alertes a verifier",
                f"{summary.over_quota_count} depassements de quota",
                f"{summary.suspicious_call_count} appels suspects",
            ]
        )
    return (
        _build_structured_answer(
            f"Conformite telecom - {scope_label}",
            metrics,
            "La conformite se lit a travers les usages hors politique potentielle: roaming non justifie, depassements repetes, lignes peu legitimes et communications sensibles.",
            f"Lancer une revue de conformite ciblee sur {scope_label}, en priorite sur les usages hors politique et les lignes a valeur ajoutee incertaine.",
        ),
        False,
    )


def _resolve_strategy_key(
    primary_domain: str,
    request_type: str,
) -> str:
    return f"{primary_domain}:{request_type}"


def _resolve_response_shape(request_type: str) -> str:
    return REQUEST_TYPE_RESPONSE_SHAPES.get(request_type, "summary")


def _build_domain_request_answer(
    question: str,
    history: list["ChatContextMessage"],
    summary: "DataSummary",
    snapshot: BusinessReasoningSnapshot,
    primary_domain: str,
    request_type: str,
    entities: list[EntityMatch],
    *,
    requested_limit: int | None,
) -> tuple[str, bool, str, str]:
    del history  # The routing itself is deterministic once entities/domain/request are resolved.

    strategy_key = _resolve_strategy_key(primary_domain, request_type)
    response_shape = _resolve_response_shape(request_type)

    if primary_domain in {"budget", "cost", "operators", "departments"}:
        if request_type == "optimization":
            answer, needs_inference = _build_budget_optimization_answer(summary, entities, snapshot)
        elif request_type in {"estimation", "forecast", "simulation", "trends"}:
            answer, needs_inference = _build_budget_estimation_answer(summary, entities, snapshot)
        elif request_type == "comparison":
            answer, needs_inference = _build_budget_comparison_answer(question, entities, snapshot)
        elif request_type == "ranking":
            answer, needs_inference = _build_budget_ranking_answer(
                question,
                summary,
                snapshot,
                requested_limit=requested_limit,
            )
        elif request_type in {"diagnostic", "explanation"}:
            answer, needs_inference = _build_budget_diagnostic_answer(summary, entities, snapshot)
        elif request_type == "risk_analysis":
            answer, needs_inference = _build_budget_risk_answer(summary, entities, snapshot)
        elif request_type in {"recommendation", "opportunities"}:
            answer, needs_inference = _build_budget_optimization_answer(summary, entities, snapshot)
        else:
            answer, needs_inference = _build_budget_summary_answer(summary, entities, snapshot)
        return answer, needs_inference, strategy_key, response_shape

    if primary_domain in {"plans", "consumption"}:
        if request_type == "comparison":
            answer, needs_inference = _build_budget_comparison_answer(question, entities, snapshot)
        elif request_type == "ranking":
            answer, needs_inference = _build_budget_ranking_answer(
                "forfait " + question,
                summary,
                snapshot,
                requested_limit=requested_limit,
            )
        elif request_type in {"optimization", "recommendation", "opportunities"}:
            answer, needs_inference = _build_plan_answer(summary, entities, snapshot)
        elif request_type in {"estimation", "forecast", "trends"}:
            answer, needs_inference = _build_budget_estimation_answer(summary, entities, snapshot)
        else:
            answer, needs_inference = _build_plan_answer(summary, entities, snapshot)
        return answer, needs_inference, strategy_key, response_shape

    if primary_domain == "roaming":
        if request_type == "comparison":
            answer, needs_inference = _build_budget_comparison_answer(question, entities, snapshot)
        elif request_type == "ranking":
            answer, needs_inference = _build_roaming_ranking_answer(snapshot, requested_limit=requested_limit)
        elif request_type in {"optimization", "recommendation", "opportunities"}:
            answer, needs_inference = _build_roaming_optimization_answer(summary, entities, snapshot)
        elif request_type in {"statistics", "estimation"}:
            answer, needs_inference = _build_roaming_statistics_answer(summary, snapshot)
        elif request_type in {"diagnostic", "explanation", "risk_analysis"}:
            answer, needs_inference = _build_roaming_answer(summary, entities, snapshot)
        else:
            answer, needs_inference = _build_roaming_answer(summary, entities, snapshot)
        return answer, needs_inference, strategy_key, response_shape

    if primary_domain in {"fraud", "risk"}:
        if request_type == "ranking":
            answer, needs_inference = _build_fraud_ranking_answer(snapshot, requested_limit=requested_limit)
        elif request_type in {"risk_analysis", "statistics"}:
            answer, needs_inference = _build_fraud_risk_answer(summary, entities, snapshot)
        else:
            answer, needs_inference = _build_fraud_answer(summary, entities, snapshot)
        return answer, needs_inference, strategy_key, response_shape

    if primary_domain in {"equipment", "maintenance"}:
        if request_type == "inventory":
            answer, needs_inference = _build_equipment_inventory_answer(
                summary,
                snapshot,
                requested_limit=requested_limit,
            )
        elif request_type == "ranking":
            answer, needs_inference = _build_equipment_ranking_answer(
                snapshot,
                requested_limit=requested_limit,
            )
        elif request_type in {"optimization", "recommendation", "opportunities"}:
            answer, needs_inference = _build_equipment_optimization_answer(summary, snapshot)
        else:
            answer, needs_inference = _build_equipment_answer(summary)
        return answer, needs_inference, strategy_key, response_shape

    if primary_domain in {"inventory", "users", "lines"}:
        if request_type == "inventory":
            answer, needs_inference = _build_lines_answer(summary, entities, snapshot)
        elif request_type == "ranking":
            answer, needs_inference = _build_lines_ranking_answer(
                snapshot,
                entities,
                requested_limit=requested_limit,
            )
        elif request_type in {"optimization", "recommendation"}:
            answer, needs_inference = _build_lines_optimization_answer(summary, entities, snapshot)
        else:
            answer, needs_inference = _build_lines_answer(summary, entities, snapshot)
        return answer, needs_inference, strategy_key, response_shape

    if primary_domain in {"performance", "kpi"}:
        if request_type in {"planning"}:
            answer, needs_inference = _build_planning_answer(summary)
        else:
            answer, needs_inference = _build_statistics_answer(summary)
        return answer, needs_inference, strategy_key, response_shape

    if primary_domain in {"planning"}:
        answer, needs_inference = _build_planning_answer(summary)
        return answer, needs_inference, strategy_key, "action_plan"

    if primary_domain in {"audit"}:
        answer, needs_inference = _build_audit_answer(summary, entities, snapshot)
        return answer, needs_inference, strategy_key, "audit"

    if request_type == "planning":
        answer, needs_inference = _build_planning_answer(summary)
        return answer, needs_inference, strategy_key, "action_plan"

    if request_type == "comparison":
        comparison_answer = _build_budget_comparison_answer(question, entities, snapshot)
        return comparison_answer[0], comparison_answer[1], strategy_key, "comparison"

    if question.strip():
        answer = _build_general_answer(summary)
        return answer, True, strategy_key, "summary"
    answer = _build_general_answer(summary)
    return answer, True, strategy_key, "summary"


def _dispatch_intent(
    intent_match: IntentClassification,
    *,
    question: str,
    summary: "DataSummary",
    snapshot: BusinessReasoningSnapshot,
    entities: list[EntityMatch],
    requested_limit: int | None,
) -> tuple[str, bool]:
    if intent_match.key == "cost_optimization":
        return _build_budget_optimization_answer(summary, entities, snapshot)
    if intent_match.key == "potential_savings":
        return _build_potential_savings_answer(summary, entities, snapshot)
    if intent_match.key == "oversized_plans":
        return _build_oversized_plan_answer(summary, entities, snapshot)
    if intent_match.key == "quota_overruns":
        return _build_quota_overrun_answer(summary, entities, snapshot)
    if intent_match.key == "fraud":
        return _build_fraud_answer(summary, entities, snapshot)
    if intent_match.key == "suspicious_calls":
        return _build_suspicious_calls_answer(summary, entities, snapshot)
    if intent_match.key == "roaming":
        if intent_match.request_type == "comparison":
            return _build_budget_comparison_answer(question, entities, snapshot)
        if intent_match.request_type == "ranking":
            return _build_roaming_ranking_answer(snapshot, requested_limit=requested_limit)
        if intent_match.request_type in {"optimization", "recommendation"}:
            return _build_roaming_optimization_answer(summary, entities, snapshot)
        if intent_match.request_type in {"statistics", "estimation", "forecast", "trends"}:
            return _build_roaming_statistics_answer(summary, snapshot)
        return _build_roaming_answer(summary, entities, snapshot)
    if intent_match.key == "maintenance":
        return _build_maintenance_answer(summary, snapshot)
    if intent_match.key == "equipment":
        if intent_match.request_type == "ranking":
            return _build_equipment_ranking_answer(snapshot, requested_limit=requested_limit)
        if intent_match.request_type in {"optimization", "recommendation"}:
            return _build_equipment_optimization_answer(summary, snapshot)
        return _build_equipment_inventory_answer(summary, snapshot, requested_limit=requested_limit)
    if intent_match.key == "consumption":
        return _build_consumption_answer(
            summary,
            entities,
            snapshot,
            requested_limit=requested_limit,
        )
    if intent_match.key == "operators":
        return _build_operator_intent_answer(
            question,
            summary,
            entities,
            snapshot,
            requested_limit=requested_limit,
        )
    if intent_match.key == "departments":
        return _build_department_intent_answer(
            question,
            summary,
            entities,
            snapshot,
            requested_limit=requested_limit,
        )
    if intent_match.key == "trends":
        return _build_trends_answer(
            summary,
            entities,
            snapshot,
            primary_domain=intent_match.primary_domain,
        )
    if intent_match.key == "forecasts":
        return _build_forecast_answer(
            summary,
            entities,
            snapshot,
            primary_domain=intent_match.primary_domain,
        )
    if intent_match.key == "comparison":
        return _build_budget_comparison_answer(question, entities, snapshot)
    if intent_match.key == "kpi":
        return _build_statistics_answer(summary)
    if intent_match.key == "recommendations":
        return _build_recommendations_intent_answer(
            summary,
            entities,
            snapshot,
            primary_domain=intent_match.primary_domain,
        )
    if intent_match.key == "prioritization":
        return _build_prioritization_answer(summary)
    if intent_match.key == "action_plan":
        return _build_planning_answer(summary)
    if intent_match.key == "audit":
        return _build_audit_answer(summary, entities, snapshot)
    if intent_match.key == "compliance":
        return _build_compliance_answer(summary, entities, snapshot)
    return _build_domain_request_answer(
        question,
        [],
        summary,
        snapshot,
        intent_match.primary_domain,
        intent_match.request_type,
        entities,
        requested_limit=requested_limit,
    )[:2]


def _build_answer(
    question: str,
    history: list["ChatContextMessage"],
    summary: "DataSummary",
    snapshot: BusinessReasoningSnapshot,
    primary_domain: str,
    request_type: str,
    entities: list[EntityMatch],
    *,
    requested_limit: int | None,
    understanding: BusinessQuestionUnderstanding | None = None,
) -> tuple[str, bool, str, str, IntentClassification]:
    intent_match = _classify_business_intent(
        question,
        history,
        entities=entities,
        primary_domain=primary_domain,
        request_type=request_type,
        understanding=understanding,
    )
    answer, needs_inference = _dispatch_intent(
        intent_match,
        question=question,
        summary=summary,
        snapshot=snapshot,
        entities=entities,
        requested_limit=requested_limit,
    )
    strategy_key = _resolve_strategy_key(intent_match.primary_domain, intent_match.request_type)
    response_shape = intent_match.response_shape or _resolve_response_shape(intent_match.request_type)
    return answer, needs_inference, strategy_key, response_shape, intent_match


def _validate_answer_body(
    answer: str,
    entities: list[EntityMatch],
    request_type: str,
    response_shape: str,
) -> bool:
    normalized_answer = _normalize_text(answer)
    if not normalized_answer:
        return False
    if normalized_answer.startswith("donnee exacte absente"):
        return False
    if "resume executif" not in normalized_answer:
        return False
    if "action" not in normalized_answer and "recommandation" not in normalized_answer:
        return False
    if "analyse" not in normalized_answer and "justification" not in normalized_answer:
        return False
    if request_type == "comparison" and "tableau comparatif" not in normalized_answer:
        return False
    if request_type == "ranking" and "classement prioritaire" not in normalized_answer and "top " not in normalized_answer:
        return False
    if request_type == "planning" and "plan priorise" not in normalized_answer and "plan d action" not in normalized_answer:
        return False
    if response_shape == "inventory" and "inventaire" not in normalized_answer and "etat des lignes" not in normalized_answer:
        return False
    if request_type in {"forecast", "estimation", "simulation", "trends"} and "projection" not in normalized_answer and "estimation" not in normalized_answer:
        return False
    if entities:
        primary_entity = entities[0]
        if request_type not in {"ranking", "statistics", "planning"} and _normalize_text(primary_entity.label) not in normalized_answer:
            return False
    return True


def _validate_answer(
    answer: str,
    entities: list[EntityMatch],
    request_type: str,
    response_shape: str,
) -> bool:
    if not _validate_answer_body(answer, entities, request_type, response_shape):
        return False
    return "indice de confiance" in _normalize_text(answer)


def _confidence_label(score: int) -> str:
    if score >= 88:
        return "Tres elevee"
    if score >= 78:
        return "Elevee"
    if score >= 66:
        return "Solide"
    if score >= 54:
        return "Prudente"
    return "Limitee"


def _build_confidence_context(
    summary: "DataSummary",
    snapshot: BusinessReasoningSnapshot,
    primary_domain: str,
    entities: list[EntityMatch],
) -> tuple[str, int, int, bool, str]:
    scope_entity = _get_primary_scope_entity(entities, "operator", "department", "country", "plan", "line")
    if primary_domain in {"budget", "cost", "operators", "departments", "plans", "consumption", "lines", "inventory"}:
        if scope_entity is not None and scope_entity.kind in {"operator", "department"}:
            scope_metric = _get_scope_metric(snapshot, scope_entity)
            if scope_metric is not None:
                coherence = scope_metric.alert_count > 0 and (
                    scope_metric.over_quota_count > 0 or scope_metric.anomaly_count > 0 or scope_metric.suspicious_call_count > 0
                )
                return (
                    f"{scope_metric.line_count} lignes, {scope_metric.alert_count} alertes et {scope_metric.over_quota_count} depassements exploites sur {scope_metric.label}",
                    scope_metric.line_count,
                    scope_metric.alert_count + scope_metric.over_quota_count,
                    coherence,
                    "couts, alertes et signaux d'usage convergent sur le meme perimetre" if coherence else "les indicateurs sont partiellement alignes sur le perimetre analyse",
                )
        if scope_entity is not None and scope_entity.kind == "plan":
            plan_metric = snapshot.plans.get(_snapshot_keyed_label(scope_entity.label))
            if plan_metric is not None:
                coherence = plan_metric.alert_count > 0 and plan_metric.average_usage_ratio > 0.55
                return (
                    f"{plan_metric.line_count} lignes, {plan_metric.alert_count} alertes et un usage moyen de {round(plan_metric.average_usage_ratio * 100)}% sur {plan_metric.label}",
                    plan_metric.line_count,
                    plan_metric.alert_count + plan_metric.over_quota_count,
                    coherence,
                    "cout moyen, volume de lignes et usage reel racontent la meme tendance" if coherence else "le volume et le cout sont fiables mais la coherence d'usage reste moderee",
                )
        coherence = summary.alert_count > 0 and summary.over_quota_count > 0 and summary.projected_monthly_cost_mad >= summary.total_monthly_cost_mad
        return (
            f"{summary.total_lines} lignes, {summary.alert_count} alertes et {summary.over_quota_count} depassements exploites",
            summary.total_lines,
            summary.alert_count + summary.over_quota_count,
            coherence,
            "projection budgetaire, alertes et depassements convergent" if coherence else "la lecture budgetaire reste exploitable avec une convergence partielle",
        )

    if primary_domain == "roaming":
        country_entity = _get_primary_scope_entity(entities, "country")
        if country_entity is not None:
            country_metric = snapshot.countries.get(_snapshot_keyed_label(country_entity.label))
            if country_metric is not None:
                coherence = country_metric.alert_count > 0 and country_metric.suspicious_call_count > 0
                return (
                    f"{country_metric.event_count} signaux roaming, {country_metric.alert_count} alertes et {country_metric.suspicious_call_count} appels suspects sur {country_metric.label}",
                    country_metric.event_count,
                    country_metric.alert_count,
                    coherence,
                    "geographie, cout roaming et signaux suspects convergent" if coherence else "la concentration geographique est claire mais le risque reste a confirmer",
                )
        top_country = max(snapshot.countries.values(), key=lambda metric: metric.event_count, default=None)
        coherence = summary.roaming_alert_count > 0 and summary.suspicious_call_count > 0
        return (
            f"{summary.roaming_line_count} lignes roaming, {summary.roaming_alert_count} alertes et {len(snapshot.countries)} pays visibles",
            summary.roaming_line_count + (top_country.event_count if top_country is not None else 0),
            summary.roaming_alert_count,
            coherence,
            "cout roaming, alertes et dispersion geographique sont coherents" if coherence else "la lecture geographique est partiellement consolidee",
        )

    if primary_domain in {"fraud", "risk"}:
        scope_entity = _get_primary_scope_entity(entities, "operator", "department")
        if scope_entity is not None and scope_entity.kind in {"operator", "department"}:
            scope_metric = _get_scope_metric(snapshot, scope_entity)
            if scope_metric is not None:
                coherence = scope_metric.suspicious_call_count > 0 and scope_metric.suspicious_call_cost_mad > 0
                return (
                    f"{scope_metric.suspicious_call_count} appels suspects, {scope_metric.alert_count} alertes et {_format_mad(scope_metric.suspicious_call_cost_mad)} d'exposition sur {scope_metric.label}",
                    scope_metric.suspicious_call_count,
                    scope_metric.alert_count,
                    coherence,
                    "volume suspect, cout et alertes convergent" if coherence else "les signaux suspects existent mais l'exposition reste a confirmer",
                )
        coherence = summary.suspicious_call_count > 0 and summary.suspicious_call_cost_mad > 0 and summary.fraud_alert_count > 0
        return (
            f"{summary.suspicious_call_count} appels suspects sur {summary.total_call_count} appels et {summary.fraud_alert_count} alertes fraude",
            summary.suspicious_call_count,
            summary.fraud_alert_count,
            coherence,
            "cout suspect, volume d'appels et alertes fraude convergent" if coherence else "la lecture fraude reste exploitable mais moins dense",
        )

    if primary_domain in {"equipment", "maintenance"}:
        coherence = summary.mobile_critical_count > 0 and summary.mobile_alert_count > 0
        return (
            f"{summary.mobile_device_total} equipements, {summary.mobile_critical_count} critiques et {summary.mobile_alert_count} alertes exploites",
            summary.mobile_device_total,
            summary.mobile_alert_count + summary.mobile_critical_count,
            coherence,
            "volume de parc, criticite et alertes sont coherents" if coherence else "la lecture parc reste utile avec une criticite partiellement documentee",
        )

    coherence = summary.critical_alert_count > 0 and summary.projected_monthly_cost_mad >= summary.total_monthly_cost_mad
    return (
        f"{summary.total_lines} lignes, {summary.critical_alert_count} alertes critiques et {summary.suspicious_call_count} appels suspects",
        summary.total_lines,
        summary.critical_alert_count + summary.suspicious_call_count,
        coherence,
        "les indicateurs de risque et de cout racontent une trajectoire globalement coherente" if coherence else "la synthese globale reste exploitable avec une coherence partielle",
    )


def _estimate_confidence_score(
    summary: "DataSummary",
    snapshot: BusinessReasoningSnapshot,
    primary_domain: str,
    request_type: str,
    entities: list[EntityMatch],
    selected_sources: list[str],
    validation_passed: bool,
    needs_inference: bool,
) -> tuple[int, str, str, str]:
    volume_note, sample_size, signal_count, strong_consistency, consistency_note = _build_confidence_context(
        summary,
        snapshot,
        primary_domain,
        entities,
    )
    sample_ratio = min(1.0, sample_size / 20) if sample_size > 0 else 0.0
    signal_ratio = min(1.0, signal_count / 8) if signal_count > 0 else 0.0
    volume_score = round(18 + sample_ratio * 14 + signal_ratio * 8)

    source_count = len(selected_sources)
    quality_score = 12 + min(source_count, 4) * 3
    quality_score += 5 if entities else 2
    quality_score += 7 if not needs_inference else 2
    quality_score = min(30, quality_score)

    consistency_score = 10
    consistency_score += 10 if validation_passed else 4
    consistency_score += 10 if strong_consistency else 5
    consistency_score = min(30, consistency_score)

    if request_type in {"comparison", "ranking", "planning"}:
        consistency_score = min(30, consistency_score + 2)

    total_score = max(42, min(96, volume_score + quality_score + consistency_score))
    quality_note = (
        f"{source_count} source(s) croisees, validation {'solide' if validation_passed else 'partielle'} et inference {'limitee' if not needs_inference else 'moderee'}"
    )
    return total_score, volume_note, quality_note, consistency_note


def _append_confidence_block(
    answer: str,
    *,
    summary: "DataSummary",
    snapshot: BusinessReasoningSnapshot,
    primary_domain: str,
    request_type: str,
    entities: list[EntityMatch],
    selected_sources: list[str],
    validation_passed: bool,
    needs_inference: bool,
) -> tuple[str, float]:
    score, volume_note, quality_note, consistency_note = _estimate_confidence_score(
        summary,
        snapshot,
        primary_domain,
        request_type,
        entities,
        selected_sources,
        validation_passed,
        needs_inference,
    )
    confidence_block = (
        "Indice de confiance\n"
        f"{score}/100 | {_confidence_label(score)} | Volume: {volume_note} | "
        f"Qualite: {quality_note} | Coherence: {consistency_note}"
    )
    return f"{answer}\n\n{confidence_block}", round(score / 100, 2)


def build_business_reasoning_result(
    db: Session,
    *,
    question: str,
    history: list["ChatContextMessage"],
    summary: "DataSummary",
) -> BusinessReasoningResult:
    snapshot = _get_snapshot(summary, db)
    entities = _extract_entities(question, history, snapshot)
    understanding = _understand_business_question(
        question,
        history,
        summary,
        snapshot,
        entities,
    )
    primary_domain = understanding.primary_domain
    request_type, requested_limit = _detect_request_type(question, history, entities)
    request_type = understanding.request_type or request_type
    answer, needs_inference, strategy_key, response_shape, intent_match = _build_answer(
        question,
        history,
        summary,
        snapshot,
        primary_domain,
        request_type,
        entities,
        requested_limit=requested_limit,
        understanding=understanding,
    )
    selected_sources = list(understanding.selected_sources) or _select_sources(
        intent_match.primary_domain,
        intent_match.request_type,
        history,
    )
    preliminary_validation = _validate_answer_body(answer, entities, intent_match.request_type, response_shape)
    answer = _append_reasoning_trace_block(
        answer,
        understanding=understanding,
    )
    answer, confidence = _append_confidence_block(
        answer,
        summary=summary,
        snapshot=snapshot,
        primary_domain=intent_match.primary_domain,
        request_type=intent_match.request_type,
        entities=entities,
        selected_sources=selected_sources,
        validation_passed=preliminary_validation,
        needs_inference=needs_inference,
    )
    validation_passed = _validate_answer(answer, entities, intent_match.request_type, response_shape)
    return BusinessReasoningResult(
        answer=answer,
        primary_domain=intent_match.primary_domain,
        request_type=intent_match.request_type,
        strategy_key=strategy_key,
        response_shape=response_shape,
        selected_sources=selected_sources,
        entities=[entity.label for entity in entities],
        needs_inference=needs_inference,
        validation_passed=validation_passed,
        confidence=confidence,
        requested_limit=requested_limit,
        intent_category=intent_match.key,
        intent_handler=intent_match.handler_name,
        intent_fallback_used=intent_match.fallback_used,
        intent_match_mode=intent_match.matched_by,
        intent_confidence=intent_match.confidence,
        analysis_strategy=understanding.analysis_strategy,
        business_goal=understanding.business_goal,
        detail_level=understanding.detail_level,
        context_scope=understanding.context_scope,
        secondary_domains=list(understanding.secondary_domains),
        secondary_request_types=list(understanding.secondary_request_types),
        source_reasons=list(understanding.source_reasons),
        applied_criteria=list(understanding.applied_criteria),
        data_gaps=list(understanding.data_gaps),
        strategy_confidence=understanding.strategy_confidence,
    )

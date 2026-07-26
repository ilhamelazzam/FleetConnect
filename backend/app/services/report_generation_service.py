from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import textwrap
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.schemas.chat import ChatActionPlanResponse, ExecutiveReportResponse, ExplainabilityResponse
from app.schemas.reports import ReportGenerateRequest, ReportGenerateResponse, ReportType
from app.services.chat_service import generate_copilot_action_plan
from app.services.executive_report_service import generate_executive_report
from app.services.live_monitoring_service import get_live_monitoring_snapshot_if_ready

if TYPE_CHECKING:
    import matplotlib.pyplot as plt
    import numpy as np
    from matplotlib.backends.backend_pdf import PdfPages
    from matplotlib.patches import FancyBboxPatch
    from PIL import Image as PILImageModule
else:
    plt = None
    np = None
    PdfPages = None
    FancyBboxPatch = None
    PILImageModule = None

REPO_ROOT = Path(__file__).resolve().parents[3]
GENERATED_REPORTS_DIR = REPO_ROOT / "generated_reports"
REPORT_RETENTION = timedelta(hours=12)


@dataclass
class GeneratedReportRecord:
    report_id: str
    path: Path
    generated_at: str
    report_type: ReportType
    fleet_health_score: int
    signature: str


_REPORT_REGISTRY: dict[str, GeneratedReportRecord] = {}
_REPORT_SIGNATURE_INDEX: dict[str, str] = {}
_REPORT_DEPENDENCIES_READY = False
_PIL_IMPORT_ATTEMPTED = False


class ReportDependenciesUnavailableError(RuntimeError):
    pass


def _ensure_report_dependencies() -> None:
    global FancyBboxPatch, PdfPages, np, plt, _REPORT_DEPENDENCIES_READY

    if _REPORT_DEPENDENCIES_READY:
        return

    try:
        import matplotlib as _matplotlib
        import numpy as _np
        from matplotlib.backends.backend_pdf import PdfPages as _PdfPages
        from matplotlib.patches import FancyBboxPatch as _FancyBboxPatch
    except ModuleNotFoundError as exc:
        raise ReportDependenciesUnavailableError(
            "Les dependances de generation PDF sont indisponibles. "
            "Utilise Python 3.11, 3.12 ou 3.13 puis reinstalle le backend avec "
            "`pip install -e \".[dev]\"`."
        ) from exc

    _matplotlib.use("Agg")
    import matplotlib.pyplot as _plt

    plt = _plt
    np = _np
    PdfPages = _PdfPages
    FancyBboxPatch = _FancyBboxPatch
    _REPORT_DEPENDENCIES_READY = True


def _get_pillow_image_class():
    global PILImageModule, _PIL_IMPORT_ATTEMPTED

    if _PIL_IMPORT_ATTEMPTED:
        return PILImageModule

    _PIL_IMPORT_ATTEMPTED = True
    try:
        from PIL import Image as _PILImageModule
    except ModuleNotFoundError:
        PILImageModule = None
        return None

    PILImageModule = _PILImageModule
    return PILImageModule


def _utcnow() -> datetime:
    return datetime.now(tz=UTC)


def _to_iso(value: datetime) -> str:
    return value.isoformat()


def _risk_label(value: str | None) -> str:
    normalized_value = (value or "").strip().lower()
    if normalized_value == "critical":
        return "Critique"
    if normalized_value == "high":
        return "Eleve"
    if normalized_value == "medium":
        return "Moyen"
    if normalized_value == "low":
        return "Faible"
    return "Non precise"


def _risk_color(value: str | None) -> str:
    normalized_value = (value or "").strip().lower()
    if normalized_value == "critical":
        return "#DC2626"
    if normalized_value == "high":
        return "#F97316"
    if normalized_value == "medium":
        return "#EAB308"
    return "#16A34A"


def _report_type_label(value: ReportType) -> str:
    return {
        "executive": "Rapport executif",
        "anomalies": "Rapport anomalies",
        "fraud": "Rapport fraude",
        "equipment": "Rapport equipements",
        "workflow": "Rapport workflow",
        "cost_optimization": "Rapport optimisation couts",
        "live": "Rapport surveillance live",
        "complete": "Rapport complet IA",
    }[value]


def _figure_text_page(title: str, subtitle: str) -> tuple[plt.Figure, plt.Axes]:
    figure = plt.figure(figsize=(8.27, 11.69), dpi=150, facecolor="#F8FAFC")
    axis = figure.add_axes([0, 0, 1, 1])
    axis.set_xlim(0, 1)
    axis.set_ylim(0, 1)
    axis.axis("off")

    axis.add_patch(
        FancyBboxPatch(
            (0.05, 0.04),
            0.90,
            0.92,
            boxstyle="round,pad=0.018,rounding_size=0.03",
            linewidth=1.2,
            edgecolor="#DBEAFE",
            facecolor="#FFFFFF",
        )
    )
    axis.text(
        0.08,
        0.93,
        title,
        fontsize=24,
        fontweight="bold",
        color="#0F172A",
        ha="left",
        va="top",
    )
    axis.text(
        0.08,
        0.895,
        subtitle,
        fontsize=11,
        color="#475569",
        ha="left",
        va="top",
    )
    return figure, axis


def _draw_metric_card(
    axis: plt.Axes,
    *,
    x: float,
    y: float,
    w: float,
    h: float,
    title: str,
    value: str,
    note: str,
    accent: str,
) -> None:
    axis.add_patch(
        FancyBboxPatch(
            (x, y),
            w,
            h,
            boxstyle="round,pad=0.012,rounding_size=0.025",
            linewidth=1,
            edgecolor="#E2E8F0",
            facecolor="#F8FAFC",
        )
    )
    axis.add_patch(
        FancyBboxPatch(
            (x + 0.016, y + h - 0.026),
            0.09,
            0.012,
            boxstyle="round,pad=0.002,rounding_size=0.01",
            linewidth=0,
            facecolor=accent,
        )
    )
    axis.text(x + 0.02, y + h - 0.04, title, fontsize=9, color="#64748B", va="top")
    axis.text(x + 0.02, y + h - 0.09, value, fontsize=18, fontweight="bold", color="#0F172A", va="top")
    axis.text(
        x + 0.02,
        y + 0.03,
        "\n".join(textwrap.wrap(note, width=26)),
        fontsize=8.2,
        color="#475569",
        va="bottom",
    )


def _render_cover_page(
    pdf: PdfPages,
    *,
    report_type: ReportType,
    executive_report: ExecutiveReportResponse,
    generated_at: str,
) -> None:
    figure = plt.figure(figsize=(8.27, 11.69), dpi=150, facecolor="#EAF2FF")
    axis = figure.add_axes([0, 0, 1, 1])
    axis.set_xlim(0, 1)
    axis.set_ylim(0, 1)
    axis.axis("off")

    axis.add_patch(
        FancyBboxPatch(
            (0.045, 0.04),
            0.91,
            0.92,
            boxstyle="round,pad=0.02,rounding_size=0.04",
            linewidth=0,
            facecolor="#0F172A",
        )
    )
    axis.add_patch(
        FancyBboxPatch(
            (0.065, 0.58),
            0.87,
            0.30,
            boxstyle="round,pad=0.02,rounding_size=0.04",
            linewidth=0,
            facecolor="#FFFFFF",
        )
    )
    axis.text(0.09, 0.89, "BC SKILLS", fontsize=13, fontweight="bold", color="#38BDF8")
    axis.text(
        0.09,
        0.84,
        _report_type_label(report_type),
        fontsize=28,
        fontweight="bold",
        color="#0F172A",
        va="top",
    )
    axis.text(
        0.09,
        0.77,
        "Rapport intelligent IA entreprise, genere automatiquement a partir des donnees telecom, du scoring flotte, des alertes critiques et des analyses multimodales disponibles.",
        fontsize=11,
        color="#334155",
        va="top",
        wrap=True,
    )
    axis.text(0.09, 0.67, f"Genere le {generated_at}", fontsize=10, color="#64748B")
    axis.text(0.09, 0.63, f"Modele local {executive_report.model}", fontsize=10, color="#64748B")

    _draw_metric_card(
        axis,
        x=0.08,
        y=0.42,
        w=0.26,
        h=0.14,
        title="Fleet Health Score",
        value=f"{executive_report.fleet_health_score}/100",
        note=f"Niveau {executive_report.fleet_health_level} sur le perimetre disponible.",
        accent="#2563EB",
    )
    _draw_metric_card(
        axis,
        x=0.37,
        y=0.42,
        w=0.26,
        h=0.14,
        title="Risque global",
        value=f"{executive_report.risk_score}/100",
        note=_risk_label(executive_report.risk_level),
        accent=_risk_color(executive_report.risk_level),
    )
    _draw_metric_card(
        axis,
        x=0.66,
        y=0.42,
        w=0.26,
        h=0.14,
        title="Fraude",
        value=f"{executive_report.fraud_score}/100",
        note="Signaux suspects et exposition potentielle.",
        accent="#F97316",
    )
    _draw_metric_card(
        axis,
        x=0.08,
        y=0.24,
        w=0.26,
        h=0.14,
        title="Optimisation",
        value=f"{executive_report.optimization_score}/100",
        note="Leviers couts et rationalisation disponibles.",
        accent="#0EA5E9",
    )
    _draw_metric_card(
        axis,
        x=0.37,
        y=0.24,
        w=0.26,
        h=0.14,
        title="Anomalies",
        value=f"{executive_report.anomaly_score}/100",
        note=f"{len(executive_report.major_anomalies)} anomalies majeures consolidees.",
        accent="#8B5CF6",
    )
    _draw_metric_card(
        axis,
        x=0.66,
        y=0.24,
        w=0.26,
        h=0.14,
        title="Equipements",
        value=f"{executive_report.equipment_score}/100",
        note=f"{executive_report.multimodal_analysis_count} analyses multimodales disponibles.",
        accent="#10B981",
    )

    axis.text(
        0.08,
        0.12,
        "Resume executif IA",
        fontsize=12,
        fontweight="bold",
        color="#E2E8F0",
    )
    axis.text(
        0.08,
        0.095,
        "\n".join(textwrap.wrap(executive_report.executive_summary, width=95)),
        fontsize=10.2,
        color="#CBD5E1",
        va="top",
    )

    pdf.savefig(figure, bbox_inches="tight")
    plt.close(figure)


def _render_summary_page(
    pdf: PdfPages,
    *,
    executive_report: ExecutiveReportResponse,
    action_plan: dict[str, object],
) -> None:
    figure, axis = _figure_text_page(
        "Synthese Executive IA",
        "Risques majeurs, points critiques, recommandations prioritaires et plan d'action DSI.",
    )

    summary_box_y = 0.73
    axis.add_patch(
        FancyBboxPatch(
            (0.08, summary_box_y),
            0.84,
            0.12,
            boxstyle="round,pad=0.012,rounding_size=0.02",
            linewidth=1,
            edgecolor="#DBEAFE",
            facecolor="#EEF6FF",
        )
    )
    axis.text(
        0.10,
        summary_box_y + 0.09,
        "\n".join(textwrap.wrap(executive_report.executive_summary, width=95)),
        fontsize=10.3,
        color="#1E293B",
        va="top",
    )

    priority_risks = executive_report.priority_risks[:6]
    recommendations = executive_report.top_recommendations[:5]
    weekly_actions = [
        action
        for action in action_plan.get("actions", [])
        if isinstance(action, dict)
    ][:5]

    axis.text(0.09, 0.66, "Alertes critiques et risques majeurs", fontsize=12, fontweight="bold", color="#0F172A")
    y = 0.635
    if priority_risks:
        for index, risk in enumerate(priority_risks, start=1):
            axis.text(0.10, y, f"{index}. {risk}", fontsize=9.6, color="#334155", va="top")
            y -= 0.038
    else:
        axis.text(0.10, y, "Aucun risque prioritaire consolide.", fontsize=9.6, color="#64748B", va="top")

    axis.text(0.53, 0.66, "Recommandations IA prioritaires", fontsize=12, fontweight="bold", color="#0F172A")
    y = 0.635
    if recommendations:
        for index, recommendation in enumerate(recommendations, start=1):
            axis.text(
                0.54,
                y,
                f"{index}. {recommendation.title} - {recommendation.action}",
                fontsize=9.2,
                color="#334155",
                va="top",
            )
            y -= 0.046
    else:
        axis.text(0.54, y, "Aucune recommandation prioritaire consolidee.", fontsize=9.6, color="#64748B", va="top")

    axis.text(0.09, 0.38, "Plan d'action IA", fontsize=12, fontweight="bold", color="#0F172A")
    y = 0.355
    if weekly_actions:
        for index, action in enumerate(weekly_actions, start=1):
            title = str(action.get("title") or "Action a confirmer")
            reason = str(action.get("reason") or "Rationale a confirmer")
            priority = _risk_label(str(action.get("priority") or "medium"))
            axis.text(
                0.10,
                y,
                f"{index}. {title} ({priority})",
                fontsize=9.6,
                color="#0F172A",
                fontweight="bold",
                va="top",
            )
            axis.text(
                0.10,
                y - 0.02,
                "\n".join(textwrap.wrap(reason, width=90)),
                fontsize=8.9,
                color="#475569",
                va="top",
            )
            y -= 0.075
    else:
        axis.text(0.10, y, "Plan d'action non disponible.", fontsize=9.6, color="#64748B", va="top")

    pdf.savefig(figure, bbox_inches="tight")
    plt.close(figure)


def _render_kpi_chart_page(
    pdf: PdfPages,
    *,
    executive_report: ExecutiveReportResponse,
) -> None:
    figure, axes = plt.subplots(2, 2, figsize=(8.27, 11.69), dpi=150, facecolor="#F8FAFC")
    figure.subplots_adjust(top=0.92, hspace=0.34, wspace=0.25)
    figure.suptitle("KPI et Visualisations IA", fontsize=20, fontweight="bold", color="#0F172A")

    cost_points = executive_report.charts.cost_evolution
    if cost_points:
        axes[0, 0].plot(
            [point.label for point in cost_points],
            [point.value for point in cost_points],
            color="#2563EB",
            linewidth=2.5,
            marker="o",
        )
        axes[0, 0].set_title("Evolution couts flotte", color="#0F172A")
        axes[0, 0].tick_params(axis="x", rotation=35, labelsize=8)
        axes[0, 0].grid(alpha=0.18)
    else:
        axes[0, 0].text(0.5, 0.5, "Serie couts non disponible", ha="center", va="center")

    department_points = executive_report.charts.department_risk
    if department_points:
        axes[0, 1].barh(
            [point.label for point in department_points],
            [point.value for point in department_points],
            color="#F97316",
            alpha=0.88,
        )
        axes[0, 1].set_title("Consommation / risque par departement", color="#0F172A")
        axes[0, 1].grid(axis="x", alpha=0.18)
    else:
        axes[0, 1].text(0.5, 0.5, "Serie departements non disponible", ha="center", va="center")

    operator_points = executive_report.charts.operator_costs
    if operator_points:
        axes[1, 0].bar(
            [point.label for point in operator_points],
            [point.value for point in operator_points],
            color="#0EA5E9",
            alpha=0.88,
        )
        axes[1, 0].set_title("Couts par operateur", color="#0F172A")
        axes[1, 0].tick_params(axis="x", rotation=28, labelsize=8)
        axes[1, 0].grid(axis="y", alpha=0.18)
    else:
        axes[1, 0].text(0.5, 0.5, "Serie operateurs non disponible", ha="center", va="center")

    axes[1, 1].remove()
    radar_axis = figure.add_subplot(2, 2, 4, polar=True)
    radar_labels = ["Fleet", "Risque", "Fraude", "Optimisation", "Anomalie", "Equipement"]
    radar_values = [
        executive_report.fleet_health_score,
        executive_report.risk_score,
        executive_report.fraud_score,
        executive_report.optimization_score,
        executive_report.anomaly_score,
        executive_report.equipment_score,
    ]
    angles = np.linspace(0, 2 * np.pi, len(radar_labels), endpoint=False).tolist()
    radar_values_closed = radar_values + [radar_values[0]]
    angles_closed = angles + [angles[0]]
    radar_axis.plot(angles_closed, radar_values_closed, color="#7C3AED", linewidth=2.5)
    radar_axis.fill(angles_closed, radar_values_closed, color="#A78BFA", alpha=0.25)
    radar_axis.set_xticks(angles)
    radar_axis.set_xticklabels(radar_labels, fontsize=8)
    radar_axis.set_yticks([20, 40, 60, 80, 100])
    radar_axis.set_yticklabels(["20", "40", "60", "80", "100"], fontsize=7)
    radar_axis.set_title("Radar scores IA", pad=18, color="#0F172A")

    pdf.savefig(figure, bbox_inches="tight")
    plt.close(figure)


def _build_explainability_bundle(
    executive_report: ExecutiveReportResponse,
    explainability: ExplainabilityResponse | None,
) -> dict[str, Any]:
    if explainability is not None:
        factors = [
            {
                "label": factor.label,
                "impact": factor.impact_score,
                "severity": factor.severity,
                "detail": factor.evidence,
            }
            for factor in explainability.influencing_factors[:6]
        ]
        critical_zones = [
            {
                "label": zone.label,
                "severity": zone.severity,
                "detail": zone.detail,
            }
            for zone in explainability.critical_zones[:5]
        ]
        return {
            "answer": explainability.answer,
            "confidence": explainability.confidence_score,
            "reasoning": explainability.reasoning[:5],
            "factors": factors,
            "critical_zones": critical_zones,
        }

    factors = [
        {
            "label": explanation.label,
            "impact": explanation.score,
            "severity": "high" if explanation.score >= 70 else "medium",
            "detail": explanation.explanation,
        }
        for explanation in executive_report.score_explanations[:5]
    ]
    critical_zones = [
        {
            "label": item.department,
            "severity": "high" if item.risk_score >= 70 else "medium",
            "detail": item.reason,
        }
        for item in executive_report.high_risk_departments[:4]
    ]
    if not critical_zones:
        critical_zones = [
            {
                "label": item.operator,
                "severity": "high",
                "detail": item.reason,
            }
            for item in executive_report.costly_operators[:3]
        ]

    return {
        "answer": (
            "Le raisonnement IA s'appuie sur les scores executifs, les risques prioritaires, les alertes "
            "fraude, la pression budgetaire et les signaux equipement disponibles."
        ),
        "confidence": 84,
        "reasoning": executive_report.priority_risks[:5],
        "factors": factors,
        "critical_zones": critical_zones,
    }


def _render_explainability_page(
    pdf: PdfPages,
    *,
    executive_report: ExecutiveReportResponse,
    explainability: ExplainabilityResponse | None,
) -> None:
    bundle = _build_explainability_bundle(executive_report, explainability)
    figure = plt.figure(figsize=(8.27, 11.69), dpi=150, facecolor="#F8FAFC")
    grid = figure.add_gridspec(2, 2, height_ratios=[1.05, 1.1], hspace=0.28, wspace=0.18)
    figure.suptitle("Explainable AI / Raisonnement IA", fontsize=20, fontweight="bold", color="#0F172A")

    top_left = figure.add_subplot(grid[0, 0])
    top_left.axis("off")
    top_left.text(
        0,
        1,
        "\n".join(textwrap.wrap(str(bundle["answer"]), width=48)),
        va="top",
        fontsize=10.2,
        color="#1E293B",
    )
    top_left.text(0, 0.08, f"Confidence {bundle['confidence']}/100", fontsize=11, fontweight="bold", color="#2563EB")

    top_right = figure.add_subplot(grid[0, 1])
    factor_labels = [factor["label"] for factor in bundle["factors"]]
    factor_values = [factor["impact"] for factor in bundle["factors"]]
    if factor_labels:
        top_right.barh(factor_labels, factor_values, color="#2563EB", alpha=0.86)
        top_right.set_title("Facteurs influents", color="#0F172A")
        top_right.grid(axis="x", alpha=0.18)
    else:
        top_right.text(0.5, 0.5, "Facteurs non disponibles", ha="center", va="center")

    bottom_left = figure.add_subplot(grid[1, 0])
    bottom_left.axis("off")
    bottom_left.text(0, 1, "Raisonnement IA", fontsize=12, fontweight="bold", color="#0F172A", va="top")
    reasoning_lines = bundle["reasoning"] or ["Aucun raisonnement explicite disponible."]
    y = 0.92
    for index, item in enumerate(reasoning_lines, start=1):
        bottom_left.text(0, y, f"{index}. {item}", fontsize=9.6, color="#334155", va="top")
        y -= 0.11

    bottom_right = figure.add_subplot(grid[1, 1])
    bottom_right.axis("off")
    bottom_right.text(0, 1, "Zones critiques", fontsize=12, fontweight="bold", color="#0F172A", va="top")
    zones = bundle["critical_zones"] or [{"label": "Perimetre global", "severity": "medium", "detail": "A confirmer"}]
    y = 0.92
    for zone in zones[:5]:
        bottom_right.text(
            0,
            y,
            f"{zone['label']} ({_risk_label(zone['severity'])})",
            fontsize=9.6,
            color=_risk_color(zone["severity"]),
            fontweight="bold",
            va="top",
        )
        bottom_right.text(
            0,
            y - 0.05,
            "\n".join(textwrap.wrap(zone["detail"], width=40)),
            fontsize=8.9,
            color="#475569",
            va="top",
        )
        y -= 0.17

    pdf.savefig(figure, bbox_inches="tight")
    plt.close(figure)


def _render_actions_page(
    pdf: PdfPages,
    *,
    executive_report: ExecutiveReportResponse,
    action_plan: dict[str, object],
) -> None:
    figure, axis = _figure_text_page(
        "Recommandations IA et Actions Prioritaires",
        "Synthese consultant IA / DSI avec priorites, economies et plan d'action.",
    )
    recommendations = executive_report.top_recommendations[:6]
    actions = [action for action in action_plan.get("actions", []) if isinstance(action, dict)][:6]

    axis.text(0.09, 0.83, "Recommandations DSI", fontsize=12, fontweight="bold", color="#0F172A")
    y = 0.80
    if recommendations:
        for index, item in enumerate(recommendations, start=1):
            savings_label = (
                f" | {item.estimated_saving_mad:,.0f} MAD"
                if item.estimated_saving_mad is not None
                else ""
            ).replace(",", " ")
            axis.text(
                0.10,
                y,
                f"{index}. {item.title} ({_risk_label(item.priority)}){savings_label}",
                fontsize=9.5,
                color="#0F172A",
                fontweight="bold",
                va="top",
            )
            axis.text(
                0.10,
                y - 0.02,
                "\n".join(textwrap.wrap(f"{item.justification} Action: {item.action}", width=92)),
                fontsize=8.8,
                color="#475569",
                va="top",
            )
            y -= 0.088
    else:
        axis.text(0.10, y, "Aucune recommandation prioritaire disponible.", fontsize=9.5, color="#64748B", va="top")

    axis.text(0.09, 0.36, "TODO list intelligente", fontsize=12, fontweight="bold", color="#0F172A")
    y = 0.33
    if actions:
        for index, action in enumerate(actions, start=1):
            title = str(action.get("title") or "Action")
            impact = str(action.get("impact") or "Impact a confirmer")
            deadline = str(action.get("deadline") or "Cette semaine")
            axis.text(
                0.10,
                y,
                f"{index}. {title} - {deadline}",
                fontsize=9.5,
                color="#0F172A",
                fontweight="bold",
                va="top",
            )
            axis.text(
                0.10,
                y - 0.02,
                "\n".join(textwrap.wrap(impact, width=92)),
                fontsize=8.8,
                color="#475569",
                va="top",
            )
            y -= 0.075
    else:
        axis.text(0.10, y, "Plan d'action IA indisponible.", fontsize=9.5, color="#64748B", va="top")

    pdf.savefig(figure, bbox_inches="tight")
    plt.close(figure)


def _decode_data_url(value: str) -> Any | None:
    source = value.strip()
    if not source:
        return None
    if source.startswith("data:") and "," in source:
        image_class = _get_pillow_image_class()
        if image_class is None:
            return None
        try:
            encoded_value = source.split(",", 1)[1]
            image_bytes = base64.b64decode(encoded_value)
            return image_class.open(io.BytesIO(image_bytes)).convert("RGB")
        except (ValueError, OSError):
            return None
    return None


def _render_image_pages(
    pdf: PdfPages,
    *,
    images: list[dict[str, str | None]],
) -> None:
    if not images:
        return

    for start_index in range(0, len(images), 4):
        page_images = images[start_index : start_index + 4]
        figure, axes = plt.subplots(2, 2, figsize=(8.27, 11.69), dpi=150, facecolor="#F8FAFC")
        figure.subplots_adjust(top=0.92, hspace=0.24, wspace=0.12)
        figure.suptitle("Images annotees et captures analysees", fontsize=20, fontweight="bold", color="#0F172A")

        for axis in axes.flatten():
            axis.axis("off")

        for axis, image_payload in zip(axes.flatten(), page_images, strict=False):
            decoded_image = _decode_data_url(str(image_payload.get("src") or ""))
            if decoded_image is None:
                axis.text(0.5, 0.5, "Image non exploitable", ha="center", va="center", color="#64748B")
                continue
            axis.imshow(decoded_image)
            axis.set_title(str(image_payload.get("title") or "Image annotee"), fontsize=10, color="#0F172A")
            caption = str(image_payload.get("caption") or "")
            if caption:
                axis.text(
                    0.02,
                    -0.09,
                    "\n".join(textwrap.wrap(caption, width=42)),
                    transform=axis.transAxes,
                    fontsize=8.2,
                    color="#475569",
                    va="top",
                )

        pdf.savefig(figure, bbox_inches="tight")
        plt.close(figure)


def _render_live_page(
    pdf: PdfPages,
    *,
    live_snapshot,
) -> None:
    if live_snapshot is None:
        return

    figure, axes = plt.subplots(2, 2, figsize=(8.27, 11.69), dpi=150, facecolor="#F8FAFC")
    figure.subplots_adjust(top=0.92, hspace=0.34, wspace=0.25)
    figure.suptitle("Surveillance Live IA", fontsize=20, fontweight="bold", color="#0F172A")

    axes[0, 0].plot(
        [point.label for point in live_snapshot.cost_series],
        [point.value for point in live_snapshot.cost_series],
        color="#2563EB",
        linewidth=2.5,
        marker="o",
    )
    axes[0, 0].set_title("Evolution Fleet Health / couts live")
    axes[0, 0].tick_params(axis="x", rotation=30, labelsize=8)
    axes[0, 0].grid(alpha=0.18)

    axes[0, 1].plot(
        [point.label for point in live_snapshot.risk_series],
        [point.value for point in live_snapshot.risk_series],
        color="#F97316",
        linewidth=2.5,
    )
    axes[0, 1].set_title("Courbe risque live")
    axes[0, 1].tick_params(axis="x", rotation=30, labelsize=8)
    axes[0, 1].grid(alpha=0.18)

    axes[1, 0].bar(
        [point.label for point in live_snapshot.operator_heatmap],
        [point.value for point in live_snapshot.operator_heatmap],
        color="#8B5CF6",
        alpha=0.88,
    )
    axes[1, 0].set_title("Heatmap operateurs")
    axes[1, 0].tick_params(axis="x", rotation=28, labelsize=8)
    axes[1, 0].grid(axis="y", alpha=0.18)

    axes[1, 1].axis("off")
    axes[1, 1].text(0, 1, "Alertes live prioritaires", fontsize=12, fontweight="bold", color="#0F172A", va="top")
    y = 0.92
    for alert in list(live_snapshot.priority_alerts)[:5]:
        axes[1, 1].text(
            0,
            y,
            f"- {alert.title} ({_risk_label(alert.severity)})",
            fontsize=9.5,
            color=_risk_color(alert.severity),
            va="top",
        )
        axes[1, 1].text(0, y - 0.05, "\n".join(textwrap.wrap(alert.message, width=40)), fontsize=8.8, color="#475569", va="top")
        y -= 0.16

    pdf.savefig(figure, bbox_inches="tight")
    plt.close(figure)


def _select_report_sections(report_type: ReportType) -> dict[str, bool]:
    return {
        "summary": True,
        "kpis": True,
        "explainability": report_type in {"executive", "complete", "fraud", "anomalies", "workflow", "equipment", "cost_optimization"},
        "actions": report_type in {"executive", "complete", "cost_optimization", "fraud", "live"},
        "images": report_type in {"complete", "anomalies", "equipment", "workflow", "executive"},
        "live": report_type in {"live", "complete"},
    }


def _cleanup_registry() -> None:
    now = _utcnow()
    expired_ids: list[str] = []
    for report_id, record in _REPORT_REGISTRY.items():
        generated_at = datetime.fromisoformat(record.generated_at)
        if now - generated_at > REPORT_RETENTION or not record.path.exists():
            expired_ids.append(report_id)

    for report_id in expired_ids:
        record = _REPORT_REGISTRY.pop(report_id, None)
        if record is not None:
            _REPORT_SIGNATURE_INDEX.pop(record.signature, None)
            if record.path.exists():
                try:
                    record.path.unlink()
                except OSError:
                    pass


def _build_signature(
    payload: ReportGenerateRequest,
    executive_report: ExecutiveReportResponse,
) -> str:
    signature_parts = [
        payload.report_type,
        executive_report.summary_updated_at,
        str(executive_report.fleet_health_score),
        executive_report.executive_summary,
        "|".join(image.title for image in payload.images[:6]),
        "|".join(executive_report.sources),
    ]
    return hashlib.sha256("::".join(signature_parts).encode("utf-8")).hexdigest()


def _normalize_action_plan(
    action_plan: ChatActionPlanResponse | dict[str, object] | None,
) -> dict[str, object]:
    if action_plan is None:
        return {}
    if isinstance(action_plan, ChatActionPlanResponse):
        return action_plan.model_dump(mode="json")
    return action_plan


def _render_report_pdf(
    output_path: Path,
    *,
    report_type: ReportType,
    executive_report: ExecutiveReportResponse,
    explainability: ExplainabilityResponse | None,
    action_plan: ChatActionPlanResponse | dict[str, object] | None,
    live_snapshot,
    images: list[dict[str, str | None]],
    generated_at: str,
) -> None:
    _ensure_report_dependencies()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    sections = _select_report_sections(report_type)
    normalized_action_plan = _normalize_action_plan(action_plan)

    with PdfPages(output_path) as pdf:
        _render_cover_page(
            pdf,
            report_type=report_type,
            executive_report=executive_report,
            generated_at=generated_at,
        )
        if sections["summary"]:
            _render_summary_page(
                pdf,
                executive_report=executive_report,
                action_plan=normalized_action_plan,
            )
        if sections["kpis"]:
            _render_kpi_chart_page(
                pdf,
                executive_report=executive_report,
            )
        if sections["actions"]:
            _render_actions_page(
                pdf,
                executive_report=executive_report,
                action_plan=normalized_action_plan,
            )
        if sections["explainability"]:
            _render_explainability_page(
                pdf,
                executive_report=executive_report,
                explainability=explainability,
            )
        if sections["live"]:
            _render_live_page(pdf, live_snapshot=live_snapshot)
        if sections["images"]:
            _render_image_pages(pdf, images=images)


async def generate_ai_pdf_report(
    db: Session,
    payload: ReportGenerateRequest,
) -> ReportGenerateResponse:
    _cleanup_registry()
    executive_report = payload.executive_report
    if executive_report is None:
        executive_report = await generate_executive_report(
            db,
            history=payload.history,
            image_analyses=payload.image_analyses,
            conversation_id=payload.conversation_id,
        )

    signature = _build_signature(payload, executive_report)
    cached_report_id = _REPORT_SIGNATURE_INDEX.get(signature)
    if cached_report_id is not None:
        cached_record = _REPORT_REGISTRY.get(cached_report_id)
        if cached_record is not None and cached_record.path.exists():
            return ReportGenerateResponse(
                report_id=cached_record.report_id,
                pdf_url=f"{get_settings().api_v1_prefix}/reports/{cached_record.report_id}/pdf",
                generated_at=cached_record.generated_at,
                report_type=cached_record.report_type,
                fleet_health_score=cached_record.fleet_health_score,
            )

    _ensure_report_dependencies()
    action_plan = await generate_copilot_action_plan(
        db,
        history=payload.history,
    )
    live_snapshot = get_live_monitoring_snapshot_if_ready()
    generated_at = _to_iso(_utcnow())
    report_id = uuid4().hex
    output_path = GENERATED_REPORTS_DIR / f"{report_id}.pdf"
    render_images = [
        {
            "title": image.title,
            "src": image.src,
            "caption": image.caption,
        }
        for image in payload.images[:8]
    ]

    await asyncio.to_thread(
        _render_report_pdf,
        output_path,
        report_type=payload.report_type,
        executive_report=executive_report,
        explainability=payload.explainability,
        action_plan=action_plan,
        live_snapshot=live_snapshot,
        images=render_images,
        generated_at=generated_at,
    )

    record = GeneratedReportRecord(
        report_id=report_id,
        path=output_path,
        generated_at=generated_at,
        report_type=payload.report_type,
        fleet_health_score=executive_report.fleet_health_score,
        signature=signature,
    )
    _REPORT_REGISTRY[report_id] = record
    _REPORT_SIGNATURE_INDEX[signature] = report_id
    return ReportGenerateResponse(
        report_id=report_id,
        pdf_url=f"{get_settings().api_v1_prefix}/reports/{report_id}/pdf",
        generated_at=generated_at,
        report_type=payload.report_type,
        fleet_health_score=executive_report.fleet_health_score,
    )


def get_generated_report_pdf_path(report_id: str) -> Path | None:
    _cleanup_registry()
    record = _REPORT_REGISTRY.get(report_id)
    if record is None or not record.path.exists():
        return None
    return record.path

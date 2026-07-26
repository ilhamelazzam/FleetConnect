import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Brain,
  ChevronRight,
  CircleAlert,
  GitBranch,
  LoaderCircle,
  Network,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ApiExplainRecommendationResponse } from "../lib/api";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { cn } from "./ui/utils";

const EXPLAIN_RECOMMENDATION_STAGES = [
  "Analyse strategique en cours...",
  "Interpretation des facteurs dominants...",
  "Evaluation des risques et de l'impact...",
  "Construction de la justification decisionnelle...",
];

const NO_EXPLANATION_MESSAGE =
  "L'IA n'a pas genere suffisamment d'elements explicatifs pour cette recommandation.";

interface ExplainRecommendationModalProps {
  recommendation: string;
  onExplain: (recommendation: string) => Promise<ApiExplainRecommendationResponse>;
  disabled?: boolean;
  buttonLabel?: string;
}

function formatRiskLabel(value: ApiExplainRecommendationResponse["risk_level"]): string {
  if (value === "low") return "Faible";
  if (value === "medium") return "Moyen";
  if (value === "high") return "Eleve";
  return "Critique";
}

function getRiskTone(value: ApiExplainRecommendationResponse["risk_level"]): string {
  if (value === "critical") {
    return "border-[#F87171]/40 bg-[#FEE2E2] text-[#B91C1C]";
  }
  if (value === "high") {
    return "border-[#FB923C]/40 bg-[#FFEDD5] text-[#C2410C]";
  }
  if (value === "medium") {
    return "border-[#FACC15]/40 bg-[#FEF9C3] text-[#A16207]";
  }
  return "border-[#4ADE80]/40 bg-[#DCFCE7] text-[#15803D]";
}

function getHeatTone(value: number): string {
  if (value >= 80) {
    return "border-[#FCA5A5]/50 bg-[radial-gradient(circle_at_top,rgba(248,113,113,0.24),rgba(255,255,255,0.98))]";
  }
  if (value >= 60) {
    return "border-[#FDBA74]/50 bg-[radial-gradient(circle_at_top,rgba(251,146,60,0.2),rgba(255,255,255,0.98))]";
  }
  if (value >= 40) {
    return "border-[#FDE047]/50 bg-[radial-gradient(circle_at_top,rgba(250,204,21,0.18),rgba(255,255,255,0.98))]";
  }
  return "border-[#86EFAC]/50 bg-[radial-gradient(circle_at_top,rgba(74,222,128,0.18),rgba(255,255,255,0.98))]";
}

function formatReliability(value: number): string {
  if (value >= 0.88) return "Tres elevee";
  if (value >= 0.72) return "Elevee";
  if (value >= 0.55) return "Solide";
  if (value >= 0.35) return "Prudente";
  return "A confirmer";
}

function renderMetricCard(
  label: string,
  value: string,
  tone: "neutral" | "risk" | "success" = "neutral",
) {
  return (
    <div
      className={cn(
        "rounded-[20px] border px-4 py-4 backdrop-blur-sm",
        tone === "risk"
          ? "border-[#F8B4B4]/45 bg-[linear-gradient(180deg,rgba(254,226,226,0.95),rgba(255,255,255,0.95))]"
          : tone === "success"
            ? "border-[#86EFAC]/45 bg-[linear-gradient(180deg,rgba(220,252,231,0.95),rgba(255,255,255,0.95))]"
            : "border-[var(--bc-neutral-border)] bg-white/80",
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-[var(--bc-neutral-strong)]">{value}</p>
    </div>
  );
}

export function ExplainRecommendationModal({
  recommendation,
  onExplain,
  disabled = false,
  buttonLabel = "Pourquoi cette recommandation ?",
}: ExplainRecommendationModalProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [explanation, setExplanation] = useState<ApiExplainRecommendationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stageLabel, setStageLabel] = useState<string>(EXPLAIN_RECOMMENDATION_STAGES[0]);

  useEffect(() => {
    if (!loading) {
      setStageLabel(EXPLAIN_RECOMMENDATION_STAGES[0]);
      return;
    }

    let stageIndex = 0;
    const intervalId = window.setInterval(() => {
      stageIndex = Math.min(stageIndex + 1, EXPLAIN_RECOMMENDATION_STAGES.length - 1);
      setStageLabel(EXPLAIN_RECOMMENDATION_STAGES[stageIndex]);
    }, 1200);

    return () => window.clearInterval(intervalId);
  }, [loading]);

  const handleExplain = async () => {
    if (!recommendation.trim()) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await onExplain(recommendation);
      setExplanation(result);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Explication IA indisponible.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && !explanation && !loading && !error) {
      void handleExplain();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const factorChartData = useMemo(
    () =>
      (explanation?.influencing_factors ?? []).slice(0, 6).map((factor) => ({
        label: factor.label,
        value: factor.impact_score,
      })),
    [explanation],
  );

  const radarData = useMemo(
    () =>
      explanation
        ? [
            { label: "Impact", value: explanation.impact_score },
            { label: "Risque", value: explanation.risk_score },
            { label: "Fraude", value: explanation.fraud_score },
            { label: "Anomalie", value: explanation.anomaly_score },
            { label: "Optimisation", value: explanation.optimization_score },
            { label: "Equipement", value: explanation.equipment_score },
          ]
        : [],
    [explanation],
  );

  const decisionTimelineData = useMemo(
    () =>
      (explanation?.decision_trace ?? []).map((step) => ({
        label: `Etape ${step.step_number}`,
        value: Math.round(step.confidence * 100),
      })),
    [explanation],
  );

  const heatmapData = useMemo(
    () =>
      (explanation?.critical_zones ?? []).map((zone) => ({
        label: zone.label,
        value:
          zone.severity === "critical"
            ? 95
            : zone.severity === "high"
              ? 78
              : zone.severity === "medium"
                ? 54
                : 28,
        detail: zone.detail,
        severity: zone.severity,
        zoneType: zone.zone_type,
        rawValue: zone.value,
      })),
    [explanation],
  );

  const reasoningFactors = useMemo(
    () => explanation?.reasoning?.factors?.filter((item) => item.trim().length > 0) ?? [],
    [explanation],
  );
  const reasoningKpis = useMemo(
    () => explanation?.reasoning?.kpis?.filter((item) => item.trim().length > 0) ?? [],
    [explanation],
  );
  const reasoningRisks = useMemo(
    () => explanation?.reasoning?.risks?.filter((item) => item.trim().length > 0) ?? [],
    [explanation],
  );
  const businessExplanation =
    explanation?.reasoning?.business_explanation?.trim() ||
    explanation?.answer?.trim() ||
    NO_EXPLANATION_MESSAGE;
  const impactPotential =
    explanation?.reasoning?.impact?.trim() ||
    "L'impact potentiel n'a pas pu etre qualifie plus precisement a ce stade.";
  const hasStructuredReasoning =
    reasoningFactors.length > 0 ||
    reasoningKpis.length > 0 ||
    reasoningRisks.length > 0 ||
    impactPotential !== "L'impact potentiel n'a pas pu etre qualifie plus precisement a ce stade." ||
    businessExplanation !== NO_EXPLANATION_MESSAGE;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || !recommendation.trim()}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="rounded-lg border-[var(--bc-ai-border)] bg-white/80 px-3 py-1.5 text-[11px] text-[var(--bc-ai-start)] hover:bg-[var(--bc-ai-soft)]/70"
      >
        <Brain className="h-4 w-4" />
        {buttonLabel}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[88vh] max-w-[min(1120px,calc(100vw-24px))] overflow-hidden border-[var(--bc-ai-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.98))] p-0 dark:bg-[linear-gradient(180deg,rgba(8,16,31,0.98),rgba(15,23,42,0.98))]">
          <div className="max-h-[88vh] overflow-y-auto">
          <DialogHeader className="border-b border-[var(--bc-neutral-border)] bg-[linear-gradient(135deg,rgba(99,102,241,0.12),rgba(56,189,248,0.08),rgba(255,255,255,0.98))] px-6 py-5">
            <DialogTitle className="flex items-center gap-2 text-[var(--bc-neutral-strong)]">
              <Brain className="h-5 w-5 text-[var(--bc-ai-start)]" />
              Raisonnement IA
            </DialogTitle>
            <DialogDescription className="text-sm leading-6 text-[var(--bc-neutral-body)]">
              Pourquoi l&apos;IA recommande &quot;{recommendation}&quot; et quels facteurs reels influencent la decision.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 px-6 py-5">
            {loading ? (
              <div className="rounded-[26px] border border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,rgba(99,102,241,0.08),rgba(56,189,248,0.08),rgba(255,255,255,0.98))] px-5 py-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--bc-ai-border)] bg-white/90 text-[var(--bc-ai-start)]">
                    <LoaderCircle className="h-5 w-5 animate-spin" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">
                        Analyse Cockpit XAI
                      </p>
                      <Badge variant="outline" className="px-2.5 py-1 text-[11px]">
                        En cours
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[var(--bc-neutral-body)]">{stageLabel}</p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {EXPLAIN_RECOMMENDATION_STAGES.map((stage) => (
                    <div
                      key={stage}
                      className={cn(
                        "rounded-[18px] border px-3 py-3 text-xs font-medium transition-colors",
                        stage === stageLabel
                          ? "border-[var(--bc-ai-border)] bg-white/92 text-[var(--bc-neutral-strong)] shadow-[0_12px_24px_-18px_rgba(79,70,229,0.42)]"
                          : "border-[var(--bc-neutral-border)] bg-white/65 text-[var(--bc-neutral-muted)]",
                      )}
                    >
                      {stage}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {error ? (
              <div className="rounded-[22px] border border-[var(--bc-danger-border)] bg-[var(--bc-danger-soft)] px-4 py-4 text-sm text-[var(--bc-danger)]">
                <div className="flex items-center gap-2 font-semibold">
                  <CircleAlert className="h-4 w-4" />
                  Explication indisponible
                </div>
                <p className="mt-2 leading-6">{error}</p>
              </div>
            ) : null}

            {explanation ? (
              <>
                <div className="rounded-[28px] border border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,rgba(15,23,42,0.03),rgba(56,189,248,0.08),rgba(255,255,255,0.98))] px-5 py-5 shadow-[0_20px_48px_-32px_rgba(14,165,233,0.45)]">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="border-[var(--bc-ai-border)] bg-white/85 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[var(--bc-ai-start)]">
                          <Sparkles className="mr-1 h-3.5 w-3.5" />
                          Justification IA
                        </Badge>
                        <Badge variant="outline" className={cn("px-3 py-1 text-[11px]", getRiskTone(explanation.risk_level))}>
                          Risque: {formatRiskLabel(explanation.risk_level)}
                        </Badge>
                        <Badge variant="secondary" className="px-3 py-1 text-[11px]">
                          Solidite: {formatReliability(explanation.confidence_score)}
                        </Badge>
                        {explanation.estimated_savings ? (
                          <Badge variant="secondary" className="px-3 py-1 text-[11px]">
                            {explanation.estimated_savings}
                          </Badge>
                        ) : null}
                      </div>

                      <p className="mt-4 text-lg font-semibold text-[var(--bc-neutral-strong)]">
                        {explanation.recommendation}
                      </p>
                      <p className="mt-3 text-sm leading-7 text-[var(--bc-neutral-body)]">
                        {explanation.answer}
                      </p>

                      {explanation.data_points_used.length > 0 ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {explanation.data_points_used.slice(0, 6).map((item, index) => (
                            <span
                              key={`data-point-${index}`}
                              className="rounded-full border border-[var(--bc-neutral-border)] bg-white/82 px-3 py-1 text-[11px] text-[var(--bc-neutral-body)]"
                            >
                              {item}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="grid min-w-[280px] gap-3 sm:grid-cols-2 xl:w-[320px] xl:grid-cols-1">
                      {renderMetricCard("Confiance IA", `${Math.round(explanation.confidence_score * 100)}%`, "success")}
                      {renderMetricCard("Impact estime", `${explanation.impact_score}/100`, "risk")}
                    </div>
                  </div>
                </div>

                <div className="rounded-[26px] border border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(240,249,255,0.94),rgba(224,231,255,0.86))] px-5 py-5 shadow-[0_20px_42px_-30px_rgba(59,130,246,0.3)] dark:bg-[linear-gradient(135deg,rgba(15,23,42,0.96),rgba(8,16,31,0.98),rgba(30,41,59,0.92))]">
                  <div className="flex items-center gap-2 border-b border-[var(--bc-ai-border)] pb-3 text-[var(--bc-ai-start)]">
                    <Brain className="h-4.5 w-4.5" />
                    <p className="text-sm font-semibold uppercase tracking-[0.16em]">
                      Raisonnement IA
                    </p>
                  </div>

                  {hasStructuredReasoning ? (
                    <div className="mt-4 grid gap-4 xl:grid-cols-2">
                      <div className="rounded-[20px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4 dark:bg-[#08101f]/90">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                          📊 KPI analyses
                        </p>
                        <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--bc-neutral-body)]">
                          {(reasoningKpis.length > 0 ? reasoningKpis : [NO_EXPLANATION_MESSAGE]).map((item, index) => (
                            <li key={`reasoning-kpi-${index}`} className="flex gap-2">
                              <span className="mt-[0.55rem] h-1.5 w-1.5 rounded-full bg-[var(--bc-ai-start)]" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="rounded-[20px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4 dark:bg-[#08101f]/90">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                          ⚠️ Risques detectes
                        </p>
                        <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--bc-neutral-body)]">
                          {(reasoningRisks.length > 0 ? reasoningRisks : [NO_EXPLANATION_MESSAGE]).map((item, index) => (
                            <li key={`reasoning-risk-${index}`} className="flex gap-2">
                              <span className="mt-[0.55rem] h-1.5 w-1.5 rounded-full bg-[#F97316]" />
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="rounded-[20px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4 dark:bg-[#08101f]/90">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                          📈 Impact potentiel
                        </p>
                        <p className="mt-3 text-sm leading-6 text-[var(--bc-neutral-body)]">
                          {impactPotential}
                        </p>
                      </div>

                      <div className="rounded-[20px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4 dark:bg-[#08101f]/90">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                          🎯 Priorite IA
                        </p>
                        <div className="mt-3 flex items-center gap-3">
                          <Badge variant="outline" className={cn("px-3 py-1 text-[11px]", getRiskTone(explanation.risk_level))}>
                            {explanation.risk_level === "critical"
                              ? "🔴 Critique"
                              : explanation.risk_level === "high"
                                ? "🔴 Elevee"
                                : explanation.risk_level === "medium"
                                  ? "🟠 Moyenne"
                                  : "🟢 Faible"}
                          </Badge>
                          <span className="text-sm text-[var(--bc-neutral-body)]">
                            Priorite retenue a partir des facteurs dominants et des KPI consolides.
                          </span>
                        </div>
                      </div>

                      <div className="rounded-[20px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4 dark:bg-[#08101f]/90 xl:col-span-2">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                          💡 Justification metier
                        </p>
                        <p className="mt-3 text-sm leading-7 text-[var(--bc-neutral-body)]">
                          {businessExplanation}
                        </p>
                        <div className="mt-4">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                            Facteurs ayant influence l'analyse
                          </p>
                          <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--bc-neutral-body)]">
                            {(reasoningFactors.length > 0 ? reasoningFactors : [NO_EXPLANATION_MESSAGE]).map((item, index) => (
                              <li key={`reasoning-factor-${index}`} className="flex gap-2">
                                <span className="mt-[0.55rem] h-1.5 w-1.5 rounded-full bg-[var(--bc-ai-start)]" />
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-[22px] border border-[var(--bc-warning-border)] bg-[var(--bc-warning-soft)]/80 px-4 py-4 text-sm leading-6 text-[var(--bc-neutral-strong)]">
                      {NO_EXPLANATION_MESSAGE}
                    </div>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                  {renderMetricCard("Risque", `${explanation.risk_score}/100`, "risk")}
                  {renderMetricCard("Fraude", `${explanation.fraud_score}/100`, explanation.fraud_score >= 60 ? "risk" : "neutral")}
                  {renderMetricCard("Anomalie", `${explanation.anomaly_score}/100`, explanation.anomaly_score >= 60 ? "risk" : "neutral")}
                  {renderMetricCard("Optimisation", `${explanation.optimization_score}/100`, explanation.optimization_score >= 60 ? "risk" : "neutral")}
                  {renderMetricCard("Equipement", `${explanation.equipment_score}/100`, explanation.equipment_score >= 60 ? "risk" : "neutral")}
                  {renderMetricCard("Facteurs", `${explanation.influencing_factors.length}`, "neutral")}
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="rounded-[24px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4">
                    <div className="mb-3 flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-[var(--bc-ai-start)]" />
                      <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">
                        Facteurs influents
                      </p>
                    </div>
                    <div className="h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={factorChartData} layout="vertical" margin={{ left: 12 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.24)" />
                          <XAxis type="number" tick={{ fill: "var(--bc-neutral-muted)", fontSize: 11 }} />
                          <YAxis type="category" dataKey="label" width={118} tick={{ fill: "var(--bc-neutral-muted)", fontSize: 11 }} />
                          <RechartsTooltip
                            formatter={(value: number) => `${Math.round(value)}/100`}
                            contentStyle={{
                              borderRadius: 14,
                              border: "1px solid rgba(148,163,184,0.24)",
                              background: "rgba(255,255,255,0.96)",
                            }}
                          />
                          <Bar dataKey="value" radius={[0, 12, 12, 0]}>
                            {factorChartData.map((entry, index) => (
                              <Cell
                                key={`${entry.label}-${index}`}
                                fill={entry.value >= 80 ? "#EF4444" : entry.value >= 60 ? "#F97316" : entry.value >= 40 ? "#EAB308" : "#22C55E"}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4">
                    <div className="mb-3 flex items-center gap-2">
                      <ShieldAlert className="h-4 w-4 text-[var(--bc-ai-start)]" />
                      <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">
                        Radar des scores
                      </p>
                    </div>
                    <div className="h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart data={radarData}>
                          <PolarGrid stroke="rgba(148,163,184,0.28)" />
                          <PolarAngleAxis dataKey="label" tick={{ fill: "var(--bc-neutral-muted)", fontSize: 11 }} />
                          <Radar dataKey="value" stroke="#0EA5E9" fill="#0EA5E9" fillOpacity={0.28} />
                          <RechartsTooltip
                            formatter={(value: number) => `${Math.round(value)}/100`}
                            contentStyle={{
                              borderRadius: 14,
                              border: "1px solid rgba(148,163,184,0.24)",
                              background: "rgba(255,255,255,0.96)",
                            }}
                          />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                  <div className="rounded-[24px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4">
                    <div className="mb-3 flex items-center gap-2">
                      <GitBranch className="h-4 w-4 text-[var(--bc-ai-start)]" />
                      <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">
                        Trace de decision
                      </p>
                    </div>

                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={decisionTimelineData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.24)" />
                          <XAxis dataKey="label" tick={{ fill: "var(--bc-neutral-muted)", fontSize: 11 }} />
                          <YAxis tick={{ fill: "var(--bc-neutral-muted)", fontSize: 11 }} />
                          <RechartsTooltip
                            formatter={(value: number) => `${Math.round(value)}%`}
                            contentStyle={{
                              borderRadius: 14,
                              border: "1px solid rgba(148,163,184,0.24)",
                              background: "rgba(255,255,255,0.96)",
                            }}
                          />
                          <Line
                            type="monotone"
                            dataKey="value"
                            stroke="#4F46E5"
                            strokeWidth={3}
                            dot={{ r: 4, fill: "#4F46E5" }}
                            activeDot={{ r: 6 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="mt-4 space-y-3">
                      {explanation.decision_trace.map((step) => (
                        <div key={`${step.step_number}-${step.step_title}`} className="rounded-[18px] border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)]/70 px-4 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">
                                Etape {step.step_number} - {step.step_title}
                              </p>
                              <p className="mt-2 text-sm leading-6 text-[var(--bc-neutral-body)]">
                                {step.step_description}
                              </p>
                            </div>
                            <Badge variant="secondary" className="px-2.5 py-1 text-[11px]">
                              {Math.round(step.confidence * 100)}%
                            </Badge>
                          </div>
                          {step.data_used.length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {step.data_used.slice(0, 4).map((item, index) => (
                                <span
                                  key={`step-${step.step_number}-data-${index}`}
                                  className="rounded-full border border-[var(--bc-neutral-border)] bg-white/85 px-3 py-1 text-[11px] text-[var(--bc-neutral-body)]"
                                >
                                  {item}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-[24px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4">
                      <div className="mb-3 flex items-center gap-2">
                        <Network className="h-4 w-4 text-[var(--bc-ai-start)]" />
                        <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">
                          Graphe explicatif
                        </p>
                      </div>
                      <p className="text-sm leading-6 text-[var(--bc-neutral-body)]">
                        {explanation.explanation_graph.summary}
                      </p>
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        {explanation.explanation_graph.nodes.slice(0, 6).map((node, index, nodes) => (
                          <div key={node.node_id} className="contents">
                            <div className={cn("rounded-full border px-3 py-1.5 text-[11px] font-semibold", getRiskTone(node.severity))}>
                              {node.label}
                            </div>
                            {index < nodes.length - 1 ? (
                              <ChevronRight className="h-3.5 w-3.5 text-[var(--bc-neutral-muted)]" />
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-[24px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4">
                      <div className="mb-3 flex items-center gap-2">
                        <Target className="h-4 w-4 text-[var(--bc-ai-start)]" />
                        <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">
                          Heatmap d&apos;influence
                        </p>
                      </div>
                      <div className="grid gap-3">
                        {heatmapData.length > 0 ? (
                          heatmapData.map((zone) => (
                            <div
                              key={`${zone.zoneType}-${zone.label}`}
                              className={cn("rounded-[18px] border px-4 py-4 shadow-[0_12px_22px_-20px_rgba(15,23,42,0.35)]", getHeatTone(zone.value))}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">{zone.label}</p>
                                  <p className="mt-1 text-[11px] uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                                    {zone.zoneType}
                                  </p>
                                </div>
                                <Badge variant="outline" className={cn("px-2.5 py-1 text-[11px]", getRiskTone(zone.severity))}>
                                  {formatRiskLabel(zone.severity)}
                                </Badge>
                              </div>
                              <div className="mt-4 h-2 rounded-full bg-white/70">
                                <div
                                  className="h-full rounded-full bg-[linear-gradient(90deg,#22C55E,#EAB308,#F97316,#EF4444)]"
                                  style={{ width: `${Math.max(8, Math.min(100, zone.value))}%` }}
                                />
                              </div>
                              <p className="mt-3 text-sm leading-6 text-[var(--bc-neutral-body)]">{zone.detail}</p>
                              {zone.rawValue ? (
                                <p className="mt-2 text-sm font-semibold text-[var(--bc-neutral-strong)]">{zone.rawValue}</p>
                              ) : null}
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-[var(--bc-neutral-body)]">
                            Aucune zone critique specifique n&apos;a ete remontee pour cette recommandation.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="rounded-[24px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Activity className="h-4 w-4 text-[var(--bc-ai-start)]" />
                      <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">
                        KPI influents
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {explanation.supporting_kpis.map((kpi) => (
                        <div key={kpi.label} className="rounded-[18px] border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)]/70 px-4 py-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">{kpi.label}</p>
                            <Badge variant="secondary" className="px-2.5 py-1 text-[11px]">
                              {Math.round(kpi.confidence * 100)}%
                            </Badge>
                          </div>
                          <p className="mt-2 text-xl font-semibold text-[var(--bc-neutral-strong)]">
                            {kpi.value}
                            {kpi.unit ? ` ${kpi.unit}` : ""}
                          </p>
                          <p className="mt-2 text-sm leading-6 text-[var(--bc-neutral-body)]">{kpi.impact}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-[var(--bc-ai-start)]" />
                      <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">
                        Justification complementaire
                      </p>
                    </div>
                    <div className="space-y-3">
                      {(reasoningFactors.length > 0 ? reasoningFactors : [NO_EXPLANATION_MESSAGE]).slice(0, 5).map((reason, index) => (
                        <div
                          key={`supporting-reason-${index}`}
                          className="rounded-[18px] border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)]/70 px-4 py-3 text-sm leading-6 text-[var(--bc-neutral-body)]"
                        >
                          {reason}
                        </div>
                      ))}
                      {explanation.alternative_recommendations.length > 0 ? (
                        <div className="rounded-[20px] border border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,rgba(99,102,241,0.08),rgba(255,255,255,0.96))] px-4 py-4">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-ai-start)]">
                            Alternatives
                          </p>
                          <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--bc-neutral-body)]">
                            {explanation.alternative_recommendations.map((item, index) => (
                              <li key={`alternative-${index}`} className="flex gap-2">
                                <span className="mt-[0.55rem] h-1.5 w-1.5 rounded-full bg-[var(--bc-ai-start)]" />
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

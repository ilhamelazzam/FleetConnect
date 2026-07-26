import { Activity, AlertTriangle, Brain, ShieldAlert, Sparkles, TrendingUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ApiFleetHealthScoreResponse, ApiLiveMonitoringSnapshot } from "../../lib/api";
import { Badge } from "../ui/badge";
import { cn } from "../ui/utils";

interface FleetHealthScoreCardProps {
  score: ApiFleetHealthScoreResponse | null;
  liveSnapshot?: ApiLiveMonitoringSnapshot | null;
  isLoading: boolean;
  errorMessage?: string | null;
}

function formatFleetHealthLabel(value: ApiFleetHealthScoreResponse["fleet_health_level"]): string {
  if (value === "excellent") return "Excellent";
  if (value === "bon") return "Bon";
  if (value === "moyen") return "Moyen";
  if (value === "eleve") return "Eleve";
  return "Critique";
}

function formatGlobalRiskLabel(value: ApiFleetHealthScoreResponse["global_risk"]): string {
  if (value === "low") return "Faible";
  if (value === "medium") return "Moyen";
  if (value === "high") return "Eleve";
  return "Critique";
}

function formatTrendLabel(value: ApiFleetHealthScoreResponse["trend"]): string {
  if (value === "improving") return "Amelioration";
  if (value === "stable") return "Stable";
  return "Degradation";
}

function formatTrendDescription(value: ApiFleetHealthScoreResponse["trend"]): string {
  if (value === "improving") {
    return "Les derniers signaux consolides montrent une amelioration nette du score.";
  }
  if (value === "stable") {
    return "Le score reste globalement stable sur les derniers signaux consolides.";
  }
  return "Les derniers signaux consolides montrent une degradation du score global.";
}

function getHealthPalette(level: ApiFleetHealthScoreResponse["fleet_health_level"]) {
  if (level === "excellent") {
    return {
      glow: "shadow-[0_28px_60px_-30px_rgba(34,197,94,0.5)]",
      panel: "border-[#BBF7D0] bg-[linear-gradient(135deg,#ECFDF5,#FFFFFF)]",
      badge: "border-[#86EFAC] bg-[#DCFCE7] text-[#15803D]",
      accent: "#22C55E",
      softAccent: "#DCFCE7",
      radar: "#22C55E",
    };
  }
  if (level === "bon") {
    return {
      glow: "shadow-[0_28px_60px_-30px_rgba(37,99,235,0.46)]",
      panel: "border-[#BFDBFE] bg-[linear-gradient(135deg,#EFF6FF,#FFFFFF)]",
      badge: "border-[#93C5FD] bg-[#DBEAFE] text-[#1D4ED8]",
      accent: "#2563EB",
      softAccent: "#DBEAFE",
      radar: "#2563EB",
    };
  }
  if (level === "moyen") {
    return {
      glow: "shadow-[0_28px_60px_-30px_rgba(234,179,8,0.44)]",
      panel: "border-[#FDE68A] bg-[linear-gradient(135deg,#FEFCE8,#FFFFFF)]",
      badge: "border-[#FDE047] bg-[#FEF9C3] text-[#A16207]",
      accent: "#EAB308",
      softAccent: "#FEF9C3",
      radar: "#EAB308",
    };
  }
  if (level === "eleve") {
    return {
      glow: "shadow-[0_28px_60px_-30px_rgba(249,115,22,0.48)]",
      panel: "border-[#FDBA74] bg-[linear-gradient(135deg,#FFF7ED,#FFFFFF)]",
      badge: "border-[#FDBA74] bg-[#FFEDD5] text-[#C2410C]",
      accent: "#F97316",
      softAccent: "#FFEDD5",
      radar: "#F97316",
    };
  }
  return {
    glow: "shadow-[0_28px_60px_-30px_rgba(239,68,68,0.5)]",
    panel: "border-[#FECACA] bg-[linear-gradient(135deg,#FEF2F2,#FFFFFF)]",
    badge: "border-[#FCA5A5] bg-[#FEE2E2] text-[#B91C1C]",
    accent: "#EF4444",
    softAccent: "#FEE2E2",
    radar: "#EF4444",
  };
}

function getMetricTone(value: number): string {
  if (value >= 90) {
    return "border-emerald-200 bg-emerald-50/85 text-[#15803D]";
  }
  if (value >= 75) {
    return "border-blue-200 bg-blue-50/85 text-[#1D4ED8]";
  }
  if (value >= 60) {
    return "border-amber-200 bg-amber-50/85 text-[#A16207]";
  }
  if (value >= 45) {
    return "border-orange-200 bg-orange-50/85 text-[#C2410C]";
  }
  return "border-red-200 bg-red-50/85 text-[#B91C1C]";
}

function getHeatmapTone(value: number): string {
  if (value >= 80) {
    return "border-red-200 bg-red-50/85 text-[#B91C1C]";
  }
  if (value >= 60) {
    return "border-orange-200 bg-orange-50/85 text-[#C2410C]";
  }
  if (value >= 40) {
    return "border-amber-200 bg-amber-50/85 text-[#A16207]";
  }
  return "border-emerald-200 bg-emerald-50/85 text-[#15803D]";
}

function getFactorTone(severity: "low" | "medium" | "high" | "critical"): string {
  if (severity === "critical") {
    return "border-red-200 bg-[linear-gradient(135deg,#FEF2F2,#FFFFFF)]";
  }
  if (severity === "high") {
    return "border-orange-200 bg-[linear-gradient(135deg,#FFF7ED,#FFFFFF)]";
  }
  if (severity === "medium") {
    return "border-amber-200 bg-[linear-gradient(135deg,#FFFBEB,#FFFFFF)]";
  }
  return "border-emerald-200 bg-[linear-gradient(135deg,#ECFDF5,#FFFFFF)]";
}

function buildHealthHistory(
  score: ApiFleetHealthScoreResponse,
  liveSnapshot?: ApiLiveMonitoringSnapshot | null,
): Array<{ label: string; value: number }> {
  if (liveSnapshot?.risk_series && liveSnapshot.risk_series.length > 0) {
    const history = liveSnapshot.risk_series.slice(-7).map((point) => ({
      label: point.label,
      value: Math.max(0, Math.min(100, Math.round(100 - point.value))),
    }));
    const lastPoint = history[history.length - 1];
    if (!lastPoint || lastPoint.value !== score.fleet_health_score) {
      history.push({
        label: "Maint.",
        value: score.fleet_health_score,
      });
    }
    return history;
  }

  const target = score.fleet_health_score;
  const values =
    score.trend === "declining"
      ? [target + 18, target + 12, target + 8, target + 4, target]
      : score.trend === "improving"
        ? [target - 12, target - 8, target - 5, target - 2, target]
        : [target - 4, target - 2, target - 3, target - 1, target];

  return values.map((value, index) => ({
    label: `T-${values.length - index - 1}`,
    value: Math.max(0, Math.min(100, value)),
  }));
}

function buildHeatmapPoints(
  score: ApiFleetHealthScoreResponse,
  liveSnapshot?: ApiLiveMonitoringSnapshot | null,
): Array<{ label: string; value: number; detail: string }> {
  if (liveSnapshot?.operator_heatmap && liveSnapshot.operator_heatmap.length > 0) {
    return liveSnapshot.operator_heatmap.slice(0, 6).map((point) => ({
      label: point.label,
      value: Math.round(point.secondary_value ?? 0),
      detail: `Anomalie operateur ${Math.round(point.secondary_value ?? 0)}/100`,
    }));
  }

  return score.key_factors.slice(0, 6).map((factor) => ({
    label: factor.label,
    value:
      factor.severity === "critical"
        ? 92
        : factor.severity === "high"
          ? 74
          : factor.severity === "medium"
            ? 52
            : 24,
    detail: factor.value,
  }));
}

function buildRadarData(score: ApiFleetHealthScoreResponse) {
  return [
    { label: "Couts", value: score.scores.cost_score },
    { label: "Fraude", value: score.scores.fraud_score },
    { label: "Anomalies", value: score.scores.anomaly_score },
    { label: "Optimisation", value: score.scores.optimization_score },
    { label: "Equipements", value: score.scores.equipment_score },
    { label: "Workflow", value: score.scores.workflow_score },
    { label: "Risque", value: score.scores.risk_score },
    { label: "Roaming", value: score.scores.roaming_score },
  ];
}

export default function FleetHealthScoreCard({
  score,
  liveSnapshot,
  isLoading,
  errorMessage,
}: FleetHealthScoreCardProps) {
  const [displayScore, setDisplayScore] = useState(score?.fleet_health_score ?? 0);
  const animationFrameRef = useRef<number | null>(null);
  const displayScoreRef = useRef(displayScore);

  useEffect(() => {
    displayScoreRef.current = displayScore;
  }, [displayScore]);

  useEffect(() => {
    if (!score) {
      setDisplayScore(0);
      return;
    }

    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
    }

    const startedAt = performance.now();
    const startValue = displayScoreRef.current;
    const targetValue = score.fleet_health_score;

    const tick = (timestamp: number) => {
      const progress = Math.min((timestamp - startedAt) / 900, 1);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      const nextValue = Math.round(startValue + (targetValue - startValue) * easedProgress);
      setDisplayScore(nextValue);

      if (progress < 1) {
        animationFrameRef.current = window.requestAnimationFrame(tick);
      } else {
        animationFrameRef.current = null;
      }
    };

    animationFrameRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [score?.fleet_health_score]);

  if (isLoading && !score) {
    return (
      <div className="rounded-[28px] border border-[#DCE5F1] bg-white p-5 shadow-sm">
        <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
          <div className="h-[260px] rounded-[26px] bg-slate-100/80" />
          <div className="grid gap-4">
            <div className="h-24 rounded-[26px] bg-slate-100/80" />
            <div className="grid gap-4 md:grid-cols-2">
              <div className="h-[220px] rounded-[26px] bg-slate-100/80" />
              <div className="h-[220px] rounded-[26px] bg-slate-100/80" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!score) {
    return (
      <div className="rounded-[28px] border border-red-200 bg-red-50/70 px-5 py-5 text-sm text-[#B91C1C]">
        {errorMessage ?? "Impossible de charger le Fleet Health Score."}
      </div>
    );
  }

  const palette = getHealthPalette(score.fleet_health_level);
  const healthHistory = buildHealthHistory(score, liveSnapshot);
  const heatmapPoints = buildHeatmapPoints(score, liveSnapshot);
  const radarData = buildRadarData(score);
  const scoreMetrics = [
    { key: "cost", label: "Cout", value: score.scores.cost_score },
    { key: "fraud", label: "Fraude", value: score.scores.fraud_score },
    { key: "anomaly", label: "Anomalie", value: score.scores.anomaly_score },
    { key: "optimization", label: "Optimisation", value: score.scores.optimization_score },
    { key: "equipment", label: "Equipement", value: score.scores.equipment_score },
    { key: "workflow", label: "Workflow", value: score.scores.workflow_score },
    { key: "risk", label: "Risque", value: score.scores.risk_score },
    { key: "roaming", label: "Roaming", value: score.scores.roaming_score },
  ];
  const gaugeData = [
    {
      name: "Fleet Health",
      value: displayScore,
      fill: palette.accent,
    },
  ];

  return (
    <div className={cn("rounded-[30px] border p-5 transition-all duration-500", palette.panel, palette.glow)}>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={cn("px-3 py-1", palette.badge)}>
              <Activity className="mr-1 h-3.5 w-3.5" />
              Fleet Health Score
            </Badge>
            <Badge className="border-[#DCE5F1] bg-white px-3 py-1 text-[#475569]">
              Risque global: {formatGlobalRiskLabel(score.global_risk)}
            </Badge>
            <Badge className="border-[#DCE5F1] bg-white px-3 py-1 text-[#475569]">
              Tendance: {formatTrendLabel(score.trend)}
            </Badge>
            <Badge className="border-[#DCE5F1] bg-white px-3 py-1 text-[#475569]">
              {liveSnapshot?.active ? "Live monitoring actif" : "Analyse consolidee"}
            </Badge>
          </div>
          <h3 className="mt-4 text-[1.45rem] font-semibold tracking-[-0.03em] text-[#0F172A]">
            Sante globale de la flotte telecom
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-[#475569]">
            {score.explanation}
          </p>
        </div>

        <div className="rounded-[24px] border border-white/70 bg-white/70 px-4 py-3 shadow-sm backdrop-blur">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#64748B]">
            Mise a jour
          </p>
          <p className="mt-2 text-sm font-semibold text-[#0F172A]">
            {new Intl.DateTimeFormat("fr-FR", {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(score.summary_updated_at))}
          </p>
          <p className="mt-1 text-xs text-[#64748B]">
            {score.sources.slice(0, 3).join(" | ")}
          </p>
        </div>
      </div>

      {errorMessage ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-[#92400E]">
          {errorMessage}
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 xl:grid-cols-[330px_minmax(0,1fr)]">
        <div className={cn("rounded-[28px] border bg-white/78 p-5", score.global_risk === "critical" ? "animate-pulse" : "", "border-white/75")}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#64748B]">
                Score global
              </p>
              <p className="mt-2 text-sm font-medium text-[#475569]">
                Niveau {formatFleetHealthLabel(score.fleet_health_level)}
              </p>
            </div>
            <div
              className="flex h-11 w-11 items-center justify-center rounded-2xl"
              style={{ backgroundColor: palette.softAccent, color: palette.accent }}
            >
              <Sparkles className="h-5 w-5" />
            </div>
          </div>

          <div className="mt-4 h-[230px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart
                innerRadius="64%"
                outerRadius="98%"
                data={gaugeData}
                startAngle={210}
                endAngle={-30}
                barSize={18}
              >
                <RadialBar
                  dataKey="value"
                  background={{ fill: "#E2E8F0" }}
                  cornerRadius={18}
                />
                <RechartsTooltip
                  formatter={(value: number) => `${Math.round(value)}/100`}
                  contentStyle={{
                    borderRadius: 14,
                    border: "1px solid rgba(148,163,184,0.22)",
                    background: "rgba(255,255,255,0.96)",
                  }}
                />
              </RadialBarChart>
            </ResponsiveContainer>
          </div>

          <div className="-mt-[8.9rem] flex flex-col items-center justify-center">
            <p className="text-5xl font-semibold tracking-[-0.04em] text-[#0F172A]">{displayScore}</p>
            <p className="mt-1 text-xs uppercase tracking-[0.18em] text-[#64748B]">sur 100</p>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <div className="rounded-[22px] border border-[#E2E8F0] bg-slate-50/85 px-4 py-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[#64748B]">Risque global</p>
              <p className="mt-2 text-lg font-semibold text-[#0F172A]">
                {formatGlobalRiskLabel(score.global_risk)}
              </p>
            </div>
            <div className="rounded-[22px] border border-[#E2E8F0] bg-slate-50/85 px-4 py-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[#64748B]">Tendance</p>
              <p className="mt-2 text-lg font-semibold text-[#0F172A]">
                {formatTrendLabel(score.trend)}
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-[22px] border border-[#E2E8F0] bg-slate-50/85 px-4 py-4">
            <p className="text-[11px] uppercase tracking-[0.16em] text-[#64748B]">Lecture IA</p>
            <p className="mt-2 text-sm leading-6 text-[#475569]">{formatTrendDescription(score.trend)}</p>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {scoreMetrics.map((metric) => (
              <div key={metric.key} className={cn("rounded-[24px] border px-4 py-4 shadow-sm", getMetricTone(metric.value))}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#64748B]">
                  {metric.label}
                </p>
                <p className="mt-3 text-2xl font-semibold">{metric.value}/100</p>
                <p className="mt-2 text-xs text-[#475569]">{formatFleetHealthLabel(
                  metric.value >= 90
                    ? "excellent"
                    : metric.value >= 75
                      ? "bon"
                      : metric.value >= 60
                        ? "moyen"
                        : metric.value >= 45
                          ? "eleve"
                          : "critique",
                )}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-[28px] border border-[#E2E8F0] bg-white/78 p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <Brain className="h-4 w-4 text-[#2563EB]" />
                <h4 className="text-sm font-semibold text-[#0F172A]">Radar des sous-scores IA</h4>
              </div>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="rgba(148,163,184,0.24)" />
                    <PolarAngleAxis dataKey="label" tick={{ fill: "#475569", fontSize: 11 }} />
                    <Radar dataKey="value" stroke={palette.radar} fill={palette.radar} fillOpacity={0.24} />
                    <RechartsTooltip
                      formatter={(value: number) => `${Math.round(value)}/100`}
                      contentStyle={{
                        borderRadius: 14,
                        border: "1px solid rgba(148,163,184,0.22)",
                        background: "rgba(255,255,255,0.96)",
                      }}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-[28px] border border-[#E2E8F0] bg-white/78 p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-[#DC2626]" />
                <h4 className="text-sm font-semibold text-[#0F172A]">Bar chart des scores</h4>
              </div>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={score.score_breakdown} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: "#475569", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "#475569", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <RechartsTooltip
                      formatter={(value: number) => `${Math.round(value)}/100`}
                      contentStyle={{
                        borderRadius: 14,
                        border: "1px solid rgba(148,163,184,0.22)",
                        background: "rgba(255,255,255,0.96)",
                      }}
                    />
                    <Bar dataKey="value" radius={[10, 10, 0, 0]}>
                      {score.score_breakdown.map((entry) => (
                        <Cell key={entry.label} fill={entry.value >= 90 ? "#22C55E" : entry.value >= 75 ? "#2563EB" : entry.value >= 60 ? "#EAB308" : entry.value >= 45 ? "#F97316" : "#EF4444"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <div className="rounded-[28px] border border-[#E2E8F0] bg-white/78 p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-[#0EA5E9]" />
                <h4 className="text-sm font-semibold text-[#0F172A]">Courbe sante flotte</h4>
              </div>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={healthHistory}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis dataKey="label" tick={{ fill: "#475569", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "#475569", fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, 100]} />
                    <RechartsTooltip
                      formatter={(value: number) => `${Math.round(value)}/100`}
                      contentStyle={{
                        borderRadius: 14,
                        border: "1px solid rgba(148,163,184,0.22)",
                        background: "rgba(255,255,255,0.96)",
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke={palette.accent}
                      strokeWidth={3}
                      dot={{ r: 4, fill: palette.accent }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-[28px] border border-[#E2E8F0] bg-white/78 p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-[#F97316]" />
                <h4 className="text-sm font-semibold text-[#0F172A]">Heatmap risques</h4>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {heatmapPoints.map((point) => (
                  <div
                    key={point.label}
                    className={cn(
                      "rounded-[22px] border px-4 py-4 shadow-sm transition-transform duration-300 hover:-translate-y-0.5",
                      getHeatmapTone(point.value),
                      point.value >= 80 ? "animate-pulse" : "",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold text-[#0F172A]">{point.label}</p>
                      <span className="text-sm font-semibold">{point.value}/100</span>
                    </div>
                    <div className="mt-4 h-2 rounded-full bg-white/75">
                      <div
                        className="h-full rounded-full bg-[linear-gradient(90deg,#22C55E,#2563EB,#EAB308,#F97316,#EF4444)]"
                        style={{ width: `${Math.max(8, Math.min(100, point.value))}%` }}
                      />
                    </div>
                    <p className="mt-3 text-xs leading-5 text-[#475569]">{point.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-[28px] border border-[#E2E8F0] bg-white/78 p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-[#2563EB]" />
            <h4 className="text-sm font-semibold text-[#0F172A]">Facteurs du score</h4>
          </div>
          <p className="mt-4 text-sm leading-7 text-[#475569]">{score.explanation}</p>
          <div className="mt-4 space-y-3">
            {score.key_factors.slice(0, 4).map((factor) => (
              <div key={`${factor.category}-${factor.label}`} className={cn("rounded-[20px] border px-4 py-3", getFactorTone(factor.severity))}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-[#0F172A]">{factor.label}</p>
                  <Badge className="border-white/70 bg-white/75 text-[#334155]">
                    {factor.impact_score}/100
                  </Badge>
                </div>
                <p className="mt-2 text-sm leading-6 text-[#475569]">{factor.evidence}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[28px] border border-[#E2E8F0] bg-white/78 p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-[#DC2626]" />
            <h4 className="text-sm font-semibold text-[#0F172A]">Risques et forces</h4>
          </div>

          <div className="mt-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#64748B]">Principaux risques</p>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-[#475569]">
              {score.main_risks.slice(0, 4).map((risk) => (
                <li key={risk} className="flex gap-2">
                  <span className="mt-[0.55rem] h-1.5 w-1.5 rounded-full bg-[#EF4444]" />
                  <span>{risk}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#64748B]">Points forts</p>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-[#475569]">
              {score.main_strengths.length > 0 ? (
                score.main_strengths.slice(0, 4).map((strength) => (
                  <li key={strength} className="flex gap-2">
                    <span className="mt-[0.55rem] h-1.5 w-1.5 rounded-full bg-[#22C55E]" />
                    <span>{strength}</span>
                  </li>
                ))
              ) : (
                <li className="text-sm text-[#64748B]">Aucun point fort dominant ne ressort a ce niveau de score.</li>
              )}
            </ul>
          </div>
        </div>

        <div className="rounded-[28px] border border-[#E2E8F0] bg-white/78 p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#0EA5E9]" />
            <h4 className="text-sm font-semibold text-[#0F172A]">Recommandations IA</h4>
          </div>

          <div className="mt-4 space-y-3">
            {score.recommendations.slice(0, 4).map((recommendation) => (
              <div key={recommendation} className="rounded-[20px] border border-[#E2E8F0] bg-slate-50/85 px-4 py-4">
                <p className="text-sm leading-6 text-[#334155]">{recommendation}</p>
              </div>
            ))}
            {score.recommendations.length === 0 ? (
              <div className="rounded-[20px] border border-dashed border-[#CBD5E1] bg-white/80 px-4 py-4 text-sm text-[#64748B]">
                Aucune recommandation supplementaire n'est necessaire sur le perimetre actuel.
              </div>
            ) : null}
          </div>

          {liveSnapshot?.executive_summary ? (
            <div className="mt-5 rounded-[20px] border border-[#DCE5F1] bg-[linear-gradient(135deg,#EFF6FF,#FFFFFF)] px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#64748B]">Signal live</p>
              <p className="mt-2 text-sm leading-6 text-[#475569]">{liveSnapshot.executive_summary}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

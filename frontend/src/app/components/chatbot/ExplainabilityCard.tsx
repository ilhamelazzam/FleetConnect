import {
  Brain,
  Flame,
  Network,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingUp,
  TriangleAlert,
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

import type { TelecomChatExplainability } from "../../lib/chatbot-storage";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { cn } from "../ui/utils";

interface ExplainabilityCardProps {
  explanation: TelecomChatExplainability;
  onApplyRecommendation?: (title: string) => void;
}

function formatRiskLevelLabel(value: TelecomChatExplainability["riskLevel"]): string {
  if (value === "low") return "Faible";
  if (value === "medium") return "Moyen";
  if (value === "high") return "Eleve";
  return "Critique";
}

function getRiskBadgeClass(value: TelecomChatExplainability["riskLevel"]): string {
  if (value === "critical") {
    return "border-[#F87171]/40 bg-[#FEE2E2] text-[#B91C1C] dark:border-[#EF4444]/30 dark:bg-[#3A0D12] dark:text-[#FCA5A5]";
  }
  if (value === "high") {
    return "border-[#FB923C]/40 bg-[#FFEDD5] text-[#C2410C] dark:border-[#F97316]/30 dark:bg-[#3A1A0C] dark:text-[#FDBA74]";
  }
  if (value === "medium") {
    return "border-[#FACC15]/40 bg-[#FEF9C3] text-[#A16207] dark:border-[#EAB308]/30 dark:bg-[#332A08] dark:text-[#FDE047]";
  }
  return "border-[#4ADE80]/40 bg-[#DCFCE7] text-[#15803D] dark:border-[#22C55E]/30 dark:bg-[#0D2A16] dark:text-[#86EFAC]";
}

function getSeverityTone(value: "low" | "medium" | "high" | "critical"): string {
  if (value === "critical") {
    return "border-[#FCA5A5]/45 bg-[linear-gradient(180deg,rgba(254,226,226,0.95),rgba(255,255,255,0.98))] dark:border-[#EF4444]/25 dark:bg-[linear-gradient(180deg,rgba(58,13,18,0.88),rgba(8,16,31,0.98))]";
  }
  if (value === "high") {
    return "border-[#FDBA74]/45 bg-[linear-gradient(180deg,rgba(255,237,213,0.95),rgba(255,255,255,0.98))] dark:border-[#F97316]/25 dark:bg-[linear-gradient(180deg,rgba(58,26,12,0.88),rgba(8,16,31,0.98))]";
  }
  if (value === "medium") {
    return "border-[#FDE047]/45 bg-[linear-gradient(180deg,rgba(254,249,195,0.95),rgba(255,255,255,0.98))] dark:border-[#EAB308]/25 dark:bg-[linear-gradient(180deg,rgba(51,42,8,0.88),rgba(8,16,31,0.98))]";
  }
  return "border-[#86EFAC]/45 bg-[linear-gradient(180deg,rgba(220,252,231,0.95),rgba(255,255,255,0.98))] dark:border-[#22C55E]/25 dark:bg-[linear-gradient(180deg,rgba(13,42,22,0.88),rgba(8,16,31,0.98))]";
}

function getHeatTone(value: number): string {
  if (value >= 80) {
    return "border-[#FCA5A5]/45 bg-[radial-gradient(circle_at_top,rgba(248,113,113,0.24),rgba(254,242,242,0.98))] dark:border-[#EF4444]/25 dark:bg-[radial-gradient(circle_at_top,rgba(239,68,68,0.2),rgba(8,16,31,0.98))]";
  }
  if (value >= 60) {
    return "border-[#FDBA74]/45 bg-[radial-gradient(circle_at_top,rgba(251,146,60,0.2),rgba(255,247,237,0.98))] dark:border-[#F97316]/25 dark:bg-[radial-gradient(circle_at_top,rgba(249,115,22,0.18),rgba(8,16,31,0.98))]";
  }
  if (value >= 40) {
    return "border-[#FDE047]/45 bg-[radial-gradient(circle_at_top,rgba(250,204,21,0.2),rgba(254,252,232,0.98))] dark:border-[#EAB308]/25 dark:bg-[radial-gradient(circle_at_top,rgba(234,179,8,0.16),rgba(8,16,31,0.98))]";
  }
  return "border-[#86EFAC]/45 bg-[radial-gradient(circle_at_top,rgba(74,222,128,0.2),rgba(240,253,244,0.98))] dark:border-[#22C55E]/25 dark:bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.16),rgba(8,16,31,0.98))]";
}

function formatReliability(value: number): string {
  if (value >= 0.88) return "Tres elevee";
  if (value >= 0.72) return "Elevee";
  if (value >= 0.55) return "Solide";
  if (value >= 0.35) return "Prudente";
  return "A confirmer";
}

function formatSourceLabel(source: string): string {
  if (source === "multimodal:image_analysis") return "Lecture visuelle et documentaire";
  if (source === "executive_report") return "Synthese executive";
  if (source === "live_monitoring") return "Surveillance temps reel";
  return source.replace(/_/g, " ");
}

function buildAnalysisScopes(explanation: TelecomChatExplainability): string[] {
  const scopes = ["KPI telecom"];
  if (explanation.sources.some((source) => source === "multimodal:image_analysis")) {
    scopes.push("Lecture image");
  }
  if (explanation.sources.some((source) => source === "executive_report")) {
    scopes.push("Scoring executif");
  }
  if (explanation.sources.some((source) => source === "live_monitoring")) {
    scopes.push("Supervision temps reel");
  }
  if (explanation.criticalZones.some((zone) => zone.zoneType === "equipment")) {
    scopes.push("Equipements");
  }
  if (explanation.criticalZones.some((zone) => zone.zoneType === "workflow")) {
    scopes.push("Workflows");
  }
  return Array.from(new Set(scopes)).slice(0, 5);
}

function buildPotentialImpact(explanation: TelecomChatExplainability): string {
  const dominantFactor = explanation.influencingFactors[0];
  const dominantZone = explanation.criticalZones[0];

  if (dominantFactor && dominantZone) {
    return `${dominantFactor.label} impacte ${dominantZone.label} et maintient une priorite ${formatRiskLevelLabel(explanation.riskLevel).toLowerCase()}.`;
  }
  if (dominantFactor) {
    return `${dominantFactor.label} reste le facteur le plus determinant dans l'etat actuel de la flotte.`;
  }
  if (dominantZone) {
    return `${dominantZone.label} concentre la zone la plus exposee dans les donnees consolidees.`;
  }
  return "Impact limite aux signaux actuellement disponibles dans le perimetre analyse.";
}

function renderMetricCard(
  label: string,
  value: string,
  tone: "neutral" | "risk" | "success" = "neutral",
) {
  return (
    <div
      className={cn(
        "rounded-[18px] border px-4 py-4 backdrop-blur-sm",
        tone === "risk"
          ? "border-[#F8B4B4]/45 bg-[linear-gradient(180deg,rgba(254,226,226,0.95),rgba(255,255,255,0.95))] dark:border-[#EF4444]/25 dark:bg-[linear-gradient(180deg,rgba(58,13,18,0.85),rgba(8,16,31,0.96))]"
          : tone === "success"
            ? "border-[#86EFAC]/45 bg-[linear-gradient(180deg,rgba(220,252,231,0.95),rgba(255,255,255,0.95))] dark:border-[#22C55E]/25 dark:bg-[linear-gradient(180deg,rgba(13,42,22,0.88),rgba(8,16,31,0.96))]"
            : "border-[var(--bc-neutral-border)] bg-white/80 dark:bg-[#08101f]/92",
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-[var(--bc-neutral-strong)]">{value}</p>
    </div>
  );
}

export default function ExplainabilityCard({
  explanation,
  onApplyRecommendation,
}: ExplainabilityCardProps) {
  const heatmapPoints =
    explanation.charts.criticalZoneHeatmap.length > 0
      ? explanation.charts.criticalZoneHeatmap.slice(0, 6)
      : explanation.criticalZones.slice(0, 6).map((zone, index) => ({
          label: zone.label,
          value:
            zone.severity === "critical"
              ? 95
              : zone.severity === "high"
                ? 75
                : zone.severity === "medium"
                  ? 52
                  : 24,
          secondaryValue: index + 1,
        }));
  const analysisScopes = buildAnalysisScopes(explanation);
  const potentialImpact = buildPotentialImpact(explanation);
  const dominantFactor =
    explanation.explanationGraph.dominantFactor ?? explanation.influencingFactors[0]?.label ?? null;

  return (
    <div className="rounded-[26px] border border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,rgba(15,23,42,0.02),rgba(56,189,248,0.08),rgba(255,255,255,0.96))] p-4 shadow-[0_24px_52px_-30px_rgba(14,165,233,0.42)] dark:bg-[linear-gradient(135deg,rgba(14,165,233,0.14),rgba(8,16,31,0.98),rgba(8,16,31,0.98))]">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="border-[var(--bc-ai-border)] bg-white/80 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[var(--bc-ai-start)] dark:bg-[#08101f]"
            >
              <Brain className="mr-1 h-3.5 w-3.5" />
              Lecture explicative IA
            </Badge>
            <Badge variant="outline" className={cn("px-3 py-1 text-[11px]", getRiskBadgeClass(explanation.riskLevel))}>
              Risque: {formatRiskLevelLabel(explanation.riskLevel)}
            </Badge>
            <Badge variant="secondary" className="px-3 py-1 text-[11px]">
              Solidite: {formatReliability(explanation.confidence)}
            </Badge>
            <Badge variant="secondary" className="px-3 py-1 text-[11px]">
              {explanation.influencingFactors.length} facteurs
            </Badge>
            {dominantFactor ? (
              <Badge variant="secondary" className="px-3 py-1 text-[11px]">
                Facteur cle: {dominantFactor}
              </Badge>
            ) : null}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
            <div className="rounded-[24px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-5 text-center dark:bg-[#08101f]/92">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--bc-neutral-muted)]">
                Solidite de l'explication
              </p>
              <div className="mx-auto mt-4 flex h-28 w-28 items-center justify-center rounded-full border-[10px] border-[var(--bc-ai-border)] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.98),rgba(224,231,255,0.9))] text-3xl font-semibold text-[var(--bc-neutral-strong)] shadow-[0_12px_28px_-18px_rgba(14,165,233,0.46)] dark:bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.18),rgba(8,16,31,0.98))]">
                {explanation.confidenceScore}
              </div>
              <p className="mt-4 text-sm text-[var(--bc-neutral-body)]">
                Transparence basee sur les donnees disponibles uniquement
              </p>
            </div>

            <div className="rounded-[24px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-5 dark:bg-[#08101f]/92">
              <div className="flex items-start gap-3">
                <Sparkles className="mt-0.5 h-5 w-5 text-[var(--bc-ai-start)]" />
                <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--bc-neutral-muted)]">
                    Lecture explicative
                  </p>
                  <p className="mt-3 text-sm leading-7 text-[var(--bc-neutral-strong)]">
                    {explanation.answer}
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-[18px] border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)]/65 px-3 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                    Priorite
                  </p>
                  <p className="mt-2 text-sm font-semibold text-[var(--bc-neutral-strong)]">
                    {formatRiskLevelLabel(explanation.riskLevel)}
                  </p>
                </div>
                <div className="rounded-[18px] border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)]/65 px-3 py-3 md:col-span-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                    Impact potentiel
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[var(--bc-neutral-body)]">
                    {potentialImpact}
                  </p>
                </div>
              </div>

              {explanation.dataPointsUsed.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {explanation.dataPointsUsed.slice(0, 6).map((item) => (
                    <span
                      key={item}
                      className="rounded-full border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)]/75 px-3 py-1 text-[11px] text-[var(--bc-neutral-body)]"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="rounded-[24px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4 dark:bg-[#08101f]/92">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
            Perimetre de donnees
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {analysisScopes.map((scope) => (
              <span
                key={scope}
                className="rounded-full border border-[var(--bc-ai-border)] bg-white/80 px-3 py-1 text-[11px] font-medium text-[var(--bc-neutral-body)] dark:bg-[#08101f]"
              >
                {scope}
              </span>
            ))}
          </div>
          {explanation.sources.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {explanation.sources.slice(0, 5).map((source) => (
                <Badge key={source} variant="secondary" className="px-2.5 py-1 text-[11px]">
                  {formatSourceLabel(source)}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>

        <div className="rounded-[24px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4 dark:bg-[#08101f]/92">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
            Synthese XAI
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="rounded-[18px] border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)]/65 px-3 py-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                Zones
              </p>
              <p className="mt-2 text-xl font-semibold text-[var(--bc-neutral-strong)]">
                {explanation.criticalZones.length}
              </p>
            </div>
            <div className="rounded-[18px] border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)]/65 px-3 py-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                Actions
              </p>
              <p className="mt-2 text-xl font-semibold text-[var(--bc-neutral-strong)]">
                {explanation.recommendations.length}
              </p>
            </div>
            <div className="rounded-[18px] border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)]/65 px-3 py-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                Modele
              </p>
              <p className="mt-2 text-sm font-semibold text-[var(--bc-neutral-strong)]">
                {explanation.model}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {renderMetricCard("Score risque", `${explanation.riskScore}/100`, "risk")}
        {renderMetricCard("Risque fraude", `${explanation.fraudScore}/100`, explanation.fraudScore >= 60 ? "risk" : "neutral")}
        {renderMetricCard("Risque anomalie", `${explanation.anomalyScore}/100`, explanation.anomalyScore >= 60 ? "risk" : "neutral")}
        {renderMetricCard("Risque optimisation", `${explanation.optimizationScore}/100`, explanation.optimizationScore >= 60 ? "risk" : "neutral")}
        {renderMetricCard("Equipement", `${explanation.equipmentScore}/100`, explanation.equipmentScore >= 60 ? "risk" : "neutral")}
        {renderMetricCard("Solidite", `${explanation.confidenceScore}/100`, "success")}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="rounded-[24px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4 dark:bg-[#08101f]/92">
          <div className="mb-3 flex items-center gap-2">
            <Flame className="h-4 w-4 text-[var(--bc-ai-start)]" />
            <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">
              Facteurs ayant influence l'analyse
            </p>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={explanation.charts.factorBreakdown} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.22)" />
                <XAxis type="number" tick={{ fill: "var(--bc-neutral-muted)", fontSize: 11 }} />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={112}
                  tick={{ fill: "var(--bc-neutral-muted)", fontSize: 11 }}
                />
                <RechartsTooltip
                  formatter={(value: number) => `${Math.round(value)}/100`}
                  contentStyle={{
                    borderRadius: 14,
                    border: "1px solid rgba(148,163,184,0.24)",
                    background: "rgba(255,255,255,0.96)",
                  }}
                />
                <Bar dataKey="value" radius={[0, 12, 12, 0]}>
                  {explanation.charts.factorBreakdown.map((entry, index) => (
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

        <div className="rounded-[24px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4 dark:bg-[#08101f]/92">
          <div className="mb-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-[var(--bc-ai-start)]" />
            <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">
              Evolution du risque
            </p>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={explanation.charts.riskTimeline}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.24)" />
                <XAxis dataKey="label" tick={{ fill: "var(--bc-neutral-muted)", fontSize: 11 }} />
                <YAxis tick={{ fill: "var(--bc-neutral-muted)", fontSize: 11 }} />
                <RechartsTooltip
                  formatter={(value: number) => `${Math.round(value)}/100`}
                  contentStyle={{
                    borderRadius: 14,
                    border: "1px solid rgba(148,163,184,0.24)",
                    background: "rgba(255,255,255,0.96)",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#0EA5E9"
                  strokeWidth={3}
                  dot={{ r: 4, fill: "#0EA5E9" }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="rounded-[24px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4 dark:bg-[#08101f]/92">
          <div className="mb-3 flex items-center gap-2">
            <Target className="h-4 w-4 text-[var(--bc-ai-start)]" />
            <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">
              Cartographie des zones critiques
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {heatmapPoints.map((point, index) => (
              <div
                key={`${point.label}-${index}`}
                className={cn(
                  "rounded-[20px] border px-4 py-4 shadow-[0_14px_28px_-24px_rgba(15,23,42,0.35)]",
                  getHeatTone(point.value),
                  point.value >= 80 ? "animate-pulse" : "",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--bc-neutral-strong)]">
                      {point.label}
                    </p>
                    <p className="mt-1 text-[11px] uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                      Intensite
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-[var(--bc-neutral-strong)]">
                    {Math.round(point.value)}/100
                  </span>
                </div>
                <div className="mt-4 h-2 rounded-full bg-white/65 dark:bg-white/10">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,#22C55E,#EAB308,#F97316,#EF4444)]"
                    style={{ width: `${Math.max(8, Math.min(100, Math.round(point.value)))}%` }}
                  />
                </div>
                {typeof point.secondaryValue === "number" ? (
                  <p className="mt-3 text-[11px] text-[var(--bc-neutral-body)]">
                    Rang heatmap: {Math.round(point.secondaryValue)}
                  </p>
                ) : null}
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-[var(--bc-neutral-body)]">
            <span className="rounded-full border border-[var(--bc-neutral-border)] bg-white/70 px-2.5 py-1 dark:bg-[#08101f]">
              Vert: normal
            </span>
            <span className="rounded-full border border-[var(--bc-neutral-border)] bg-white/70 px-2.5 py-1 dark:bg-[#08101f]">
              Jaune: attention
            </span>
            <span className="rounded-full border border-[var(--bc-neutral-border)] bg-white/70 px-2.5 py-1 dark:bg-[#08101f]">
              Orange: risque eleve
            </span>
            <span className="rounded-full border border-[var(--bc-neutral-border)] bg-white/70 px-2.5 py-1 dark:bg-[#08101f]">
              Rouge: critique
            </span>
          </div>

          {explanation.criticalZones.length > 0 ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {explanation.criticalZones.slice(0, 4).map((zone) => (
                <div
                  key={`${zone.zoneType}-${zone.label}`}
                  className={cn("rounded-[18px] border px-4 py-3", getSeverityTone(zone.severity))}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">
                        {zone.label}
                      </p>
                      <p className="mt-1 text-[11px] uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                        {zone.zoneType}
                      </p>
                    </div>
                    <Badge variant="outline" className={cn("px-2.5 py-1 text-[11px]", getRiskBadgeClass(zone.severity))}>
                      {formatRiskLevelLabel(zone.severity)}
                    </Badge>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-[var(--bc-neutral-body)]">
                    {zone.detail}
                  </p>
                  {zone.value ? (
                    <p className="mt-3 text-sm font-semibold text-[var(--bc-neutral-strong)]">{zone.value}</p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="rounded-[24px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4 dark:bg-[#08101f]/92">
          <div className="mb-3 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-[var(--bc-ai-start)]" />
            <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">
              Radar des scores IA
            </p>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={explanation.charts.scoreRadar}>
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

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="rounded-[24px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4 dark:bg-[#08101f]/92">
          <div className="mb-3 flex items-center gap-2">
            <TriangleAlert className="h-4 w-4 text-[var(--bc-ai-start)]" />
            <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">
              Causes et facteurs explicatifs
            </p>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                Facteurs explicatifs
              </p>
              <ul className="mt-2 space-y-2 text-sm leading-6 text-[var(--bc-neutral-body)]">
                {explanation.reasoning.slice(0, 5).map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-[0.55rem] h-1.5 w-1.5 rounded-full bg-[var(--bc-ai-start)]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
                Causes probables
              </p>
              <ul className="mt-2 space-y-2 text-sm leading-6 text-[var(--bc-neutral-body)]">
                {explanation.causes.slice(0, 5).map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-[0.55rem] h-1.5 w-1.5 rounded-full bg-[#F97316]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <div className="rounded-[24px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4 dark:bg-[#08101f]/92">
          <div className="mb-3 flex items-center gap-2">
            <Network className="h-4 w-4 text-[var(--bc-ai-start)]" />
            <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">
              Graphe explicatif
            </p>
          </div>
          <p className="text-sm leading-6 text-[var(--bc-neutral-body)]">
            {explanation.explanationGraph.summary}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {explanation.explanationGraph.nodes.slice(0, 6).map((node, index, nodes) => (
              <div key={node.nodeId} className="contents">
                <div
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-[11px] font-semibold",
                    getRiskBadgeClass(node.severity),
                  )}
                >
                  {node.label}
                </div>
                {index < nodes.length - 1 ? (
                  <span className="text-[var(--bc-neutral-muted)]">-&gt;</span>
                ) : null}
              </div>
            ))}
          </div>
          {explanation.explanationGraph.edges.length > 0 ? (
            <div className="mt-4 grid gap-2">
              {explanation.explanationGraph.edges.slice(0, 4).map((edge, index) => (
                <div
                  key={`${edge.source}-${edge.target}-${index}`}
                  className="rounded-[16px] border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)]/65 px-3 py-2 text-xs text-[var(--bc-neutral-body)]"
                >
                  {edge.source} - {edge.relation} - {edge.target}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {explanation.influencingFactors.length > 0 ? (
        <div className="mt-4 rounded-[24px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4 dark:bg-[#08101f]/92">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
            Facteurs dominants retenus
          </p>
          <div className="mt-3 grid gap-3 xl:grid-cols-2">
            {explanation.influencingFactors.slice(0, 6).map((factor) => (
              <div
                key={`${factor.category}-${factor.label}`}
                className={cn("rounded-[18px] border px-4 py-3", getSeverityTone(factor.severity))}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">{factor.label}</p>
                  <span className="text-sm font-semibold text-[var(--bc-neutral-strong)]">
                    {factor.value}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-[var(--bc-neutral-body)]">
                  {factor.evidence}
                </p>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <Badge variant="secondary" className="px-2.5 py-1 text-[11px]">
                    Impact {factor.impactScore}/100
                  </Badge>
                  <Badge variant="outline" className={cn("px-2.5 py-1 text-[11px]", getRiskBadgeClass(factor.severity))}>
                    {formatRiskLevelLabel(factor.severity)}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {explanation.recommendations.length > 0 ? (
        <div className="mt-4 rounded-[24px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4 dark:bg-[#08101f]/92">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
            Recommandations justifiees
          </p>
          <div className="mt-3 grid gap-3 xl:grid-cols-2">
            {explanation.recommendations.slice(0, 4).map((recommendation) => (
              <div
                key={recommendation}
                className="rounded-[18px] border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)]/70 px-4 py-3"
              >
                <p className="text-sm leading-6 text-[var(--bc-neutral-strong)]">{recommendation}</p>
                {onApplyRecommendation ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-3 rounded-xl border-[var(--bc-ai-border)] bg-white/80 dark:bg-[#08101f]"
                    onClick={() => onApplyRecommendation(recommendation)}
                  >
                    Approfondir
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

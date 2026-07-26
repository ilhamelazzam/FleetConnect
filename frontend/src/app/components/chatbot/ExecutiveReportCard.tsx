import {
  ArrowUpRight,
  Building2,
  Download,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
  Wallet,
  Wrench,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ApiExplainRecommendationResponse } from "../../lib/api";
import type { TelecomExecutiveReport } from "../../lib/chatbot-storage";
import { ExplainRecommendationModal } from "../ExplainRecommendationModal";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { cn } from "../ui/utils";

interface ExecutiveReportCardProps {
  report: TelecomExecutiveReport;
  onExportPdf: () => void;
  onApplyRecommendation?: (title: string) => void;
  onExplainRecommendation?: (title: string) => Promise<ApiExplainRecommendationResponse>;
}

function formatMadValue(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }

  return `${new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 0,
  }).format(value)} MAD`;
}

function formatScoreLevelLabel(value: TelecomExecutiveReport["fleetHealthLevel"]): string {
  if (value === "excellent") return "Excellent";
  if (value === "bon") return "Bon";
  if (value === "moyen") return "Moyen";
  return "Critique";
}

function formatRiskLevelLabel(value: TelecomExecutiveReport["riskLevel"]): string {
  if (value === "low") return "Faible";
  if (value === "medium") return "Moyen";
  if (value === "high") return "Eleve";
  return "Critique";
}

function getRiskBadgeClass(value: "low" | "medium" | "high" | "critical"): string {
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

function getHealthPillClass(value: TelecomExecutiveReport["fleetHealthLevel"]): string {
  if (value === "excellent") {
    return "border-[#22C55E]/30 bg-[#DCFCE7] text-[#166534] dark:border-[#22C55E]/30 dark:bg-[#0D2A16] dark:text-[#86EFAC]";
  }
  if (value === "bon") {
    return "border-[#38BDF8]/30 bg-[#E0F2FE] text-[#075985] dark:border-[#38BDF8]/30 dark:bg-[#082132] dark:text-[#7DD3FC]";
  }
  if (value === "moyen") {
    return "border-[#F59E0B]/30 bg-[#FEF3C7] text-[#92400E] dark:border-[#F59E0B]/30 dark:bg-[#35210A] dark:text-[#FCD34D]";
  }
  return "border-[#EF4444]/30 bg-[#FEE2E2] text-[#991B1B] dark:border-[#EF4444]/30 dark:bg-[#3A0D12] dark:text-[#FCA5A5]";
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
          ? "border-[#F8B4B4]/45 bg-[linear-gradient(180deg,rgba(254,226,226,0.95),rgba(255,255,255,0.95))] dark:border-[#EF4444]/25 dark:bg-[linear-gradient(180deg,rgba(58,13,18,0.85),rgba(8,16,31,0.96))]"
          : tone === "success"
            ? "border-[#86EFAC]/45 bg-[linear-gradient(180deg,rgba(220,252,231,0.95),rgba(255,255,255,0.95))] dark:border-[#22C55E]/25 dark:bg-[linear-gradient(180deg,rgba(13,42,22,0.88),rgba(8,16,31,0.96))]"
            : "border-[var(--bc-neutral-border)] bg-white/80 dark:bg-[#08101f]/90",
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-[var(--bc-neutral-strong)]">{value}</p>
    </div>
  );
}

export default function ExecutiveReportCard({
  report,
  onExportPdf,
  onApplyRecommendation,
  onExplainRecommendation,
}: ExecutiveReportCardProps) {
  return (
    <div className="rounded-[26px] border border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,rgba(99,102,241,0.09),rgba(56,189,248,0.06),rgba(255,255,255,0.96))] p-4 shadow-[0_22px_46px_-28px_rgba(37,99,235,0.42)] dark:bg-[linear-gradient(135deg,rgba(99,102,241,0.16),rgba(8,16,31,0.98),rgba(8,16,31,0.98))]">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="border-[var(--bc-ai-border)] bg-white/75 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[var(--bc-ai-start)] dark:bg-[#08101f]"
            >
              <Sparkles className="mr-1 h-3.5 w-3.5" />
              Directeur / DSI
            </Badge>
            <Badge variant="outline" className={cn("px-3 py-1 text-[11px]", getHealthPillClass(report.fleetHealthLevel))}>
              Sante flotte: {formatScoreLevelLabel(report.fleetHealthLevel)}
            </Badge>
            <Badge variant="outline" className={cn("px-3 py-1 text-[11px]", getRiskBadgeClass(report.riskLevel))}>
              Risque: {formatRiskLevelLabel(report.riskLevel)}
            </Badge>
            <Badge variant="secondary" className="px-3 py-1 text-[11px]">
              {report.multimodalAnalysisCount} analyses multimodales
            </Badge>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
            <div className="rounded-[24px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-5 text-center dark:bg-[#08101f]/92">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--bc-neutral-muted)]">
                Fleet Health Score
              </p>
              <div className="mx-auto mt-4 flex h-28 w-28 items-center justify-center rounded-full border-[10px] border-[var(--bc-ai-border)] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.96),rgba(224,231,255,0.88))] text-3xl font-semibold text-[var(--bc-neutral-strong)] shadow-[0_12px_28px_-18px_rgba(79,70,229,0.5)] dark:bg-[radial-gradient(circle_at_top,rgba(99,102,241,0.18),rgba(8,16,31,0.98))]">
                {report.fleetHealthScore}
              </div>
              <p className="mt-4 text-sm text-[var(--bc-neutral-body)]">
                {formatScoreLevelLabel(report.fleetHealthLevel)} sur le perimetre disponible
              </p>
            </div>

            <div className="rounded-[24px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-5 dark:bg-[#08101f]/92">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--bc-neutral-muted)]">
                    Resume executif IA
                  </p>
                  <p className="mt-3 text-sm leading-7 text-[var(--bc-neutral-strong)]">
                    {report.executiveSummary}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0 rounded-xl border-[var(--bc-ai-border)] bg-white/80 dark:bg-[#08101f]"
                  onClick={onExportPdf}
                >
                  <Download className="h-4 w-4" />
                  Export PDF executif
                </Button>
              </div>

              {report.multimodalHighlights.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {report.multimodalHighlights.map((highlight) => (
                    <span
                      key={highlight}
                      className="rounded-full border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)]/75 px-3 py-1 text-[11px] text-[var(--bc-neutral-body)]"
                    >
                      {highlight}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {renderMetricCard("Economies estimees", report.estimatedSavings, "success")}
        {renderMetricCard("Risque global", `${report.riskScore}/100`, "risk")}
        {renderMetricCard("Fraude", `${report.fraudScore}/100`, report.fraudScore >= 60 ? "risk" : "neutral")}
        {renderMetricCard(
          "Optimisation",
          `${report.optimizationScore}/100`,
          report.optimizationScore >= 60 ? "risk" : "neutral",
        )}
        {renderMetricCard(
          "Anomalie",
          `${report.anomalyScore}/100`,
          report.anomalyScore >= 60 ? "risk" : "neutral",
        )}
        {renderMetricCard(
          "Equipement",
          `${report.equipmentScore}/100`,
          report.equipmentScore >= 60 ? "risk" : "neutral",
        )}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="rounded-[24px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4 dark:bg-[#08101f]/92">
          <div className="mb-3 flex items-center gap-2">
            <Wallet className="h-4 w-4 text-[var(--bc-ai-start)]" />
            <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">
              Evolution et projection couts
            </p>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={report.charts.costEvolution}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.24)" />
                <XAxis dataKey="label" tick={{ fill: "var(--bc-neutral-muted)", fontSize: 11 }} />
                <YAxis tick={{ fill: "var(--bc-neutral-muted)", fontSize: 11 }} />
                <RechartsTooltip
                  formatter={(value: number) => formatMadValue(value)}
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
        </div>

        <div className="rounded-[24px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4 dark:bg-[#08101f]/92">
          <div className="mb-3 flex items-center gap-2">
            <Building2 className="h-4 w-4 text-[var(--bc-ai-start)]" />
            <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">
              Risque par departement
            </p>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={report.charts.departmentRisk} layout="vertical" margin={{ left: 18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                <XAxis type="number" tick={{ fill: "var(--bc-neutral-muted)", fontSize: 11 }} />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={92}
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
                  {report.charts.departmentRisk.map((entry) => (
                    <Cell
                      key={entry.label}
                      fill={entry.value >= 75 ? "#EF4444" : entry.value >= 55 ? "#F97316" : "#38BDF8"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="rounded-[24px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4 dark:bg-[#08101f]/92">
          <div className="mb-3 flex items-center gap-2">
            <TriangleAlert className="h-4 w-4 text-[var(--bc-ai-start)]" />
            <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">
              Operateurs les plus couteux
            </p>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={report.charts.operatorCosts}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.24)" />
                <XAxis dataKey="label" tick={{ fill: "var(--bc-neutral-muted)", fontSize: 11 }} />
                <YAxis tick={{ fill: "var(--bc-neutral-muted)", fontSize: 11 }} />
                <RechartsTooltip
                  formatter={(value: number) => formatMadValue(value)}
                  contentStyle={{
                    borderRadius: 14,
                    border: "1px solid rgba(148,163,184,0.24)",
                    background: "rgba(255,255,255,0.96)",
                  }}
                />
                <Bar dataKey="value" radius={[12, 12, 0, 0]}>
                  {report.charts.operatorCosts.map((entry) => (
                    <Cell key={entry.label} fill="#0F766E" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-[24px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4 dark:bg-[#08101f]/92">
          <div className="mb-3 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-[var(--bc-ai-start)]" />
            <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">
              Breakdown des scores
            </p>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={report.charts.scoreBreakdown}>
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
                <Bar dataKey="value" radius={[12, 12, 0, 0]}>
                  {report.charts.scoreBreakdown.map((entry) => (
                    <Cell
                      key={entry.label}
                      fill={
                        entry.label === "Fraude"
                          ? "#DC2626"
                          : entry.label === "Risque"
                            ? "#F97316"
                            : entry.label === "Optimisation"
                              ? "#2563EB"
                              : entry.label === "Anomalie"
                                ? "#7C3AED"
                                : "#0F766E"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="rounded-[24px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4 dark:bg-[#08101f]/92">
          <div className="mb-3 flex items-center gap-2">
            <Wallet className="h-4 w-4 text-[var(--bc-ai-start)]" />
            <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">
              Couts critiques
            </p>
          </div>
          <div className="space-y-3">
            {report.criticalCosts.slice(0, 5).map((item) => (
              <div
                key={`${item.category}-${item.title}`}
                className="rounded-2xl border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)]/70 px-3 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">{item.title}</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--bc-neutral-body)]">{item.reason}</p>
                  </div>
                  <span className="whitespace-nowrap text-sm font-semibold text-[var(--bc-ai-start)]">
                    {formatMadValue(item.amountMad)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[24px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4 dark:bg-[#08101f]/92">
          <div className="mb-3 flex items-center gap-2">
            <Building2 className="h-4 w-4 text-[var(--bc-ai-start)]" />
            <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">
              Departements les plus exposes
            </p>
          </div>
          <div className="space-y-3">
            {report.highRiskDepartments.slice(0, 5).map((item) => (
              <div
                key={item.department}
                className="rounded-2xl border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)]/70 px-3 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">{item.department}</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--bc-neutral-body)]">{item.reason}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">{item.riskScore}/100</p>
                    <p className="mt-1 text-[11px] text-[var(--bc-neutral-muted)]">
                      {item.monthlyCostMad ? formatMadValue(item.monthlyCostMad) : `${item.alertCount} alertes`}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div className="rounded-[24px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4 dark:bg-[#08101f]/92">
          <div className="mb-3 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-[var(--bc-ai-start)]" />
            <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">
              Risques prioritaires et fraude potentielle
            </p>
          </div>
          <div className="space-y-3">
            {report.priorityRisks.slice(0, 6).map((risk) => (
              <div
                key={risk}
                className="rounded-2xl border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)]/70 px-3 py-3 text-sm text-[var(--bc-neutral-body)]"
              >
                {risk}
              </div>
            ))}
            {report.fraudSignals.slice(0, 3).map((signal) => (
              <div
                key={signal.title}
                className="rounded-2xl border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)]/70 px-3 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">{signal.title}</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--bc-neutral-body)]">{signal.reason}</p>
                  </div>
                  <Badge variant="outline" className={cn("px-2.5 py-1 text-[10px]", getRiskBadgeClass(signal.severity))}>
                    {formatRiskLevelLabel(signal.severity)}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[24px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4 dark:bg-[#08101f]/92">
          <div className="mb-3 flex items-center gap-2">
            <Wrench className="h-4 w-4 text-[var(--bc-ai-start)]" />
            <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">
              Opportunites d'optimisation
            </p>
          </div>
          <div className="space-y-3">
            {report.optimizationOpportunities.slice(0, 5).map((item) => (
              <div
                key={item.title}
                className="rounded-2xl border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)]/70 px-3 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">{item.title}</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--bc-neutral-body)]">{item.justification}</p>
                  </div>
                  <span className="whitespace-nowrap text-sm font-semibold text-[var(--bc-ai-start)]">
                    {typeof item.estimatedSavingMad === "number"
                      ? formatMadValue(item.estimatedSavingMad)
                      : "Impact non chiffre"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-[24px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4 dark:bg-[#08101f]/92">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--bc-ai-start)]" />
          <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">
            Recommandations prioritaires
          </p>
        </div>
        <div className="grid gap-3 xl:grid-cols-2">
          {report.topRecommendations.slice(0, 6).map((item) => (
            <div
              key={item.title}
              className="rounded-[22px] border border-[var(--bc-neutral-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.94))] px-4 py-4 dark:bg-[linear-gradient(180deg,rgba(8,16,31,0.98),rgba(15,23,42,0.95))]"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">{item.title}</p>
                  <p className="mt-2 text-xs leading-5 text-[var(--bc-neutral-body)]">{item.justification}</p>
                </div>
                <Badge variant="outline" className={cn("px-2.5 py-1 text-[10px]", getRiskBadgeClass(item.priority))}>
                  {formatRiskLevelLabel(item.priority)}
                </Badge>
              </div>
              <div className="mt-3 rounded-2xl border border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,rgba(99,102,241,0.08),rgba(56,189,248,0.04),rgba(255,255,255,0.88))] px-3 py-3 dark:bg-[linear-gradient(135deg,rgba(99,102,241,0.12),rgba(8,16,31,0.98),rgba(8,16,31,0.98))]">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--bc-ai-start)]">
                  Action proposee
                </p>
                <p className="mt-2 text-sm leading-6 text-[var(--bc-neutral-strong)]">{item.action}</p>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-xs text-[var(--bc-neutral-muted)]">
                  {typeof item.estimatedSavingMad === "number"
                    ? `Gain estime: ${formatMadValue(item.estimatedSavingMad)}`
                    : "Gain a confirmer"}
                </span>
                <div className="flex flex-wrap justify-end gap-2">
                  {onExplainRecommendation ? (
                    <ExplainRecommendationModal
                      recommendation={item.title}
                      onExplain={onExplainRecommendation}
                      buttonLabel="Pourquoi cette recommandation ?"
                    />
                  ) : null}
                  {onApplyRecommendation ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="rounded-xl border-[var(--bc-ai-border)] bg-white/80 dark:bg-[#08101f]"
                      onClick={() => onApplyRecommendation(item.title)}
                    >
                      <ArrowUpRight className="h-4 w-4" />
                      Approfondir
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {report.majorAnomalies.length > 0 ? (
        <div className="mt-4 rounded-[24px] border border-[var(--bc-neutral-border)] bg-white/82 px-4 py-4 dark:bg-[#08101f]/92">
          <div className="mb-3 flex items-center gap-2">
            <TriangleAlert className="h-4 w-4 text-[var(--bc-ai-start)]" />
            <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">
              Anomalies majeures
            </p>
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            {report.majorAnomalies.slice(0, 6).map((item) => (
              <div
                key={`${item.source}-${item.title}`}
                className="rounded-2xl border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)]/70 px-3 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--bc-neutral-strong)]">{item.title}</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--bc-neutral-body)]">{item.reason}</p>
                  </div>
                  <Badge variant="outline" className={cn("px-2.5 py-1 text-[10px]", getRiskBadgeClass(item.severity))}>
                    {formatRiskLevelLabel(item.severity)}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

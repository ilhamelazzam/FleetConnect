import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Database,
  Gauge,
  Globe2,
  Search,
  ShieldAlert,
  TrendingUp,
  Wallet,
  Wifi,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import DashboardSection from "../components/dashboard/DashboardSection";
import WidgetVisibilityManager from "../components/dashboard/WidgetVisibilityManager";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { useAuth } from "../context/AuthContext";
import {
  ApiError,
  customerChurnApi,
  type ApiCustomerChurnConsumption,
  type ApiCustomerChurnFilters,
  type ApiCustomerChurnPrediction,
} from "../lib/api";
import {
  formatCustomerRiskLabel,
  formatMadValue,
  formatRiskScore,
  getCustomerRiskClasses,
  getCustomerRiskColor,
  getOperatorStyles,
} from "../lib/customer-churn";
import {
  type DashboardWidgetDefinition,
  useDashboardPreferences,
} from "../hooks/useDashboardPreferences";

const consumptionWidgets: DashboardWidgetDefinition[] = [
  {
    id: "kpis",
    label: "Pilotage teleco",
    description: "Vue executive des couts, quotas, roaming et exposition future.",
    defaultVisible: true,
  },
  {
    id: "filters",
    label: "Filtres",
    description: "Ciblage par operateur, departement, forfait et risque.",
    defaultVisible: true,
  },
  {
    id: "charts",
    label: "Analyses par segment",
    description: "Repartition dynamique par operateur et departement.",
    defaultVisible: true,
  },
  {
    id: "priority-lines",
    label: "Lignes prioritaires",
    description: "Lignes a surveiller pour quota, roaming, anomalies et cout futur.",
    defaultVisible: true,
  },
];

function normalizeError(error: unknown, fallbackMessage: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallbackMessage;
}

function formatVolume(value: number, unit: string): string {
  return `${value.toLocaleString("fr-FR", {
    minimumFractionDigits: value % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 1,
  })} ${unit}`;
}

function formatRatio(numerator: number, denominator: number): string {
  if (denominator === 0) {
    return "0%";
  }
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function buildPriorityReason(line: ApiCustomerChurnPrediction): string[] {
  const reasons: string[] = [];

  if (line.over_quota_flag) {
    reasons.push("Depassement de quota");
  }
  if (line.roaming_flag) {
    reasons.push("Roaming actif");
  }
  if (line.anomaly_flag) {
    reasons.push("Anomalie detectee");
  }
  if (line.risk_level === "Critique" || line.risk_level === "Eleve") {
    reasons.push(`Risque ${formatCustomerRiskLabel(line.risk_level)}`);
  }

  return reasons.length > 0 ? reasons : ["Surveillance preventive"];
}

function ConsumptionLineCard({
  line,
  emphasis,
  onOpenPredictions,
  onOpenRecommendations,
}: {
  line: ApiCustomerChurnPrediction;
  emphasis: "cost" | "priority";
  onOpenPredictions: () => void;
  onOpenRecommendations: () => void;
}) {
  const operatorStyles = getOperatorStyles(line.operator);
  const reasons = buildPriorityReason(line);

  return (
    <article className="rounded-[28px] border border-[var(--bc-neutral-border)] bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-semibold text-[var(--bc-neutral-strong)]">
                {line.customer_id}
              </h3>
              <span
                className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getCustomerRiskClasses(
                  line.risk_level,
                )}`}
              >
                {formatCustomerRiskLabel(line.risk_level)}
              </span>
              <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-[#6D28D9]">
                {emphasis === "priority" ? "A traiter" : "Top consommation"}
              </span>
            </div>
            <p className="mt-2 text-sm text-[var(--bc-neutral-body)]">
              {line.department} · {line.plan} · quota {formatVolume(line.quota_gb, "Go")}
            </p>
          </div>

          <span
            className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold"
            style={operatorStyles}
          >
            {line.operator}
          </span>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-[var(--bc-neutral-border)] bg-[var(--bc-primary-soft)] px-4 py-3">
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
              Cout mensuel
            </p>
            <p className="mt-2 text-xl font-semibold text-[var(--bc-primary-hover)]">
              {formatMadValue(line.monthly_cost_mad)}
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--bc-neutral-border)] bg-white px-4 py-3">
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
              Data consommee
            </p>
            <p className="mt-2 text-xl font-semibold text-[var(--bc-neutral-strong)]">
              {formatVolume(line.data_usage_gb, "Go")}
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--bc-neutral-border)] bg-white px-4 py-3">
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
              Cout futur
            </p>
            <p className="mt-2 text-xl font-semibold text-[var(--bc-neutral-strong)]">
              {formatMadValue(line.future_cost_pred_mad)}
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--bc-neutral-border)] bg-white px-4 py-3">
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--bc-neutral-muted)]">
              Score risque
            </p>
            <p className="mt-2 text-xl font-semibold text-[var(--bc-neutral-strong)]">
              {formatRiskScore(line.risk_score_100)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {reasons.map((reason) => (
            <Badge key={reason} variant="outline" className="bg-white">
              {reason}
            </Badge>
          ))}
          <Badge variant="outline" className="bg-white">
            {formatVolume(line.data_usage_gb, "Go")} / {formatVolume(line.quota_gb, "Go")}
          </Badge>
        </div>

        <div className="rounded-2xl border border-[var(--bc-ai-border)] bg-[var(--bc-ai-soft)] px-4 py-3 text-sm text-[var(--bc-neutral-body)]">
          {line.recommendation}
        </div>

        <div className="flex flex-wrap gap-3">
          <Button type="button" className="rounded-2xl" onClick={onOpenPredictions}>
            <TrendingUp className="h-4 w-4" />
            Ouvrir les predictions
          </Button>
          <Button
            type="button"
            variant="outline"
            className="rounded-2xl"
            onClick={onOpenRecommendations}
          >
            <ArrowRight className="h-4 w-4" />
            Voir la recommandation
          </Button>
        </div>
      </div>
    </article>
  );
}

export default function Consumption() {
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const dashboardPreferences = useDashboardPreferences(
    "historical-consumption",
    consumptionWidgets,
    user?.email,
  );

  const [filters, setFilters] = useState<ApiCustomerChurnFilters | null>(null);
  const [consumption, setConsumption] = useState<ApiCustomerChurnConsumption | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOperator, setSelectedOperator] = useState("all");
  const [selectedDepartment, setSelectedDepartment] = useState("all");
  const [selectedPlan, setSelectedPlan] = useState("all");
  const [selectedRiskLevel, setSelectedRiskLevel] = useState("all");

  useEffect(() => {
    let isMounted = true;

    async function loadFilters() {
      if (!token) {
        return;
      }

      try {
        const response = await customerChurnApi.filters(token);
        if (isMounted) {
          setFilters(response);
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(normalizeError(error, "Impossible de charger les filtres teleco."));
        }
      }
    }

    void loadFilters();

    return () => {
      isMounted = false;
    };
  }, [token]);

  useEffect(() => {
    let isMounted = true;

    async function loadConsumption() {
      if (!token) {
        if (isMounted) {
          setConsumption(null);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await customerChurnApi.consumption(token, {
          search: searchQuery.trim() || undefined,
          operator: selectedOperator !== "all" ? selectedOperator : undefined,
          department: selectedDepartment !== "all" ? selectedDepartment : undefined,
          plan: selectedPlan !== "all" ? selectedPlan : undefined,
          risk_level: selectedRiskLevel !== "all" ? selectedRiskLevel : undefined,
        });

        if (isMounted) {
          setConsumption(response);
        }
      } catch (error) {
        if (isMounted) {
          setConsumption(null);
          setErrorMessage(
            normalizeError(error, "Impossible de charger le module Consommations."),
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadConsumption();

    return () => {
      isMounted = false;
    };
  }, [token, searchQuery, selectedOperator, selectedDepartment, selectedPlan, selectedRiskLevel]);

  const kpis = consumption?.kpis;
  const overQuotaRatio = useMemo(
    () => formatRatio(kpis?.over_quota_lines ?? 0, kpis?.total_lines ?? 0),
    [kpis],
  );
  const roamingRatio = useMemo(
    () => formatRatio(kpis?.roaming_lines ?? 0, kpis?.total_lines ?? 0),
    [kpis],
  );
  const topOperator = consumption?.cost_by_operator[0] ?? null;
  const topDepartment = consumption?.cost_by_department[0] ?? null;

  return (
    <div className="space-y-6 p-6">
      <DashboardSection isVisible={dashboardPreferences.isWidgetVisible("kpis")}>
        <section className="overflow-hidden rounded-[34px] border border-[var(--bc-primary-border)] bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.16),transparent_24%),radial-gradient(circle_at_top_right,rgba(139,92,246,0.18),transparent_32%),linear-gradient(135deg,#0F172A_0%,#1D4ED8_55%,#4F46E5_100%)] p-6 text-white shadow-[0_28px_80px_-48px_rgba(15,23,42,0.48)]">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/80">
                <BarChart3 className="h-3.5 w-3.5" />
                Dataset teleco restaure
              </div>
              <h1 className="mt-4 text-3xl font-bold">Consommations</h1>
              <p className="mt-3 text-sm leading-6 text-white/80">
                Pilotage dynamique issu de <span className="font-semibold">fleet_ai_results_morocco.csv</span>:
                couts mensuels, data, depassements de quota, roaming et projection future.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge className="rounded-full border-white/15 bg-white/10 px-3 py-1 text-white">
                  {topOperator ? `${topOperator.label} en tete` : "Operateurs charges dynamiquement"}
                </Badge>
                <Badge className="rounded-full border-white/15 bg-white/10 px-3 py-1 text-white">
                  {topDepartment ? `${topDepartment.label} le plus expose` : "Vue par departement"}
                </Badge>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {[
                {
                  label: "Cout mensuel",
                  value: isLoading ? "--" : formatMadValue(kpis?.total_monthly_cost_mad ?? 0),
                  helper: `${kpis?.total_lines ?? 0} lignes analysees`,
                  icon: Wallet,
                },
                {
                  label: "Projection future",
                  value: isLoading ? "--" : formatMadValue(kpis?.total_future_cost_pred_mad ?? 0),
                  helper: "Projection agrégée IA",
                  icon: TrendingUp,
                },
                {
                  label: "Depassements",
                  value: isLoading ? "--" : `${kpis?.over_quota_lines ?? 0}`,
                  helper: `${overQuotaRatio} du parc filtre`,
                  icon: AlertTriangle,
                },
                {
                  label: "Roaming actif",
                  value: isLoading ? "--" : `${kpis?.roaming_lines ?? 0}`,
                  helper: `${roamingRatio} du parc filtre`,
                  icon: Globe2,
                },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.label}
                    className="rounded-3xl border border-white/15 bg-white/10 p-4 backdrop-blur-sm"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
                        {item.label}
                      </p>
                      <Icon className="h-4 w-4 text-white" />
                    </div>
                    <p className="mt-3 text-2xl font-bold">{item.value}</p>
                    <p className="mt-2 text-sm text-white/75">{item.helper}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </DashboardSection>

      {errorMessage ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {errorMessage}
        </div>
      ) : null}

      <WidgetVisibilityManager
        widgets={consumptionWidgets}
        visibility={dashboardPreferences.visibility}
        visibleCount={dashboardPreferences.visibleCount}
        onChange={dashboardPreferences.setWidgetVisible}
        onReset={dashboardPreferences.showAllWidgets}
      />

      <DashboardSection isVisible={dashboardPreferences.isWidgetVisible("filters")}>
        <section className="rounded-[28px] border border-[var(--bc-neutral-border)] bg-white p-5 shadow-sm">
          <div className="grid gap-4 xl:grid-cols-5">
            <label className="relative xl:col-span-2">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--bc-neutral-muted)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Client, recommandation, operateur..."
                className="h-12 w-full rounded-2xl border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)] py-2.5 pl-10 pr-4 text-sm text-[var(--bc-neutral-strong)] outline-none transition focus:border-[var(--bc-primary)] focus:ring-2 focus:ring-[var(--bc-primary-soft)]"
              />
            </label>

            <select
              value={selectedOperator}
              onChange={(event) => setSelectedOperator(event.target.value)}
              className="h-12 rounded-2xl border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)] px-4 text-sm outline-none transition focus:border-[var(--bc-primary)] focus:ring-2 focus:ring-[var(--bc-primary-soft)]"
            >
              <option value="all">Tous les operateurs</option>
              {(filters?.operators ?? []).map((operator) => (
                <option key={operator} value={operator}>
                  {operator}
                </option>
              ))}
            </select>

            <select
              value={selectedDepartment}
              onChange={(event) => setSelectedDepartment(event.target.value)}
              className="h-12 rounded-2xl border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)] px-4 text-sm outline-none transition focus:border-[var(--bc-primary)] focus:ring-2 focus:ring-[var(--bc-primary-soft)]"
            >
              <option value="all">Tous les departements</option>
              {(filters?.departments ?? []).map((department) => (
                <option key={department} value={department}>
                  {department}
                </option>
              ))}
            </select>

            <select
              value={selectedPlan}
              onChange={(event) => setSelectedPlan(event.target.value)}
              className="h-12 rounded-2xl border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)] px-4 text-sm outline-none transition focus:border-[var(--bc-primary)] focus:ring-2 focus:ring-[var(--bc-primary-soft)]"
            >
              <option value="all">Tous les forfaits</option>
              {(filters?.plans ?? []).map((plan) => (
                <option key={plan} value={plan}>
                  {plan}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_auto]">
            <select
              value={selectedRiskLevel}
              onChange={(event) => setSelectedRiskLevel(event.target.value)}
              className="h-12 rounded-2xl border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)] px-4 text-sm outline-none transition focus:border-[var(--bc-primary)] focus:ring-2 focus:ring-[var(--bc-primary-soft)]"
            >
              <option value="all">Tous les niveaux de risque</option>
              {(filters?.risk_levels ?? []).map((riskLevel) => (
                <option key={riskLevel} value={riskLevel}>
                  {formatCustomerRiskLabel(riskLevel)}
                </option>
              ))}
            </select>

            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="bg-white">
                <Database className="mr-1 h-3.5 w-3.5" />
                Source: `fleet_ai_results_morocco.csv`
              </Badge>
              <Badge variant="outline" className="bg-white">
                <Gauge className="mr-1 h-3.5 w-3.5" />
                Score moyen {formatRiskScore(kpis?.average_risk_score ?? 0)}
              </Badge>
            </div>
          </div>
        </section>
      </DashboardSection>

      <DashboardSection isVisible={dashboardPreferences.isWidgetVisible("charts")}>
        <div className="grid gap-6 xl:grid-cols-3">
          <section className="rounded-[28px] border border-[var(--bc-neutral-border)] bg-white p-5 shadow-sm xl:col-span-2">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--bc-neutral-muted)]">
                  Cout mensuel par operateur
                </p>
                <h2 className="mt-2 text-xl font-semibold text-[var(--bc-neutral-strong)]">
                  Concentration budgetaire
                </h2>
              </div>
              <Badge className="rounded-full border-blue-200 bg-blue-50 px-3 py-1 text-[#2563EB]">
                {consumption?.cost_by_operator.length ?? 0} operateurs
              </Badge>
            </div>

            <div className="mt-5 h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={consumption?.cost_by_operator ?? []}>
                  <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="#64748B" />
                  <YAxis stroke="#64748B" />
                  <Tooltip formatter={(value: number) => formatMadValue(value)} />
                  <Bar dataKey="total_monthly_cost_mad" radius={[12, 12, 0, 0]}>
                    {(consumption?.cost_by_operator ?? []).map((entry, index) => (
                      <Cell
                        key={entry.label}
                        fill={index === 0 ? "#2563EB" : "#93C5FD"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="rounded-[28px] border border-[var(--bc-neutral-border)] bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--bc-neutral-muted)]">
              Resume teleco
            </p>
            <div className="mt-4 space-y-3">
              {[
                {
                  label: "Data totale",
                  value: formatVolume(kpis?.total_data_usage_gb ?? 0, "Go"),
                  icon: Wifi,
                  tone: "text-[#2563EB]",
                },
                {
                  label: "Quota moyen",
                  value: formatVolume(kpis?.average_quota_gb ?? 0, "Go"),
                  icon: Gauge,
                  tone: "text-[#6D28D9]",
                },
                {
                  label: "Lignes a risque",
                  value: `${kpis?.high_risk_lines ?? 0}`,
                  icon: ShieldAlert,
                  tone: "text-[#DC2626]",
                },
                {
                  label: "Anomalies d'usage",
                  value: `${kpis?.anomaly_lines ?? 0}`,
                  icon: AlertTriangle,
                  tone: "text-[#F97316]",
                },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.label}
                    className="rounded-2xl border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)] px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-[var(--bc-neutral-body)]">{item.label}</span>
                      <Icon className={`h-4 w-4 ${item.tone}`} />
                    </div>
                    <p className="mt-2 text-lg font-semibold text-[var(--bc-neutral-strong)]">
                      {isLoading ? "--" : item.value}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-[28px] border border-[var(--bc-neutral-border)] bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--bc-neutral-muted)]">
                  Cout par departement
                </p>
                <h2 className="mt-2 text-xl font-semibold text-[var(--bc-neutral-strong)]">
                  Departments exposes
                </h2>
              </div>
            </div>

            <div className="mt-5 h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={consumption?.cost_by_department ?? []} layout="vertical">
                  <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" />
                  <XAxis type="number" stroke="#64748B" />
                  <YAxis dataKey="label" type="category" width={110} stroke="#64748B" />
                  <Tooltip formatter={(value: number) => formatMadValue(value)} />
                  <Bar dataKey="total_monthly_cost_mad" radius={[0, 12, 12, 0]}>
                    {(consumption?.cost_by_department ?? []).map((entry) => (
                      <Cell
                        key={entry.label}
                        fill={getCustomerRiskColor(entry.average_risk_score >= 70 ? "Critique" : entry.average_risk_score >= 50 ? "Eleve" : entry.average_risk_score >= 30 ? "Moyen" : "Faible")}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="rounded-[28px] border border-[var(--bc-neutral-border)] bg-white p-5 shadow-sm xl:col-span-2">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--bc-neutral-muted)]">
                  Usage data par departement
                </p>
                <h2 className="mt-2 text-xl font-semibold text-[var(--bc-neutral-strong)]">
                  Volumetrie et saturation
                </h2>
              </div>
            </div>

            <div className="mt-5 h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={consumption?.usage_by_department ?? []}>
                  <CartesianGrid stroke="#E2E8F0" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="#64748B" />
                  <YAxis stroke="#64748B" />
                  <Tooltip formatter={(value: number) => formatVolume(value, "Go")} />
                  <Bar dataKey="total_data_usage_gb" radius={[12, 12, 0, 0]}>
                    {(consumption?.usage_by_department ?? []).map((entry, index) => (
                      <Cell
                        key={entry.label}
                        fill={index % 2 === 0 ? "#6D28D9" : "#8B5CF6"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>
      </DashboardSection>

      <DashboardSection isVisible={dashboardPreferences.isWidgetVisible("priority-lines")}>
        <div className="grid gap-6 2xl:grid-cols-2">
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--bc-neutral-muted)]">
                  Top consommateurs
                </p>
                <h2 className="mt-2 text-xl font-semibold text-[var(--bc-neutral-strong)]">
                  Lignes les plus couteuses
                </h2>
              </div>
            </div>

            {(consumption?.top_consumers ?? []).slice(0, 4).map((line) => (
              <ConsumptionLineCard
                key={`top-${line.customer_row_id}`}
                line={line}
                emphasis="cost"
                onOpenPredictions={() => navigate("/predictions")}
                onOpenRecommendations={() => navigate("/recommandations")}
              />
            ))}
          </section>

          <section className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--bc-neutral-muted)]">
                  Lignes prioritaires
                </p>
                <h2 className="mt-2 text-xl font-semibold text-[var(--bc-neutral-strong)]">
                  Quota, roaming et anomalies
                </h2>
              </div>
            </div>

            {(consumption?.priority_lines ?? []).slice(0, 4).map((line) => (
              <ConsumptionLineCard
                key={`priority-${line.customer_row_id}`}
                line={line}
                emphasis="priority"
                onOpenPredictions={() => navigate("/predictions")}
                onOpenRecommendations={() => navigate("/recommandations")}
              />
            ))}
          </section>
        </div>
      </DashboardSection>
    </div>
  );
}

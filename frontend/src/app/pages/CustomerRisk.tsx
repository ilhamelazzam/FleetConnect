import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  Brain,
  Download,
  Eye,
  Filter,
  Lightbulb,
  PhoneCall,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  TrendingUp,
  Users as UsersIcon,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import AIRecommendationBlock from "../components/AIRecommendationBlock";
import { Badge } from "../components/ui/badge";
import { useAuth } from "../context/AuthContext";
import {
  ApiError,
  customerChurnApi,
  type ApiCustomerChurnCustomer,
  type ApiCustomerChurnCustomerList,
  type ApiCustomerChurnFilters,
  type ApiCustomerChurnOverview,
} from "../lib/api";
import {
  formatChurnLabel,
  formatContractLabel,
  formatCustomerRiskLabel,
  formatInternetServiceLabel,
  formatMadValue,
  formatPaymentMethodLabel,
  formatRiskProbability,
  formatRiskScore,
  formatTenure,
  getChurnClasses,
  getCustomerRiskClasses,
  getOperatorStyles,
} from "../lib/customer-churn";

const PAGE_SIZE = 20;

type PriorityLevel = "P1" | "P2" | "P3";
type SortMode = "risk" | "revenue" | "probability";
type ScoreBand = "all" | "critical" | "warning" | "safe";

interface EnrichedCustomer extends ApiCustomerChurnCustomer {
  priorityLevel: PriorityLevel;
  priorityScore: number;
  whyRisk: string[];
  quickSummary: string;
  primaryAction: string;
  revenueExposureMad: number;
  estimatedRecoveredRevenueMad: number;
}

function normalizeError(error: unknown, fallbackMessage: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallbackMessage;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}

function getPriorityClasses(priorityLevel: PriorityLevel): string {
  if (priorityLevel === "P1") return "border-red-200 bg-red-50 text-[#DC2626]";
  if (priorityLevel === "P2") return "border-orange-200 bg-orange-50 text-[#F97316]";
  return "border-amber-200 bg-amber-50 text-[#CA8A04]";
}

function getScoreColor(score: number): string {
  if (score >= 80) return "#DC2626";
  if (score >= 50) return "#F97316";
  return "#16A34A";
}

function getPriorityLevel(score: number): PriorityLevel {
  if (score >= 82) return "P1";
  if (score >= 63) return "P2";
  return "P3";
}

function matchesScoreBand(score: number, scoreBand: ScoreBand): boolean {
  if (scoreBand === "critical") return score >= 80;
  if (scoreBand === "warning") return score >= 50 && score < 80;
  if (scoreBand === "safe") return score < 50;
  return true;
}

function buildWhyRisk(customer: ApiCustomerChurnCustomer, averageMonthlyRevenueMad: number): string[] {
  const reasons: string[] = [];
  const normalizedContract = customer.contract.trim().toLowerCase();
  const normalizedService = customer.internet_service.trim().toLowerCase();
  const normalizedPaymentMethod = customer.payment_method.trim().toLowerCase();

  if (customer.tenure <= 6) reasons.push("faible anciennete");
  if (averageMonthlyRevenueMad > 0 && customer.monthly_cost_mad >= averageMonthlyRevenueMad * 1.15) reasons.push("cout eleve");
  if (normalizedContract === "month-to-month") reasons.push("contrat mensuel instable");
  if (customer.risk_proba >= 0.75 || customer.predicted_churn) reasons.push("risque de depart eleve");
  if (normalizedService === "dsl" || normalizedService === "no internet service") reasons.push("usage faible percu");
  if (normalizedPaymentMethod === "electronic check") reasons.push("mode de paiement sensible");
  if (reasons.length === 0) reasons.push("profil proche des cohortes a surveiller");

  return reasons.slice(0, 4);
}

function buildPrimaryAction(customer: ApiCustomerChurnCustomer, priorityLevel: PriorityLevel, averageMonthlyRevenueMad: number): string {
  const normalizedRecommendation = customer.recommendation.trim().toLowerCase();
  if (normalizedRecommendation.includes("upgrade") || normalizedRecommendation.includes("superieur")) return "Proposer upgrade";
  if (normalizedRecommendation.includes("promotion") || normalizedRecommendation.includes("reduction") || normalizedRecommendation.includes("offre")) return "Offrir promotion";
  if (priorityLevel === "P1" || customer.risk_proba >= 0.75) return "Contacter client";
  if (averageMonthlyRevenueMad > 0 && customer.monthly_cost_mad >= averageMonthlyRevenueMad * 1.15) return "Offrir promotion";
  return "Surveiller";
}

function buildEnrichedCustomer(customer: ApiCustomerChurnCustomer, averageMonthlyRevenueMad: number): EnrichedCustomer {
  const revenueBoost = averageMonthlyRevenueMad > 0 ? Math.min((customer.monthly_cost_mad / averageMonthlyRevenueMad) * 10, 18) : 8;
  const contractBoost = customer.contract.trim().toLowerCase() === "month-to-month" ? 5 : 0;
  const predictedBoost = customer.predicted_churn ? 4 : 0;
  const priorityScore = Math.round(clamp(customer.risk_score_100 * 0.68 + customer.risk_proba * 22 + revenueBoost + contractBoost + predictedBoost, 0, 100));
  const priorityLevel = getPriorityLevel(priorityScore);
  const whyRisk = buildWhyRisk(customer, averageMonthlyRevenueMad);
  const revenueExposureMad = customer.monthly_cost_mad * customer.risk_proba * (customer.predicted_churn ? 1.22 : 0.9);
  const retentionRatio = priorityLevel === "P1" ? 0.58 : priorityLevel === "P2" ? 0.41 : 0.24;

  return {
    ...customer,
    priorityLevel,
    priorityScore,
    whyRisk,
    quickSummary: whyRisk.slice(0, 2).join(" • "),
    primaryAction: buildPrimaryAction(customer, priorityLevel, averageMonthlyRevenueMad),
    revenueExposureMad,
    estimatedRecoveredRevenueMad: revenueExposureMad * retentionRatio,
  };
}

function downloadRowsAsCsv(filename: string, rows: EnrichedCustomer[]) {
  const header = ["customer_id", "operator", "department", "contract", "tenure", "monthly_cost_mad", "risk_score_100", "risk_probability", "priority_level", "why_risk", "primary_action", "recommendation"];
  const csvRows = [header.join(","), ...rows.map((row) => [row.customer_id, row.operator, row.department, row.contract, row.tenure, row.monthly_cost_mad, row.risk_score_100, row.risk_proba, row.priorityLevel, `"${row.whyRisk.join(" | ").replace(/"/g, '""')}"`, row.primaryAction, `"${row.recommendation.replace(/"/g, '""')}"`].join(","))];
  const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function getRecommendationStatus(
  customerId: number,
  appliedCustomerIds: number[],
  contactedCustomerIds: number[],
): string {
  if (appliedCustomerIds.includes(customerId)) return "Traitee";
  if (contactedCustomerIds.includes(customerId)) return "En cours";
  return "Non traitee";
}

export default function Users() {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [filters, setFilters] = useState<ApiCustomerChurnFilters | null>(null);
  const [overview, setOverview] = useState<ApiCustomerChurnOverview | null>(null);
  const [customers, setCustomers] = useState<ApiCustomerChurnCustomerList | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationReady, setSimulationReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOperator, setSelectedOperator] = useState("all");
  const [selectedDepartment, setSelectedDepartment] = useState("all");
  const [selectedContract, setSelectedContract] = useState("all");
  const [selectedPriceRange, setSelectedPriceRange] = useState("all");
  const [selectedTenureGroup, setSelectedTenureGroup] = useState("all");
  const [selectedRiskLevel, setSelectedRiskLevel] = useState("all");
  const [selectedChurnStatus, setSelectedChurnStatus] = useState("all");
  const [selectedScoreBand, setSelectedScoreBand] = useState<ScoreBand>("all");
  const [priorityFilter, setPriorityFilter] = useState<"all" | PriorityLevel>("all");
  const [sortMode, setSortMode] = useState<SortMode>("risk");
  const [offset, setOffset] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [appliedCustomerIds, setAppliedCustomerIds] = useState<number[]>([]);
  const [contactedCustomerIds, setContactedCustomerIds] = useState<number[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);

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
          setErrorMessage(normalizeError(error, "Impossible de charger les filtres clients."));
        }
      }
    }

    void loadFilters();

    return () => {
      isMounted = false;
    };
  }, [token]);

  useEffect(() => {
    setOffset(0);
  }, [
    searchQuery,
    selectedOperator,
    selectedDepartment,
    selectedContract,
    selectedPriceRange,
    selectedTenureGroup,
    selectedRiskLevel,
    selectedChurnStatus,
    selectedScoreBand,
    priorityFilter,
  ]);

  useEffect(() => {
    let isMounted = true;

    async function loadCustomers() {
      if (!token) {
        if (isMounted) {
          setOverview(null);
          setCustomers(null);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      setErrorMessage(null);

      try {
        const query = {
          search: searchQuery.trim() || undefined,
          operator: selectedOperator !== "all" ? selectedOperator : undefined,
          department: selectedDepartment !== "all" ? selectedDepartment : undefined,
          contract: selectedContract !== "all" ? selectedContract : undefined,
          price_range: selectedPriceRange !== "all" ? selectedPriceRange : undefined,
          tenure_group: selectedTenureGroup !== "all" ? selectedTenureGroup : undefined,
          risk_level: selectedRiskLevel !== "all" ? selectedRiskLevel : undefined,
          churn_status: selectedChurnStatus !== "all" ? selectedChurnStatus : undefined,
        };

        const [overviewResponse, customersResponse] = await Promise.all([
          customerChurnApi.overview(token, query),
          customerChurnApi.customers(token, {
            ...query,
            offset,
            limit: PAGE_SIZE,
          }),
        ]);

        if (isMounted) {
          setOverview(overviewResponse);
          setCustomers(customersResponse);
        }
      } catch (error) {
        if (isMounted) {
          setOverview(null);
          setCustomers(null);
          setErrorMessage(normalizeError(error, "Impossible de charger la vue clients."));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    }

    void loadCustomers();

    return () => {
      isMounted = false;
    };
  }, [
    token,
    offset,
    refreshKey,
    searchQuery,
    selectedOperator,
    selectedDepartment,
    selectedContract,
    selectedPriceRange,
    selectedTenureGroup,
    selectedRiskLevel,
    selectedChurnStatus,
  ]);

  const averageMonthlyRevenueMad = overview?.kpis.average_monthly_revenue_mad ?? 0;
  const allEnrichedCustomers = (customers?.items ?? []).map((customer) =>
    buildEnrichedCustomer(customer, averageMonthlyRevenueMad),
  );

  const visibleCustomers = allEnrichedCustomers
    .filter((customer) => matchesScoreBand(customer.risk_score_100, selectedScoreBand))
    .filter((customer) =>
      priorityFilter === "all" ? true : customer.priorityLevel === priorityFilter,
    )
    .sort((leftCustomer, rightCustomer) => {
      if (sortMode === "revenue") {
        if (leftCustomer.monthly_cost_mad !== rightCustomer.monthly_cost_mad) {
          return rightCustomer.monthly_cost_mad - leftCustomer.monthly_cost_mad;
        }
      } else if (sortMode === "probability") {
        if (leftCustomer.risk_proba !== rightCustomer.risk_proba) {
          return rightCustomer.risk_proba - leftCustomer.risk_proba;
        }
      } else if (leftCustomer.priorityScore !== rightCustomer.priorityScore) {
        return rightCustomer.priorityScore - leftCustomer.priorityScore;
      }

      return rightCustomer.risk_score_100 - leftCustomer.risk_score_100;
    });

  const currentPage = Math.floor((customers?.offset ?? 0) / PAGE_SIZE) + 1;
  const totalPages = customers ? Math.max(1, Math.ceil(customers.total / PAGE_SIZE)) : 1;
  const p1Count = visibleCustomers.filter((customer) => customer.priorityLevel === "P1").length;
  const p2Count = visibleCustomers.filter((customer) => customer.priorityLevel === "P2").length;
  const p3Count = visibleCustomers.filter((customer) => customer.priorityLevel === "P3").length;
  const highValueThreshold = averageMonthlyRevenueMad > 0 ? averageMonthlyRevenueMad * 1.18 : 900;
  const highValueAtRiskCustomers = visibleCustomers.filter(
    (customer) =>
      customer.monthly_cost_mad >= highValueThreshold &&
      (customer.priorityLevel === "P1" || customer.priorityLevel === "P2"),
  );
  const topRiskDepartment =
    [...(overview?.risk_by_department ?? [])].sort((leftRow, rightRow) => {
      if (
        leftRow.predicted_high_risk_customers !== rightRow.predicted_high_risk_customers
      ) {
        return (
          rightRow.predicted_high_risk_customers - leftRow.predicted_high_risk_customers
        );
      }
      return rightRow.revenue_at_risk_mad - leftRow.revenue_at_risk_mad;
    })[0] ?? null;
  const mostUnstableContract =
    [...(overview?.churn_by_contract ?? [])].sort((leftRow, rightRow) => {
      if (leftRow.churn_rate_pct !== rightRow.churn_rate_pct) {
        return rightRow.churn_rate_pct - leftRow.churn_rate_pct;
      }
      return (
        rightRow.predicted_high_risk_customers - leftRow.predicted_high_risk_customers
      );
    })[0] ?? null;
  const globalRecommendation = topRiskDepartment
    ? `Prioriser une strategie de retention sur ${topRiskDepartment.label.toLowerCase()} et stabiliser le contrat ${formatContractLabel(
        mostUnstableContract?.label ?? "",
      ).toLowerCase()}.`
    : "Prioriser les clients les plus exposes et contacter les profils P1 avant une perte de revenu.";
  const averageRetentionGainMad =
    visibleCustomers.length === 0
      ? 0
      : visibleCustomers.reduce(
          (sum, customer) => sum + customer.estimatedRecoveredRevenueMad,
          0,
        ) / visibleCustomers.length;
  const estimatedRecoveredRevenueMad = visibleCustomers.reduce(
    (sum, customer) => sum + customer.estimatedRecoveredRevenueMad,
    0,
  );
  const estimatedSavedCustomers = Math.round(
    visibleCustomers.reduce(
      (sum, customer) =>
        sum +
        (customer.priorityLevel === "P1"
          ? 0.72
          : customer.priorityLevel === "P2"
            ? 0.44
            : 0.21),
      0,
    ),
  );
  const estimatedChurnDecreasePct = Math.min(
    overview?.kpis.churn_rate_pct ?? 0,
    visibleCustomers.length === 0
      ? 0
      : visibleCustomers.reduce(
          (sum, customer) =>
            sum +
            (customer.priorityLevel === "P1"
              ? 0.68
              : customer.priorityLevel === "P2"
                ? 0.42
                : 0.18),
          0,
        ) /
          visibleCustomers.length *
          (simulationReady ? 14 : 7),
  );
  const selectedCustomer =
    visibleCustomers.find((customer) => customer.customer_row_id === selectedCustomerId) ??
    allEnrichedCustomers.find((customer) => customer.customer_row_id === selectedCustomerId) ??
    null;

  useEffect(() => {
    if (!selectedCustomerId && visibleCustomers[0]) {
      setSelectedCustomerId(visibleCustomers[0].customer_row_id);
      return;
    }
    if (
      selectedCustomerId &&
      !visibleCustomers.some((customer) => customer.customer_row_id === selectedCustomerId)
    ) {
      setSelectedCustomerId(visibleCustomers[0]?.customer_row_id ?? null);
    }
  }, [selectedCustomerId, visibleCustomers]);

  function resetFilters() {
    setSearchQuery("");
    setSelectedOperator("all");
    setSelectedDepartment("all");
    setSelectedContract("all");
    setSelectedPriceRange("all");
    setSelectedTenureGroup("all");
    setSelectedRiskLevel("all");
    setSelectedChurnStatus("all");
    setSelectedScoreBand("all");
    setPriorityFilter("all");
  }

  async function handleSimulateStrategy() {
    setIsSimulating(true);
    await wait(650);
    setSimulationReady(true);
    setIsSimulating(false);
    toast.success("Simulation mise a jour", {
      description: `${formatMadValue(estimatedRecoveredRevenueMad)} recuperables sur la vue courante.`,
    });
  }

  function handleContactCustomer(customer: EnrichedCustomer) {
    setContactedCustomerIds((previousIds) =>
      previousIds.includes(customer.customer_row_id)
        ? previousIds
        : [...previousIds, customer.customer_row_id],
    );
    toast.success("Client contacte", {
      description: `${customer.customer_id} passe en suivi retention prioritaire.`,
    });
  }

  function handleApplyAction(customer: EnrichedCustomer) {
    setAppliedCustomerIds((previousIds) =>
      previousIds.includes(customer.customer_row_id)
        ? previousIds
        : [...previousIds, customer.customer_row_id],
    );
    toast.success("Action appliquee", {
      description: `${customer.primaryAction} active pour ${customer.customer_id}.`,
    });
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="mb-2 text-2xl font-bold text-[#0F172A]">Clients a surveiller</h1>
          <p className="max-w-4xl text-[#64748B]">
            Identifiez les clients a risque de depart et les actions prioritaires pour proteger votre revenu.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void handleSimulateStrategy()}
            className="inline-flex items-center gap-2 rounded-xl bg-[#2D6CDF] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#1D4ED8]"
          >
            <Sparkles className={`h-4 w-4 ${isSimulating ? "animate-spin" : ""}`} />
            <span>{isSimulating ? "Simulation..." : "Tester un plan d'action"}</span>
          </button>

          <button
            type="button"
            onClick={() =>
              downloadRowsAsCsv("customer-risk-current-view.csv", visibleCustomers)
            }
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-[#64748B] transition-colors hover:bg-[#F8FAFC]"
          >
            <Download className="h-4 w-4" />
            <span>Telecharger le rapport</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setIsRefreshing(true);
              setRefreshKey((previousValue) => previousValue + 1);
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-[#64748B] transition-colors hover:bg-[#F8FAFC]"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            <span>Rafraichir</span>
          </button>
        </div>
      </div>

      {errorMessage ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {errorMessage}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
        <div className="rounded-3xl border border-blue-100 bg-gradient-to-br from-[#EFF6FF] via-white to-[#F8FAFC] p-6">
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-[#2D6CDF]" />
            <h2 className="text-lg font-semibold text-[#0F172A]">Vue d'ensemble du risque client</h2>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-2xl bg-white/90 p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Segment le plus a risque</p>
              <p className="mt-3 text-xl font-semibold text-[#0F172A]">
                {topRiskDepartment?.label ?? "--"}
              </p>
              <p className="mt-2 text-sm text-[#64748B]">
                {topRiskDepartment
                  ? `${topRiskDepartment.predicted_high_risk_customers} clients exposes pour ${formatMadValue(topRiskDepartment.revenue_at_risk_mad)}.`
                  : "Segment critique indisponible."}
              </p>
            </div>

            <div className="rounded-2xl bg-white/90 p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Contrat le plus instable</p>
              <p className="mt-3 text-xl font-semibold text-[#0F172A]">
                {mostUnstableContract ? formatContractLabel(mostUnstableContract.label) : "--"}
              </p>
              <p className="mt-2 text-sm text-[#64748B]">
                {mostUnstableContract
                  ? `${mostUnstableContract.churn_rate_pct.toFixed(1)}% de departs constates et ${mostUnstableContract.predicted_high_risk_customers} clients sensibles.`
                  : "Contrat critique indisponible."}
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-blue-100 bg-white p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Recommandation globale</p>
            <p className="mt-3 text-sm leading-7 text-[#334155]">
              {globalRecommendation}
            </p>
          </div>
        </div>

        <div
          className={`rounded-3xl border p-6 ${
            simulationReady ? "border-emerald-200 bg-emerald-50/40" : "border-gray-200 bg-white"
          }`}
        >
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-[#16A34A]" />
            <h2 className="text-lg font-semibold text-[#0F172A]">Impact retention</h2>
          </div>

          <div className="mt-5 space-y-4">
            <div className="rounded-2xl bg-[#F8FAFC] p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Clients sauves estimes</p>
              <p className="mt-2 text-2xl font-semibold text-[#0F172A]">{estimatedSavedCustomers}</p>
            </div>
            <div className="rounded-2xl bg-[#F8FAFC] p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Revenu recupere</p>
              <p className="mt-2 text-2xl font-semibold text-[#16A34A]">{formatMadValue(estimatedRecoveredRevenueMad)}</p>
            </div>
            <div className="rounded-2xl bg-[#F8FAFC] p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Baisse du risque de depart</p>
              <p className="mt-2 text-2xl font-semibold text-[#2D6CDF]">{estimatedChurnDecreasePct.toFixed(1)}%</p>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-emerald-100 bg-white p-4">
            <p className="text-sm font-medium text-[#0F172A]">
              {simulationReady ? "Scenario simule actif" : "Scenario pret a estimer"}
            </p>
            <p className="mt-2 text-sm text-[#64748B]">
              Gain moyen de {formatMadValue(averageRetentionGainMad)} par client visible priorise.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm text-[#64748B]">Total clients</p>
            <UsersIcon className="h-5 w-5 text-[#2D6CDF]" />
          </div>
          <p className="text-3xl font-bold text-[#0F172A]">{isLoading ? "--" : overview?.kpis.total_customers ?? 0}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <p className="text-sm text-[#64748B]">Departs constates</p>
          <p className="mt-2 text-3xl font-bold text-[#DC2626]">{isLoading ? "--" : overview?.kpis.actual_churn_customers ?? 0}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <p className="text-sm text-[#64748B]">Clients a risque</p>
          <p className="mt-2 text-3xl font-bold text-[#D97706]">{isLoading ? "--" : overview?.kpis.high_risk_customers ?? 0}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <p className="text-sm text-[#64748B]">Revenu expose</p>
          <p className="mt-2 text-3xl font-bold text-[#0F172A]">{isLoading ? "--" : formatMadValue(overview?.kpis.revenue_at_risk_mad ?? 0)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <button
          type="button"
          onClick={() => setPriorityFilter((previousValue) => (previousValue === "P1" ? "all" : "P1"))}
          className={`rounded-2xl border p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md ${priorityFilter === "P1" ? "border-[#DC2626] bg-red-50" : "border-gray-200 bg-white"}`}
        >
          <Badge className={getPriorityClasses("P1")}>Priorite 1</Badge>
          <p className="mt-3 text-3xl font-bold text-[#0F172A]">{p1Count}</p>
          <p className="mt-2 text-sm text-[#64748B]">Clients critiques a traiter maintenant</p>
        </button>

        <button
          type="button"
          onClick={() => setPriorityFilter((previousValue) => (previousValue === "P2" ? "all" : "P2"))}
          className={`rounded-2xl border p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md ${priorityFilter === "P2" ? "border-[#F97316] bg-orange-50" : "border-gray-200 bg-white"}`}
        >
          <Badge className={getPriorityClasses("P2")}>Priorite 2</Badge>
          <p className="mt-3 text-3xl font-bold text-[#0F172A]">{p2Count}</p>
          <p className="mt-2 text-sm text-[#64748B]">Clients eleves a cadrer rapidement</p>
        </button>

        <button
          type="button"
          onClick={() => setPriorityFilter((previousValue) => (previousValue === "P3" ? "all" : "P3"))}
          className={`rounded-2xl border p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md ${priorityFilter === "P3" ? "border-[#CA8A04] bg-amber-50" : "border-gray-200 bg-white"}`}
        >
          <Badge className={getPriorityClasses("P3")}>Priorite 3</Badge>
          <p className="mt-3 text-3xl font-bold text-[#0F172A]">{p3Count}</p>
          <p className="mt-2 text-sm text-[#64748B]">Clients moyens a surveiller</p>
        </button>

        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-[#16A34A]" />
            <p className="text-sm font-medium text-[#64748B]">Forte valeur + risque eleve</p>
          </div>
          <p className="mt-3 text-3xl font-bold text-[#0F172A]">{highValueAtRiskCustomers.length}</p>
          <p className="mt-2 text-sm text-[#64748B]">Clients a proteger en priorite</p>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="mb-4 flex items-center gap-2">
          <Target className="h-5 w-5 text-[#DC2626]" />
          <h2 className="text-lg font-semibold text-[#0F172A]">Clients a forte valeur + risque eleve</h2>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
          {(highValueAtRiskCustomers.length > 0 ? highValueAtRiskCustomers.slice(0, 4) : visibleCustomers.slice(0, 4)).map((customer) => (
            <button
              key={customer.customer_row_id}
              type="button"
              onClick={() => setSelectedCustomerId(customer.customer_row_id)}
              className="rounded-2xl border border-red-100 bg-red-50/50 p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
              title={customer.whyRisk.join(" • ")}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-[#0F172A]">{customer.customer_id}</span>
                <Badge className={getPriorityClasses(customer.priorityLevel)}>{customer.priorityLevel}</Badge>
              </div>
              <p className="mt-2 text-sm text-[#64748B]">{customer.department} - {formatContractLabel(customer.contract)}</p>
              <p className="mt-3 text-lg font-semibold text-[#0F172A]">{formatMadValue(customer.monthly_cost_mad)}</p>
              <p className="mt-1 text-sm text-[#475569]">{customer.quickSummary}</p>
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-[#64748B]">
            <Filter className="h-4 w-4" />
            <span>{customers?.total ?? 0} clients dans la vue courante</span>
          </div>
          <button
            type="button"
            onClick={resetFilters}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-[#64748B] transition-colors hover:bg-[#F8FAFC]"
          >
            Reinitialiser
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-10">
          <div className="relative md:col-span-2">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Client, operateur, contrat..."
              className="w-full rounded-lg border border-gray-200 bg-[#F8FAFC] py-2.5 pl-10 pr-4 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"
            />
          </div>

          <select value={selectedOperator} onChange={(event) => setSelectedOperator(event.target.value)} className="rounded-lg border border-gray-200 bg-[#F8FAFC] px-4 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]">
            <option value="all">Tous les operateurs</option>
            {(filters?.operators ?? []).map((operator) => <option key={operator} value={operator}>{operator}</option>)}
          </select>

          <select value={selectedDepartment} onChange={(event) => setSelectedDepartment(event.target.value)} className="rounded-lg border border-gray-200 bg-[#F8FAFC] px-4 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]">
            <option value="all">Tous les departements</option>
            {(filters?.departments ?? []).map((department) => <option key={department} value={department}>{department}</option>)}
          </select>

          <select value={selectedContract} onChange={(event) => setSelectedContract(event.target.value)} className="rounded-lg border border-gray-200 bg-[#F8FAFC] px-4 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]">
            <option value="all">Tous les contrats</option>
            {(filters?.contracts ?? []).map((contract) => <option key={contract} value={contract}>{formatContractLabel(contract)}</option>)}
          </select>

          <select value={selectedPriceRange} onChange={(event) => setSelectedPriceRange(event.target.value)} className="rounded-lg border border-gray-200 bg-[#F8FAFC] px-4 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]">
            <option value="all">Tous revenus</option>
            {(filters?.price_ranges ?? []).map((priceRange) => <option key={priceRange} value={priceRange}>{priceRange}</option>)}
          </select>

          <select value={selectedTenureGroup} onChange={(event) => setSelectedTenureGroup(event.target.value)} className="rounded-lg border border-gray-200 bg-[#F8FAFC] px-4 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]">
            <option value="all">Toutes anciennetes</option>
            {(filters?.tenure_groups ?? []).map((tenureGroup) => <option key={tenureGroup} value={tenureGroup}>{tenureGroup}</option>)}
          </select>

          <select value={selectedRiskLevel} onChange={(event) => setSelectedRiskLevel(event.target.value)} className="rounded-lg border border-gray-200 bg-[#F8FAFC] px-4 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]">
            <option value="all">Tous les risques</option>
            {(filters?.risk_levels ?? []).map((riskLevel) => <option key={riskLevel} value={riskLevel}>{formatCustomerRiskLabel(riskLevel)}</option>)}
          </select>

          <select value={selectedScoreBand} onChange={(event) => setSelectedScoreBand(event.target.value as ScoreBand)} className="rounded-lg border border-gray-200 bg-[#F8FAFC] px-4 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]">
            <option value="all">Tous les scores</option>
            <option value="critical">Score &gt;= 80</option>
            <option value="warning">Score 50-79</option>
            <option value="safe">Score &lt; 50</option>
          </select>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <select value={selectedChurnStatus} onChange={(event) => setSelectedChurnStatus(event.target.value)} className="rounded-lg border border-gray-200 bg-[#F8FAFC] px-4 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]">
            <option value="all">Tous les statuts de depart</option>
            {(filters?.churn_statuses ?? []).map((status) => <option key={status} value={status}>{status === "Yes" ? "Oui" : "Non"}</option>)}
          </select>

          <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as "all" | PriorityLevel)} className="rounded-lg border border-gray-200 bg-[#F8FAFC] px-4 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]">
            <option value="all">Toutes priorites</option>
            <option value="P1">Priorite 1</option>
            <option value="P2">Priorite 2</option>
            <option value="P3">Priorite 3</option>
          </select>

          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} className="rounded-lg border border-gray-200 bg-[#F8FAFC] px-4 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]">
            <option value="risk">Trier par risque</option>
            <option value="revenue">Trier par revenu mensuel</option>
            <option value="probability">Trier par risque de depart</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-[1450px] w-full">
              <thead className="border-b border-gray-200 bg-[#F8FAFC]">
                <tr>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-[#0F172A]">Client</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-[#0F172A]">Operateur</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-[#0F172A]">Departement</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-[#0F172A]">Contrat</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-[#0F172A]">Anciennete</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-[#0F172A]">Mensuel</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-[#0F172A]">Score de risque</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-[#0F172A]">Priorite</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-[#0F172A]">Pourquoi a risque ?</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-[#0F172A]">Action conseillee</th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-[#0F172A]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {isLoading ? (
                  <tr>
                    <td colSpan={11} className="px-6 py-12 text-center text-sm text-[#64748B]">Chargement des clients...</td>
                  </tr>
                ) : visibleCustomers.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-6 py-12 text-center text-sm text-[#64748B]">Aucun client ne correspond aux filtres actuels.</td>
                  </tr>
                ) : (
                  visibleCustomers.map((customer) => {
                    const operatorStyles = getOperatorStyles(customer.operator);
                    const scoreColor = getScoreColor(customer.risk_score_100);
                    const recommendationStatus = getRecommendationStatus(
                      customer.customer_row_id,
                      appliedCustomerIds,
                      contactedCustomerIds,
                    );

                    return (
                      <tr key={customer.customer_row_id} title={customer.whyRisk.join(" • ")} className={`transition-colors hover:bg-[#F8FAFC] ${customer.priorityLevel === "P1" ? "bg-[linear-gradient(90deg,rgba(254,242,242,0.9),rgba(255,255,255,1))]" : ""}`}>
                        <td className="px-6 py-4 align-top">
                          <button type="button" onClick={() => setSelectedCustomerId(customer.customer_row_id)} className="text-left">
                            <div className="font-medium text-[#0F172A]">{customer.customer_id}</div>
                            <div className="mt-1 text-xs text-[#64748B]">{formatInternetServiceLabel(customer.internet_service)} - {formatPaymentMethodLabel(customer.payment_method)}</div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${getChurnClasses(customer.actual_churn)}`}>Depart constate {formatChurnLabel(customer.actual_churn)}</span>
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${getChurnClasses(customer.predicted_churn)}`}>Risque estime {formatChurnLabel(customer.predicted_churn)}</span>
                            </div>
                          </button>
                        </td>
                        <td className="px-6 py-4 align-top"><span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium" style={operatorStyles}>{customer.operator}</span></td>
                        <td className="px-6 py-4 align-top text-sm text-[#64748B]">{customer.department}</td>
                        <td className="px-6 py-4 align-top text-sm text-[#0F172A]">{formatContractLabel(customer.contract)}</td>
                        <td className="px-6 py-4 align-top text-sm text-[#64748B]">{formatTenure(customer.tenure)}</td>
                        <td className="px-6 py-4 align-top">
                          <p className="text-sm font-semibold text-[#0F172A]">{formatMadValue(customer.monthly_cost_mad)}</p>
                          <p className="mt-1 text-xs text-[#64748B]">Expose {formatMadValue(customer.revenueExposureMad)}</p>
                        </td>
                        <td className="px-6 py-4 align-top">
                          <div className="min-w-[170px]">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-sm font-semibold text-[#0F172A]">{customer.risk_score_100.toFixed(0)}</span>
                              <span className="text-xs text-[#64748B]">{formatRiskProbability(customer.risk_proba)}</span>
                            </div>
                            <div className="mt-2 h-2 rounded-full bg-gray-200">
                              <div className="h-2 rounded-full" style={{ width: `${Math.min(customer.risk_score_100, 100)}%`, backgroundColor: scoreColor }} />
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 align-top">
                          <div className="space-y-2">
                            <Badge className={getPriorityClasses(customer.priorityLevel)}>{customer.priorityLevel === "P1" ? "Priorite 1" : customer.priorityLevel === "P2" ? "Priorite 2" : "Priorite 3"}</Badge>
                            <Badge className={getCustomerRiskClasses(customer.risk_level)}>{formatCustomerRiskLabel(customer.risk_level)}</Badge>
                          </div>
                        </td>
                        <td className="max-w-[250px] px-6 py-4 align-top">
                          <div className="flex flex-wrap gap-1.5">
                            {customer.whyRisk.map((reason) => <span key={reason} className="rounded-full border border-gray-200 bg-[#F8FAFC] px-2.5 py-1 text-xs font-medium text-[#475569]">{reason}</span>)}
                          </div>
                        </td>
                        <td className="max-w-[240px] px-6 py-4 align-top">
                          <AIRecommendationBlock
                            recommendation={customer.recommendation}
                            secondaryText={customer.primaryAction}
                            status={recommendationStatus}
                            severityLabel={formatCustomerRiskLabel(customer.risk_level)}
                            riskTypeLabel={`Priorite ${customer.priorityLevel}`}
                            scoreLabel={`Score ${formatRiskScore(customer.risk_score_100)}`}
                            compact
                            previewLength={96}
                          />
                        </td>
                        <td className="px-6 py-4 align-top">
                          <div className="flex min-w-[180px] flex-col gap-2">
                            <button type="button" onClick={() => handleApplyAction(customer)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-[#16A34A] transition-colors hover:bg-emerald-100"><Sparkles className="h-4 w-4" /><span>{appliedCustomerIds.includes(customer.customer_row_id) ? "Applique" : "Appliquer"}</span></button>
                            <button type="button" onClick={() => handleContactCustomer(customer)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-[#1D4ED8] transition-colors hover:bg-blue-100"><PhoneCall className="h-4 w-4" /><span>{contactedCustomerIds.includes(customer.customer_row_id) ? "Contacte" : "Contacter"}</span></button>
                            <button type="button" onClick={() => setSelectedCustomerId(customer.customer_row_id)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-[#475569] transition-colors hover:bg-[#F8FAFC]"><Eye className="h-4 w-4" /><span>Details</span></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="h-fit rounded-2xl border border-gray-200 bg-white p-6">
          {selectedCustomer ? (
            <div className="space-y-5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold text-[#0F172A]">{selectedCustomer.customer_id}</h2>
                  <Badge className={getPriorityClasses(selectedCustomer.priorityLevel)}>{selectedCustomer.priorityLevel}</Badge>
                  <Badge className={getCustomerRiskClasses(selectedCustomer.risk_level)}>{formatCustomerRiskLabel(selectedCustomer.risk_level)}</Badge>
                </div>
                <p className="mt-2 text-sm text-[#64748B]">{selectedCustomer.department} - {formatContractLabel(selectedCustomer.contract)} - {formatTenure(selectedCustomer.tenure)}</p>
              </div>

              <AIRecommendationBlock
                recommendation={selectedCustomer.recommendation}
                secondaryText={`${selectedCustomer.primaryAction} - ${selectedCustomer.quickSummary}`}
                status={getRecommendationStatus(
                  selectedCustomer.customer_row_id,
                  appliedCustomerIds,
                  contactedCustomerIds,
                )}
                severityLabel={formatCustomerRiskLabel(selectedCustomer.risk_level)}
                riskTypeLabel={`Priorite ${selectedCustomer.priorityLevel}`}
                scoreLabel={`Score ${formatRiskScore(selectedCustomer.risk_score_100)}`}
                className="bg-[#F8FAFC]"
              />

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-gray-200 p-4"><p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Score de risque</p><p className="mt-2 text-lg font-semibold text-[#0F172A]">{formatRiskScore(selectedCustomer.risk_score_100)}</p></div>
                <div className="rounded-2xl border border-gray-200 p-4"><p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Probabilite</p><p className="mt-2 text-lg font-semibold text-[#0F172A]">{formatRiskProbability(selectedCustomer.risk_proba)}</p></div>
                <div className="rounded-2xl border border-gray-200 p-4"><p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Revenu mensuel</p><p className="mt-2 text-lg font-semibold text-[#0F172A]">{formatMadValue(selectedCustomer.monthly_cost_mad)}</p></div>
                <div className="rounded-2xl border border-gray-200 p-4"><p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Gain estime</p><p className="mt-2 text-lg font-semibold text-[#16A34A]">{formatMadValue(selectedCustomer.estimatedRecoveredRevenueMad)}</p></div>
              </div>

              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#64748B]">Pourquoi a risque</p>
                <div className="mt-3 space-y-2">
                  {selectedCustomer.whyRisk.map((reason) => <div key={reason} className="rounded-xl bg-[#F8FAFC] px-3 py-2 text-sm text-[#475569]">{reason}</div>)}
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <button type="button" onClick={() => handleApplyAction(selectedCustomer)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 font-medium text-[#16A34A] transition-colors hover:bg-emerald-100"><Sparkles className="h-4 w-4" /><span>Appliquer</span></button>
                <button type="button" onClick={() => handleContactCustomer(selectedCustomer)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 font-medium text-[#1D4ED8] transition-colors hover:bg-blue-100"><PhoneCall className="h-4 w-4" /><span>Contacter</span></button>
              </div>
            </div>
          ) : (
            <div className="py-10 text-center text-sm text-[#64748B]">Selectionnez un client pour afficher le detail.</div>
          )}
        </aside>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white px-5 py-4 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-[#64748B]">Page {currentPage} / {totalPages} - {visibleCustomers.length} clients affiches sur cette page</p>

        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => navigate("/predictions")} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-[#64748B] transition-colors hover:bg-[#F8FAFC]"><TrendingUp className="h-4 w-4" /><span>Previsions et alertes</span></button>
          <button type="button" onClick={() => navigate("/recommandations")} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-[#64748B] transition-colors hover:bg-[#F8FAFC]"><Lightbulb className="h-4 w-4" /><span>Suggestions d'optimisation</span></button>
          <button type="button" onClick={() => navigate("/rapports")} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-[#64748B] transition-colors hover:bg-[#F8FAFC]"><Brain className="h-4 w-4" /><span>Rapports sur le risque client</span></button>
          <button type="button" disabled={offset === 0 || isLoading} onClick={() => setOffset((previousOffset) => Math.max(previousOffset - PAGE_SIZE, 0))} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-[#64748B] transition-colors hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-60">Precedent</button>
          <button type="button" disabled={isLoading || !customers || offset + PAGE_SIZE >= customers.total} onClick={() => setOffset((previousOffset) => previousOffset + PAGE_SIZE)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-[#64748B] transition-colors hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-60">Suivant</button>
        </div>
      </div>
    </div>
  );
}

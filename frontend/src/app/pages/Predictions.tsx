import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
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
import {
  Brain,
  Building2,
  CheckCheck,
  Eye,
  Filter,
  Lightbulb,
  Phone,
  Search,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import DashboardSection from "../components/dashboard/DashboardSection";
import AIRiskInsightCard from "../components/AIRiskInsightCard";
import WidgetVisibilityManager from "../components/dashboard/WidgetVisibilityManager";
import { Badge } from "../components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import AIRecommendationBlock from "../components/AIRecommendationBlock";
import { useAuth } from "../context/AuthContext";
import {
  ApiError,
  customerChurnApi,
  type ApiCustomerChurnFilters,
  type ApiCustomerChurnOverview,
  type ApiCustomerChurnPrediction,
  type ApiCustomerChurnPredictionList,
} from "../lib/api";
import {
  type DashboardWidgetDefinition,
  useDashboardPreferences,
} from "../hooks/useDashboardPreferences";
import {
  buildPredictionSummary,
  enrichPrediction,
  type ChurnActionType,
  type ChurnPriorityLevel,
  type EnrichedChurnPrediction,
} from "../lib/churn-predictions";
import {
  formatChurnLabel,
  formatContractLabel,
  formatCustomerRiskLabel,
  formatInternetServiceLabel,
  formatMadValue,
  formatRiskProbability,
  formatRiskScore,
  formatTenure,
  getChurnClasses,
  getCustomerRiskClasses,
  getCustomerRiskColor,
  getOperatorStyles,
} from "../lib/customer-churn";

const PAGE_SIZE = 5;

const predictionWidgets: DashboardWidgetDefinition[] = [
  {
    id: "kpis",
    label: "Indicateurs de risque client",
    description: "Clients a suivre, taux de depart, revenu a proteger et score moyen.",
    defaultVisible: true,
  },
  {
    id: "impact-scenario",
    label: "Impact estime",
    description: "Projection des clients conserves et du revenu protege.",
    defaultVisible: true,
  },
  {
    id: "ai-insights",
    label: "Points d'attention",
    description: "Resume des segments clients a traiter en priorite.",
    defaultVisible: true,
  },
  {
    id: "filters",
    label: "Filtres",
    description: "Recherche et filtres pour cibler les clients prioritaires.",
    defaultVisible: true,
  },
  {
    id: "secondary-charts",
    label: "Graphiques de risque",
    description: "Graphiques par segment, revenu et departement.",
    defaultVisible: false,
  },
  {
    id: "prediction-list",
    label: "Liste clients",
    description: "Liste paginee des clients a traiter.",
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

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}

function getPriorityClasses(priorityLevel: ChurnPriorityLevel): string {
  if (priorityLevel === "P1") {
    return "border-red-200 bg-red-50 text-[#DC2626]";
  }
  if (priorityLevel === "P2") {
    return "border-orange-200 bg-orange-50 text-[#F97316]";
  }
  return "border-violet-200 bg-violet-50 text-[#6D28D9]";
}

function getQuickStatusClasses(status: string): string {
  if (status === "Traite") {
    return "border-emerald-200 bg-emerald-50 text-[#16A34A]";
  }
  if (status === "Offre appliquee") {
    return "border-blue-200 bg-blue-50 text-[#2563EB]";
  }
  if (status === "Client contacte") {
    return "border-violet-200 bg-violet-50 text-[#6D28D9]";
  }
  return "border-slate-200 bg-slate-50 text-[#475569]";
}

function getActionLabel(actionType: ChurnActionType): string {
  if (actionType === "forfait") {
    return "Changer forfait";
  }
  if (actionType === "offre") {
    return "Offrir reduction";
  }
  return "Intervention commerciale";
}

export default function Predictions() {
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const dashboardPreferences = useDashboardPreferences("churn-predictions", predictionWidgets, user?.email);

  const [filters, setFilters] = useState<ApiCustomerChurnFilters | null>(null);
  const [overview, setOverview] = useState<ApiCustomerChurnOverview | null>(null);
  const [predictions, setPredictions] = useState<ApiCustomerChurnPredictionList | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDepartment, setSelectedDepartment] = useState("all");
  const [selectedContract, setSelectedContract] = useState("all");
  const [selectedInternetService, setSelectedInternetService] = useState("all");
  const [selectedRiskLevel, setSelectedRiskLevel] = useState("all");
  const [selectedPriceRange, setSelectedPriceRange] = useState("all");
  const [offset, setOffset] = useState(0);

  const [actionKey, setActionKey] = useState<string | null>(null);
  const [contactedCustomerIds, setContactedCustomerIds] = useState<number[]>([]);
  const [offeredCustomerIds, setOfferedCustomerIds] = useState<number[]>([]);
  const [treatedCustomerIds, setTreatedCustomerIds] = useState<number[]>([]);
  const [selectedWhyCustomer, setSelectedWhyCustomer] = useState<EnrichedChurnPrediction | null>(null);
  const [selectedSimulationCustomer, setSelectedSimulationCustomer] = useState<EnrichedChurnPrediction | null>(null);

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
          setErrorMessage(normalizeError(error, "Impossible de charger les filtres churn."));
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
  }, [searchQuery, selectedDepartment, selectedContract, selectedInternetService, selectedRiskLevel, selectedPriceRange]);

  useEffect(() => {
    let isMounted = true;

    async function loadPredictions() {
      if (!token) {
        if (isMounted) {
          setOverview(null);
          setPredictions(null);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      setErrorMessage(null);

      try {
        const query = {
          search: searchQuery.trim() || undefined,
          department: selectedDepartment !== "all" ? selectedDepartment : undefined,
          contract: selectedContract !== "all" ? selectedContract : undefined,
          internet_service: selectedInternetService !== "all" ? selectedInternetService : undefined,
          risk_level: selectedRiskLevel !== "all" ? selectedRiskLevel : undefined,
          price_range: selectedPriceRange !== "all" ? selectedPriceRange : undefined,
          prediction_status: "Yes",
        };

        const [overviewResponse, predictionsResponse] = await Promise.all([
          customerChurnApi.overview(token, query),
          customerChurnApi.predictions(token, {
            ...query,
            offset,
            limit: PAGE_SIZE,
          }),
        ]);

        if (isMounted) {
          setOverview(overviewResponse);
          setPredictions(predictionsResponse);
        }
      } catch (error) {
        if (isMounted) {
          setOverview(null);
          setPredictions(null);
          setErrorMessage(normalizeError(error, "Impossible de charger les predictions churn."));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadPredictions();

    return () => {
      isMounted = false;
    };
  }, [
    token,
    offset,
    searchQuery,
    selectedDepartment,
    selectedContract,
    selectedInternetService,
    selectedRiskLevel,
    selectedPriceRange,
  ]);

  const predictionPool = useMemo(() => {
    const customerMap = new Map<number, ApiCustomerChurnPrediction>();

    for (const customer of predictions?.items ?? []) {
      customerMap.set(customer.customer_row_id, customer);
    }
    for (const customer of overview?.top_at_risk_customers ?? []) {
      customerMap.set(customer.customer_row_id, customer);
    }

    return Array.from(customerMap.values());
  }, [predictions, overview]);

  const predictionSummary = useMemo(() => buildPredictionSummary(predictionPool), [predictionPool]);

  const enrichedPredictions = useMemo(
    () =>
      (predictions?.items ?? [])
        .map((customer) => enrichPrediction(customer, predictionSummary))
        .sort((leftCustomer, rightCustomer) => {
          if (leftCustomer.priorityLevel !== rightCustomer.priorityLevel) {
            return leftCustomer.priorityLevel.localeCompare(rightCustomer.priorityLevel);
          }
          if (leftCustomer.priorityScore !== rightCustomer.priorityScore) {
            return rightCustomer.priorityScore - leftCustomer.priorityScore;
          }
          return rightCustomer.revenue_at_risk_mad - leftCustomer.revenue_at_risk_mad;
        }),
    [predictions, predictionSummary],
  );

  const enrichedInsightPool = useMemo(
    () =>
      predictionPool
        .map((customer) => enrichPrediction(customer, predictionSummary))
        .sort((leftCustomer, rightCustomer) => rightCustomer.priorityScore - leftCustomer.priorityScore),
    [predictionPool, predictionSummary],
  );

  const highRiskCount = overview?.kpis.high_risk_customers ?? 0;
  const topRiskDepartment = useMemo(
    () =>
      [...(overview?.risk_by_department ?? [])].sort(
        (leftRow, rightRow) => rightRow.predicted_high_risk_customers - leftRow.predicted_high_risk_customers,
      )[0] ?? null,
    [overview],
  );
  const topRiskContract = useMemo(
    () =>
      [...(overview?.churn_by_contract ?? [])].sort(
        (leftRow, rightRow) => rightRow.predicted_high_risk_customers - leftRow.predicted_high_risk_customers,
      )[0] ?? null,
    [overview],
  );

  const contractChartData = (overview?.churn_by_contract ?? []).map((row) => ({
    ...row,
    label: formatContractLabel(row.label),
    rawLabel: row.label,
  }));
  const revenueChartData = (overview?.churn_by_price_range ?? []).map((row) => ({
    ...row,
    label: row.label,
  }));
  const departmentChartData = (overview?.risk_by_department ?? []).map((row) => ({
    ...row,
    label: row.label,
  }));

  const globalImpact = useMemo(() => {
    if (!overview || enrichedInsightPool.length === 0) {
      return {
        churnReducedPct: 0,
        revenueSavedMad: 0,
        retainedCustomers: 0,
      };
    }

    const averageReduction =
      enrichedInsightPool.reduce((sum, customer) => sum + customer.simulatedChurnReductionPct, 0) /
      enrichedInsightPool.length;

    return {
      churnReducedPct: Math.min(
        overview.kpis.churn_rate_pct,
        overview.kpis.churn_rate_pct * (averageReduction / 100) * 0.64,
      ),
      revenueSavedMad: Math.min(
        overview.kpis.revenue_at_risk_mad,
        overview.kpis.revenue_at_risk_mad * (averageReduction / 100) * 0.74,
      ),
      retainedCustomers: Math.max(
        1,
        Math.round((overview.kpis.high_risk_customers * averageReduction * 0.34) / 100),
      ),
    };
  }, [overview, enrichedInsightPool]);

  function resetFilters() {
    setSearchQuery("");
    setSelectedDepartment("all");
    setSelectedContract("all");
    setSelectedInternetService("all");
    setSelectedRiskLevel("all");
    setSelectedPriceRange("all");
  }

  function getProcessingStatus(customerId: number): string {
    if (treatedCustomerIds.includes(customerId)) {
      return "Traite";
    }
    if (offeredCustomerIds.includes(customerId)) {
      return "Offre appliquee";
    }
    if (contactedCustomerIds.includes(customerId)) {
      return "Client contacte";
    }
    return "A traiter";
  }

  async function handleQuickAction(customer: EnrichedChurnPrediction, action: "contact" | "offer" | "treat") {
    const nextActionKey = `${action}-${customer.customer_row_id}`;
    setActionKey(nextActionKey);

    try {
      await wait(650);

      if (action === "contact") {
        setContactedCustomerIds((previousIds) =>
          previousIds.includes(customer.customer_row_id) ? previousIds : [...previousIds, customer.customer_row_id],
        );
        toast.success("Client contacte", {
          description: `${customer.customer_id} passe en suivi commercial prioritaire.`,
        });
      }

      if (action === "offer") {
        setOfferedCustomerIds((previousIds) =>
          previousIds.includes(customer.customer_row_id) ? previousIds : [...previousIds, customer.customer_row_id],
        );
        toast.success("Offre appliquee", {
          description: `${getActionLabel(customer.actionType)} declenche pour ${customer.customer_id}.`,
        });
      }

      if (action === "treat") {
        setTreatedCustomerIds((previousIds) =>
          previousIds.includes(customer.customer_row_id) ? previousIds : [...previousIds, customer.customer_row_id],
        );
        toast.success("Client marque comme traite", {
          description: `${customer.customer_id} sort de la file de priorisation immediate.`,
        });
      }
    } finally {
      setActionKey(null);
    }
  }

  const currentPage = Math.floor((predictions?.offset ?? 0) / PAGE_SIZE) + 1;
  const totalPages = predictions ? Math.max(1, Math.ceil(predictions.total / PAGE_SIZE)) : 1;

  return (
    <>
      <div className="space-y-6 p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h1 className="mb-2 text-2xl font-bold text-[#0F172A]">Previsions et alertes</h1>
            <p className="max-w-4xl text-[#64748B]">
              Reperez les clients a suivre, estimez l'impact des actions et priorisez vos decisions pour proteger le revenu.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#0F172A] to-[#2D6CDF] px-4 py-2.5 text-white shadow-lg shadow-blue-500/20">
            <Brain className="h-5 w-5" />
            <span className="font-medium">Suivi du risque client actif</span>
          </div>
        </div>

        {errorMessage ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {errorMessage}
          </div>
        ) : null}

        <WidgetVisibilityManager
          widgets={predictionWidgets}
          visibility={dashboardPreferences.visibility}
          visibleCount={dashboardPreferences.visibleCount}
          onChange={dashboardPreferences.setWidgetVisible}
          onReset={dashboardPreferences.showAllWidgets}
        />

        <DashboardSection isVisible={dashboardPreferences.isWidgetVisible("kpis")}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="rounded-2xl bg-gradient-to-br from-[#DC2626] to-[#B91C1C] p-6 text-white">
            <div className="mb-3 flex items-center gap-2">
              <ShieldAlert className="h-6 w-6" />
              <h3 className="text-lg font-semibold">Clients a risque</h3>
            </div>
            <p className="text-4xl font-bold">{isLoading ? "--" : predictions?.total ?? 0}</p>
            <p className="mt-2 text-sm text-white/80">Tri automatique par priorite IA</p>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-6">
            <div className="mb-3 flex items-center gap-2">
              <TrendingUp className="h-6 w-6 text-[#D97706]" />
              <h3 className="text-lg font-semibold text-[#0F172A]">Taux churn</h3>
            </div>
            <p className="text-4xl font-bold text-[#0F172A]">
              {isLoading ? "--" : `${(overview?.kpis.churn_rate_pct ?? 0).toFixed(1)}%`}
            </p>
            <p className="mt-2 text-sm text-[#64748B]">Departs constates sur le perimetre</p>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-6">
            <div className="mb-3 flex items-center gap-2">
              <Wallet className="h-6 w-6 text-[#16A34A]" />
              <h3 className="text-lg font-semibold text-[#0F172A]">Revenu a risque</h3>
            </div>
            <p className="text-4xl font-bold text-[#0F172A]">
              {isLoading ? "--" : formatMadValue(overview?.kpis.revenue_at_risk_mad ?? 0)}
            </p>
            <p className="mt-2 text-sm text-[#64748B]">Mensuel estime</p>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-6">
            <div className="mb-3 flex items-center gap-2">
              <Brain className="h-6 w-6 text-[#2D6CDF]" />
              <h3 className="text-lg font-semibold text-[#0F172A]">Score moyen</h3>
            </div>
            <p className="text-4xl font-bold text-[#0F172A]">
              {isLoading ? "--" : (overview?.kpis.average_risk_score ?? 0).toFixed(1)}
            </p>
            <p className="mt-2 text-sm text-[#64748B]">Sur 100</p>
          </div>
        </div>
        </DashboardSection>

        <DashboardSection isVisible={dashboardPreferences.isWidgetVisible("impact-scenario")}>
        <div className="rounded-3xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-blue-50 p-6 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6D28D9]">Impact global si actions appliquees</p>
              <h2 className="mt-2 text-2xl font-semibold text-[#0F172A]">Impact estime de vos actions</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[#64748B]">
                Estimation du resultat attendu a partir des clients les plus sensibles, du revenu a proteger et des actions conseillees sur la vue courante.
              </p>
            </div>
            <Badge className="rounded-full border-violet-200 bg-violet-50 px-3 py-1 text-[#6D28D9]">
              Actions priorisees
            </Badge>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-white bg-white/90 p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Risque reduit</p>
              <p className="mt-3 text-3xl font-bold text-[#16A34A]">{isLoading ? "--" : formatPercent(globalImpact.churnReducedPct)}</p>
            </div>
            <div className="rounded-2xl border border-white bg-white/90 p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Revenu sauvegarde</p>
              <p className="mt-3 text-3xl font-bold text-[#0F172A]">{isLoading ? "--" : formatMadValue(globalImpact.revenueSavedMad)}</p>
            </div>
            <div className="rounded-2xl border border-white bg-white/90 p-5">
              <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Clients retenus</p>
              <p className="mt-3 text-3xl font-bold text-[#2D6CDF]">{isLoading ? "--" : globalImpact.retainedCustomers}</p>
            </div>
          </div>
        </div>
        </DashboardSection>

        <DashboardSection isVisible={dashboardPreferences.isWidgetVisible("ai-insights")}>
        <div className="rounded-3xl border border-gray-200 bg-white p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6D28D9]">Points d'attention</p>
              <h2 className="mt-2 text-2xl font-semibold text-[#0F172A]">Resume du risque client</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[#64748B]">
                Le moteur synthétise les segments critiques puis propose l'action la plus utile pour retenir la valeur.
              </p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
            <button
              type="button"
              onClick={() => setSelectedRiskLevel(highRiskCount > 0 ? "Critique" : selectedRiskLevel)}
              className="rounded-2xl border border-gray-200 bg-gradient-to-br from-white to-[#F8FAFC] p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#64748B]">Clients a risque eleve</p>
              <p className="mt-3 text-xl font-semibold text-[#0F172A]">{highRiskCount.toLocaleString("fr-FR")}</p>
              <p className="mt-2 text-sm leading-6 text-[#64748B]">Clients a traiter en priorite.</p>
              <div className="mt-4 rounded-2xl border border-violet-100 bg-violet-50/70 p-3 text-sm text-[#4C1D95]">
                Traiter d'abord les clients P1 pour proteger le revenu mensuel.
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                if (topRiskDepartment) {
                  setSelectedDepartment(topRiskDepartment.label);
                  toast.success("Filtre departement applique", {
                    description: `${topRiskDepartment.label} devient le segment prioritaire.`,
                  });
                }
              }}
              className="rounded-2xl border border-gray-200 bg-gradient-to-br from-white to-[#F8FAFC] p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#64748B]">Departement le plus a risque</p>
              <p className="mt-3 text-xl font-semibold text-[#0F172A]">{topRiskDepartment?.label ?? "Non disponible"}</p>
              <p className="mt-2 text-sm leading-6 text-[#64748B]">
                {topRiskDepartment
                  ? `${topRiskDepartment.predicted_high_risk_customers} clients et ${formatMadValue(topRiskDepartment.revenue_at_risk_mad)} exposes.`
                  : "Aucun departement dominant detecte."}
              </p>
              <div className="mt-4 rounded-2xl border border-violet-100 bg-violet-50/70 p-3 text-sm text-[#4C1D95]">
                Lancer une campagne de retention ciblee avec le manager du departement.
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                if (topRiskContract) {
                  setSelectedContract(topRiskContract.label);
                  toast.success("Filtre contrat applique", {
                    description: `${formatContractLabel(topRiskContract.label)} est maintenant priorise.`,
                  });
                }
              }}
              className="rounded-2xl border border-gray-200 bg-gradient-to-br from-white to-[#F8FAFC] p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#64748B]">Contrat le plus expose</p>
              <p className="mt-3 text-xl font-semibold text-[#0F172A]">{topRiskContract ? formatContractLabel(topRiskContract.label) : "Non disponible"}</p>
              <p className="mt-2 text-sm leading-6 text-[#64748B]">
                {topRiskContract
                  ? `${topRiskContract.predicted_high_risk_customers} clients a risque sur ce segment.`
                  : "Aucun contrat dominant detecte."}
              </p>
              <div className="mt-4 rounded-2xl border border-violet-100 bg-violet-50/70 p-3 text-sm text-[#4C1D95]">
                Verifier si une migration vers un engagement plus stable peut etre proposee.
              </div>
            </button>

            <button
              type="button"
              onClick={() => navigate("/recommandations")}
              className="rounded-2xl border border-gray-200 bg-gradient-to-br from-white to-[#F8FAFC] p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#64748B]">Revenu a risque total</p>
              <p className="mt-3 text-xl font-semibold text-[#0F172A]">{formatMadValue(overview?.kpis.revenue_at_risk_mad ?? 0)}</p>
              <p className="mt-2 text-sm leading-6 text-[#64748B]">Projection mensuelle exposee sur le portefeuille filtre.</p>
              <div className="mt-4 rounded-2xl border border-violet-100 bg-violet-50/70 p-3 text-sm text-[#4C1D95]">
                Coupler offre de retention et intervention commerciale sur les clients a plus forte valeur.
              </div>
            </button>
          </div>
        </div>
        </DashboardSection>

        <DashboardSection isVisible={dashboardPreferences.isWidgetVisible("filters")}>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-[#64748B]">
              <Filter className="h-4 w-4" />
              <span>{predictions?.total ?? 0} clients prioritaires</span>
            </div>
            <button
              type="button"
              onClick={resetFilters}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-[#64748B] transition-colors hover:bg-[#F8FAFC]"
            >
              Reinitialiser
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
            <div className="relative md:col-span-2">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Client, contrat, recommandation..."
                className="w-full rounded-lg border border-gray-200 bg-[#F8FAFC] py-2 pl-10 pr-4 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"
              />
            </div>

            <select
              value={selectedDepartment}
              onChange={(event) => setSelectedDepartment(event.target.value)}
              className="rounded-lg border border-gray-200 bg-[#F8FAFC] px-4 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"
            >
              <option value="all">Tous les departements</option>
              {(filters?.departments ?? []).map((department) => (
                <option key={department} value={department}>
                  {department}
                </option>
              ))}
            </select>

            <select
              value={selectedContract}
              onChange={(event) => setSelectedContract(event.target.value)}
              className="rounded-lg border border-gray-200 bg-[#F8FAFC] px-4 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"
            >
              <option value="all">Tous les contrats</option>
              {(filters?.contracts ?? []).map((contract) => (
                <option key={contract} value={contract}>
                  {formatContractLabel(contract)}
                </option>
              ))}
            </select>

            <select
              value={selectedInternetService}
              onChange={(event) => setSelectedInternetService(event.target.value)}
              className="rounded-lg border border-gray-200 bg-[#F8FAFC] px-4 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"
            >
              <option value="all">Tous les services</option>
              {(filters?.internet_services ?? []).map((service) => (
                <option key={service} value={service}>
                  {formatInternetServiceLabel(service)}
                </option>
              ))}
            </select>

            <select
              value={selectedRiskLevel}
              onChange={(event) => setSelectedRiskLevel(event.target.value)}
              className="rounded-lg border border-gray-200 bg-[#F8FAFC] px-4 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"
            >
              <option value="all">Tous les risques</option>
              {(filters?.risk_levels ?? []).map((riskLevel) => (
                <option key={riskLevel} value={riskLevel}>
                  {formatCustomerRiskLabel(riskLevel)}
                </option>
              ))}
            </select>

            <select
              value={selectedPriceRange}
              onChange={(event) => setSelectedPriceRange(event.target.value)}
              className="rounded-lg border border-gray-200 bg-[#F8FAFC] px-4 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"
            >
              <option value="all">Tous les paliers</option>
              {(filters?.price_ranges ?? []).map((priceRange) => (
                <option key={priceRange} value={priceRange}>
                  {priceRange}
                </option>
              ))}
            </select>
          </div>
        </div>
        </DashboardSection>

        <DashboardSection
          isVisible={dashboardPreferences.isWidgetVisible("secondary-charts")}
          collapsible
          title="Graphiques de risque complementaires"
          description="Analyse par segment, revenu et departement, disponible a la demande."
          className="rounded-3xl border border-gray-200 bg-white p-6"
          contentClassName="pt-5"
        >
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-[#0F172A]">Risque de depart par segment</h2>
                <p className="mt-1 text-sm text-[#64748B]">Cliquer pour filtrer le contrat dominant.</p>
              </div>
              <Building2 className="h-5 w-5 text-[#DC2626]" />
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={contractChartData}>
                <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="#64748B" />
                <YAxis stroke="#64748B" />
                <Tooltip formatter={(value: number) => [`${value} clients`, "Risque eleve"]} />
                <Bar dataKey="predicted_high_risk_customers" radius={[8, 8, 0, 0]}>
                  {contractChartData.map((row) => (
                    <Cell
                      key={row.label}
                      fill="#DC2626"
                      className="cursor-pointer"
                      onClick={() => {
                        setSelectedContract(row.rawLabel);
                        toast.success("Filtre contrat applique", {
                          description: `${row.label} devient le segment analyse.`,
                        });
                      }}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-[#0F172A]">Risque et revenu</h2>
                <p className="mt-1 text-sm text-[#64748B]">Chaque barre filtre un palier de valeur.</p>
              </div>
              <Wallet className="h-5 w-5 text-[#16A34A]" />
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={revenueChartData}>
                <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="#64748B" />
                <YAxis stroke="#64748B" />
                <Tooltip formatter={(value: number) => [`${value} clients`, "Risque eleve"]} />
                <Bar dataKey="predicted_high_risk_customers" radius={[8, 8, 0, 0]}>
                  {revenueChartData.map((row) => (
                    <Cell
                      key={row.label}
                      fill="#16A34A"
                      className="cursor-pointer"
                      onClick={() => {
                        setSelectedPriceRange(row.label);
                        toast.success("Filtre revenu applique", {
                          description: `${row.label} est maintenant le palier analyse.`,
                        });
                      }}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-[#0F172A]">Risque par departement</h2>
                <p className="mt-1 text-sm text-[#64748B]">Le clic applique le filtre departement.</p>
              </div>
              <Users className="h-5 w-5 text-[#2D6CDF]" />
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={departmentChartData}>
                <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="#64748B" />
                <YAxis stroke="#64748B" />
                <Tooltip formatter={(value: number) => [`${value} clients`, "Risque eleve"]} />
                <Bar dataKey="predicted_high_risk_customers" radius={[8, 8, 0, 0]}>
                  {departmentChartData.map((row) => (
                    <Cell
                      key={row.label}
                      fill="#2D6CDF"
                      className="cursor-pointer"
                      onClick={() => {
                        setSelectedDepartment(row.label);
                        toast.success("Filtre departement applique", {
                          description: `${row.label} devient le perimetre prioritaire.`,
                        });
                      }}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        </DashboardSection>

        <DashboardSection isVisible={dashboardPreferences.isWidgetVisible("prediction-list")}>
        {isLoading ? (
          <div className="rounded-2xl border border-gray-200 bg-white px-6 py-16 text-center">
            <p className="text-sm text-[#64748B]">Chargement des predictions churn...</p>
          </div>
        ) : enrichedPredictions.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white px-6 py-16 text-center">
            <p className="text-sm text-[#64748B]">
              Aucun client a risque ne correspond aux filtres actuels.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {enrichedPredictions.map((customer) => {
              const isCritical = customer.priorityLevel === "P1" || customer.risk_level === "Critique";
              const status = getProcessingStatus(customer.customer_row_id);
              const operatorStyles = getOperatorStyles(customer.operator);

              return (
                <div
                  key={customer.customer_row_id}
                  title={customer.quickSummary}
                  className={`rounded-3xl border bg-white p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg ${
                    isCritical ? "border-red-200 bg-red-50/30" : "border-gray-200"
                  }`}
                >
                  <div className="flex flex-col gap-5 xl:flex-row xl:justify-between">
                    <div className="min-w-0 flex-1 space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-xl font-semibold text-[#0F172A]">{customer.customer_id}</h2>
                        <Badge className={getPriorityClasses(customer.priorityLevel)}>
                          Priorite IA {customer.priorityLevel}
                        </Badge>
                        <Badge className={getCustomerRiskClasses(customer.risk_level)}>
                          {formatCustomerRiskLabel(customer.risk_level)}
                        </Badge>
                        <Badge className={getChurnClasses(customer.predicted_churn)}>
                          Risque estime {formatChurnLabel(customer.predicted_churn)}
                        </Badge>
                        <Badge className={`${operatorStyles.bgClass} ${operatorStyles.textClass}`}>
                          {customer.operator}
                        </Badge>
                        <Badge className={`border ${getQuickStatusClasses(status)}`}>{status}</Badge>
                      </div>

                      <div>
                        <p className="font-medium text-[#0F172A]">
                          {formatContractLabel(customer.contract)} - {customer.department}
                        </p>
                        <p className="mt-1 text-sm text-[#64748B]">
                          {formatInternetServiceLabel(customer.internet_service)} • {formatTenure(customer.tenure)} •{" "}
                          {customer.plan}
                        </p>
                      </div>

                      <div className="grid gap-3 md:grid-cols-4">
                        <div className="rounded-2xl bg-[#F8FAFC] p-4">
                          <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Score</p>
                          <p className="mt-2 text-lg font-semibold text-[#0F172A]">
                            {formatRiskScore(customer.risk_score_100)}
                          </p>
                        </div>
                        <div className="rounded-2xl bg-[#F8FAFC] p-4">
                          <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Proba churn</p>
                          <p className="mt-2 text-lg font-semibold text-[#0F172A]">
                            {formatRiskProbability(customer.risk_proba)}
                          </p>
                        </div>
                        <div className="rounded-2xl bg-[#F8FAFC] p-4">
                          <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Cout mensuel</p>
                          <p className="mt-2 text-lg font-semibold text-[#0F172A]">
                            {formatMadValue(customer.monthly_cost_mad)}
                          </p>
                        </div>
                        <div className="rounded-2xl bg-[#F8FAFC] p-4">
                          <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Revenu a risque</p>
                          <p className="mt-2 text-lg font-semibold text-[#0F172A]">
                            {formatMadValue(customer.revenue_at_risk_mad)}
                          </p>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-gray-200 bg-white p-4">
                        <div className="flex items-center gap-2">
                          <Brain className="h-4 w-4 text-[#2D6CDF]" />
                          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#64748B]">
                            Pourquoi ce client est a risque
                          </p>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          {customer.whyRisk.slice(0, 4).map((reason) => (
                            <div key={reason} className="rounded-2xl bg-[#F8FAFC] px-4 py-3 text-sm text-[#334155]">
                              {reason}
                            </div>
                          ))}
                        </div>
                      </div>

                      <AIRiskInsightCard
                        riskId={customer.risk_id}
                        moduleLabel="Previsions et alertes"
                        title={customer.title}
                        severity={customer.risk_level}
                        description={customer.actionSummary}
                        impact={customer.impact}
                        cause={customer.whyRisk.join(" ")}
                        aiRecommendation={customer.ai_recommendation}
                        suggestedAction={customer.suggested_action}
                        confidenceScore={customer.confidence_score}
                        recommendationStatus={status}
                        compact
                        onApply={() =>
                          void handleQuickAction(customer, customer.actionType === "commercial" ? "contact" : "offer")
                        }
                        onSimulate={() => setSelectedSimulationCustomer(customer)}
                        onIgnore={() => {
                          toast.info("Risque ignore", {
                            description: `${customer.customer_id} est retire temporairement de la file active.`,
                          });
                        }}
                      />
                    </div>

                    <div className="w-full xl:w-[310px] xl:shrink-0">
                      <div className="space-y-3 rounded-3xl border border-gray-200 bg-[#F8FAFC] p-5">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#64748B]">
                            Priorite IA
                          </p>
                          <Badge className={getPriorityClasses(customer.priorityLevel)}>{customer.priorityLevel}</Badge>
                        </div>
                        <p className="text-4xl font-bold text-[#0F172A]">{customer.priorityScore}/100</p>
                        <div className="h-3 rounded-full bg-gray-200">
                          <div
                            className="h-3 rounded-full"
                            style={{
                              width: `${customer.priorityScore}%`,
                              backgroundColor: getCustomerRiskColor(customer.risk_level),
                            }}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div className="rounded-2xl bg-white px-4 py-3 text-[#166534]">
                            Gain estime
                            <p className="mt-1 font-semibold text-[#0F172A]">
                              {formatMadValue(customer.simulatedFinancialGainMad)}
                            </p>
                          </div>
                          <div className="rounded-2xl bg-white px-4 py-3 text-[#6D28D9]">
                            Reduction
                            <p className="mt-1 font-semibold text-[#0F172A]">
                              {formatPercent(customer.simulatedChurnReductionPct)}
                            </p>
                          </div>
                        </div>
                        <div className="grid gap-3">
                          <button
                            type="button"
                            onClick={() => setSelectedWhyCustomer(customer)}
                            className="flex items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-[#0F172A] transition-colors hover:bg-[#F1F5F9]"
                          >
                            <Eye className="h-4 w-4" />
                            <span>Pourquoi ce client est a risque ?</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedSimulationCustomer(customer)}
                            className="flex items-center justify-center gap-2 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm font-medium text-[#6D28D9] transition-colors hover:bg-violet-100"
                          >
                            <TrendingUp className="h-4 w-4" />
                            <span>Simuler action</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleQuickAction(customer, "contact")}
                            disabled={actionKey === `contact-${customer.customer_row_id}`}
                            className="flex items-center justify-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-[#1D4ED8] transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <Phone className="h-4 w-4" />
                            <span>{actionKey === `contact-${customer.customer_row_id}` ? "Contact..." : "Contacter client"}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleQuickAction(customer, "offer")}
                            disabled={actionKey === `offer-${customer.customer_row_id}`}
                            className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#6D28D9] to-[#2D6CDF] px-4 py-3 text-sm font-medium text-white shadow-lg shadow-violet-500/25 transition-all hover:-translate-y-0.5 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <Sparkles className="h-4 w-4" />
                            <span>{actionKey === `offer-${customer.customer_row_id}` ? "Application..." : "Appliquer offre"}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleQuickAction(customer, "treat")}
                            disabled={actionKey === `treat-${customer.customer_row_id}`}
                            className="flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-[#15803D] transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <CheckCheck className="h-4 w-4" />
                            <span>{actionKey === `treat-${customer.customer_row_id}` ? "Traitement..." : "Marquer traite"}</span>
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <button
                            type="button"
                            onClick={() => navigate("/consommations")}
                            className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-[#475569] transition-colors hover:bg-[#F1F5F9]"
                          >
                            Voir consommation
                          </button>
                          <button
                            type="button"
                            onClick={() => navigate("/forfaits")}
                            className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-[#475569] transition-colors hover:bg-[#F1F5F9]"
                          >
                            Voir forfait recommande
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white px-5 py-4 md:flex-row md:items-center md:justify-between">
              <p className="text-sm text-[#64748B]">
                Page {currentPage} / {totalPages} • {predictions?.total ?? 0} clients prioritaires
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setOffset((previousOffset) => Math.max(0, previousOffset - PAGE_SIZE))}
                  disabled={offset === 0}
                  className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-[#64748B] transition-colors hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Precedent
                </button>
                <button
                  type="button"
                  onClick={() => setOffset((previousOffset) => previousOffset + PAGE_SIZE)}
                  disabled={currentPage >= totalPages}
                  className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-[#64748B] transition-colors hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Suivant
                </button>
              </div>
            </div>
          </div>
        )}
        </DashboardSection>
      </div>

      <Dialog
        open={selectedWhyCustomer !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setSelectedWhyCustomer(null);
          }
        }}
      >
        <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col overflow-hidden border border-gray-200 bg-white p-0">
          {selectedWhyCustomer ? (
            <>
              <DialogHeader className="shrink-0 border-b border-gray-200 px-6 py-5 pr-14">
                <DialogTitle className="text-2xl font-bold text-[#0F172A]">
                  Pourquoi ce client est a risque ?
                </DialogTitle>
                <DialogDescription className="text-sm text-[#64748B]">
                  Lecture explicable du score churn, des facteurs declencheurs et de l'action recommandee.
                </DialogDescription>
              </DialogHeader>

              <div className="min-h-0 space-y-6 overflow-y-auto px-6 py-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xl font-semibold text-[#0F172A]">{selectedWhyCustomer.customer_id}</h3>
                      <Badge className={getPriorityClasses(selectedWhyCustomer.priorityLevel)}>
                        Priorite IA {selectedWhyCustomer.priorityLevel}
                      </Badge>
                      <Badge className={getCustomerRiskClasses(selectedWhyCustomer.risk_level)}>
                        {formatCustomerRiskLabel(selectedWhyCustomer.risk_level)}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-[#64748B]">
                      {formatContractLabel(selectedWhyCustomer.contract)} • {selectedWhyCustomer.department} •{" "}
                      {formatInternetServiceLabel(selectedWhyCustomer.internet_service)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-violet-100 bg-violet-50 px-4 py-3 text-sm text-[#4C1D95]">
                    {selectedWhyCustomer.quickSummary}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                  <div className="rounded-2xl bg-[#F8FAFC] p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Score churn</p>
                    <p className="mt-2 text-2xl font-semibold text-[#0F172A]">
                      {formatRiskScore(selectedWhyCustomer.risk_score_100)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-[#F8FAFC] p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Probabilite</p>
                    <p className="mt-2 text-2xl font-semibold text-[#0F172A]">
                      {formatRiskProbability(selectedWhyCustomer.risk_proba)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-[#F8FAFC] p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Revenu a risque</p>
                    <p className="mt-2 text-2xl font-semibold text-[#0F172A]">
                      {formatMadValue(selectedWhyCustomer.revenue_at_risk_mad)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-[#F8FAFC] p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Anciennete</p>
                    <p className="mt-2 text-2xl font-semibold text-[#0F172A]">
                      {formatTenure(selectedWhyCustomer.tenure)}
                    </p>
                  </div>
                </div>

                <div className="rounded-3xl border border-gray-200 bg-white p-5">
                  <div className="flex items-center gap-2">
                    <Brain className="h-4 w-4 text-[#2D6CDF]" />
                    <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#64748B]">
                      Facteurs declencheurs
                    </p>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    {selectedWhyCustomer.whyRisk.map((reason) => (
                      <div key={reason} className="rounded-2xl bg-[#F8FAFC] px-4 py-3 text-sm text-[#334155]">
                        {reason}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-3xl border border-violet-100 bg-violet-50/60 p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="border-violet-200 bg-white text-[#6D28D9]">
                      {selectedWhyCustomer.actionBadge}
                    </Badge>
                    <Badge className="border-blue-200 bg-white text-[#1D4ED8]">
                      {getActionLabel(selectedWhyCustomer.actionType)}
                    </Badge>
                  </div>
                  <p className="mt-4 text-lg font-semibold text-[#0F172A]">{selectedWhyCustomer.actionTitle}</p>
                  <p className="mt-2 text-sm leading-6 text-[#475569]">{selectedWhyCustomer.actionSummary}</p>
                  <AIRecommendationBlock
                    recommendation={selectedWhyCustomer.recommendation}
                    secondaryText={selectedWhyCustomer.quickSummary}
                    status={getProcessingStatus(selectedWhyCustomer.customer_row_id)}
                    severityLabel={formatCustomerRiskLabel(selectedWhyCustomer.risk_level)}
                    scoreLabel={`Score ${formatRiskScore(selectedWhyCustomer.risk_score_100)}`}
                    compact
                    className="mt-4 border-violet-200 bg-white/80"
                  />
                </div>
              </div>

              <DialogFooter className="shrink-0 gap-3 border-t border-gray-200 px-6 py-4">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSimulationCustomer(selectedWhyCustomer);
                    setSelectedWhyCustomer(null);
                  }}
                  className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-[#6D28D9] to-[#2D6CDF] px-4 py-2.5 font-medium text-white shadow-lg shadow-violet-500/25 transition-all hover:-translate-y-0.5 hover:shadow-xl"
                >
                  <TrendingUp className="h-4 w-4" />
                  <span>Simuler action</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedWhyCustomer(null)}
                  className="rounded-2xl border border-gray-200 px-4 py-2.5 font-medium text-[#64748B] transition-colors hover:bg-[#F8FAFC]"
                >
                  Fermer
                </button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog
        open={selectedSimulationCustomer !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setSelectedSimulationCustomer(null);
          }
        }}
      >
        <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col overflow-hidden border border-gray-200 bg-white p-0">
          {selectedSimulationCustomer ? (
            <>
              <DialogHeader className="shrink-0 border-b border-gray-200 px-6 py-5 pr-14">
                <DialogTitle className="text-2xl font-bold text-[#0F172A]">
                  Simulation d'impact retention
                </DialogTitle>
                <DialogDescription className="text-sm text-[#64748B]">
                  Projection de reduction churn et de revenu sauvegarde avant application de l'action.
                </DialogDescription>
              </DialogHeader>

              <div className="min-h-0 space-y-6 overflow-y-auto px-6 py-5">
                <div className="rounded-3xl border border-violet-100 bg-gradient-to-r from-violet-50 to-blue-50 p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="border-violet-200 bg-white text-[#6D28D9]">
                      {selectedSimulationCustomer.actionBadge}
                    </Badge>
                    <Badge className={getPriorityClasses(selectedSimulationCustomer.priorityLevel)}>
                      Priorite IA {selectedSimulationCustomer.priorityLevel}
                    </Badge>
                  </div>
                  <p className="mt-4 text-xl font-semibold text-[#0F172A]">
                    {selectedSimulationCustomer.actionTitle}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[#475569]">
                    {selectedSimulationCustomer.actionSummary}
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="rounded-2xl bg-white p-5">
                    <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Reduction churn estimee</p>
                    <p className="mt-3 text-3xl font-bold text-[#16A34A]">
                      {formatPercent(selectedSimulationCustomer.simulatedChurnReductionPct)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white p-5">
                    <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Gain financier</p>
                    <p className="mt-3 text-3xl font-bold text-[#0F172A]">
                      {formatMadValue(selectedSimulationCustomer.simulatedFinancialGainMad)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white p-5">
                    <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Clients retenus</p>
                    <p className="mt-3 text-3xl font-bold text-[#0F172A]">
                      {selectedSimulationCustomer.simulatedRetainedCustomers}
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-3xl border border-gray-200 bg-white p-5">
                    <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#64748B]">Avant action</p>
                    <div className="mt-5 space-y-4">
                      <div>
                        <div className="mb-2 flex items-center justify-between text-sm text-[#64748B]">
                          <span>Score churn</span>
                          <span className="font-medium text-[#0F172A]">
                            {formatRiskScore(selectedSimulationCustomer.risk_score_100)}
                          </span>
                        </div>
                        <div className="h-3 rounded-full bg-gray-200">
                          <div
                            className="h-3 rounded-full"
                            style={{
                              width: `${selectedSimulationCustomer.risk_score_100}%`,
                              backgroundColor: getCustomerRiskColor(selectedSimulationCustomer.risk_level),
                            }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="mb-2 flex items-center justify-between text-sm text-[#64748B]">
                          <span>Revenu expose</span>
                          <span className="font-medium text-[#0F172A]">
                            {formatMadValue(selectedSimulationCustomer.revenue_at_risk_mad)}
                          </span>
                        </div>
                        <div className="h-3 rounded-full bg-gray-200">
                          <div
                            className="h-3 rounded-full bg-[#DC2626]"
                            style={{
                              width: `${Math.min(
                                100,
                                (selectedSimulationCustomer.revenue_at_risk_mad /
                                  Math.max(predictionSummary.maxRevenueAtRiskMad, 1)) *
                                  100,
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-emerald-100 bg-emerald-50/40 p-5">
                    <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#64748B]">Apres action</p>
                    <div className="mt-5 space-y-4">
                      <div>
                        <div className="mb-2 flex items-center justify-between text-sm text-[#64748B]">
                          <span>Score churn projete</span>
                          <span className="font-medium text-[#0F172A]">
                            {Math.max(
                              12,
                              Math.round(
                                selectedSimulationCustomer.risk_score_100 -
                                  selectedSimulationCustomer.simulatedChurnReductionPct * 0.88,
                              ),
                            )}
                            /100
                          </span>
                        </div>
                        <div className="h-3 rounded-full bg-emerald-100">
                          <div
                            className="h-3 rounded-full bg-[#16A34A]"
                            style={{
                              width: `${Math.max(
                                12,
                                Math.round(
                                  selectedSimulationCustomer.risk_score_100 -
                                    selectedSimulationCustomer.simulatedChurnReductionPct * 0.88,
                                ),
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                      <div>
                        <div className="mb-2 flex items-center justify-between text-sm text-[#64748B]">
                          <span>Revenu sauvegarde</span>
                          <span className="font-medium text-[#0F172A]">
                            {formatMadValue(selectedSimulationCustomer.simulatedFinancialGainMad)}
                          </span>
                        </div>
                        <div className="h-3 rounded-full bg-emerald-100">
                          <div
                            className="h-3 rounded-full bg-[#16A34A]"
                            style={{
                              width: `${Math.min(
                                100,
                                (selectedSimulationCustomer.simulatedFinancialGainMad /
                                  Math.max(predictionSummary.maxRevenueAtRiskMad, 1)) *
                                  100,
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <DialogFooter className="shrink-0 gap-3 border-t border-gray-200 px-6 py-4">
                <button
                  type="button"
                  onClick={() => void handleQuickAction(selectedSimulationCustomer, "offer")}
                  disabled={actionKey === `offer-${selectedSimulationCustomer.customer_row_id}`}
                  className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-[#6D28D9] to-[#2D6CDF] px-4 py-2.5 font-medium text-white shadow-lg shadow-violet-500/25 transition-all hover:-translate-y-0.5 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Sparkles className="h-4 w-4" />
                  <span>
                    {actionKey === `offer-${selectedSimulationCustomer.customer_row_id}`
                      ? "Application..."
                      : "Appliquer offre"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/forfaits")}
                  className="inline-flex items-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2.5 font-medium text-[#1D4ED8] transition-colors hover:bg-blue-100"
                >
                  <Lightbulb className="h-4 w-4" />
                  <span>Voir forfait recommande</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedSimulationCustomer(null)}
                  className="rounded-2xl border border-gray-200 px-4 py-2.5 font-medium text-[#64748B] transition-colors hover:bg-[#F8FAFC]"
                >
                  Fermer
                </button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

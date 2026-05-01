import { useEffect, useState } from "react";
import { Check, Eye, Lightbulb, Search, X } from "lucide-react";
import { toast } from "sonner";

import AIRecommendationBlock from "../components/AIRecommendationBlock";
import DashboardSection from "../components/dashboard/DashboardSection";
import AIRiskInsightCard from "../components/AIRiskInsightCard";
import WidgetVisibilityManager from "../components/dashboard/WidgetVisibilityManager";
import { useAuth } from "../context/AuthContext";
import {
  ApiError,
  customerChurnApi,
  type ApiCustomerChurnFilters,
  type ApiCustomerChurnRecommendationList,
} from "../lib/api";
import { buildRecommendationSummary, enrichRecommendation } from "../lib/churn-recommendations";
import {
  formatContractLabel,
  formatCustomerFactorLabel,
  formatCustomerRiskLabel,
  formatInternetServiceLabel,
  formatMadValue,
  formatRiskProbability,
  formatRiskScore,
  formatTenure,
  getCustomerRiskClasses,
  getOperatorStyles,
} from "../lib/customer-churn";
import {
  type DashboardWidgetDefinition,
  useDashboardPreferences,
} from "../hooks/useDashboardPreferences";

const PAGE_SIZE = 5;

const recommendationWidgets: DashboardWidgetDefinition[] = [
  {
    id: "summary",
    label: "Synthese decision IA",
    description: "Bandeau executive avec economies, lignes impactees et decisions prises.",
    defaultVisible: true,
  },
  {
    id: "filters",
    label: "Filtres recommandations",
    description: "Recherche et filtres departement / risque.",
    defaultVisible: true,
  },
  {
    id: "recommendations",
    label: "Liste recommandations",
    description: "Cartes IA paginees avec examen detaille.",
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

export default function Recommendations() {
  const { token, user } = useAuth();
  const dashboardPreferences = useDashboardPreferences("recommendations-ai", recommendationWidgets, user?.email);

  const [filters, setFilters] = useState<ApiCustomerChurnFilters | null>(null);
  const [recommendations, setRecommendations] = useState<ApiCustomerChurnRecommendationList | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDepartment, setSelectedDepartment] = useState("all");
  const [selectedRiskLevel, setSelectedRiskLevel] = useState("all");
  const [offset, setOffset] = useState(0);
  const [acceptedIds, setAcceptedIds] = useState<number[]>([]);
  const [rejectedIds, setRejectedIds] = useState<number[]>([]);
  const [selectedRecommendationId, setSelectedRecommendationId] = useState<number | null>(null);

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
          setErrorMessage(normalizeError(error, "Impossible de charger les filtres recommandations."));
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
  }, [searchQuery, selectedDepartment, selectedRiskLevel]);

  useEffect(() => {
    let isMounted = true;

    async function loadRecommendations() {
      if (!token) {
        if (isMounted) {
          setRecommendations(null);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await customerChurnApi.recommendations(token, {
          search: searchQuery.trim() || undefined,
          department: selectedDepartment !== "all" ? selectedDepartment : undefined,
          risk_level: selectedRiskLevel !== "all" ? selectedRiskLevel : undefined,
          offset,
          limit: PAGE_SIZE,
        });

        if (isMounted) {
          setRecommendations(response);
        }
      } catch (error) {
        if (isMounted) {
          setRecommendations(null);
          setErrorMessage(normalizeError(error, "Impossible de charger les recommandations IA."));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadRecommendations();

    return () => {
      isMounted = false;
    };
  }, [token, offset, searchQuery, selectedDepartment, selectedRiskLevel]);

  const summary = buildRecommendationSummary(recommendations?.items ?? []);
  const enrichedRecommendations = (recommendations?.items ?? [])
    .map((recommendation) => enrichRecommendation(recommendation, summary))
    .sort((leftRecommendation, rightRecommendation) => {
      if (leftRecommendation.priorityScore !== rightRecommendation.priorityScore) {
        return rightRecommendation.priorityScore - leftRecommendation.priorityScore;
      }
      return rightRecommendation.simulatedFinancialGainMad - leftRecommendation.simulatedFinancialGainMad;
    });

  const selectedRecommendation =
    enrichedRecommendations.find(
      (recommendation) => recommendation.customer_row_id === selectedRecommendationId,
    ) ?? null;

  const totalSavingsMad = enrichedRecommendations.reduce(
    (sum, recommendation) => sum + recommendation.simulatedFinancialGainMad,
    0,
  );
  const totalImpactedLines = enrichedRecommendations.reduce(
    (sum, recommendation) => sum + recommendation.simulatedImpactedLines,
    0,
  );
  const currentPage = Math.floor((recommendations?.offset ?? 0) / PAGE_SIZE) + 1;
  const totalPages = recommendations ? Math.max(1, Math.ceil(recommendations.total / PAGE_SIZE)) : 1;

  function getDecisionStatus(customerRowId: number): string {
    if (acceptedIds.includes(customerRowId)) {
      return "Acceptee";
    }
    if (rejectedIds.includes(customerRowId)) {
      return "Rejetee";
    }
    return "A examiner";
  }

  function getRecommendationLifecycleStatus(customerRowId: number): string {
    if (acceptedIds.includes(customerRowId)) {
      return "En cours";
    }
    if (rejectedIds.includes(customerRowId)) {
      return "Traitee";
    }
    return "Non traitee";
  }

  function handleAccept(customerRowId: number, customerId: string) {
    setAcceptedIds((previousIds) =>
      previousIds.includes(customerRowId) ? previousIds : [...previousIds, customerRowId],
    );
    setRejectedIds((previousIds) =>
      previousIds.filter((value) => value !== customerRowId),
    );
    toast.success("Recommandation acceptee", {
      description: `${customerId} passe en action prioritaire.`,
    });
  }

  function handleReject(customerRowId: number, customerId: string) {
    setRejectedIds((previousIds) =>
      previousIds.includes(customerRowId) ? previousIds : [...previousIds, customerRowId],
    );
    setAcceptedIds((previousIds) =>
      previousIds.filter((value) => value !== customerRowId),
    );
    toast.success("Recommandation rejetee", {
      description: `${customerId} sort de la file de traitement.`,
    });
  }

  return (
    <div className="space-y-6 p-6">
      <DashboardSection isVisible={dashboardPreferences.isWidgetVisible("summary")}>
      <div className="rounded-3xl bg-gradient-to-r from-[#0F172A] via-[#1E3A8A] to-[#06B6D4] p-6 text-white">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-white/80">
              <Lightbulb className="h-3.5 w-3.5" />
              <span>Decision IA</span>
            </div>
            <h1 className="mt-4 text-3xl font-bold">Recommandations d'optimisation</h1>
            <p className="mt-3 text-sm leading-6 text-white/80">
              Priorisation des actions a accepter, rejeter ou examiner pour reduire le risque et
              proteger le revenu.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-white/15 bg-white/10 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-white/70">Cartes</p>
              <p className="mt-2 text-3xl font-bold">{isLoading ? "--" : enrichedRecommendations.length}</p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/10 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-white/70">Economie</p>
              <p className="mt-2 text-2xl font-bold">{isLoading ? "--" : formatMadValue(totalSavingsMad)}</p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/10 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-white/70">Lignes</p>
              <p className="mt-2 text-3xl font-bold">{isLoading ? "--" : totalImpactedLines}</p>
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/10 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-white/70">Acceptees</p>
              <p className="mt-2 text-3xl font-bold">{acceptedIds.length}</p>
            </div>
          </div>
        </div>
      </div>
      </DashboardSection>

      {errorMessage ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {errorMessage}
        </div>
      ) : null}

      <WidgetVisibilityManager
        widgets={recommendationWidgets}
        visibility={dashboardPreferences.visibility}
        visibleCount={dashboardPreferences.visibleCount}
        onChange={dashboardPreferences.setWidgetVisible}
        onReset={dashboardPreferences.resetVisibility}
      />

      <DashboardSection isVisible={dashboardPreferences.isWidgetVisible("filters")}>
      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="relative md:col-span-2">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Client, recommandation, justification..."
              className="w-full rounded-xl border border-gray-200 bg-[#F8FAFC] py-2.5 pl-10 pr-4 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"
            />
          </div>

          <select
            value={selectedDepartment}
            onChange={(event) => setSelectedDepartment(event.target.value)}
            className="rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"
          >
            <option value="all">Tous les departements</option>
            {(filters?.departments ?? []).map((department) => (
              <option key={department} value={department}>
                {department}
              </option>
            ))}
          </select>

          <select
            value={selectedRiskLevel}
            onChange={(event) => setSelectedRiskLevel(event.target.value)}
            className="rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"
          >
            <option value="all">Tous les risques</option>
            {(filters?.risk_levels ?? []).map((riskLevel) => (
              <option key={riskLevel} value={riskLevel}>
                {formatCustomerRiskLabel(riskLevel)}
              </option>
            ))}
          </select>
        </div>
      </div>
      </DashboardSection>

      <DashboardSection isVisible={dashboardPreferences.isWidgetVisible("recommendations")}>
      {isLoading ? (
        <div className="rounded-2xl border border-gray-200 bg-white px-6 py-16 text-center text-sm text-[#64748B]">
          Chargement des recommandations IA...
        </div>
      ) : enrichedRecommendations.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center text-sm text-[#64748B]">
          Aucune recommandation disponible pour les filtres actuels.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-5">
            {enrichedRecommendations.map((recommendation) => {
              const operatorStyles = getOperatorStyles(recommendation.operator);

              return (
                <article
                  key={recommendation.customer_row_id}
                  className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-xl font-semibold text-[#0F172A]">
                            {recommendation.customer_id}
                          </h2>
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${getCustomerRiskClasses(recommendation.risk_level)}`}
                          >
                            {formatCustomerRiskLabel(recommendation.risk_level)}
                          </span>
                          <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-[#1D4ED8]">
                            {recommendation.recommendationKindLabel}
                          </span>
                          <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-[#475569]">
                            {getDecisionStatus(recommendation.customer_row_id)}
                          </span>
                        </div>

                        <p className="mt-2 text-sm text-[#64748B]">
                          {recommendation.department} - {formatContractLabel(recommendation.contract)} -{" "}
                          {formatTenure(recommendation.tenure)}
                        </p>
                        <p className="mt-1 text-sm text-[#64748B]">
                          {formatInternetServiceLabel(recommendation.internet_service)}
                        </p>
                      </div>

                      <span
                        className="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium"
                        style={operatorStyles}
                      >
                        {recommendation.operator}
                      </span>
                    </div>

                    <AIRiskInsightCard
                      riskId={recommendation.risk_id}
                      moduleLabel="Recommandations"
                      title={recommendation.title}
                      severity={recommendation.risk_level}
                      description={recommendation.recommendation_reason}
                      impact={recommendation.impact}
                      cause={recommendation.quickSummary}
                      aiRecommendation={recommendation.ai_recommendation}
                      suggestedAction={recommendation.suggested_action}
                      confidenceScore={recommendation.confidence_score}
                      recommendationStatus={getRecommendationLifecycleStatus(recommendation.customer_row_id)}
                      compact
                      onApply={() => handleAccept(recommendation.customer_row_id, recommendation.customer_id)}
                      onIgnore={() => handleReject(recommendation.customer_row_id, recommendation.customer_id)}
                      onSimulate={() => setSelectedRecommendationId(recommendation.customer_row_id)}
                    />

                    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                      <div className="rounded-2xl border border-gray-200 p-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Score</p>
                        <p className="mt-2 text-xl font-semibold text-[#0F172A]">
                          {formatRiskScore(recommendation.risk_score_100)}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-gray-200 p-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Probabilite</p>
                        <p className="mt-2 text-xl font-semibold text-[#0F172A]">
                          {formatRiskProbability(recommendation.risk_proba)}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-gray-200 p-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Economie</p>
                        <p className="mt-2 text-xl font-semibold text-[#16A34A]">
                          {formatMadValue(recommendation.simulatedFinancialGainMad)}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-gray-200 p-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Impact</p>
                        <p className="mt-2 text-xl font-semibold text-[#0F172A]">
                          {recommendation.simulatedImpactedLines} lignes
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {recommendation.key_factors.map((factor) => (
                        <span
                          key={factor}
                          className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-[#475569]"
                        >
                          {formatCustomerFactorLabel(factor)}
                        </span>
                      ))}
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row">
                      <button
                        type="button"
                        onClick={() =>
                          handleAccept(recommendation.customer_row_id, recommendation.customer_id)
                        }
                        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#16A34A] px-4 py-3 font-medium text-white transition-colors hover:bg-[#15803D]"
                      >
                        <Check className="h-4 w-4" />
                        <span>Accepter</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleReject(recommendation.customer_row_id, recommendation.customer_id)
                        }
                        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#DC2626] px-4 py-3 font-medium text-white transition-colors hover:bg-[#B91C1C]"
                      >
                        <X className="h-4 w-4" />
                        <span>Rejeter</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedRecommendationId(recommendation.customer_row_id)}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 font-medium text-[#475569] transition-colors hover:bg-[#F8FAFC]"
                      >
                        <Eye className="h-4 w-4" />
                        <span>Examiner</span>
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <aside className="h-fit rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            {selectedRecommendation ? (
              <div className="space-y-5">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Examen detaille</p>
                  <h2 className="mt-2 text-2xl font-semibold text-[#0F172A]">
                    {selectedRecommendation.customer_id}
                  </h2>
                  <p className="mt-2 text-sm text-[#64748B]">
                    {selectedRecommendation.department} -{" "}
                    {formatContractLabel(selectedRecommendation.contract)}
                  </p>
                </div>

                <AIRecommendationBlock
                  recommendation={selectedRecommendation.recommendation}
                  secondaryText={selectedRecommendation.quickSummary}
                  status={getRecommendationLifecycleStatus(selectedRecommendation.customer_row_id)}
                  severityLabel={formatCustomerRiskLabel(selectedRecommendation.risk_level)}
                  riskTypeLabel={selectedRecommendation.recommendationKindLabel}
                  scoreLabel={`Score ${formatRiskScore(selectedRecommendation.risk_score_100)}`}
                  className="bg-[#F8FAFC]"
                />

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-gray-200 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Mensuel</p>
                    <p className="mt-2 text-lg font-semibold text-[#0F172A]">
                      {formatMadValue(selectedRecommendation.monthly_cost_mad)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-gray-200 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Risque</p>
                    <p className="mt-2 text-lg font-semibold text-[#0F172A]">
                      {formatMadValue(selectedRecommendation.revenue_at_risk_mad)}
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-200 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Justification IA</p>
                  <p className="mt-3 text-sm leading-6 text-[#475569]">
                    {selectedRecommendation.recommendation_reason}
                  </p>
                </div>

                <div className="rounded-2xl border border-gray-200 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">Pourquoi cette action</p>
                  <div className="mt-3 space-y-2">
                    {selectedRecommendation.whyRecommendation.map((reason) => (
                      <div key={reason} className="rounded-xl bg-[#F8FAFC] px-3 py-2 text-sm text-[#475569]">
                        {reason}
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedRecommendationId(null)}
                  className="w-full rounded-2xl border border-gray-200 px-4 py-3 font-medium text-[#64748B] transition-colors hover:bg-[#F8FAFC]"
                >
                  Fermer l'examen
                </button>
              </div>
            ) : (
              <div className="py-10 text-center text-sm text-[#64748B]">
                Selectionnez une recommandation pour examiner sa justification et son impact.
              </div>
            )}
          </aside>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white px-5 py-4 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-[#64748B]">
          Page {currentPage} / {totalPages} - {recommendations?.total ?? 0} recommandations
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setOffset((previousOffset) => Math.max(previousOffset - PAGE_SIZE, 0))}
            disabled={offset === 0 || isLoading}
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-[#64748B] transition-colors hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Precedent
          </button>
          <button
            type="button"
            onClick={() => setOffset((previousOffset) => previousOffset + PAGE_SIZE)}
            disabled={isLoading || !recommendations || offset + PAGE_SIZE >= recommendations.total}
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-[#64748B] transition-colors hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-60"
          >
            Suivant
          </button>
        </div>
      </div>
      </DashboardSection>
    </div>
  );
}

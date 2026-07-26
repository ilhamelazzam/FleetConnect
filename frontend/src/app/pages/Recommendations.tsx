import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Check, Eye, Lightbulb, Search, ShieldAlert, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

import AIRiskInsightCard from "../components/AIRiskInsightCard";
import AIRecommendationBlock from "../components/AIRecommendationBlock";
import DashboardSection from "../components/dashboard/DashboardSection";
import WidgetVisibilityManager from "../components/dashboard/WidgetVisibilityManager";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { useAuth } from "../context/AuthContext";
import {
  ApiError,
  cdrAnalyticsApi,
  type ApiCdrFilters,
  type ApiCdrRecommendation,
  type ApiCdrRecommendationList,
} from "../lib/api";
import {
  formatCallZoneLabel,
  formatFraudTypeLabel,
  formatMadValue,
  formatRiskScore,
  formatSeverityLabel,
  getSeverityClasses,
} from "../lib/cdr-analytics";
import {
  type DashboardWidgetDefinition,
  useDashboardPreferences,
} from "../hooks/useDashboardPreferences";

const PAGE_SIZE = 6;

const recommendationWidgets: DashboardWidgetDefinition[] = [
  {
    id: "summary",
    label: "Pilotage recommandations",
    description: "Vision executive des priorités IA, des pertes et des décisions locales.",
    defaultVisible: true,
  },
  {
    id: "filters",
    label: "Filtres",
    description: "Recherche par opérateur, département, zone et sévérité.",
    defaultVisible: true,
  },
  {
    id: "recommendations",
    label: "Console d'actions",
    description: "Cartes actionnables issues du dataset CDR enrichi.",
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

function getPriorityTone(priority: string): string {
  if (priority === "P1") {
    return "border-red-200 bg-red-50 text-[#DC2626]";
  }
  if (priority === "P2") {
    return "border-orange-200 bg-orange-50 text-[#F97316]";
  }
  if (priority === "P3") {
    return "border-violet-200 bg-violet-50 text-[#6D28D9]";
  }
  return "border-slate-200 bg-slate-50 text-[#475569]";
}

export default function Recommendations() {
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const dashboardPreferences = useDashboardPreferences(
    "historical-cdr-recommendations",
    recommendationWidgets,
    user?.email,
  );

  const [filters, setFilters] = useState<ApiCdrFilters | null>(null);
  const [recommendations, setRecommendations] = useState<ApiCdrRecommendationList | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOperator, setSelectedOperator] = useState("all");
  const [selectedDepartment, setSelectedDepartment] = useState("all");
  const [selectedSeverity, setSelectedSeverity] = useState("all");
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
        const response = await cdrAnalyticsApi.filters(token);
        if (isMounted) {
          setFilters(response);
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(normalizeError(error, "Impossible de charger les filtres CDR."));
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
  }, [searchQuery, selectedOperator, selectedDepartment, selectedSeverity]);

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
        const response = await cdrAnalyticsApi.recommendations(token, {
          search: searchQuery.trim() || undefined,
          operator: selectedOperator !== "all" ? selectedOperator : undefined,
          department: selectedDepartment !== "all" ? selectedDepartment : undefined,
          severity: selectedSeverity !== "all" ? selectedSeverity : undefined,
          offset,
          limit: PAGE_SIZE,
        });

        if (isMounted) {
          setRecommendations(response);
        }
      } catch (error) {
        if (isMounted) {
          setRecommendations(null);
          setErrorMessage(
            normalizeError(error, "Impossible de charger les recommandations IA."),
          );
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
  }, [token, offset, searchQuery, selectedOperator, selectedDepartment, selectedSeverity]);

  const orderedRecommendations = useMemo(
    () =>
      [...(recommendations?.items ?? [])].sort((left, right) => {
        if (left.investigation_priority !== right.investigation_priority) {
          return left.investigation_priority.localeCompare(right.investigation_priority);
        }
        if (left.estimated_financial_loss !== right.estimated_financial_loss) {
          return right.estimated_financial_loss - left.estimated_financial_loss;
        }
        return right.fraud_risk_score_100 - left.fraud_risk_score_100;
      }),
    [recommendations],
  );

  const selectedRecommendation =
    orderedRecommendations.find(
      (recommendation) => recommendation.cdr_row_id === selectedRecommendationId,
    ) ?? null;

  const totalEstimatedLoss = orderedRecommendations.reduce(
    (sum, recommendation) => sum + recommendation.estimated_financial_loss,
    0,
  );
  const p1Count = orderedRecommendations.filter(
    (recommendation) => recommendation.investigation_priority === "P1",
  ).length;
  const acceptedCount = acceptedIds.length;
  const currentPage = Math.floor((recommendations?.offset ?? 0) / PAGE_SIZE) + 1;
  const totalPages = recommendations ? Math.max(1, Math.ceil(recommendations.total / PAGE_SIZE)) : 1;

  function getDecisionStatus(cdrRowId: number): string {
    if (acceptedIds.includes(cdrRowId)) {
      return "Appliquee";
    }
    if (rejectedIds.includes(cdrRowId)) {
      return "Ecartee";
    }
    return "A arbitrer";
  }

  function handleAccept(recommendation: ApiCdrRecommendation) {
    setAcceptedIds((current) =>
      current.includes(recommendation.cdr_row_id)
        ? current
        : [...current, recommendation.cdr_row_id],
    );
    setRejectedIds((current) => current.filter((item) => item !== recommendation.cdr_row_id));
    toast.success("Recommandation appliquee", {
      description: `Action prioritaire engagee sur l'alerte ${recommendation.cdr_row_id}.`,
    });
  }

  function handleReject(recommendation: ApiCdrRecommendation) {
    setRejectedIds((current) =>
      current.includes(recommendation.cdr_row_id)
        ? current
        : [...current, recommendation.cdr_row_id],
    );
    setAcceptedIds((current) => current.filter((item) => item !== recommendation.cdr_row_id));
    toast.success("Recommandation classee", {
      description: `L'alerte ${recommendation.cdr_row_id} sort de la file prioritaire.`,
    });
  }

  return (
    <div className="space-y-6 p-6">
      <DashboardSection isVisible={dashboardPreferences.isWidgetVisible("summary")}>
        <section className="rounded-[34px] border border-[var(--bc-ai-border)] bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.18),transparent_22%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.16),transparent_28%),linear-gradient(135deg,#0F172A_0%,#312E81_54%,#4F46E5_100%)] p-6 text-white shadow-[0_28px_80px_-48px_rgba(15,23,42,0.48)]">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/80">
                <Lightbulb className="h-3.5 w-3.5" />
                CDR enrichi
              </div>
              <h1 className="mt-4 text-3xl font-bold">Recommandations IA</h1>
              <p className="mt-3 text-sm leading-6 text-white/80">
                Priorisation réelle issue de <span className="font-semibold">telecom_cdr_fraud_fleetconnect_enriched.csv</span>:
                recommandation, priorité d’investigation, sévérité fraude et perte financière estimée.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {[
                { label: "Actions visibles", value: `${orderedRecommendations.length}`, icon: Sparkles },
                { label: "P1", value: `${p1Count}`, icon: ShieldAlert },
                { label: "Perte potentielle", value: formatMadValue(totalEstimatedLoss), icon: Lightbulb },
                { label: "Appliquees", value: `${acceptedCount}`, icon: Check },
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
                    <p className="mt-3 text-2xl font-bold">{isLoading ? "--" : item.value}</p>
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
        widgets={recommendationWidgets}
        visibility={dashboardPreferences.visibility}
        visibleCount={dashboardPreferences.visibleCount}
        onChange={dashboardPreferences.setWidgetVisible}
        onReset={dashboardPreferences.showAllWidgets}
      />

      <DashboardSection isVisible={dashboardPreferences.isWidgetVisible("filters")}>
        <section className="rounded-[28px] border border-[var(--bc-neutral-border)] bg-white p-5 shadow-sm">
          <div className="grid gap-4 xl:grid-cols-4">
            <label className="relative xl:col-span-2">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--bc-neutral-muted)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Alerte, departement, type de fraude..."
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
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_auto]">
            <select
              value={selectedSeverity}
              onChange={(event) => setSelectedSeverity(event.target.value)}
              className="h-12 rounded-2xl border border-[var(--bc-neutral-border)] bg-[var(--bc-neutral-soft)] px-4 text-sm outline-none transition focus:border-[var(--bc-primary)] focus:ring-2 focus:ring-[var(--bc-primary-soft)]"
            >
              <option value="all">Toutes les severites</option>
              {(filters?.severities ?? []).map((severity) => (
                <option key={severity} value={severity}>
                  {formatSeverityLabel(severity)}
                </option>
              ))}
            </select>

            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="bg-white">
                Source: `telecom_cdr_fraud_fleetconnect_enriched.csv`
              </Badge>
            </div>
          </div>
        </section>
      </DashboardSection>

      <DashboardSection isVisible={dashboardPreferences.isWidgetVisible("recommendations")}>
        {isLoading ? (
          <div className="rounded-2xl border border-[var(--bc-neutral-border)] bg-white px-6 py-16 text-center text-sm text-[var(--bc-neutral-body)]">
            Chargement des recommandations IA...
          </div>
        ) : orderedRecommendations.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--bc-neutral-border)] bg-white px-6 py-16 text-center text-sm text-[var(--bc-neutral-body)]">
            Aucune recommandation disponible pour les filtres actuels.
          </div>
        ) : (
          <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-5">
              {orderedRecommendations.map((recommendation) => (
                <article
                  key={recommendation.cdr_row_id}
                  className="rounded-[30px] border border-[var(--bc-neutral-border)] bg-white p-5 shadow-sm"
                >
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-xl font-semibold text-[var(--bc-neutral-strong)]">
                            Alerte {recommendation.cdr_row_id}
                          </h2>
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getSeverityClasses(
                              recommendation.severity,
                            )}`}
                          >
                            {formatSeverityLabel(recommendation.severity)}
                          </span>
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getPriorityTone(
                              recommendation.investigation_priority,
                            )}`}
                          >
                            {recommendation.investigation_priority}
                          </span>
                          <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-semibold text-[#475569]">
                            {getDecisionStatus(recommendation.cdr_row_id)}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-[var(--bc-neutral-body)]">
                          {recommendation.operator_maroc} · {recommendation.department} ·{" "}
                          {formatCallZoneLabel(recommendation.call_zone)}
                        </p>
                        <p className="mt-1 text-sm text-[var(--bc-neutral-body)]">
                          {formatFraudTypeLabel(recommendation.fraud_type)}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline" className="bg-white">
                          IA {recommendation.ai_recommendation_priority}
                        </Badge>
                        <Badge variant="outline" className="bg-white">
                          {formatMadValue(recommendation.estimated_financial_loss)}
                        </Badge>
                      </div>
                    </div>

                    <AIRiskInsightCard
                      riskId={recommendation.risk_id}
                      moduleLabel="Recommandations IA"
                      title={recommendation.title}
                      severity={recommendation.severity}
                      description={recommendation.recommendation_reason}
                      impact={recommendation.impact}
                      cause={recommendation.description}
                      aiRecommendation={recommendation.ai_recommendation}
                      suggestedAction={recommendation.suggested_action}
                      confidenceScore={recommendation.confidence_score}
                      recommendationStatus={getDecisionStatus(recommendation.cdr_row_id)}
                      compact
                      onApply={() => handleAccept(recommendation)}
                      onIgnore={() => handleReject(recommendation)}
                      onSimulate={() => setSelectedRecommendationId(recommendation.cdr_row_id)}
                    />

                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-2xl border border-[var(--bc-neutral-border)] p-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-[var(--bc-neutral-muted)]">
                          Score
                        </p>
                        <p className="mt-2 text-lg font-semibold text-[var(--bc-neutral-strong)]">
                          {formatRiskScore(recommendation.fraud_risk_score_100)}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-[var(--bc-neutral-border)] p-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-[var(--bc-neutral-muted)]">
                          Cout appel
                        </p>
                        <p className="mt-2 text-lg font-semibold text-[var(--bc-neutral-strong)]">
                          {formatMadValue(recommendation.call_cost_mad)}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-[var(--bc-neutral-border)] p-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-[var(--bc-neutral-muted)]">
                          Perte estimee
                        </p>
                        <p className="mt-2 text-lg font-semibold text-[#DC2626]">
                          {formatMadValue(recommendation.estimated_financial_loss)}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-[var(--bc-neutral-border)] p-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-[var(--bc-neutral-muted)]">
                          Priorite IA
                        </p>
                        <p className="mt-2 text-lg font-semibold text-[var(--bc-neutral-strong)]">
                          {recommendation.ai_recommendation_priority}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <Button type="button" className="rounded-2xl" onClick={() => handleAccept(recommendation)}>
                        <Check className="h-4 w-4" />
                        Appliquer
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        className="rounded-2xl"
                        onClick={() => handleReject(recommendation)}
                      >
                        <X className="h-4 w-4" />
                        Ecarter
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="rounded-2xl"
                        onClick={() => setSelectedRecommendationId(recommendation.cdr_row_id)}
                      >
                        <Eye className="h-4 w-4" />
                        Examiner
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <aside className="h-fit rounded-[30px] border border-[var(--bc-neutral-border)] bg-white p-5 shadow-sm">
              {selectedRecommendation ? (
                <div className="space-y-5">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-[var(--bc-neutral-muted)]">
                      Examen detaille
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold text-[var(--bc-neutral-strong)]">
                      Alerte {selectedRecommendation.cdr_row_id}
                    </h2>
                    <p className="mt-2 text-sm text-[var(--bc-neutral-body)]">
                      {selectedRecommendation.operator_maroc} · {selectedRecommendation.department}
                    </p>
                  </div>

                  <AIRecommendationBlock
                    recommendation={selectedRecommendation.recommendation}
                    secondaryText={selectedRecommendation.recommendation_reason}
                    status={getDecisionStatus(selectedRecommendation.cdr_row_id)}
                    severityLabel={formatSeverityLabel(selectedRecommendation.severity)}
                    riskTypeLabel={formatFraudTypeLabel(selectedRecommendation.fraud_type)}
                    scoreLabel={`Score ${formatRiskScore(selectedRecommendation.fraud_risk_score_100)}`}
                    className="bg-[#F8FAFC]"
                  />

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-[var(--bc-neutral-border)] p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-[var(--bc-neutral-muted)]">
                        Investig.
                      </p>
                      <p className="mt-2 text-lg font-semibold text-[var(--bc-neutral-strong)]">
                        {selectedRecommendation.investigation_priority}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-[var(--bc-neutral-border)] p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-[var(--bc-neutral-muted)]">
                        IA
                      </p>
                      <p className="mt-2 text-lg font-semibold text-[var(--bc-neutral-strong)]">
                        {selectedRecommendation.ai_recommendation_priority}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[var(--bc-neutral-border)] p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-[var(--bc-neutral-muted)]">
                      Impact financier
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-[#DC2626]">
                      {formatMadValue(selectedRecommendation.estimated_financial_loss)}
                    </p>
                    <p className="mt-2 text-sm text-[var(--bc-neutral-body)]">
                      {selectedRecommendation.description}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <Button type="button" className="rounded-2xl" onClick={() => navigate("/fraude-cdr")}>
                      <ShieldAlert className="h-4 w-4" />
                      Ouvrir Fraude CDR
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-2xl"
                      onClick={() => setSelectedRecommendationId(null)}
                    >
                      Fermer
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="py-10 text-center text-sm text-[var(--bc-neutral-body)]">
                  Selectionnez une recommandation pour examiner sa justification et son impact.
                </div>
              )}
            </aside>
          </div>
        )}

        <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-[var(--bc-neutral-border)] bg-white px-5 py-4 md:flex-row md:items-center md:justify-between">
          <p className="text-sm text-[var(--bc-neutral-body)]">
            Page {currentPage} / {totalPages} · {recommendations?.total ?? 0} recommandations
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setOffset((current) => Math.max(current - PAGE_SIZE, 0))}
              disabled={offset === 0 || isLoading}
              className="rounded-xl border border-[var(--bc-neutral-border)] px-4 py-2 text-sm font-medium text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Precedent
            </button>
            <button
              type="button"
              onClick={() => setOffset((current) => current + PAGE_SIZE)}
              disabled={isLoading || !recommendations || offset + PAGE_SIZE >= recommendations.total}
              className="rounded-xl border border-[var(--bc-neutral-border)] px-4 py-2 text-sm font-medium text-[var(--bc-neutral-body)] transition-colors hover:bg-[var(--bc-neutral-soft)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Suivant
            </button>
          </div>
        </div>
      </DashboardSection>
    </div>
  );
}

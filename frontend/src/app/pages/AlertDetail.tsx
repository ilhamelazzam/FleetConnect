import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import {
  AlertCircle,
  ArrowLeft,
  Clock3,
  Globe2,
  MapPinned,
  Radar,
  ShieldAlert,
  Wallet,
} from "lucide-react";

import AIRecommendationBlock from "../components/AIRecommendationBlock";
import { useAuth } from "../context/AuthContext";
import {
  formatCallTypeLabel,
  formatCallZoneLabel,
  formatCdrDateTime,
  formatFraudTypeLabel,
  formatMadValue,
  formatRiskScore,
  formatSeverityLabel,
  formatTransactionStatusLabel,
  getSeverityClasses,
} from "../lib/cdr-analytics";
import { ApiError, cdrAnalyticsApi, type ApiCdrAlertDetail } from "../lib/api";

function normalizeError(error: unknown, fallbackMessage: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallbackMessage;
}

function getFlagLabel(label: string, active: boolean): string {
  return active ? `${label}: oui` : `${label}: non`;
}

export default function AlertDetail() {
  const { id } = useParams();
  const { token } = useAuth();
  const [alert, setAlert] = useState<ApiCdrAlertDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadAlertDetail() {
      if (!token || !id) {
        if (isMounted) {
          setAlert(null);
          setIsLoading(false);
        }
        return;
      }

      const cdrRowId = Number(id);
      if (Number.isNaN(cdrRowId) || cdrRowId <= 0) {
        if (isMounted) {
          setAlert(null);
          setErrorMessage("Identifiant d'alerte invalide.");
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      setErrorMessage(null);

      try {
        const response = await cdrAnalyticsApi.alert(token, cdrRowId);
        if (isMounted) {
          setAlert(response);
        }
      } catch (error) {
        if (isMounted) {
          setAlert(null);
          setErrorMessage(normalizeError(error, "Impossible de charger le detail de cette alerte."));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadAlertDetail();

    return () => {
      isMounted = false;
    };
  }, [token, id]);

  return (
    <div className="space-y-6 p-6">
      <Link
        to="/anomalies"
        className="inline-flex items-center gap-2 font-medium text-[#2563EB] hover:text-[#1d4ed8]"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>Retour aux alertes</span>
      </Link>

      {errorMessage ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {errorMessage}
        </div>
      ) : null}

      {isLoading ? (
        <div className="rounded-xl border border-gray-200 bg-white px-6 py-12 text-center text-sm text-[#64748B]">
          Chargement du detail de l'alerte...
        </div>
      ) : !alert ? (
        <div className="rounded-xl border border-gray-200 bg-white px-6 py-12 text-center text-sm text-[#64748B]">
          Aucune alerte n'a ete trouvee pour cet identifiant.
        </div>
      ) : (
        <>
          <div className="rounded-xl border-2 border-red-200 bg-white p-6">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-start gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-red-100">
                  <AlertCircle className="h-8 w-8 text-[#DC2626]" />
                </div>
                <div>
                  <div className="mb-2 flex flex-wrap items-center gap-3">
                    <h1 className="text-2xl font-bold text-[#0F172A]">Alerte {alert.cdr_row_id}</h1>
                    <span className={`rounded-full px-3 py-1 text-sm font-medium ${getSeverityClasses(alert.severity)}`}>
                      {formatSeverityLabel(alert.severity)}
                    </span>
                  </div>
                  <p className="text-lg font-medium text-[#0F172A]">
                    {formatFraudTypeLabel(alert.fraud_type)} - {formatCallZoneLabel(alert.call_zone)}
                  </p>
                  <p className="mt-1 text-sm text-[#64748B]">{formatCdrDateTime(alert.start_time)}</p>
                  <AIRecommendationBlock
                    recommendation={alert.ai_recommendation || alert.recommendation}
                    secondaryText={alert.recommendation_reason}
                    status={alert.recommendation_status}
                    severityLabel={formatSeverityLabel(alert.severity)}
                    riskTypeLabel={formatFraudTypeLabel(alert.fraud_type)}
                    scoreLabel={`Score ${formatRiskScore(alert.fraud_risk_score_100)}`}
                    compact
                    className="mt-4"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                  <p className="text-xs uppercase tracking-wide text-[#64748B]">Score risque</p>
                  <p className="mt-2 text-xl font-bold text-[#0F172A]">
                    {formatRiskScore(alert.fraud_risk_score_100)}
                  </p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                  <p className="text-xs uppercase tracking-wide text-[#64748B]">Probabilite</p>
                  <p className="mt-2 text-xl font-bold text-[#0F172A]">
                    {(alert.fraud_risk_proba * 100).toFixed(1)}%
                  </p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                  <p className="text-xs uppercase tracking-wide text-[#64748B]">Cout</p>
                  <p className="mt-2 text-xl font-bold text-[#0F172A]">{formatMadValue(alert.call_cost_mad)}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-gray-200 bg-white p-6">
              <div className="mb-4 flex items-center gap-2">
                <MapPinned className="h-5 w-5 text-[#2563EB]" />
                <h2 className="text-lg font-semibold text-[#0F172A]">Parcours de l'appel</h2>
              </div>
              <div className="space-y-4">
                <div className="rounded-lg bg-[#F8FAFC] p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Route</p>
                  <p className="mt-2 text-sm text-[#0F172A]">{alert.route_label}</p>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="rounded-lg border border-gray-200 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Origine</p>
                    <p className="mt-2 text-sm font-semibold text-[#0F172A]">{alert.location_origin}</p>
                    <p className="text-sm text-[#64748B]">{alert.country_origin}</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Destination</p>
                    <p className="mt-2 text-sm font-semibold text-[#0F172A]">{alert.location_dest}</p>
                    <p className="text-sm text-[#64748B]">{alert.country_dest}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="rounded-lg border border-gray-200 p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <Clock3 className="h-4 w-4 text-[#64748B]" />
                      <p className="text-sm text-[#64748B]">Duree</p>
                    </div>
                    <p className="font-semibold text-[#0F172A]">{alert.duration_sec}s</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <Globe2 className="h-4 w-4 text-[#64748B]" />
                      <p className="text-sm text-[#64748B]">Type</p>
                    </div>
                    <p className="font-semibold text-[#0F172A]">{formatCallTypeLabel(alert.call_type)}</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <Radar className="h-4 w-4 text-[#64748B]" />
                      <p className="text-sm text-[#64748B]">Statut transaction</p>
                    </div>
                    <p className="font-semibold text-[#0F172A]">
                      {formatTransactionStatusLabel(alert.transaction_status)}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-6">
              <div className="mb-4 flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-[#DC2626]" />
                <h2 className="text-lg font-semibold text-[#0F172A]">Explication et action</h2>
              </div>
              <div className="space-y-4">
                <div className="rounded-lg bg-[#F8FAFC] p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Raison principale</p>
                  <p className="mt-2 text-sm text-[#0F172A]">{alert.recommendation_reason}</p>
                </div>
                <AIRecommendationBlock
                  recommendation={alert.ai_recommendation || alert.recommendation}
                  secondaryText={alert.recommendation_reason}
                  status={alert.recommendation_status}
                  severityLabel={formatSeverityLabel(alert.severity)}
                  riskTypeLabel={formatFraudTypeLabel(alert.fraud_type)}
                  scoreLabel={`Score ${formatRiskScore(alert.fraud_risk_score_100)}`}
                  className="border-gray-200 bg-white"
                />
                <div className="rounded-lg border border-gray-200 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Regles declenchees</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {alert.rule_matches.map((rule) => (
                      <span
                        key={rule}
                        className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-[#2563EB]"
                      >
                        {rule}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Flags</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {[
                      getFlagLabel("Roaming", alert.roaming_flag),
                      getFlagLabel("International", alert.international_flag),
                      getFlagLabel("Cout eleve", alert.high_cost_flag),
                      getFlagLabel("Longue duree", alert.long_duration_flag),
                      getFlagLabel("Appel de nuit", alert.is_night_call),
                    ].map((flag) => (
                      <span
                        key={flag}
                        className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-[#334155]"
                      >
                        {flag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="rounded-xl border border-gray-200 bg-white p-6">
              <div className="mb-3 flex items-center gap-2">
                <Wallet className="h-5 w-5 text-[#16A34A]" />
                <h3 className="font-semibold text-[#0F172A]">Exposition financiere</h3>
              </div>
              <p className="text-2xl font-bold text-[#0F172A]">{formatMadValue(alert.call_cost_mad)}</p>
              <p className="mt-2 text-sm text-[#64748B]">
                Montant associe a cet evenement suspect dans le snapshot actuel.
              </p>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-6">
              <div className="mb-3 flex items-center gap-2">
                <Globe2 className="h-5 w-5 text-[#2563EB]" />
                <h3 className="font-semibold text-[#0F172A]">Operateur et zone</h3>
              </div>
              <p className="text-lg font-bold text-[#0F172A]">{alert.operator_maroc}</p>
              <p className="mt-2 text-sm text-[#64748B]">
                {alert.department} - {formatCallZoneLabel(alert.call_zone)}
              </p>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-6">
              <div className="mb-3 flex items-center gap-2">
                <Radar className="h-5 w-5 text-[#D97706]" />
                <h3 className="font-semibold text-[#0F172A]">Type de fraude</h3>
              </div>
              <p className="text-lg font-bold text-[#0F172A]">{formatFraudTypeLabel(alert.fraud_type)}</p>
              <p className="mt-2 text-sm text-[#64748B]">
                Evenement classe {formatSeverityLabel(alert.severity).toLowerCase()}.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

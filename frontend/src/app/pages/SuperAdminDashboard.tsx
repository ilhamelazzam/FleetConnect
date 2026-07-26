import { useEffect, useState } from "react";
import { Link } from "react-router";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock3,
  ShieldCheck,
  Users,
  XCircle,
} from "lucide-react";

import { useAuth } from "../context/AuthContext";
import {
  ApiError,
  companyRegistrationApi,
  formatCompanyRequestedRoleLabel,
  type ApiCompanyListItem,
  type ApiCompanyRegistrationOverview,
  type ApiCompanyRegistrationSummary,
} from "../lib/api";
import {
  RegistrationStatusBadge,
  formatDateTime,
} from "../components/company-registration/RegistrationUi";

const cardBaseClassName =
  "rounded-[28px] border border-white/80 bg-white/92 p-5 shadow-[0_20px_70px_-36px_rgba(15,23,42,0.28)] backdrop-blur-sm";

export default function SuperAdminDashboard() {
  const { token, user } = useAuth();
  const [overview, setOverview] = useState<ApiCompanyRegistrationOverview | null>(null);
  const [pendingRequests, setPendingRequests] = useState<ApiCompanyRegistrationSummary[]>([]);
  const [companies, setCompanies] = useState<ApiCompanyListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
      if (!token) {
        return;
      }

      setIsLoading(true);
      setErrorMessage("");
      try {
        const [overviewResponse, requestsResponse, companiesResponse] = await Promise.all([
          companyRegistrationApi.overview(token),
          companyRegistrationApi.list(token, { limit: 10 }),
          companyRegistrationApi.listCompanies(token, { limit: 5 }),
        ]);
        if (!active) {
          return;
        }
        setOverview(overviewResponse);
        setPendingRequests(
          requestsResponse.items
            .filter(
              (item) =>
                !item.is_deleted &&
                (item.status === "pending" || item.status === "under_review"),
            )
            .slice(0, 5),
        );
        setCompanies(companiesResponse.items);
      } catch (error) {
        if (!active) {
          return;
        }
        if (error instanceof ApiError) {
          setErrorMessage(error.message);
        } else {
          setErrorMessage("Impossible de charger le dashboard Super Admin.");
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void loadDashboard();

    return () => {
      active = false;
    };
  }, [token]);

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.14),transparent_28%),linear-gradient(180deg,#F8FAFC_0%,#FFFFFF_52%,#EEF6FF_100%)] p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="overflow-hidden rounded-[32px] bg-[linear-gradient(145deg,#0F172A_0%,#1E3A8A_42%,#06B6D4_100%)] p-7 text-white shadow-[0_28px_90px_-42px_rgba(15,23,42,0.72)]">
          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-end">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium">
                <ShieldCheck className="h-4 w-4" />
                <span>Portail Super Administrateur</span>
              </div>
              <h1 className="mt-5 text-3xl font-semibold tracking-tight">Dashboard Super Admin</h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-white/80">
                Suivez les demandes d'inscription des entreprises, les validations et l'activite
                globale de FleetConnect IA depuis un acces dedie.
              </p>
            </div>
            <div className="rounded-[28px] border border-white/15 bg-white/10 p-5 backdrop-blur-sm">
              <p className="text-xs uppercase tracking-[0.22em] text-white/60">Session active</p>
              <p className="mt-3 text-xl font-semibold">{user?.full_name ?? "Super Admin"}</p>
              <p className="mt-1 text-sm text-white/75">{user?.email ?? "-"}</p>
              <div className="mt-4 flex flex-wrap gap-3 text-xs text-white/75">
                <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5">
                  Redirection: /admin/dashboard
                </span>
                <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5">
                  Espace protege
                </span>
              </div>
            </div>
          </div>
        </section>

        {errorMessage ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-[#B91C1C]">
            {errorMessage}
          </div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            title="Entreprises enregistrees"
            value={overview?.stats.active_companies ?? 0}
            helper="Espaces entreprises actifs"
            icon={Building2}
            accentClassName="from-sky-500 to-blue-600"
            isLoading={isLoading}
          />
          <MetricCard
            title="Demandes en attente"
            value={overview?.stats.pending ?? 0}
            helper="Dossiers a valider"
            icon={Clock3}
            accentClassName="from-amber-400 to-orange-500"
            isLoading={isLoading}
          />
          <MetricCard
            title="Demandes approuvees"
            value={overview?.stats.approved ?? 0}
            helper="Entreprises activees"
            icon={CheckCircle2}
            accentClassName="from-emerald-400 to-teal-500"
            isLoading={isLoading}
          />
          <MetricCard
            title="Demandes refusees"
            value={overview?.stats.rejected ?? 0}
            helper="Dossiers refuses"
            icon={XCircle}
            accentClassName="from-rose-500 to-red-500"
            isLoading={isLoading}
          />
          <MetricCard
            title="Utilisateurs"
            value={overview?.stats.total_users ?? 0}
            helper="Comptes detectes sur la plateforme"
            icon={Users}
            accentClassName="from-indigo-500 to-violet-500"
            isLoading={isLoading}
          />
          <MetricCard
            title="Connexions"
            value={overview?.stats.connections ?? 0}
            helper="Utilisateurs ayant deja ouvert une session"
            icon={ShieldCheck}
            accentClassName="from-cyan-500 to-sky-500"
            isLoading={isLoading}
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className={cardBaseClassName}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-[#0F172A]">
                  Demandes recentes
                </h2>
                <p className="mt-2 text-sm leading-7 text-[#64748B]">
                  Les dossiers en attente et rouverts restent priorises dans le workflow de
                  validation.
                </p>
              </div>
              <Link
                to="/admin/company-requests"
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-[#0F172A] hover:bg-slate-50"
              >
                <span>Ouvrir la file</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="mt-6 space-y-3">
              {pendingRequests.length ? (
                pendingRequests.map((request) => (
                  <div
                    key={request.id}
                    className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-semibold text-[#0F172A]">{request.company_name}</p>
                        <p className="mt-1 text-sm text-[#64748B]">
                          {request.responsible_full_name} • {request.responsible_email}
                        </p>
                        <p className="mt-2 text-sm text-[#475569]">
                          {request.country || request.city} •{" "}
                          {request.primary_operator || request.operators[0] || "Operateur non precise"}
                        </p>
                        <p className="mt-2 text-sm text-[#475569]">
                          Fonction / poste: {request.job_title}
                        </p>
                        <div className="mt-3">
                          <span className="inline-flex rounded-full border border-[#DBEAFE] bg-white px-3 py-1.5 text-xs font-semibold text-[#1D4ED8]">
                            Role demande:{" "}
                            {request.requested_role_label ||
                              formatCompanyRequestedRoleLabel(request.requested_role)}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-col items-start gap-2 sm:items-end">
                        <RegistrationStatusBadge status={request.status} />
                        <span className="text-xs text-[#64748B]">
                          {formatDateTime(request.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState label="Aucune demande en attente pour le moment." />
              )}
            </div>
          </div>

          <div className={cardBaseClassName}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-[#0F172A]">
                  Entreprises actives
                </h2>
                <p className="mt-2 text-sm leading-7 text-[#64748B]">
                  Vue rapide sur les workspaces entreprises deja provisionnes.
                </p>
              </div>
              <Link
                to="/admin/companies"
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-[#0F172A] hover:bg-slate-50"
              >
                <span>Voir toutes</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="mt-6 space-y-3">
              {companies.length ? (
                companies.map((company) => (
                  <div
                    key={company.id}
                    className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-semibold text-[#0F172A]">{company.name}</p>
                        <p className="mt-1 text-sm text-[#64748B]">
                          {company.city}
                          {company.country ? ` • ${company.country}` : ""}
                        </p>
                        <p className="mt-2 text-sm text-[#475569]">
                          {company.user_count} utilisateurs • {company.estimated_phone_lines} lignes
                        </p>
                      </div>
                      <div className="flex flex-col items-start gap-2 sm:items-end">
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-[#047857]">
                          {company.status}
                        </span>
                        <span className="text-xs text-[#64748B]">
                          {formatDateTime(company.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState label="Aucune entreprise active disponible." />
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  helper,
  icon: Icon,
  accentClassName,
  isLoading,
}: {
  title: string;
  value: number;
  helper: string;
  icon: typeof Building2;
  accentClassName: string;
  isLoading: boolean;
}) {
  return (
    <div className={cardBaseClassName}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-[#64748B]">{title}</p>
          <p className="mt-3 text-4xl font-semibold tracking-tight text-[#0F172A]">
            {isLoading ? "--" : value}
          </p>
          <p className="mt-3 text-sm text-[#475569]">{helper}</p>
        </div>
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${accentClassName} text-white shadow-[0_18px_32px_-18px_rgba(37,99,235,0.58)]`}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-10 text-center text-sm text-[#64748B]">
      {label}
    </div>
  );
}

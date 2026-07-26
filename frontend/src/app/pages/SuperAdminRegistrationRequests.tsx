import { startTransition, useDeferredValue, useEffect, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  Building2,
  CheckCircle2,
  Eye,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  UserRoundCog,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import {
  DeleteRequestDialog,
  RejectRequestDialog,
  ReopenRequestDialog,
  RegistrationStatusBadge,
  formatDateTime,
} from "../components/company-registration/RegistrationUi";
import { useAuth } from "../context/AuthContext";
import {
  ApiError,
  companyRegistrationApi,
  formatCompanyRequestedRoleLabel,
  type ApiCompanyRegistrationOverview,
  type ApiCompanyRegistrationStatus,
  type ApiCompanyRegistrationSummary,
} from "../lib/api";

const statusOptions: Array<{
  label: string;
  value: ApiCompanyRegistrationStatus | "all";
}> = [
  { label: "Tous", value: "all" },
  { label: "En attente", value: "pending" },
  { label: "En revision", value: "under_review" },
  { label: "Approuvees", value: "approved" },
  { label: "Refusees", value: "rejected" },
];

function normalizeStatusFilter(value: string | null): ApiCompanyRegistrationStatus | "all" {
  if (
    value === "pending" ||
    value === "under_review" ||
    value === "approved" ||
    value === "rejected"
  ) {
    return value;
  }

  return "all";
}

export default function SuperAdminRegistrationRequests() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { token, user } = useAuth();
  const [overview, setOverview] = useState<ApiCompanyRegistrationOverview | null>(null);
  const [requests, setRequests] = useState<ApiCompanyRegistrationSummary[]>([]);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [showDeletedOnly, setShowDeletedOnly] = useState<boolean>(
    () => searchParams.get("scope") === "trash",
  );
  const [selectedStatus, setSelectedStatus] = useState<ApiCompanyRegistrationStatus | "all">(
    () => normalizeStatusFilter(searchParams.get("status")),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isOverviewLoading, setIsOverviewLoading] = useState(true);
  const [isActionSubmitting, setIsActionSubmitting] = useState(false);
  const [actionRequestId, setActionRequestId] = useState<number | null>(null);
  const [rejectTarget, setRejectTarget] = useState<ApiCompanyRegistrationSummary | null>(null);
  const [reopenTarget, setReopenTarget] = useState<ApiCompanyRegistrationSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiCompanyRegistrationSummary | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const nextStatus = normalizeStatusFilter(searchParams.get("status"));
    const nextScopeIsTrash = searchParams.get("scope") === "trash";
    setSelectedStatus((currentStatus) =>
      currentStatus === nextStatus ? currentStatus : nextStatus,
    );
    setShowDeletedOnly((currentScope) =>
      currentScope === nextScopeIsTrash ? currentScope : nextScopeIsTrash,
    );
  }, [searchParams]);

  const loadOverview = async () => {
    if (!token) {
      return;
    }

    setIsOverviewLoading(true);
    try {
      const nextOverview = await companyRegistrationApi.overview(token);
      setOverview(nextOverview);
    } catch (error) {
      if (error instanceof ApiError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage("Impossible de charger les statistiques super admin.");
      }
    } finally {
      setIsOverviewLoading(false);
    }
  };

  const loadRequests = async () => {
    if (!token) {
      return;
    }

    setIsLoading(true);
    setErrorMessage("");
    try {
      const response = await companyRegistrationApi.list(token, {
        status: selectedStatus,
        search: deferredSearch.trim(),
        limit: 50,
        include_deleted: showDeletedOnly,
        deleted_only: showDeletedOnly,
      });
      setRequests(response.items);
    } catch (error) {
      if (error instanceof ApiError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage("Impossible de charger les demandes d'inscription.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadOverview();
  }, [token]);

  useEffect(() => {
    void loadRequests();
  }, [token, selectedStatus, deferredSearch, showDeletedOnly]);

  const refreshAll = async () => {
    await Promise.all([loadOverview(), loadRequests()]);
  };

  const handleApprove = async (item: ApiCompanyRegistrationSummary) => {
    if (!token) {
      return;
    }

    if (!window.confirm(`Approuver la demande de ${item.company_name} ?`)) {
      return;
    }

    setIsActionSubmitting(true);
    setActionRequestId(item.id);
    try {
      await companyRegistrationApi.approve(token, item.id);
      toast.success("Demande approuvee", {
        description: "La demande a ete approuvee et l'entreprise a ete creee.",
      });
      await refreshAll();
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.message);
      } else {
        toast.error("Erreur pendant l'approbation.");
      }
    } finally {
      setIsActionSubmitting(false);
      setActionRequestId(null);
    }
  };

  const handleReject = async () => {
    if (!token || !rejectTarget) {
      return;
    }

    if (rejectReason.trim().length < 10) {
      toast.error("La raison du refus doit contenir au moins 10 caracteres.");
      return;
    }

    setIsActionSubmitting(true);
    setActionRequestId(rejectTarget.id);
    try {
      await companyRegistrationApi.reject(token, rejectTarget.id, rejectReason.trim());
      toast.success("Demande refusee", {
        description: `Le motif a ete envoye a ${rejectTarget.company_name}.`,
      });
      setRejectTarget(null);
      setRejectReason("");
      await refreshAll();
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.message);
      } else {
        toast.error("Erreur pendant le refus.");
      }
    } finally {
      setIsActionSubmitting(false);
      setActionRequestId(null);
    }
  };

  const handleReopen = async () => {
    if (!token || !reopenTarget) {
      return;
    }

    if (reopenReason.trim().length < 3) {
      toast.error("Le motif de reouverture doit contenir au moins 3 caracteres.");
      return;
    }

    setIsActionSubmitting(true);
    setActionRequestId(reopenTarget.id);
    try {
      await companyRegistrationApi.reopen(token, reopenTarget.id, reopenReason.trim());
      toast.success("Reouverture reussie", {
        description: "La demande est de nouveau en cours d'examen.",
      });
      setReopenTarget(null);
      setReopenReason("");
      await refreshAll();
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.message);
      } else {
        toast.error("Erreur pendant la reouverture.");
      }
    } finally {
      setIsActionSubmitting(false);
      setActionRequestId(null);
    }
  };

  const handleDelete = async () => {
    if (!token || !deleteTarget) {
      return;
    }

    setIsActionSubmitting(true);
    setActionRequestId(deleteTarget.id);
    try {
      await companyRegistrationApi.delete(token, deleteTarget.id, {
        force: deleteTarget.status === "pending",
      });
      toast.success("Demande supprimee", {
        description: `${deleteTarget.company_name} a ete retiree de la liste active.`,
      });
      setDeleteTarget(null);
      await refreshAll();
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.message);
      } else {
        toast.error("Erreur pendant la suppression.");
      }
    } finally {
      setIsActionSubmitting(false);
      setActionRequestId(null);
    }
  };

  const handleRestore = async (item: ApiCompanyRegistrationSummary) => {
    if (!token) {
      return;
    }

    setIsActionSubmitting(true);
    setActionRequestId(item.id);
    try {
      await companyRegistrationApi.restore(token, item.id);
      toast.success("Demande restauree", {
        description: `${item.company_name} est revenue dans la liste active.`,
      });
      await refreshAll();
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.message);
      } else {
        toast.error("Erreur pendant la restauration.");
      }
    } finally {
      setIsActionSubmitting(false);
      setActionRequestId(null);
    }
  };

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.14),transparent_28%),linear-gradient(180deg,#F8FAFC_0%,#FFFFFF_52%,#EEF6FF_100%)] p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="overflow-hidden rounded-[32px] bg-[linear-gradient(145deg,#0F172A_0%,#1E3A8A_42%,#06B6D4_100%)] p-7 text-white shadow-[0_28px_90px_-42px_rgba(15,23,42,0.72)]">
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium">
                <ShieldCheck className="h-4 w-4" />
                <span>Espace super administrateur</span>
              </div>
              <h1 className="mt-5 text-3xl font-semibold tracking-tight">
                Validation des demandes d'inscription entreprise
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-white/80">
                Controlez les dossiers soumis, consultez les pieces justificatives, activez les
                comptes admin entreprise et suivez les structures creees.
              </p>
            </div>
            <div className="rounded-[28px] border border-white/15 bg-white/10 p-5 backdrop-blur-sm">
              <p className="text-xs uppercase tracking-[0.22em] text-white/60">
                Session connectee
              </p>
              <p className="mt-3 text-xl font-semibold">{user?.full_name ?? "Super administrateur"}</p>
              <p className="mt-1 text-sm text-white/75">{user?.email ?? "admin@bcskills.ma"}</p>
              <p className="mt-4 text-sm text-white/80">
                Les documents restent proteges par authentification et les actions critiques sont
                journalisees.
              </p>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StatCard
            title="En attente"
            value={overview?.stats.pending ?? 0}
            helper="Demandes a traiter"
            accentClassName="from-amber-400 to-orange-500"
            isLoading={isOverviewLoading}
            icon={Building2}
          />
          <StatCard
            title="En revision"
            value={overview?.stats.under_review ?? 0}
            helper="Dossiers rouverts"
            accentClassName="from-sky-500 to-cyan-500"
            isLoading={isOverviewLoading}
            icon={RotateCcw}
          />
          <StatCard
            title="Approuvees"
            value={overview?.stats.approved ?? 0}
            helper="Comptes entreprises actifs"
            accentClassName="from-emerald-400 to-teal-500"
            isLoading={isOverviewLoading}
            icon={CheckCircle2}
          />
          <StatCard
            title="Refusees"
            value={overview?.stats.rejected ?? 0}
            helper="Dossiers rejetes"
            accentClassName="from-rose-500 to-red-500"
            isLoading={isOverviewLoading}
            icon={XCircle}
          />
          <StatCard
            title="Ce mois"
            value={overview?.stats.this_month ?? 0}
            helper="Demandes recues"
            accentClassName="from-sky-500 to-blue-600"
            isLoading={isOverviewLoading}
            icon={UserRoundCog}
          />
        </section>

        <section className="rounded-[32px] border border-white/80 bg-white/92 p-6 shadow-[0_20px_70px_-36px_rgba(15,23,42,0.28)] backdrop-blur-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-[#0F172A]">
                File des demandes
              </h2>
              <p className="mt-2 text-sm leading-7 text-[#64748B]">
                Recherche par entreprise, email ou ville. Les actions critiques restent reservees
                au super admin.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <label className="relative block min-w-[260px]">
                <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => {
                    const value = event.target.value;
                    startTransition(() => setSearch(value));
                  }}
                  placeholder="Entreprise, responsable, email..."
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm text-[#0F172A] outline-none transition-colors focus:border-[#93C5FD] focus:bg-white"
                />
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowDeletedOnly(false);
                    const nextParams = new URLSearchParams(searchParams);
                    nextParams.delete("scope");
                    setSearchParams(nextParams, { replace: true });
                  }}
                  className={`rounded-2xl px-4 py-3 text-sm font-medium transition-all ${
                    !showDeletedOnly
                      ? "bg-[#0F172A] text-white shadow-[0_18px_32px_-18px_rgba(15,23,42,0.55)]"
                      : "border border-slate-200 bg-white text-[#0F172A] hover:bg-slate-50"
                  }`}
                >
                  Actives
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowDeletedOnly(true);
                    const nextParams = new URLSearchParams(searchParams);
                    nextParams.set("scope", "trash");
                    setSearchParams(nextParams, { replace: true });
                  }}
                  className={`rounded-2xl px-4 py-3 text-sm font-medium transition-all ${
                    showDeletedOnly
                      ? "bg-[#B91C1C] text-white shadow-[0_18px_32px_-18px_rgba(185,28,28,0.42)]"
                      : "border border-slate-200 bg-white text-[#0F172A] hover:bg-slate-50"
                  }`}
                >
                  Corbeille
                </button>
                {statusOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setSelectedStatus(option.value);
                      const nextParams = new URLSearchParams(searchParams);
                      if (option.value === "all") {
                        nextParams.delete("status");
                      } else {
                        nextParams.set("status", option.value);
                      }
                      setSearchParams(nextParams, { replace: true });
                    }}
                    className={`rounded-2xl px-4 py-3 text-sm font-medium transition-all ${
                      selectedStatus === option.value
                        ? "bg-[#1D4ED8] text-white shadow-[0_18px_32px_-18px_rgba(37,99,235,0.58)]"
                        : "border border-slate-200 bg-white text-[#0F172A] hover:bg-slate-50"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {errorMessage ? (
            <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-[#B91C1C]">
              {errorMessage}
            </div>
          ) : null}

          <div className="mt-6 overflow-hidden rounded-[28px] border border-slate-200">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50/80">
                  <tr className="text-left text-xs uppercase tracking-[0.18em] text-[#64748B]">
                    <th className="px-5 py-4 font-semibold">Entreprise</th>
                    <th className="px-5 py-4 font-semibold">Responsable</th>
                    <th className="px-5 py-4 font-semibold">Fonction / poste</th>
                    <th className="px-5 py-4 font-semibold">Email</th>
                    <th className="px-5 py-4 font-semibold">Telephone</th>
                    <th className="px-5 py-4 font-semibold">Pays</th>
                    <th className="px-5 py-4 font-semibold">Role demande</th>
                    <th className="px-5 py-4 font-semibold">Operateur choisi</th>
                    <th className="px-5 py-4 font-semibold">Statut</th>
                    <th className="px-5 py-4 font-semibold">Date</th>
                    <th className="px-5 py-4 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {isLoading ? (
                    <tr>
                      <td colSpan={11} className="px-5 py-12 text-center text-sm text-[#64748B]">
                        Chargement des demandes...
                      </td>
                    </tr>
                  ) : requests.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-5 py-12 text-center text-sm text-[#64748B]">
                        Aucune demande ne correspond aux filtres courants.
                      </td>
                    </tr>
                  ) : (
                    requests.map((item) => (
                      <tr key={item.id} className="align-top">
                        <td className="px-5 py-5">
                          <p className="font-semibold text-[#0F172A]">{item.company_name}</p>
                          <p className="mt-1 text-sm text-[#64748B]">
                            {item.sector} - {item.city}
                          </p>
                        </td>
                        <td className="px-5 py-5">
                          <p className="font-medium text-[#0F172A]">
                            {item.responsible_full_name}
                          </p>
                        </td>
                        <td className="px-5 py-5 text-sm text-[#0F172A]">{item.job_title}</td>
                        <td className="px-5 py-5 text-sm text-[#0F172A]">
                          {item.responsible_email}
                        </td>
                        <td className="px-5 py-5 text-sm text-[#0F172A]">
                          {item.responsible_phone}
                        </td>
                        <td className="px-5 py-5 text-sm text-[#0F172A]">
                          {item.country ?? "-"}
                        </td>
                        <td className="px-5 py-5">
                          <span className="inline-flex rounded-full border border-[#DBEAFE] bg-[#EFF6FF] px-3 py-1.5 text-xs font-semibold text-[#1D4ED8]">
                            {item.requested_role_label ||
                              formatCompanyRequestedRoleLabel(item.requested_role)}
                          </span>
                        </td>
                        <td className="px-5 py-5 text-sm text-[#0F172A]">
                          {item.primary_operator ?? item.operators[0] ?? "-"}
                        </td>
                        <td className="px-5 py-5">
                          <RegistrationStatusBadge
                            status={item.status}
                            isDeleted={item.is_deleted}
                          />
                        </td>
                        <td className="px-5 py-5 text-sm text-[#475569]">
                          {formatDateTime(item.created_at)}
                        </td>
                        <td className="px-5 py-5">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => navigate(`/admin/company-requests/${item.id}`)}
                              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-[#0F172A] hover:bg-slate-50"
                            >
                              <Eye className="h-4 w-4" />
                              <span>Voir</span>
                            </button>

                            {!item.is_deleted &&
                            (item.status === "pending" || item.status === "under_review") ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void handleApprove(item)}
                                  disabled={isActionSubmitting && actionRequestId === item.id}
                                  className="rounded-2xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Approuver
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRejectTarget(item);
                                    setRejectReason("");
                                  }}
                                  disabled={isActionSubmitting && actionRequestId === item.id}
                                  className="rounded-2xl bg-[#B91C1C] px-3 py-2 text-sm font-semibold text-white hover:bg-[#991B1B] disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Refuser
                                </button>
                              </>
                            ) : null}

                            {!item.is_deleted && item.status === "rejected" ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setReopenTarget(item);
                                  setReopenReason("");
                                }}
                                disabled={isActionSubmitting && actionRequestId === item.id}
                                className="inline-flex items-center gap-2 rounded-2xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <RotateCcw className="h-4 w-4" />
                                <span>Reouvrir</span>
                              </button>
                            ) : null}

                            {!item.is_deleted &&
                            (item.status === "pending" || item.status === "rejected") ? (
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(item)}
                                disabled={isActionSubmitting && actionRequestId === item.id}
                                className="inline-flex items-center gap-2 rounded-2xl bg-[#B91C1C] px-3 py-2 text-sm font-semibold text-white hover:bg-[#991B1B] disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <Trash2 className="h-4 w-4" />
                                <span>Supprimer</span>
                              </button>
                            ) : null}

                            {item.is_deleted ? (
                              <button
                                type="button"
                                onClick={() => void handleRestore(item)}
                                disabled={isActionSubmitting && actionRequestId === item.id}
                                className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <RotateCcw className="h-4 w-4" />
                                <span>Restaurer</span>
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <Panel
            title="Entreprises creees"
            subtitle="Dernieres structures activees apres approbation."
          >
            {overview?.recent_companies.length ? (
              <div className="space-y-3">
                {overview.recent_companies.map((company) => (
                  <div
                    key={company.id}
                    className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-semibold text-[#0F172A]">{company.name}</p>
                        <p className="mt-1 text-sm text-[#64748B]">
                          {company.sector} • {company.city}
                        </p>
                      </div>
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#1D4ED8]">
                        {formatDateTime(company.created_at)}
                      </span>
                    </div>
                    <p className="mt-3 text-sm text-[#475569]">
                      Telephone: {company.phone}
                      {company.ice ? ` • ICE: ${company.ice}` : ""}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyPanelState label="Aucune entreprise approuvee pour le moment." />
            )}
          </Panel>

          <Panel
            title="Comptes entreprise crees"
            subtitle="Comptes provisionnes automatiquement avec le role demande apres validation."
          >
            {overview?.recent_company_admins.length ? (
              <div className="space-y-3">
                {overview.recent_company_admins.map((admin) => (
                  <div
                    key={admin.id}
                    className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-semibold text-[#0F172A]">{admin.full_name}</p>
                        <p className="mt-1 text-sm text-[#64748B]">{admin.email}</p>
                      </div>
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#7C3AED]">
                        {formatDateTime(admin.created_at)}
                      </span>
                    </div>
                    <p className="mt-3 text-sm text-[#475569]">
                      {admin.company_name ?? "Entreprise non renseignee"} • {admin.role}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyPanelState label="Aucun admin entreprise cree pour le moment." />
            )}
          </Panel>
        </section>
      </div>

      <RejectRequestDialog
        isOpen={rejectTarget !== null}
        reason={rejectReason}
        isSubmitting={isActionSubmitting}
        onReasonChange={setRejectReason}
        onClose={() => {
          setRejectTarget(null);
          setRejectReason("");
        }}
        onConfirm={() => void handleReject()}
      />
      <ReopenRequestDialog
        isOpen={reopenTarget !== null}
        reason={reopenReason}
        isSubmitting={isActionSubmitting}
        onReasonChange={setReopenReason}
        onClose={() => {
          setReopenTarget(null);
          setReopenReason("");
        }}
        onConfirm={() => void handleReopen()}
      />
      <DeleteRequestDialog
        isOpen={deleteTarget !== null}
        isSubmitting={isActionSubmitting}
        companyName={deleteTarget?.company_name ?? ""}
        isPendingRequest={deleteTarget?.status === "pending"}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}

function StatCard({
  title,
  value,
  helper,
  accentClassName,
  isLoading,
  icon: Icon,
}: {
  title: string;
  value: number;
  helper: string;
  accentClassName: string;
  isLoading: boolean;
  icon: typeof Building2;
}) {
  return (
    <div className="rounded-[28px] border border-white/80 bg-white/90 p-5 shadow-[0_20px_60px_-36px_rgba(15,23,42,0.28)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-[#64748B]">{title}</p>
          <p className="mt-3 text-4xl font-semibold tracking-tight text-[#0F172A]">
            {isLoading ? "--" : value}
          </p>
        </div>
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${accentClassName} text-white`}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className={`mt-5 h-2 rounded-full bg-gradient-to-r ${accentClassName}`} />
      <p className="mt-3 text-sm text-[#64748B]">{helper}</p>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[32px] border border-white/80 bg-white/92 p-6 shadow-[0_20px_70px_-36px_rgba(15,23,42,0.28)]">
      <h2 className="text-2xl font-semibold tracking-tight text-[#0F172A]">{title}</h2>
      <p className="mt-2 text-sm leading-7 text-[#64748B]">{subtitle}</p>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function EmptyPanelState({ label }: { label: string }) {
  return (
    <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-10 text-center text-sm text-[#64748B]">
      {label}
    </div>
  );
}

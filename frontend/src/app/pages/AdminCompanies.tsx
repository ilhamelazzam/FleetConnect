import { useDeferredValue, useEffect, useState } from "react";
import {
  Building2,
  MapPin,
  Phone,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { formatDateTime } from "../components/company-registration/RegistrationUi";
import { useAuth } from "../context/AuthContext";
import {
  ApiError,
  companyRegistrationApi,
  type ApiCompanyDashboard,
  type ApiCompanyLifecycleStatus,
  type ApiCompanyListItem,
} from "../lib/api";

const companyStatusFilters: Array<{
  label: string;
  value: ApiCompanyLifecycleStatus | "all";
}> = [
  { label: "Toutes", value: "all" },
  { label: "Actives", value: "active" },
  { label: "Suspendues", value: "suspended" },
  { label: "Supprimees", value: "deleted" },
];

function formatCompanyStatusLabel(status: ApiCompanyLifecycleStatus) {
  if (status === "active") {
    return "Active";
  }
  if (status === "suspended") {
    return "Suspendue";
  }
  return "Supprimee";
}

function companyStatusBadgeClassName(status: ApiCompanyLifecycleStatus) {
  if (status === "active") {
    return "border-emerald-200 bg-emerald-50 text-[#047857]";
  }
  if (status === "suspended") {
    return "border-amber-200 bg-amber-50 text-[#B45309]";
  }
  return "border-slate-200 bg-slate-50 text-[#475569]";
}

export default function AdminCompanies() {
  const { token } = useAuth();
  const [companies, setCompanies] = useState<ApiCompanyListItem[]>([]);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [selectedStatus, setSelectedStatus] = useState<ApiCompanyLifecycleStatus | "all">("all");
  const [sortBy, setSortBy] = useState<"date" | "company" | "status">("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);
  const [selectedCompanyDashboard, setSelectedCompanyDashboard] =
    useState<ApiCompanyDashboard | null>(null);
  const [isDrawerLoading, setIsDrawerLoading] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadCompanies() {
      if (!token) {
        return;
      }

      setIsLoading(true);
      setErrorMessage("");
      try {
        const response = await companyRegistrationApi.listCompanies(token, {
          limit: 50,
          search: deferredSearch.trim(),
          status: selectedStatus === "all" ? undefined : selectedStatus,
          sort_by: sortBy,
          sort_order: sortOrder,
        });

        if (!active) {
          return;
        }

        setCompanies(response.items);
      } catch (error) {
        if (!active) {
          return;
        }

        if (error instanceof ApiError) {
          setErrorMessage(error.message);
        } else {
          setErrorMessage("Impossible de charger les entreprises validees.");
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void loadCompanies();

    return () => {
      active = false;
    };
  }, [token, deferredSearch, selectedStatus, sortBy, sortOrder]);

  useEffect(() => {
    let active = true;

    async function loadCompanyDashboard() {
      if (!token || !selectedCompanyId) {
        setSelectedCompanyDashboard(null);
        return;
      }

      setIsDrawerLoading(true);
      try {
        const dashboard = await companyRegistrationApi.companyDashboard(token, selectedCompanyId);
        if (!active) {
          return;
        }
        setSelectedCompanyDashboard(dashboard);
      } catch (error) {
        if (!active) {
          return;
        }
        setSelectedCompanyDashboard(null);
        if (error instanceof ApiError) {
          toast.error(error.message);
        } else {
          toast.error("Impossible de charger le detail de l'entreprise.");
        }
      } finally {
        if (active) {
          setIsDrawerLoading(false);
        }
      }
    }

    void loadCompanyDashboard();

    return () => {
      active = false;
    };
  }, [token, selectedCompanyId]);

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.14),transparent_28%),linear-gradient(180deg,#F8FAFC_0%,#FFFFFF_52%,#EEF6FF_100%)] p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="overflow-hidden rounded-[32px] bg-[linear-gradient(145deg,#0F172A_0%,#1E3A8A_42%,#06B6D4_100%)] p-7 text-white shadow-[0_28px_90px_-42px_rgba(15,23,42,0.72)]">
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium">
                <Building2 className="h-4 w-4" />
                <span>Catalogue entreprises</span>
              </div>
              <h1 className="mt-5 text-3xl font-semibold tracking-tight">
                Entreprises validees
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-white/80">
                Consultez les workspaces actifs, les utilisateurs provisionnes et le detail des
                tenants apres approbation par le Super Administrateur.
              </p>
            </div>

            <div className="rounded-[28px] border border-white/15 bg-white/10 p-5 backdrop-blur-sm">
              <p className="text-xs uppercase tracking-[0.22em] text-white/60">
                Vue operationnelle
              </p>
              <p className="mt-3 text-xl font-semibold">{companies.length} entreprises affichees</p>
              <p className="mt-1 text-sm text-white/75">
                Recherche, tri et detail complet via le panneau lateral.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-[32px] border border-white/80 bg-white/92 p-6 shadow-[0_20px_70px_-36px_rgba(15,23,42,0.28)] backdrop-blur-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-[#0F172A]">
                Liste des entreprises
              </h2>
              <p className="mt-2 text-sm leading-7 text-[#64748B]">
                Filtrez par statut, triez par nom ou date, puis ouvrez le detail complet.
              </p>
            </div>

            <div className="flex flex-col gap-3 lg:flex-row">
              <label className="relative min-w-[260px]">
                <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Entreprise, ville, code..."
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm text-[#0F172A] outline-none transition-colors focus:border-[#93C5FD] focus:bg-white"
                />
              </label>

              <select
                value={sortBy}
                onChange={(event) =>
                  setSortBy(event.target.value as "date" | "company" | "status")
                }
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-[#0F172A] outline-none"
              >
                <option value="date">Tri par date</option>
                <option value="company">Tri par entreprise</option>
                <option value="status">Tri par statut</option>
              </select>

              <select
                value={sortOrder}
                onChange={(event) => setSortOrder(event.target.value as "asc" | "desc")}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-[#0F172A] outline-none"
              >
                <option value="desc">Plus recentes</option>
                <option value="asc">Plus anciennes</option>
              </select>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {companyStatusFilters.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setSelectedStatus(option.value)}
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
                    <th className="px-5 py-4 font-semibold">Operateurs</th>
                    <th className="px-5 py-4 font-semibold">Utilisateurs</th>
                    <th className="px-5 py-4 font-semibold">Lignes</th>
                    <th className="px-5 py-4 font-semibold">Statut</th>
                    <th className="px-5 py-4 font-semibold">Creation</th>
                    <th className="px-5 py-4 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {isLoading ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-12 text-center text-sm text-[#64748B]">
                        Chargement des entreprises...
                      </td>
                    </tr>
                  ) : companies.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-12 text-center text-sm text-[#64748B]">
                        Aucune entreprise ne correspond aux filtres courants.
                      </td>
                    </tr>
                  ) : (
                    companies.map((company) => (
                      <tr key={company.id} className="align-top">
                        <td className="px-5 py-5">
                          <p className="font-semibold text-[#0F172A]">{company.name}</p>
                          <p className="mt-1 text-sm text-[#64748B]">
                            {company.city}
                            {company.country ? ` - ${company.country}` : ""}
                          </p>
                        </td>
                        <td className="px-5 py-5 text-sm text-[#0F172A]">
                          {company.operators.join(", ") || "-"}
                        </td>
                        <td className="px-5 py-5 text-sm text-[#0F172A]">{company.user_count}</td>
                        <td className="px-5 py-5 text-sm text-[#0F172A]">
                          {company.estimated_phone_lines}
                        </td>
                        <td className="px-5 py-5">
                          <span
                            className={`inline-flex rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] ${companyStatusBadgeClassName(company.status)}`}
                          >
                            {formatCompanyStatusLabel(company.status)}
                          </span>
                        </td>
                        <td className="px-5 py-5 text-sm text-[#475569]">
                          {formatDateTime(company.created_at)}
                        </td>
                        <td className="px-5 py-5">
                          <button
                            type="button"
                            onClick={() => setSelectedCompanyId(company.id)}
                            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-[#0F172A] hover:bg-slate-50"
                          >
                            Voir
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>

      {selectedCompanyId ? (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Fermer le detail entreprise"
            onClick={() => {
              setSelectedCompanyId(null);
              setSelectedCompanyDashboard(null);
            }}
            className="absolute inset-0 bg-slate-950/25 backdrop-blur-[2px]"
          />
          <aside className="absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto border-l border-slate-200 bg-white shadow-[0_32px_80px_-32px_rgba(15,23,42,0.4)]">
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-6 py-5 backdrop-blur">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#1D4ED8]">
                    Fiche entreprise
                  </p>
                  <h3 className="mt-2 text-2xl font-semibold tracking-tight text-[#0F172A]">
                    {selectedCompanyDashboard?.company.name ?? "Chargement..."}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCompanyId(null);
                    setSelectedCompanyDashboard(null);
                  }}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-[#475569] hover:bg-slate-50"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="space-y-6 p-6">
              {isDrawerLoading || !selectedCompanyDashboard ? (
                <div className="rounded-[28px] border border-slate-200 bg-slate-50/80 px-5 py-12 text-center text-sm text-[#64748B]">
                  Chargement du detail entreprise...
                </div>
              ) : (
                <>
                  <section className="rounded-[28px] border border-slate-200 bg-slate-50/70 p-5">
                    <div className="grid gap-4 md:grid-cols-2">
                      <InfoTile
                        icon={Building2}
                        label="Code entreprise"
                        value={selectedCompanyDashboard.company.join_code ?? "-"}
                      />
                      <InfoTile
                        icon={Phone}
                        label="Telephone"
                        value={selectedCompanyDashboard.company.phone}
                      />
                      <InfoTile
                        icon={MapPin}
                        label="Adresse"
                        value={
                          selectedCompanyDashboard.company.address_line ??
                          `${selectedCompanyDashboard.company.city}${
                            selectedCompanyDashboard.company.country
                              ? ` - ${selectedCompanyDashboard.company.country}`
                              : ""
                          }`
                        }
                      />
                      <InfoTile
                        icon={ShieldCheck}
                        label="Statut"
                        value={formatCompanyStatusLabel(selectedCompanyDashboard.company.status)}
                      />
                    </div>
                  </section>

                  <section className="grid gap-4 md:grid-cols-2">
                    <MetricTile
                      label="Utilisateurs"
                      value={selectedCompanyDashboard.metrics.total_users}
                    />
                    <MetricTile label="Admins" value={selectedCompanyDashboard.metrics.admin_users} />
                    <MetricTile
                      label="Lignes"
                      value={selectedCompanyDashboard.metrics.estimated_phone_lines}
                    />
                    <MetricTile
                      label="Operateurs"
                      value={selectedCompanyDashboard.metrics.operators_count}
                    />
                  </section>

                  <section className="rounded-[28px] border border-slate-200 bg-white p-5">
                    <h4 className="text-lg font-semibold text-[#0F172A]">Administrateurs</h4>
                    <div className="mt-4 space-y-3">
                      {selectedCompanyDashboard.admins.length ? (
                        selectedCompanyDashboard.admins.map((admin) => (
                          <div
                            key={admin.id}
                            className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4"
                          >
                            <p className="font-semibold text-[#0F172A]">{admin.full_name}</p>
                            <p className="mt-1 text-sm text-[#64748B]">{admin.email}</p>
                            <p className="mt-2 text-sm text-[#475569]">
                              {admin.role} - {formatDateTime(admin.created_at)}
                            </p>
                          </div>
                        ))
                      ) : (
                        <EmptyBlock label="Aucun administrateur n'est rattache a cette entreprise." />
                      )}
                    </div>
                  </section>

                  <section className="rounded-[28px] border border-slate-200 bg-white p-5">
                    <h4 className="text-lg font-semibold text-[#0F172A]">Historique</h4>
                    <div className="mt-4 space-y-3">
                      {selectedCompanyDashboard.history.length ? (
                        selectedCompanyDashboard.history.map((entry) => (
                          <div
                            key={entry.id}
                            className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4"
                          >
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <p className="font-semibold text-[#0F172A]">{entry.title}</p>
                                <p className="mt-1 text-sm text-[#64748B]">
                                  {entry.actor_user_name ?? "Systeme"} - {entry.action}
                                </p>
                                {entry.comment ? (
                                  <p className="mt-3 text-sm leading-6 text-[#475569]">
                                    {entry.comment}
                                  </p>
                                ) : null}
                              </div>
                              <span className="text-xs text-[#64748B]">
                                {formatDateTime(entry.created_at)}
                              </span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <EmptyBlock label="Aucun historique n'est disponible." />
                      )}
                    </div>
                  </section>
                </>
              )}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function InfoTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Building2;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-3 text-sm text-[#64748B]">
        <Icon className="h-4 w-4" />
        <span>{label}</span>
      </div>
      <p className="mt-3 text-sm font-semibold text-[#0F172A]">{value}</p>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[28px] border border-white/80 bg-white/92 p-5 shadow-[0_20px_60px_-36px_rgba(15,23,42,0.28)]">
      <p className="text-sm font-medium text-[#64748B]">{label}</p>
      <p className="mt-3 text-4xl font-semibold tracking-tight text-[#0F172A]">{value}</p>
    </div>
  );
}

function EmptyBlock({ label }: { label: string }) {
  return (
    <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-10 text-center text-sm text-[#64748B]">
      {label}
    </div>
  );
}

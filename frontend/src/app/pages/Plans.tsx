import { Eye, Pencil, Plus, RefreshCw, Trash2, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";

import PlanFormModal, { type PlanFormData } from "../components/PlanFormModal";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { useAuth } from "../context/AuthContext";
import {
  ApiError,
  plansApi,
  type ApiPlan,
  type CreatePlanPayload,
  type UpdatePlanPayload,
} from "../lib/api";

function normalizeError(error: unknown, fallbackMessage: string): string {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return fallbackMessage;
}

function formatCreatedAt(value: string): string {
  return new Date(value).toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatPrice(value: number): string {
  return `${value} MAD`;
}

function getOperatorBadgeClass(operatorName: string): string {
  if (operatorName === "Orange Maroc") {
    return "bg-blue-50 text-[#2D6CDF]";
  }
  if (operatorName === "Maroc Telecom") {
    return "bg-red-50 text-[#DC2626]";
  }
  return "bg-emerald-50 text-[#059669]";
}

function toPlanFormData(plan: ApiPlan): PlanFormData {
  return {
    name: plan.name,
    operator_name: plan.operator_name,
    monthly_price: plan.monthly_price,
    voice_quota: plan.voice_quota,
    data_quota: plan.data_quota,
    sms_quota: plan.sms_quota,
    roaming_zone: plan.roaming_zone,
    active_lines: plan.active_lines,
    description: plan.description ?? "",
  };
}

function buildCreatePayload(data: PlanFormData): CreatePlanPayload {
  return {
    name: data.name.trim(),
    operator_name: data.operator_name.trim(),
    monthly_price: data.monthly_price,
    voice_quota: data.voice_quota.trim(),
    data_quota: data.data_quota.trim(),
    sms_quota: data.sms_quota.trim(),
    roaming_zone: data.roaming_zone.trim(),
    active_lines: data.active_lines,
    description: data.description.trim() || null,
  };
}

function buildUpdatePayload(plan: ApiPlan, data: PlanFormData): UpdatePlanPayload {
  const payload: UpdatePlanPayload = {};
  const nextDescription = data.description.trim() || null;

  if (data.name.trim() !== plan.name) {
    payload.name = data.name.trim();
  }
  if (data.operator_name.trim() !== plan.operator_name) {
    payload.operator_name = data.operator_name.trim();
  }
  if (data.monthly_price !== plan.monthly_price) {
    payload.monthly_price = data.monthly_price;
  }
  if (data.voice_quota.trim() !== plan.voice_quota) {
    payload.voice_quota = data.voice_quota.trim();
  }
  if (data.data_quota.trim() !== plan.data_quota) {
    payload.data_quota = data.data_quota.trim();
  }
  if (data.sms_quota.trim() !== plan.sms_quota) {
    payload.sms_quota = data.sms_quota.trim();
  }
  if (data.roaming_zone.trim() !== plan.roaming_zone) {
    payload.roaming_zone = data.roaming_zone.trim();
  }
  if (data.active_lines !== plan.active_lines) {
    payload.active_lines = data.active_lines;
  }
  if (nextDescription !== (plan.description ?? null)) {
    payload.description = nextDescription;
  }

  return payload;
}

function getRecommendationReason(plan: ApiPlan): string {
  if (plan.monthly_price <= 150) {
    return "Recommande pour les profils standards et les budgets maitrises.";
  }
  if (plan.data_quota.toLowerCase().includes("100")) {
    return "Recommande pour les gros consommateurs et les equipes en mobilite.";
  }
  return "Bon compromis entre prix, data et couverture roaming.";
}

export default function Plans() {
  const { token, user } = useAuth();
  const isAdmin = user?.role.trim().toLowerCase() === "admin";
  const [plans, setPlans] = useState<ApiPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editingPlan, setEditingPlan] = useState<ApiPlan | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [detailPlan, setDetailPlan] = useState<ApiPlan | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);

  async function loadPlans(): Promise<void> {
    if (!token) {
      setPlans([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const apiPlans = await plansApi.list(token);
      setPlans(apiPlans);
    } catch (error) {
      setErrorMessage(normalizeError(error, "Impossible de charger les forfaits."));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadPlans();
  }, [token]);

  async function handleRefresh(): Promise<void> {
    setIsRefreshing(true);

    try {
      await loadPlans();
    } finally {
      setIsRefreshing(false);
    }
  }

  function closeFormModal(): void {
    setIsFormOpen(false);
    setEditingPlan(null);
    setFormError(null);
    setIsSubmitting(false);
  }

  function openCreateModal(): void {
    setFormMode("create");
    setEditingPlan(null);
    setFormError(null);
    setIsFormOpen(true);
  }

  function openEditModal(plan: ApiPlan): void {
    setFormMode("edit");
    setEditingPlan(plan);
    setFormError(null);
    setIsFormOpen(true);
  }

  function closeDetailModal(): void {
    setDetailPlan(null);
    setDetailError(null);
    setIsDetailLoading(false);
  }

  async function handleSubmitPlan(data: PlanFormData): Promise<void> {
    if (!token) {
      setFormError("Session expiree. Reconnectez-vous.");
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      if (formMode === "create") {
        const createdPlan = await plansApi.create(token, buildCreatePayload(data));
        setPlans((previousPlans) => [createdPlan, ...previousPlans]);
      } else if (editingPlan) {
        const payload = buildUpdatePayload(editingPlan, data);

        if (Object.keys(payload).length > 0) {
          const updatedPlan = await plansApi.update(token, editingPlan.id, payload);
          setPlans((previousPlans) =>
            previousPlans.map((plan) => (plan.id === updatedPlan.id ? updatedPlan : plan)),
          );
          setDetailPlan((currentPlan) => (currentPlan?.id === updatedPlan.id ? updatedPlan : currentPlan));
        }
      }

      closeFormModal();
    } catch (error) {
      setFormError(normalizeError(error, "Impossible d'enregistrer ce forfait."));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function openDetailModal(planId: number): Promise<void> {
    if (!token) {
      setDetailError("Session expiree. Reconnectez-vous.");
      return;
    }

    setDetailPlan(null);
    setDetailError(null);
    setIsDetailLoading(true);

    try {
      const fetchedPlan = await plansApi.get(token, planId);
      setDetailPlan(fetchedPlan);
    } catch (error) {
      setDetailError(normalizeError(error, "Impossible de charger ce forfait."));
    } finally {
      setIsDetailLoading(false);
    }
  }

  async function handleDeletePlan(plan: ApiPlan): Promise<void> {
    if (!token) {
      setErrorMessage("Session expiree. Reconnectez-vous.");
      return;
    }

    const confirmed = window.confirm(`Supprimer le forfait ${plan.name} ?`);
    if (!confirmed) {
      return;
    }

    try {
      await plansApi.remove(token, plan.id);
      setPlans((previousPlans) => previousPlans.filter((currentPlan) => currentPlan.id !== plan.id));
      closeDetailModal();
    } catch (error) {
      setErrorMessage(normalizeError(error, "Suppression impossible pour le moment."));
    }
  }

  const recommendations = [...plans]
    .sort((leftPlan, rightPlan) => rightPlan.active_lines - leftPlan.active_lines)
    .slice(0, 3);

  return (
    <>
      <div className="p-6 space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="mb-2 text-2xl font-bold text-[#0F172A]">Gestion des forfaits</h1>
            <p className="text-[#64748B]">Gerez et comparez les forfaits disponibles</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={isLoading || isRefreshing}
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 font-medium text-[#0F172A] transition-colors hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
              <span>{isRefreshing ? "Rafraichissement..." : "Rafraichir"}</span>
            </button>
            {isAdmin ? (
              <button
                type="button"
                onClick={openCreateModal}
                className="flex items-center gap-2 rounded-lg bg-[#2D6CDF] px-4 py-2 font-medium text-white shadow-lg shadow-blue-500/30 transition-colors hover:bg-[#1d4ed8]"
              >
                <Plus className="h-5 w-5" />
                <span>Ajouter un forfait</span>
              </button>
            ) : null}
          </div>
        </div>

        {!isAdmin ? (
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            Consultation en lecture seule. La creation et la modification des forfaits sont reservees a l'administrateur.
          </div>
        ) : null}

        {errorMessage ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {errorMessage}
          </div>
        ) : null}

        {isLoading ? (
          <div className="rounded-xl border border-gray-200 bg-white px-6 py-14 text-center">
            <p className="text-sm text-[#64748B]">Chargement des forfaits...</p>
          </div>
        ) : plans.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white px-6 py-14 text-center">
            <p className="text-sm text-[#64748B]">Aucun forfait disponible pour le moment.</p>
            {isAdmin ? (
              <button
                type="button"
                onClick={openCreateModal}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#2D6CDF] px-4 py-2 font-medium text-white transition-colors hover:bg-[#1d4ed8]"
              >
                <Plus className="h-4 w-4" />
                <span>Ajouter votre premier forfait</span>
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
              {plans.map((plan) => (
                <div
                  key={plan.id}
                  className="rounded-xl border-2 border-gray-200 bg-white p-6 transition-colors hover:border-[#2D6CDF]"
                >
                  <div className="mb-4 flex items-start justify-between gap-4">
                    <div>
                      <h3 className="mb-2 text-lg font-bold text-[#0F172A]">{plan.name}</h3>
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${getOperatorBadgeClass(plan.operator_name)}`}
                      >
                        {plan.operator_name}
                      </span>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-[#2D6CDF]">{formatPrice(plan.monthly_price)}</p>
                      <p className="text-xs text-[#64748B]">/mois</p>
                    </div>
                  </div>

                  <div className="mb-4 space-y-3">
                    <div className="flex items-center justify-between border-b border-gray-100 py-2">
                      <span className="text-sm text-[#64748B]">Voix</span>
                      <span className="text-sm font-medium text-[#0F172A]">{plan.voice_quota}</span>
                    </div>
                    <div className="flex items-center justify-between border-b border-gray-100 py-2">
                      <span className="text-sm text-[#64748B]">Data</span>
                      <span className="text-sm font-medium text-[#0F172A]">{plan.data_quota}</span>
                    </div>
                    <div className="flex items-center justify-between border-b border-gray-100 py-2">
                      <span className="text-sm text-[#64748B]">SMS</span>
                      <span className="text-sm font-medium text-[#0F172A]">{plan.sms_quota}</span>
                    </div>
                    <div className="flex items-center justify-between border-b border-gray-100 py-2">
                      <span className="text-sm text-[#64748B]">Roaming</span>
                      <span className="text-sm font-medium text-[#0F172A]">{plan.roaming_zone}</span>
                    </div>
                  </div>

                  <div className="mb-4 rounded-lg bg-[#F8FAFC] p-3">
                    <p className="mb-1 text-xs text-[#64748B]">Lignes actives</p>
                    <p className="text-lg font-bold text-[#0F172A]">{plan.active_lines}</p>
                  </div>

                  <div className="flex gap-2">
                    {isAdmin ? (
                      <button
                        type="button"
                        onClick={() => openEditModal(plan)}
                        className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#2D6CDF] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1d4ed8]"
                      >
                        <Pencil className="h-4 w-4" />
                        <span>Modifier</span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void openDetailModal(plan.id)}
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-[#64748B] transition-colors hover:bg-[#F8FAFC]"
                    >
                      <Eye className="h-4 w-4" />
                      <span>Details</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-xl bg-gradient-to-br from-[#7C3AED] to-[#2D6CDF] p-6 text-white shadow-2xl">
              <div className="mb-4 flex items-center gap-2">
                <TrendingUp className="h-6 w-6" />
                <h2 className="text-xl font-bold">Forfaits recommandes par IA</h2>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {recommendations.map((plan) => (
                  <div
                    key={plan.id}
                    className="rounded-lg border border-white/20 bg-white/10 p-4 backdrop-blur-sm"
                  >
                    <h3 className="mb-2 font-bold">{plan.name}</h3>
                    <p className="mb-3 text-sm text-white/90">{getRecommendationReason(plan)}</p>
                    <div className="flex items-end justify-between gap-4">
                      <div>
                        <p className="text-xs text-white/70">Lignes concernees</p>
                        <p className="text-lg font-bold">{plan.active_lines}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-white/70">Prix mensuel</p>
                        <p className="text-lg font-bold text-[#BAF7D0]">{formatPrice(plan.monthly_price)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-6">
              <h2 className="mb-4 text-xl font-bold text-[#0F172A]">Comparateur de forfaits</h2>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-gray-200 bg-[#F8FAFC]">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-[#0F172A]">Forfait</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-[#0F172A]">Operateur</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-[#0F172A]">Prix</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-[#0F172A]">Data</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-[#0F172A]">Voix</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-[#0F172A]">SMS</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-[#0F172A]">Roaming</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-[#0F172A]">Lignes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {plans.map((plan) => (
                      <tr key={plan.id} className="transition-colors hover:bg-[#F8FAFC]">
                        <td className="px-4 py-3 font-medium text-[#0F172A]">{plan.name}</td>
                        <td className="px-4 py-3 text-sm text-[#64748B]">{plan.operator_name}</td>
                        <td className="px-4 py-3 font-semibold text-[#2D6CDF]">{formatPrice(plan.monthly_price)}</td>
                        <td className="px-4 py-3 text-sm text-[#0F172A]">{plan.data_quota}</td>
                        <td className="px-4 py-3 text-sm text-[#0F172A]">{plan.voice_quota}</td>
                        <td className="px-4 py-3 text-sm text-[#0F172A]">{plan.sms_quota}</td>
                        <td className="px-4 py-3 text-sm text-[#0F172A]">{plan.roaming_zone}</td>
                        <td className="px-4 py-3 text-sm font-medium text-[#0F172A]">{plan.active_lines}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      <PlanFormModal
        open={isFormOpen}
        mode={formMode}
        initialData={editingPlan ? toPlanFormData(editingPlan) : null}
        isSubmitting={isSubmitting}
        errorMessage={formError}
        onClose={closeFormModal}
        onSubmit={handleSubmitPlan}
      />

      <Dialog
        open={isDetailLoading || detailPlan !== null || detailError !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            closeDetailModal();
          }
        }}
      >
        <DialogContent className="max-w-2xl border border-gray-200 bg-white">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-[#0F172A]">Details du forfait</DialogTitle>
            <DialogDescription className="text-sm text-[#64748B]">
              Informations detaillees synchronisees depuis le backend.
            </DialogDescription>
          </DialogHeader>

          {isDetailLoading ? (
            <p className="text-sm text-[#64748B]">Chargement du forfait...</p>
          ) : detailError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              {detailError}
            </div>
          ) : detailPlan ? (
            <>
              <div className="space-y-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-xl font-bold text-[#0F172A]">{detailPlan.name}</h3>
                    <p className="mt-2 text-sm text-[#64748B]">ID #{detailPlan.id}</p>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-2xl font-bold text-[#2D6CDF]">{formatPrice(detailPlan.monthly_price)}</p>
                    <p className="text-sm text-[#64748B]">/mois</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Operateur</p>
                    <p className="mt-2 text-sm text-[#0F172A]">{detailPlan.operator_name}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Lignes actives</p>
                    <p className="mt-2 text-sm text-[#0F172A]">{detailPlan.active_lines}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Voix</p>
                    <p className="mt-2 text-sm text-[#0F172A]">{detailPlan.voice_quota}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Data</p>
                    <p className="mt-2 text-sm text-[#0F172A]">{detailPlan.data_quota}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">SMS</p>
                    <p className="mt-2 text-sm text-[#0F172A]">{detailPlan.sms_quota}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Roaming</p>
                    <p className="mt-2 text-sm text-[#0F172A]">{detailPlan.roaming_zone}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Cree le</p>
                    <p className="mt-2 text-sm text-[#0F172A]">{formatCreatedAt(detailPlan.created_at)}</p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Mis a jour le</p>
                    <p className="mt-2 text-sm text-[#0F172A]">{formatCreatedAt(detailPlan.updated_at)}</p>
                  </div>
                </div>

                <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Description</p>
                  <p className="mt-2 text-sm leading-6 text-[#0F172A]">
                    {detailPlan.description || "Aucune description fournie pour ce forfait."}
                  </p>
                </div>
              </div>

              <DialogFooter className="mt-6 gap-3">
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={() => {
                      closeDetailModal();
                      openEditModal(detailPlan);
                    }}
                    className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 font-medium text-[#2D6CDF] transition-colors hover:bg-blue-100"
                  >
                    <Pencil className="h-4 w-4" />
                    <span>Modifier</span>
                  </button>
                ) : null}
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={() => void handleDeletePlan(detailPlan)}
                    className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 font-medium text-[#DC2626] transition-colors hover:bg-red-100"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span>Supprimer</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={closeDetailModal}
                  className="rounded-lg border border-gray-200 px-4 py-2.5 font-medium text-[#64748B] transition-colors hover:bg-[#F8FAFC]"
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

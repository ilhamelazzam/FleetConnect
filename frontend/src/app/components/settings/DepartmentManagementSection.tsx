import { useMemo, useState } from "react";
import {
  Building2,
  PencilLine,
  Plus,
  Power,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "../ui/badge";
import { useDepartments } from "../../context/DepartmentsContext";

interface DepartmentManagementSectionProps {
  panelClassName: string;
  fieldClassName: string;
  compact?: boolean;
}

interface DepartmentFormState {
  name: string;
  code: string;
  description: string;
  is_active: boolean;
}

const initialDepartmentForm: DepartmentFormState = {
  name: "",
  code: "",
  description: "",
  is_active: true,
};

function normalizeDepartmentCodeInput(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .toUpperCase()
    .slice(0, 24);
}

function normalizeDepartmentNameInput(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function formatDepartmentDate(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error) {
    return error.message;
  }
  return fallbackMessage;
}

export default function DepartmentManagementSection({
  panelClassName,
  fieldClassName,
  compact = false,
}: DepartmentManagementSectionProps) {
  const {
    allDepartments,
    errorMessage,
    isLoading,
    isSaving,
    createDepartment,
    updateDepartment,
    removeDepartment,
  } = useDepartments();
  const [formState, setFormState] = useState<DepartmentFormState>(initialDepartmentForm);
  const [editingDepartmentId, setEditingDepartmentId] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const activeCount = useMemo(
    () => allDepartments.filter((department) => department.is_active).length,
    [allDepartments],
  );
  const inactiveCount = allDepartments.length - activeCount;

  function resetForm() {
    setEditingDepartmentId(null);
    setFormState(initialDepartmentForm);
    setFormError(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = normalizeDepartmentNameInput(formState.name);
    const normalizedCode = normalizeDepartmentCodeInput(formState.code);

    if (normalizedName.length < 2) {
      setFormError("Le nom du departement doit contenir au moins 2 caracteres.");
      return;
    }

    if (normalizedCode.length < 2) {
      setFormError("Le code du departement doit contenir au moins 2 caracteres.");
      return;
    }

    const duplicateName = allDepartments.some(
      (department) =>
        department.id !== editingDepartmentId &&
        department.name.trim().toLowerCase() === normalizedName.toLowerCase(),
    );
    if (duplicateName) {
      setFormError("Un departement avec ce nom existe deja.");
      return;
    }

    const duplicateCode = allDepartments.some(
      (department) =>
        department.id !== editingDepartmentId &&
        department.code.trim().toLowerCase() === normalizedCode.toLowerCase(),
    );
    if (duplicateCode) {
      setFormError("Un departement avec ce code existe deja.");
      return;
    }

    setFormError(null);

    try {
      if (editingDepartmentId === null) {
        await createDepartment({
          name: normalizedName,
          code: normalizedCode,
          description: formState.description.trim() || null,
          is_active: formState.is_active,
        });
        toast.success("Departement ajoute", {
          description: `${normalizedName} est maintenant disponible dans les formulaires.`,
        });
      } else {
        await updateDepartment(editingDepartmentId, {
          name: normalizedName,
          code: normalizedCode,
          description: formState.description.trim() || null,
          is_active: formState.is_active,
        });
        toast.success("Departement mis a jour", {
          description: `${normalizedName} a ete actualise dans toute l'application.`,
        });
      }
      resetForm();
    } catch (error) {
      setFormError(getErrorMessage(error, "Enregistrement impossible."));
    }
  }

  function handleEdit(departmentId: number) {
    const department = allDepartments.find((item) => item.id === departmentId);
    if (!department) {
      return;
    }

    setEditingDepartmentId(department.id);
    setFormError(null);
    setFormState({
      name: department.name,
      code: department.code,
      description: department.description ?? "",
      is_active: department.is_active,
    });
  }

  async function handleToggleStatus(departmentId: number) {
    const department = allDepartments.find((item) => item.id === departmentId);
    if (!department) {
      return;
    }

    try {
      await updateDepartment(department.id, { is_active: !department.is_active });
      toast.success(
        department.is_active ? "Departement desactive" : "Departement reactive",
        {
          description: department.is_active
            ? `${department.name} ne sera plus propose dans les listes actives.`
            : `${department.name} est de nouveau disponible dans les formulaires.`,
        },
      );
      if (editingDepartmentId === department.id) {
        setFormState((current) => ({ ...current, is_active: !department.is_active }));
      }
    } catch (error) {
      toast.error("Statut non mis a jour", {
        description: getErrorMessage(error, "Impossible de modifier le statut du departement."),
      });
    }
  }

  async function handleDelete(departmentId: number) {
    const department = allDepartments.find((item) => item.id === departmentId);
    if (!department) {
      return;
    }

    const isConfirmed = window.confirm(
      `Supprimer definitivement le departement ${department.name} ?`,
    );
    if (!isConfirmed) {
      return;
    }

    try {
      await removeDepartment(department.id);
      toast.success("Departement supprime", {
        description: `${department.name} a ete retire de la configuration.`,
      });
      if (editingDepartmentId === department.id) {
        resetForm();
      }
    } catch (error) {
      toast.error("Suppression impossible", {
        description: getErrorMessage(
          error,
          "Desactivez ce departement s'il est encore utilise dans la plateforme.",
        ),
      });
    }
  }

  return (
    <section className={panelClassName}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-4">
          <div className="bc-icon-primary flex h-11 w-11 items-center justify-center rounded-2xl">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-[#0F172A] dark:text-white">
              Gestion des departements
            </h2>
            <p className="mt-1 text-sm text-[#64748B] dark:text-slate-400">
              Creez, ajustez et diffusez les departements metier vers tous les formulaires
              relies a la source centrale.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge className="border-[var(--bc-primary-border)] bg-[var(--bc-primary-soft)] text-[var(--bc-primary)]">
            {allDepartments.length} departement(s)
          </Badge>
          <Badge className="border-[var(--bc-success-border)] bg-[var(--bc-success-soft)] text-[var(--bc-success)]">
            {activeCount} actif(s)
          </Badge>
          <Badge className="border-slate-200 bg-slate-100 text-[#475569]">
            {inactiveCount} inactif(s)
          </Badge>
        </div>
      </div>

      <div className={`mt-5 grid gap-5 ${compact ? "xl:grid-cols-[320px_minmax(0,1fr)]" : "xl:grid-cols-[360px_minmax(0,1fr)]"}`}>
        <div className="bc-surface-primary rounded-[22px] border p-4 dark:bg-white/5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[#0F172A] dark:text-white">
                {editingDepartmentId === null ? "Nouveau departement" : "Modifier le departement"}
              </p>
              <p className="mt-1 text-sm text-[#64748B] dark:text-slate-400">
                Nom, code, description et statut de diffusion.
              </p>
            </div>
            {editingDepartmentId !== null ? (
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-[#334155] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
              >
                <RotateCcw className="h-4 w-4" />
                Annuler
              </button>
            ) : null}
          </div>

          <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
            <div>
              <label className="mb-2 block text-sm font-medium text-[#0F172A] dark:text-white">
                Nom du departement
              </label>
              <input
                type="text"
                value={formState.name}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Ex. Operations terrain"
                className={fieldClassName}
                disabled={isSaving}
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#0F172A] dark:text-white">
                Code du departement
              </label>
              <input
                type="text"
                value={formState.code}
                onChange={(event) =>
                  setFormState((current) => ({
                    ...current,
                    code: normalizeDepartmentCodeInput(event.target.value),
                  }))
                }
                placeholder="Ex. OPS"
                className={fieldClassName}
                disabled={isSaving}
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#0F172A] dark:text-white">
                Description
              </label>
              <textarea
                value={formState.description}
                onChange={(event) =>
                  setFormState((current) => ({ ...current, description: event.target.value }))
                }
                placeholder="Perimetre metier, equipes concernees, usage principal."
                className={`${fieldClassName} ${compact ? "min-h-[96px]" : "min-h-[120px]"} resize-none`}
                disabled={isSaving}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#0F172A] dark:text-white">
                Statut
              </label>
              <select
                value={formState.is_active ? "active" : "inactive"}
                onChange={(event) =>
                  setFormState((current) => ({
                    ...current,
                    is_active: event.target.value === "active",
                  }))
                }
                className={fieldClassName}
                disabled={isSaving}
              >
                <option value="active">Actif</option>
                <option value="inactive">Inactif</option>
              </select>
            </div>

            {formError ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-[#DC2626]">
                {formError}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#1D4ED8,#2563EB)] px-4 py-3 text-sm font-semibold text-white shadow-[0_18px_40px_-22px_rgba(29,78,216,0.9)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_22px_46px_-22px_rgba(29,78,216,0.95)] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {editingDepartmentId === null ? (
                <Plus className="h-4 w-4" />
              ) : (
                <PencilLine className="h-4 w-4" />
              )}
              <span>
                {isSaving
                  ? "Enregistrement..."
                  : editingDepartmentId === null
                    ? "Ajouter le departement"
                    : "Enregistrer les modifications"}
              </span>
            </button>
          </form>
        </div>

        <div className="rounded-[22px] border border-slate-200/80 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold text-[#0F172A] dark:text-white">
                Referentiel central
              </p>
              <p className="mt-1 text-sm text-[#64748B] dark:text-slate-400">
                Les departements actifs alimentent directement les listes de selection partagees.
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--bc-success-border)] bg-[var(--bc-success-soft)] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--bc-success)]">
              <ShieldCheck className="h-3.5 w-3.5" />
              Source centrale
            </div>
          </div>

          {errorMessage ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-[#DC2626]">
              {errorMessage}
            </div>
          ) : null}

          {isLoading && allDepartments.length === 0 ? (
            <div className="mt-5 grid gap-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className="h-20 animate-pulse rounded-[22px] border border-slate-200/70 bg-slate-100/80"
                />
              ))}
            </div>
          ) : allDepartments.length === 0 ? (
            <div className="mt-5 rounded-[24px] border border-dashed border-slate-300 bg-slate-50/80 px-6 py-10 text-center">
              <p className="text-base font-semibold text-[#0F172A]">Aucun departement configure</p>
              <p className="mt-2 text-sm leading-6 text-[#64748B]">
                Creez un premier departement pour le rendre disponible dans les formulaires et les
                attributions.
              </p>
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-y-3">
                <thead>
                  <tr>
                    <th className="px-4 text-left text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">
                      Departement
                    </th>
                    <th className="px-4 text-left text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">
                      Code
                    </th>
                    <th className="px-4 text-left text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">
                      Description
                    </th>
                    <th className="px-4 text-left text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">
                      Statut
                    </th>
                    <th className="px-4 text-left text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">
                      Mise a jour
                    </th>
                    <th className="px-4 text-right text-xs font-semibold uppercase tracking-[0.16em] text-[#64748B]">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {allDepartments.map((department) => (
                    <tr
                      key={department.id}
                      className={`rounded-[22px] border border-slate-200/80 bg-slate-50/70 shadow-sm ${
                        department.is_active ? "" : "opacity-80"
                      }`}
                    >
                      <td className="rounded-l-[22px] px-4 py-4 align-top">
                        <p className="font-semibold text-[#0F172A] dark:text-white">
                          {department.name}
                        </p>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold tracking-[0.14em] text-[#334155]">
                          {department.code}
                        </span>
                      </td>
                      <td className="px-4 py-4 align-top text-sm leading-6 text-[#64748B]">
                        {department.description || "Description non renseignee."}
                      </td>
                      <td className="px-4 py-4 align-top">
                        <Badge
                          className={
                            department.is_active
                              ? "border-[var(--bc-success-border)] bg-[var(--bc-success-soft)] text-[var(--bc-success)]"
                              : "border-slate-200 bg-slate-100 text-[#475569]"
                          }
                        >
                          {department.is_active ? "Actif" : "Inactif"}
                        </Badge>
                      </td>
                      <td className="px-4 py-4 align-top text-sm text-[#475569]">
                        {formatDepartmentDate(department.updated_at)}
                      </td>
                      <td className="rounded-r-[22px] px-4 py-4 align-top">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleEdit(department.id)}
                            disabled={isSaving}
                            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-[#334155] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-70"
                          >
                            <PencilLine className="h-4 w-4" />
                            Modifier
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleToggleStatus(department.id)}
                            disabled={isSaving}
                            className="inline-flex items-center gap-2 rounded-2xl border border-[var(--bc-warning-border)] bg-[var(--bc-warning-soft)] px-3 py-2 text-sm font-medium text-[var(--bc-warning)] transition-all duration-300 hover:-translate-y-0.5 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
                          >
                            {department.is_active ? (
                              <Power className="h-4 w-4" />
                            ) : (
                              <RotateCcw className="h-4 w-4" />
                            )}
                            {department.is_active ? "Desactiver" : "Reactiver"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(department.id)}
                            disabled={isSaving}
                            className="inline-flex items-center gap-2 rounded-2xl border border-[var(--bc-danger-border)] bg-[var(--bc-danger-soft)] px-3 py-2 text-sm font-medium text-[var(--bc-danger)] transition-all duration-300 hover:-translate-y-0.5 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
                          >
                            <Trash2 className="h-4 w-4" />
                            Supprimer
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 rounded-2xl border border-[var(--bc-primary-border)] bg-[var(--bc-primary-soft)] px-4 py-3 text-sm text-[var(--bc-primary)]">
            La suppression definitive est reservee aux departements non relies a des utilisateurs
            ou a des ressources. Sinon, desactivez-les pour les retirer des listes actives.
          </div>
        </div>
      </div>
    </section>
  );
}

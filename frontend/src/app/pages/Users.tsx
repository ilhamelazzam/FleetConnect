import { useEffect, useState } from "react";
import {
  Building2,
  Eye,
  Loader2,
  Mail,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  Trash2,
  UserCog,
  UserPlus,
  Users2,
} from "lucide-react";
import { toast } from "sonner";

import KPICard from "../components/KPICard";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Badge } from "../components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { useAuth } from "../context/AuthContext";
import { useDepartments } from "../context/DepartmentsContext";
import {
  ApiError,
  formatRoleLabel,
  getUserAvatarUrl,
  type ApiUser,
  type ApiUserRole,
  type ApiUserStatus,
  type CreateUserPayload,
  type UpdateUserPayload,
  usersApi,
} from "../lib/api";
import { isAdminUser } from "../lib/roles";

const USER_BATCH_SIZE = 100;

type RoleFilter = "all" | ApiUserRole;
type StatusFilter = "all" | ApiUserStatus;

interface UserFormState {
  full_name: string;
  email: string;
  department_id: string;
  role: ApiUserRole;
  status: ApiUserStatus;
  password: string;
}

interface PendingRoleConfirmation {
  source: "form" | "quick";
  userId: number;
  userName: string;
  currentRole: ApiUserRole;
  nextRole: ApiUserRole;
  payload?: UpdateUserPayload;
}

interface PendingStatusAction {
  user: ApiUser;
  nextStatus: ApiUserStatus;
}

function generateTemporaryPassword(): string {
  const randomBlock = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `Fleet${randomBlock}!9`;
}

function createInitialFormState(): UserFormState {
  return {
    full_name: "",
    email: "",
    department_id: "",
    role: "user",
    status: "active",
    password: generateTemporaryPassword(),
  };
}

function normalizeError(error: unknown, fallbackMessage: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallbackMessage;
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "Jamais";
  }

  try {
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function getRoleBadgeClass(role: ApiUserRole): string {
  if (role === "admin") return "border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]";
  if (role === "manager") return "border-[#C7D2FE] bg-[#EEF2FF] text-[#4F46E5]";
  if (role === "analyst") return "border-[#BAE6FD] bg-[#F0F9FF] text-[#0369A1]";
  return "border-[#D1FAE5] bg-[#ECFDF5] text-[#047857]";
}

function getStatusBadgeClass(status: ApiUserStatus): string {
  if (status === "active") return "border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]";
  return "border-[#FECACA] bg-[#FEF2F2] text-[#DC2626]";
}

function getStatusLabel(status: ApiUserStatus): string {
  return status === "active" ? "Actif" : "Suspendu";
}

export default function Users() {
  const { token, user } = useAuth();
  const { allDepartments, departments, isLoading: isDepartmentsLoading } = useDepartments();
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<RoleFilter>("all");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<StatusFilter>("all");
  const [selectedDepartmentFilter, setSelectedDepartmentFilter] = useState("all");
  const [reloadKey, setReloadKey] = useState(0);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<ApiUser | null>(null);
  const [selectedUser, setSelectedUser] = useState<ApiUser | null>(null);
  const [roleTargetUser, setRoleTargetUser] = useState<ApiUser | null>(null);
  const [roleDraft, setRoleDraft] = useState<ApiUserRole>("user");
  const [pendingRoleConfirmation, setPendingRoleConfirmation] =
    useState<PendingRoleConfirmation | null>(null);
  const [pendingStatusAction, setPendingStatusAction] = useState<PendingStatusAction | null>(null);
  const [deleteTargetUser, setDeleteTargetUser] = useState<ApiUser | null>(null);
  const [formState, setFormState] = useState<UserFormState>(createInitialFormState);

  const availableDepartments = allDepartments.length > 0 ? allDepartments : departments;
  const trimmedSearch = searchQuery.trim();

  useEffect(() => {
    let isMounted = true;

    async function loadUsers() {
      if (!token || !isAdminUser(user)) {
        if (isMounted) {
          setUsers([]);
          setIsLoading(false);
          setIsRefreshing(false);
        }
        return;
      }

      setIsLoading(true);
      setErrorMessage(null);

      try {
        const aggregatedUsers: ApiUser[] = [];
        let offset = 0;

        while (true) {
          const batch = await usersApi.list(token, {
            offset,
            limit: USER_BATCH_SIZE,
            search: trimmedSearch || undefined,
            role: selectedRoleFilter !== "all" ? selectedRoleFilter : undefined,
            status: selectedStatusFilter !== "all" ? selectedStatusFilter : undefined,
            department_id:
              selectedDepartmentFilter !== "all"
                ? Number(selectedDepartmentFilter)
                : undefined,
          });

          aggregatedUsers.push(...batch);

          if (batch.length < USER_BATCH_SIZE) {
            break;
          }

          offset += USER_BATCH_SIZE;
        }

        if (isMounted) {
          setUsers(aggregatedUsers);
        }
      } catch (error) {
        if (isMounted) {
          setUsers([]);
          setErrorMessage(
            normalizeError(error, "Impossible de charger la gestion des utilisateurs."),
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    }

    void loadUsers();

    return () => {
      isMounted = false;
    };
  }, [
    token,
    user,
    trimmedSearch,
    selectedRoleFilter,
    selectedStatusFilter,
    selectedDepartmentFilter,
    reloadKey,
  ]);

  if (!isAdminUser(user)) {
    return (
      <div className="p-6">
        <div className="rounded-[28px] border border-red-200 bg-red-50 p-6 text-[#B91C1C]">
          Acces refuse. Cette fonctionnalite est reservee aux administrateurs.
        </div>
      </div>
    );
  }

  const totalUsers = users.length;
  const adminCount = users.filter((item) => item.role === "admin").length;
  const managerCount = users.filter((item) => item.role === "manager").length;
  const analystCount = users.filter((item) => item.role === "analyst").length;
  const activeCount = users.filter((item) => item.status === "active").length;
  const suspendedCount = users.filter((item) => item.status === "suspended").length;

  function refreshUsers(showLoader = false) {
    if (showLoader) {
      setIsRefreshing(true);
    }
    setReloadKey((currentValue) => currentValue + 1);
  }

  function openCreateDialog() {
    setEditingUser(null);
    setFormState(createInitialFormState());
    setIsFormOpen(true);
  }

  function openEditDialog(targetUser: ApiUser) {
    setSelectedUser(null);
    setEditingUser(targetUser);
    setFormState({
      full_name: targetUser.full_name,
      email: targetUser.email,
      department_id: targetUser.department_id ? String(targetUser.department_id) : "",
      role: targetUser.role,
      status: targetUser.status,
      password: "",
    });
    setIsFormOpen(true);
  }

  function openRoleDialog(targetUser: ApiUser) {
    setRoleTargetUser(targetUser);
    setRoleDraft(targetUser.role);
  }

  function isCurrentAdmin(targetUser: ApiUser): boolean {
    return user?.id === targetUser.id;
  }

  async function submitCreate(payload: CreateUserPayload) {
    if (!token) return;

    setIsSubmitting(true);

    try {
      await usersApi.create(token, payload);
      setIsFormOpen(false);
      setFormState(createInitialFormState());
      toast.success("Utilisateur cree", {
        description: `${payload.full_name} a ete ajoute a la console d'administration.`,
      });
      refreshUsers();
    } catch (error) {
      toast.error("Creation impossible", {
        description: normalizeError(error, "Le compte n'a pas pu etre cree."),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitUpdate(userId: number, payload: UpdateUserPayload) {
    if (!token) return;

    setIsSubmitting(true);

    try {
      await usersApi.update(token, userId, payload);
      setIsFormOpen(false);
      setEditingUser(null);
      setPendingRoleConfirmation(null);
      toast.success("Utilisateur mis a jour", {
        description: "Les informations du compte ont ete enregistrees.",
      });
      refreshUsers();
    } catch (error) {
      toast.error("Mise a jour impossible", {
        description: normalizeError(error, "Les modifications n'ont pas pu etre appliquees."),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleFormSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const fullName = formState.full_name.trim();
    const email = formState.email.trim().toLowerCase();
    const password = formState.password.trim();
    const departmentId = formState.department_id ? Number(formState.department_id) : null;
    const isActive = formState.status === "active";

    if (fullName.length < 2) {
      toast.error("Nom invalide", {
        description: "Le nom complet doit contenir au moins 2 caracteres.",
      });
      return;
    }

    if (!email) {
      toast.error("Email requis", {
        description: "Renseignez un email professionnel valide.",
      });
      return;
    }

    if (!editingUser && password.length < 8) {
      toast.error("Mot de passe invalide", {
        description: "Le mot de passe temporaire doit contenir au moins 8 caracteres.",
      });
      return;
    }

    if (!editingUser) {
      await submitCreate({
        full_name: fullName,
        email,
        password,
        role: formState.role,
        department_id: departmentId,
        is_active: isActive,
      });
      return;
    }

    const payload: UpdateUserPayload = {
      full_name: fullName,
      email,
      role: formState.role,
      department_id: departmentId,
      is_active: isActive,
    };

    if (password) {
      payload.password = password;
    }

    if (editingUser.role !== formState.role) {
      setPendingRoleConfirmation({
        source: "form",
        userId: editingUser.id,
        userName: editingUser.full_name,
        currentRole: editingUser.role,
        nextRole: formState.role,
        payload,
      });
      return;
    }

    await submitUpdate(editingUser.id, payload);
  }

  async function handleConfirmRoleChange() {
    if (!token || !pendingRoleConfirmation) {
      return;
    }

    setIsSubmitting(true);

    try {
      if (pendingRoleConfirmation.source === "quick") {
        await usersApi.changeRole(token, pendingRoleConfirmation.userId, {
          role: pendingRoleConfirmation.nextRole,
        });
        setRoleTargetUser(null);
        toast.success("Role mis a jour", {
          description: `${pendingRoleConfirmation.userName} passe maintenant en role ${formatRoleLabel(
            pendingRoleConfirmation.nextRole,
          ).toLowerCase()}.`,
        });
      } else if (pendingRoleConfirmation.payload) {
        await usersApi.update(
          token,
          pendingRoleConfirmation.userId,
          pendingRoleConfirmation.payload,
        );
        setIsFormOpen(false);
        setEditingUser(null);
        toast.success("Utilisateur mis a jour", {
          description: "Le changement de role et les autres modifications ont ete confirmes.",
        });
      }

      setPendingRoleConfirmation(null);
      refreshUsers();
    } catch (error) {
      toast.error("Changement de role refuse", {
        description: normalizeError(error, "Le role n'a pas pu etre modifie."),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleConfirmStatusChange() {
    if (!token || !pendingStatusAction) {
      return;
    }

    setIsSubmitting(true);

    try {
      if (pendingStatusAction.nextStatus === "suspended") {
        await usersApi.deactivate(token, pendingStatusAction.user.id);
      } else {
        await usersApi.setStatus(token, pendingStatusAction.user.id, { status: "active" });
      }

      toast.success(
        pendingStatusAction.nextStatus === "active"
          ? "Compte reactive"
          : "Compte suspendu",
        {
          description:
            pendingStatusAction.nextStatus === "active"
              ? `${pendingStatusAction.user.full_name} peut a nouveau se connecter.`
              : `${pendingStatusAction.user.full_name} ne pourra plus acceder a l'application.`,
        },
      );
      setPendingStatusAction(null);
      refreshUsers();
    } catch (error) {
      toast.error("Action refusee", {
        description: normalizeError(error, "Le statut du compte n'a pas pu etre modifie."),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleConfirmDelete() {
    if (!token || !deleteTargetUser) {
      return;
    }

    setIsSubmitting(true);

    try {
      await usersApi.remove(token, deleteTargetUser.id);
      toast.success("Utilisateur supprime", {
        description: `${deleteTargetUser.full_name} a ete retire de la plateforme.`,
      });
      if (selectedUser?.id === deleteTargetUser.id) {
        setSelectedUser(null);
      }
      setDeleteTargetUser(null);
      refreshUsers();
    } catch (error) {
      toast.error("Suppression refusee", {
        description: normalizeError(
          error,
          "La suppression definitive a ete bloquee. Preferez la desactivation si besoin.",
        ),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <section className="overflow-hidden rounded-[32px] border border-white/70 bg-[linear-gradient(135deg,rgba(15,23,42,1),rgba(37,99,235,0.96)_58%,rgba(14,165,233,0.92)_100%)] p-8 text-white shadow-[0_28px_80px_-34px_rgba(15,23,42,0.58)]">
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-end">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white/90 backdrop-blur">
              <ShieldCheck className="h-4 w-4" />
              <span>Console administration utilisateurs</span>
            </div>
            <h1 className="mt-5 max-w-3xl text-3xl font-semibold tracking-tight">
              Supervisez les comptes, les roles et les acces depuis une seule console.
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-100/85">
              Seul le role Administrateur peut consulter cette page, modifier les comptes,
              suspendre les acces et arbitrer les changements de role.
            </p>
          </div>

          <div className="rounded-[28px] border border-white/15 bg-white/10 p-5 backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-200/80">
              Gouvernance
            </p>
            <div className="mt-4 space-y-3">
              <div className="rounded-2xl border border-white/12 bg-white/8 px-4 py-3">
                <p className="text-xs text-slate-200/70">Comptes visibles</p>
                <p className="mt-2 text-2xl font-semibold">{totalUsers}</p>
              </div>
              <div className="rounded-2xl border border-white/12 bg-white/8 px-4 py-3">
                <p className="text-xs text-slate-200/70">Filtre actif</p>
                <p className="mt-2 text-sm font-medium text-white/90">
                  {trimmedSearch || selectedRoleFilter !== "all" || selectedStatusFilter !== "all" || selectedDepartmentFilter !== "all"
                    ? "Vue admin filtree"
                    : "Vision globale"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <KPICard
          title="Total utilisateurs"
          value={String(totalUsers)}
          description="Comptes visibles avec les filtres actifs"
          icon={Users2}
          color="blue"
          emphasis="strong"
          density="compact"
        />
        <KPICard
          title="Administrateurs"
          value={String(adminCount)}
          description="Acces total a la plateforme"
          icon={Shield}
          color="purple"
          density="compact"
        />
        <KPICard
          title="Managers"
          value={String(managerCount)}
          description="Pilotage operationnel"
          icon={UserCog}
          color="cyan"
          density="compact"
        />
        <KPICard
          title="Analystes"
          value={String(analystCount)}
          description="Consultation et analyse"
          icon={Search}
          color="orange"
          density="compact"
        />
        <KPICard
          title="Comptes actifs"
          value={String(activeCount)}
          description="Connexion autorisee"
          icon={ShieldCheck}
          color="green"
          density="compact"
        />
        <KPICard
          title="Comptes suspendus"
          value={String(suspendedCount)}
          description="Acces actuellement bloque"
          icon={Power}
          color="red"
          density="compact"
        />
      </div>

      <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-[0_22px_60px_-40px_rgba(15,23,42,0.32)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,0.7fr))]">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Rechercher par nom, email ou departement"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 text-sm text-[#0F172A] outline-none transition-all focus:border-[#2563EB] focus:ring-4 focus:ring-blue-100"
              />
            </label>

            <select
              value={selectedRoleFilter}
              onChange={(event) => setSelectedRoleFilter(event.target.value as RoleFilter)}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-[#0F172A] outline-none transition-all focus:border-[#2563EB] focus:ring-4 focus:ring-blue-100"
            >
              <option value="all">Tous les roles</option>
              <option value="admin">Administrateurs</option>
              <option value="manager">Managers</option>
              <option value="analyst">Analystes</option>
              <option value="user">Utilisateurs</option>
            </select>

            <select
              value={selectedStatusFilter}
              onChange={(event) => setSelectedStatusFilter(event.target.value as StatusFilter)}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-[#0F172A] outline-none transition-all focus:border-[#2563EB] focus:ring-4 focus:ring-blue-100"
            >
              <option value="all">Tous les statuts</option>
              <option value="active">Actifs</option>
              <option value="suspended">Suspendus</option>
            </select>

            <select
              value={selectedDepartmentFilter}
              onChange={(event) => setSelectedDepartmentFilter(event.target.value)}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-[#0F172A] outline-none transition-all focus:border-[#2563EB] focus:ring-4 focus:ring-blue-100"
            >
              <option value="all">Tous les departements</option>
              {availableDepartments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => refreshUsers(true)}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-[#475569] transition-all hover:-translate-y-0.5 hover:bg-[#F8FAFC]"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
              <span>{isRefreshing ? "Actualisation..." : "Actualiser"}</span>
            </button>

            <button
              type="button"
              onClick={openCreateDialog}
              className="inline-flex items-center gap-2 rounded-2xl bg-[#2563EB] px-4 py-3 text-sm font-semibold text-white shadow-[0_18px_34px_-18px_rgba(37,99,235,0.55)] transition-all hover:-translate-y-0.5 hover:bg-[#1D4ED8]"
            >
              <Plus className="h-4 w-4" />
              <span>Nouvel utilisateur</span>
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3 text-sm text-[#64748B]">
          <span>{totalUsers} compte(s) affiches</span>
          <span className="text-slate-300">|</span>
          <span>
            {isDepartmentsLoading
              ? "Chargement des departements..."
              : `${availableDepartments.length} departement(s) disponibles`}
          </span>
        </div>

        {errorMessage ? (
          <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-[#B91C1C]">
            {errorMessage}
          </div>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-[0_24px_60px_-42px_rgba(15,23,42,0.32)]">
        <div className="overflow-x-auto">
          <table className="min-w-[1180px] w-full">
            <thead className="border-b border-slate-200 bg-[#F8FAFC]">
              <tr>
                <th className="px-6 py-4 text-left text-sm font-semibold text-[#0F172A]">
                  Utilisateur
                </th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-[#0F172A]">
                  Departement
                </th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-[#0F172A]">
                  Role
                </th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-[#0F172A]">
                  Statut
                </th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-[#0F172A]">
                  Creation
                </th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-[#0F172A]">
                  Derniere connexion
                </th>
                <th className="px-6 py-4 text-left text-sm font-semibold text-[#0F172A]">
                  Actions rapides
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-200">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-16 text-center text-sm text-[#64748B]">
                    Chargement des utilisateurs...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-16 text-center text-sm text-[#64748B]">
                    Aucun utilisateur ne correspond aux filtres actuels.
                  </td>
                </tr>
              ) : (
                users.map((item) => (
                  <tr key={item.id} className="transition-colors hover:bg-[#F8FAFC]">
                    <td className="px-6 py-4 align-top">
                      <div className="flex items-start gap-3">
                        <img
                          src={getUserAvatarUrl(item.full_name, item.photo_url)}
                          alt={item.full_name}
                          className="h-12 w-12 rounded-2xl border border-slate-200 object-cover"
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-[#0F172A]">{item.full_name}</p>
                            {isCurrentAdmin(item) ? (
                              <Badge className="border-slate-200 bg-white text-[#475569]">
                                Vous
                              </Badge>
                            ) : null}
                          </div>
                          <div className="mt-1 inline-flex items-center gap-2 text-sm text-[#64748B]">
                            <Mail className="h-3.5 w-3.5" />
                            <span className="truncate">{item.email}</span>
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="px-6 py-4 align-top text-sm text-[#475569]">
                      <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1">
                        <Building2 className="h-3.5 w-3.5 text-[#64748B]" />
                        <span>{item.department_name ?? "Non renseigne"}</span>
                      </div>
                    </td>

                    <td className="px-6 py-4 align-top">
                      <Badge className={getRoleBadgeClass(item.role)}>
                        {formatRoleLabel(item.role)}
                      </Badge>
                    </td>

                    <td className="px-6 py-4 align-top">
                      <Badge className={getStatusBadgeClass(item.status)}>
                        {getStatusLabel(item.status)}
                      </Badge>
                    </td>

                    <td className="px-6 py-4 align-top text-sm text-[#475569]">
                      {formatDateTime(item.created_at)}
                    </td>

                    <td className="px-6 py-4 align-top text-sm text-[#475569]">
                      {formatDateTime(item.last_login_at)}
                    </td>

                    <td className="px-6 py-4 align-top">
                      <div className="flex min-w-[320px] flex-wrap gap-2" data-export-ignore="true">
                        <button
                          type="button"
                          onClick={() => setSelectedUser(item)}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-[#475569] transition-all hover:-translate-y-0.5 hover:bg-[#F8FAFC]"
                        >
                          <Eye className="h-4 w-4" />
                          <span>Details</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => openEditDialog(item)}
                          className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-[#1D4ED8] transition-all hover:-translate-y-0.5 hover:bg-blue-100"
                        >
                          <Pencil className="h-4 w-4" />
                          <span>Modifier</span>
                        </button>

                        <button
                          type="button"
                          disabled={isCurrentAdmin(item)}
                          onClick={() =>
                            setPendingStatusAction({
                              user: item,
                              nextStatus: item.status === "active" ? "suspended" : "active",
                            })
                          }
                          className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-[#B45309] transition-all hover:-translate-y-0.5 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-55"
                          title={
                            isCurrentAdmin(item)
                              ? "Vous ne pouvez pas modifier votre propre statut."
                              : undefined
                          }
                        >
                          <Power className="h-4 w-4" />
                          <span>{item.status === "active" ? "Desactiver" : "Activer"}</span>
                        </button>

                        <button
                          type="button"
                          disabled={isCurrentAdmin(item)}
                          onClick={() => openRoleDialog(item)}
                          className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-medium text-[#6D28D9] transition-all hover:-translate-y-0.5 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-55"
                          title={
                            isCurrentAdmin(item)
                              ? "Vous ne pouvez pas retirer votre propre role administrateur."
                              : undefined
                          }
                        >
                          <UserCog className="h-4 w-4" />
                          <span>Changer role</span>
                        </button>

                        <button
                          type="button"
                          disabled={isCurrentAdmin(item)}
                          onClick={() => setDeleteTargetUser(item)}
                          className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-[#DC2626] transition-all hover:-translate-y-0.5 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-55"
                          title={
                            isCurrentAdmin(item)
                              ? "Vous ne pouvez pas supprimer votre propre compte."
                              : undefined
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                          <span>Supprimer</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <Dialog open={Boolean(selectedUser)} onOpenChange={(open) => !open && setSelectedUser(null)}>
        <DialogContent className="max-w-3xl rounded-[30px] border border-slate-200 bg-white p-0 shadow-[0_30px_90px_-38px_rgba(15,23,42,0.28)]">
          {selectedUser ? (
            <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="p-7">
                <DialogHeader className="text-left">
                  <DialogTitle className="text-2xl font-semibold text-[#0F172A]">
                    Detail utilisateur
                  </DialogTitle>
                  <DialogDescription className="text-sm leading-6 text-[#64748B]">
                    Visualisez le role, le statut et les informations de derniere activite du
                    compte selectionne.
                  </DialogDescription>
                </DialogHeader>

                <div className="mt-6 flex items-start gap-4">
                  <img
                    src={getUserAvatarUrl(selectedUser.full_name, selectedUser.photo_url)}
                    alt={selectedUser.full_name}
                    className="h-20 w-20 rounded-[26px] border border-slate-200 object-cover"
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-semibold text-[#0F172A]">
                        {selectedUser.full_name}
                      </h2>
                      <Badge className={getRoleBadgeClass(selectedUser.role)}>
                        {formatRoleLabel(selectedUser.role)}
                      </Badge>
                      <Badge className={getStatusBadgeClass(selectedUser.status)}>
                        {getStatusLabel(selectedUser.status)}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-[#64748B]">{selectedUser.email}</p>
                  </div>
                </div>

                <div className="mt-7 grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">
                      Departement
                    </p>
                    <p className="mt-2 text-sm font-semibold text-[#0F172A]">
                      {selectedUser.department_name ?? "Non renseigne"}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">
                      Identifiant
                    </p>
                    <p className="mt-2 text-sm font-semibold text-[#0F172A]">
                      Utilisateur #{selectedUser.id}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">
                      Date de creation
                    </p>
                    <p className="mt-2 text-sm font-semibold text-[#0F172A]">
                      {formatDateTime(selectedUser.created_at)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">
                      Derniere connexion
                    </p>
                    <p className="mt-2 text-sm font-semibold text-[#0F172A]">
                      {formatDateTime(selectedUser.last_login_at)}
                    </p>
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap gap-3" data-export-ignore="true">
                  <button
                    type="button"
                    onClick={() => openEditDialog(selectedUser)}
                    className="inline-flex items-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-medium text-[#1D4ED8] transition-all hover:-translate-y-0.5 hover:bg-blue-100"
                  >
                    <Pencil className="h-4 w-4" />
                    <span>Modifier</span>
                  </button>
                  <button
                    type="button"
                    disabled={isCurrentAdmin(selectedUser)}
                    onClick={() => openRoleDialog(selectedUser)}
                    className="inline-flex items-center gap-2 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-medium text-[#6D28D9] transition-all hover:-translate-y-0.5 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    <UserCog className="h-4 w-4" />
                    <span>Changer role</span>
                  </button>
                </div>
              </div>

              <aside className="border-l border-slate-200 bg-[linear-gradient(180deg,#F8FAFC_0%,#EFF6FF_100%)] p-7">
                <div className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#64748B]">
                    Regles metier
                  </p>
                  <div className="mt-4 space-y-3 text-sm leading-6 text-[#475569]">
                    <p>La desactivation est recommandee avant toute suppression definitive.</p>
                    <p>Les changements de role et d&apos;acces sont journalises.</p>
                    <p>Un administrateur ne peut pas se supprimer ni retirer son propre role.</p>
                  </div>
                </div>
              </aside>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={isFormOpen} onOpenChange={(open) => !open && !isSubmitting && setIsFormOpen(false)}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto rounded-[30px] border border-slate-200 bg-white p-0 shadow-[0_30px_90px_-38px_rgba(15,23,42,0.3)]">
          <form onSubmit={(event) => void handleFormSubmit(event)} className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="p-7">
              <DialogHeader className="text-left">
                <DialogTitle className="text-2xl font-semibold text-[#0F172A]">
                  {editingUser ? "Modifier un utilisateur" : "Creer un utilisateur"}
                </DialogTitle>
                <DialogDescription className="text-sm leading-6 text-[#64748B]">
                  Renseignez les informations du compte, le role et le statut d&apos;acces.
                </DialogDescription>
              </DialogHeader>

              <div className="mt-6 grid gap-5 md:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-[#0F172A]">
                    Nom complet
                  </span>
                  <input
                    value={formState.full_name}
                    onChange={(event) =>
                      setFormState((currentState) => ({
                        ...currentState,
                        full_name: event.target.value,
                      }))
                    }
                    required
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-[#0F172A] outline-none transition-all focus:border-[#2563EB] focus:ring-4 focus:ring-blue-100"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-[#0F172A]">
                    Email professionnel
                  </span>
                  <input
                    type="email"
                    value={formState.email}
                    onChange={(event) =>
                      setFormState((currentState) => ({
                        ...currentState,
                        email: event.target.value,
                      }))
                    }
                    required
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-[#0F172A] outline-none transition-all focus:border-[#2563EB] focus:ring-4 focus:ring-blue-100"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-[#0F172A]">
                    Departement
                  </span>
                  <select
                    value={formState.department_id}
                    onChange={(event) =>
                      setFormState((currentState) => ({
                        ...currentState,
                        department_id: event.target.value,
                      }))
                    }
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-[#0F172A] outline-none transition-all focus:border-[#2563EB] focus:ring-4 focus:ring-blue-100"
                  >
                    <option value="">Aucun departement</option>
                    {availableDepartments.map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-[#0F172A]">Role</span>
                  <select
                    value={formState.role}
                    onChange={(event) =>
                      setFormState((currentState) => ({
                        ...currentState,
                        role: event.target.value as ApiUserRole,
                      }))
                    }
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-[#0F172A] outline-none transition-all focus:border-[#2563EB] focus:ring-4 focus:ring-blue-100"
                    disabled={Boolean(editingUser && isCurrentAdmin(editingUser))}
                  >
                    <option value="admin">Administrateur</option>
                    <option value="manager">Manager</option>
                    <option value="analyst">Analyste</option>
                    <option value="user">Utilisateur</option>
                  </select>
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-[#0F172A]">Statut</span>
                  <select
                    value={formState.status}
                    onChange={(event) =>
                      setFormState((currentState) => ({
                        ...currentState,
                        status: event.target.value as ApiUserStatus,
                      }))
                    }
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-[#0F172A] outline-none transition-all focus:border-[#2563EB] focus:ring-4 focus:ring-blue-100"
                    disabled={Boolean(editingUser && isCurrentAdmin(editingUser))}
                  >
                    <option value="active">Actif</option>
                    <option value="suspended">Suspendu</option>
                  </select>
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-[#0F172A]">
                    {editingUser ? "Nouveau mot de passe (optionnel)" : "Mot de passe temporaire"}
                  </span>
                  <input
                    type="text"
                    value={formState.password}
                    onChange={(event) =>
                      setFormState((currentState) => ({
                        ...currentState,
                        password: event.target.value,
                      }))
                    }
                    minLength={editingUser ? undefined : 8}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-[#0F172A] outline-none transition-all focus:border-[#2563EB] focus:ring-4 focus:ring-blue-100"
                  />
                </label>
              </div>

              {editingUser && editingUser.role !== formState.role ? (
                <div className="mt-5 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-[#6D28D9]">
                  Ce changement de role demandera une confirmation avant enregistrement.
                </div>
              ) : null}

              <div className="mt-6 flex flex-wrap justify-end gap-3" data-export-ignore="true">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  disabled={isSubmitting}
                  className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-[#475569] transition-all hover:-translate-y-0.5 hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Annuler
                </button>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 rounded-2xl bg-[#2563EB] px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_34px_-18px_rgba(37,99,235,0.55)] transition-all hover:-translate-y-0.5 hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-65"
                >
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                  <span>{isSubmitting ? "Enregistrement..." : editingUser ? "Enregistrer" : "Creer le compte"}</span>
                </button>
              </div>
            </div>

            <aside className="border-l border-slate-200 bg-[linear-gradient(180deg,#F8FAFC_0%,#EFF6FF_100%)] p-7">
              <div className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#64748B]">
                  Metadonnees
                </p>
                <div className="mt-4 space-y-4 text-sm text-[#475569]">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-[#94A3B8]">
                      Date de creation
                    </p>
                    <p className="mt-2 font-semibold text-[#0F172A]">
                      {editingUser ? formatDateTime(editingUser.created_at) : "Generee automatiquement"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-[#94A3B8]">
                      Derniere connexion
                    </p>
                    <p className="mt-2 font-semibold text-[#0F172A]">
                      {editingUser ? formatDateTime(editingUser.last_login_at) : "Aucune pour le moment"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-5 rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#64748B]">
                  Rappels
                </p>
                <div className="mt-4 space-y-3 text-sm leading-6 text-[#475569]">
                  <p>Preferez suspendre un compte avant toute suppression definitive.</p>
                  <p>Les changements de role ont un impact direct sur les droits applicatifs.</p>
                  <p>Le backend verifiera toujours le role Administrateur avant validation.</p>
                </div>
              </div>
            </aside>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(roleTargetUser)} onOpenChange={(open) => !open && setRoleTargetUser(null)}>
        <DialogContent className="max-w-xl rounded-[30px] border border-slate-200 bg-white p-0 shadow-[0_30px_90px_-38px_rgba(15,23,42,0.28)]">
          {roleTargetUser ? (
            <div className="p-7">
              <DialogHeader className="text-left">
                <DialogTitle className="text-2xl font-semibold text-[#0F172A]">
                  Changer le role
                </DialogTitle>
                <DialogDescription className="text-sm leading-6 text-[#64748B]">
                  Confirmez le nouveau role de {roleTargetUser.full_name}. Cette action modifie
                  immediatement les acces applicatifs.
                </DialogDescription>
              </DialogHeader>

              <div className="mt-6 rounded-[24px] border border-slate-200 bg-[#F8FAFC] p-5">
                <p className="text-sm text-[#64748B]">Role actuel</p>
                <p className="mt-2 text-lg font-semibold text-[#0F172A]">
                  {formatRoleLabel(roleTargetUser.role)}
                </p>

                <label className="mt-5 block">
                  <span className="mb-2 block text-sm font-medium text-[#0F172A]">
                    Nouveau role
                  </span>
                  <select
                    value={roleDraft}
                    onChange={(event) => setRoleDraft(event.target.value as ApiUserRole)}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-[#0F172A] outline-none transition-all focus:border-[#2563EB] focus:ring-4 focus:ring-blue-100"
                  >
                    <option value="admin">Administrateur</option>
                    <option value="manager">Manager</option>
                    <option value="analyst">Analyste</option>
                    <option value="user">Utilisateur</option>
                  </select>
                </label>
              </div>

              <div className="mt-6 flex justify-end gap-3" data-export-ignore="true">
                <button
                  type="button"
                  onClick={() => setRoleTargetUser(null)}
                  className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-[#475569] transition-all hover:-translate-y-0.5 hover:bg-[#F8FAFC]"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (roleDraft === roleTargetUser.role) {
                      toast.info("Aucun changement", {
                        description: "Le role selectionne est deja applique a ce compte.",
                      });
                      return;
                    }

                    setRoleTargetUser(null);
                    setPendingRoleConfirmation({
                      source: "quick",
                      userId: roleTargetUser.id,
                      userName: roleTargetUser.full_name,
                      currentRole: roleTargetUser.role,
                      nextRole: roleDraft,
                    });
                  }}
                  className="inline-flex items-center gap-2 rounded-2xl bg-[#6D28D9] px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_34px_-18px_rgba(109,40,217,0.45)] transition-all hover:-translate-y-0.5 hover:bg-[#5B21B6]"
                >
                  <UserCog className="h-4 w-4" />
                  <span>Continuer</span>
                </button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(pendingRoleConfirmation)}
        onOpenChange={(open) => !open && !isSubmitting && setPendingRoleConfirmation(null)}
      >
        <AlertDialogContent className="rounded-[30px] border border-violet-200 bg-white shadow-[0_30px_90px_-38px_rgba(15,23,42,0.28)]">
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle className="text-2xl font-semibold text-[#0F172A]">
              Confirmer le changement de role
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3 text-sm leading-6 text-[#64748B]">
              <p>
                Vous allez faire passer{" "}
                <span className="font-semibold text-[#0F172A]">
                  {pendingRoleConfirmation?.userName}
                </span>{" "}
                de{" "}
                <span className="font-semibold text-[#0F172A]">
                  {pendingRoleConfirmation
                    ? formatRoleLabel(pendingRoleConfirmation.currentRole).toLowerCase()
                    : ""}
                </span>{" "}
                a{" "}
                <span className="font-semibold text-[#0F172A]">
                  {pendingRoleConfirmation
                    ? formatRoleLabel(pendingRoleConfirmation.nextRole).toLowerCase()
                    : ""}
                </span>
                .
              </p>
              <p>Les permissions du compte seront mises a jour immediatement apres validation.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter className="gap-3">
            <AlertDialogCancel className="h-11 rounded-2xl border-slate-200 text-[#475569]">
              Annuler
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmRoleChange();
              }}
              className="h-11 rounded-2xl bg-[#6D28D9] text-white hover:bg-[#5B21B6]"
            >
              {isSubmitting ? "Confirmation..." : "Confirmer le role"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(pendingStatusAction)}
        onOpenChange={(open) => !open && !isSubmitting && setPendingStatusAction(null)}
      >
        <AlertDialogContent className="rounded-[30px] border border-amber-200 bg-white shadow-[0_30px_90px_-38px_rgba(15,23,42,0.28)]">
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle className="text-2xl font-semibold text-[#0F172A]">
              {pendingStatusAction?.nextStatus === "active"
                ? "Reactiver ce compte ?"
                : "Suspendre ce compte ?"}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3 text-sm leading-6 text-[#64748B]">
              <p>
                {pendingStatusAction?.nextStatus === "active"
                  ? "L'utilisateur recuperera l'acces a l'application apres validation."
                  : "La desactivation est privilegiee avant toute suppression definitive."}
              </p>
              <p>
                Compte cible :{" "}
                <span className="font-semibold text-[#0F172A]">
                  {pendingStatusAction?.user.full_name}
                </span>
                .
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter className="gap-3">
            <AlertDialogCancel className="h-11 rounded-2xl border-slate-200 text-[#475569]">
              Annuler
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmStatusChange();
              }}
              className="h-11 rounded-2xl bg-[#D97706] text-white hover:bg-[#B45309]"
            >
              {isSubmitting
                ? "Validation..."
                : pendingStatusAction?.nextStatus === "active"
                  ? "Reactiver"
                  : "Suspendre"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(deleteTargetUser)}
        onOpenChange={(open) => !open && !isSubmitting && setDeleteTargetUser(null)}
      >
        <AlertDialogContent className="rounded-[30px] border border-red-200 bg-white shadow-[0_30px_90px_-38px_rgba(15,23,42,0.28)]">
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle className="text-2xl font-semibold text-[#0F172A]">
              Supprimer definitivement ce compte ?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3 text-sm leading-6 text-[#64748B]">
              <p>
                Cette action supprimera le compte{" "}
                <span className="font-semibold text-[#0F172A]">
                  {deleteTargetUser?.full_name}
                </span>
                .
              </p>
              <p>
                La suppression est irreversible. Si vous souhaitez simplement bloquer l&apos;acces,
                preferez la desactivation.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter className="gap-3">
            <AlertDialogCancel className="h-11 rounded-2xl border-slate-200 text-[#475569]">
              Annuler
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmDelete();
              }}
              className="h-11 rounded-2xl bg-[#DC2626] text-white hover:bg-[#B91C1C]"
            >
              {isSubmitting ? "Suppression..." : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

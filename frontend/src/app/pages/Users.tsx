import { useEffect, useRef, useState } from "react";
import {
  Ban,
  Building2,
  CheckCircle2,
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
  XCircle,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
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
  type ApiInvitationExpiration,
  type ApiInvitationStatus,
  type ApiUserInvitationActionCode,
  type ApiUserInvitation,
  formatRoleLabel,
  getUserAvatarUrl,
  type ApiUser,
  type ApiUserRole,
  type ApiUserStatus,
  type CreateUserPayload,
  type UpdateUserPayload,
  usersApi,
} from "../lib/api";
import { canManageUsers } from "../lib/roles";

const USER_BATCH_SIZE = 100;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DEFAULT_INVITATION_DEPARTMENTS = [
  "Direction",
  "Finance",
  "RH",
  "Informatique",
  "Commercial",
  "Marketing",
  "Support",
  "Technique",
  "Exploitation",
] as const;
const DEFAULT_INVITATION_JOB_TITLES = [
  "Analyste",
  "Manager",
  "Responsable",
  "Technicien",
  "Assistant",
  "Commercial",
] as const;
const INVITATION_EXPIRATION_OPTIONS: Array<{ value: ApiInvitationExpiration; label: string }> = [
  { value: "7_days", label: "7 jours" },
  { value: "14_days", label: "14 jours" },
  { value: "30_days", label: "30 jours" },
];
const INVITATION_LABEL_CLASS =
  "mb-2.5 block text-sm font-semibold tracking-[0.01em] text-[#0F172A]";
const INVITATION_CONTROL_CLASS =
  "h-14 w-full rounded-[20px] border border-white/70 bg-white/80 px-4 text-[15px] text-[#0F172A] shadow-[inset_0_1px_0_rgba(255,255,255,0.82),0_18px_38px_-28px_rgba(37,99,235,0.34)] outline-none transition-all duration-200 placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:bg-white focus:ring-4 focus:ring-[#BFDBFE]/80";
const INVITATION_SURFACE_CLASS =
  "rounded-[28px] border border-white/70 bg-white/78 shadow-[0_24px_70px_-34px_rgba(15,23,42,0.22)] backdrop-blur-xl";

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

interface InvitationFormState {
  full_name: string;
  email: string;
  phone: string;
  departmentOption: string;
  customDepartment: string;
  jobTitleOption: string;
  customJobTitle: string;
  expiration: ApiInvitationExpiration;
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

function createInitialInvitationFormState(): InvitationFormState {
  return {
    full_name: "",
    email: "",
    phone: "",
    departmentOption: "Finance",
    customDepartment: "",
    jobTitleOption: DEFAULT_INVITATION_JOB_TITLES[0],
    customJobTitle: "",
    expiration: "7_days",
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
  if (role === "company_admin") return "border-[#DDD6FE] bg-[#F5F3FF] text-[#6D28D9]";
  if (role === "manager") return "border-[#C7D2FE] bg-[#EEF2FF] text-[#4F46E5]";
  if (role === "analyst") return "border-[#BAE6FD] bg-[#F0F9FF] text-[#0369A1]";
  return "border-[#D1FAE5] bg-[#ECFDF5] text-[#047857]";
}

function getStatusBadgeClass(status: ApiUserStatus): string {
  if (status === "active") return "border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]";
  if (status === "pending") return "border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]";
  if (status === "rejected") return "border-[#FECACA] bg-[#FEF2F2] text-[#DC2626]";
  return "border-slate-200 bg-slate-100 text-[#475569]";
}

function getStatusLabel(status: ApiUserStatus): string {
  if (status === "active") return "Actif";
  if (status === "pending") return "En attente";
  if (status === "rejected") return "Rejete";
  return "Suspendu";
}

function getInvitationStatusBadgeClass(status: ApiInvitationStatus): string {
  if (status === "accepted") return "border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]";
  if (status === "expired") {
    return "border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]";
  }
  if (status === "pending") return "border-[#DBEAFE] bg-[#EFF6FF] text-[#1D4ED8]";
  return "border-slate-200 bg-slate-100 text-[#475569]";
}

function getInvitationStatusLabel(status: ApiInvitationStatus): string {
  if (status === "pending") return "En attente";
  if (status === "accepted") return "Acceptee";
  if (status === "expired") return "Expiree";
  return "Annulee";
}

function getPendingStatusDialogTitle(action: PendingStatusAction | null): string {
  if (!action) return "Mettre a jour le compte ?";
  if (action.nextStatus === "active") {
    return action.user.status === "pending" ? "Accepter cette demande ?" : "Reactiver ce compte ?";
  }
  if (action.nextStatus === "rejected") {
    return "Refuser cette demande ?";
  }
  return "Suspendre ce compte ?";
}

function getPendingStatusDialogDescription(action: PendingStatusAction | null): string {
  if (!action) return "";
  if (action.nextStatus === "active") {
    return action.user.status === "pending"
      ? "Le collaborateur pourra se connecter des que vous validez cette demande."
      : "L'utilisateur recuperera l'acces a l'application apres validation.";
  }
  if (action.nextStatus === "rejected") {
    return "La demande passera en statut rejete et le collaborateur ne pourra pas acceder a la plateforme.";
  }
  return "La desactivation est privilegiee avant toute suppression definitive.";
}

function getPendingStatusActionLabel(action: PendingStatusAction | null): string {
  if (!action) return "Confirmer";
  if (action.nextStatus === "active") {
    return action.user.status === "pending" ? "Accepter la demande" : "Reactiver le compte";
  }
  if (action.nextStatus === "rejected") {
    return "Refuser la demande";
  }
  return "Suspendre le compte";
}

function buildInvitationOptions(defaultOptions: readonly string[], dynamicOptions: string[]): string[] {
  return [...new Set([...defaultOptions, ...dynamicOptions.filter(Boolean)])];
}

function resolveInvitationDepartment(state: InvitationFormState): string {
  return (state.departmentOption === "__other__" ? state.customDepartment : state.departmentOption).trim();
}

function resolveInvitationJobTitle(state: InvitationFormState): string {
  return (state.jobTitleOption === "__other__" ? state.customJobTitle : state.jobTitleOption).trim();
}

function getInvitationExpirationLabel(expiration: ApiInvitationExpiration): string {
  return (
    INVITATION_EXPIRATION_OPTIONS.find((option) => option.value === expiration)?.label ?? "7 jours"
  );
}

function canCancelInvitation(invitation: ApiUserInvitation): boolean {
  return invitation.status === "pending";
}

function getInvitationToastTitleFromCode(code: ApiUserInvitationActionCode): string {
  if (code === "INVITATION_ALREADY_SENT") {
    return "Invitation deja envoyee";
  }
  return "Invitation envoyee";
}

function getAssignableRoles(currentUser: ApiUser | null): ApiUserRole[] {
  if (currentUser?.role === "company_admin") {
    return ["manager", "analyst", "user"];
  }

  return ["admin", "company_admin", "manager", "analyst", "user"];
}

function canManageTargetUser(currentUser: ApiUser | null, targetUser: ApiUser): boolean {
  if (currentUser?.role !== "company_admin") {
    return true;
  }

  return !["super_admin", "admin", "company_admin"].includes(targetUser.role);
}

export default function Users() {
  const { token, user } = useAuth();
  const { allDepartments, departments, isLoading: isDepartmentsLoading } = useDepartments();
  const invitationNameInputRef = useRef<HTMLInputElement | null>(null);
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [invitations, setInvitations] = useState<ApiUserInvitation[]>([]);
  const [isInvitationsLoading, setIsInvitationsLoading] = useState(false);
  const [isInvitationSubmitting, setIsInvitationSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRoleFilter, setSelectedRoleFilter] = useState<RoleFilter>("all");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<StatusFilter>("all");
  const [selectedDepartmentFilter, setSelectedDepartmentFilter] = useState("all");
  const [reloadKey, setReloadKey] = useState(0);
  const [invitationReloadKey, setInvitationReloadKey] = useState(0);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isInvitationDialogOpen, setIsInvitationDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<ApiUser | null>(null);
  const [selectedUser, setSelectedUser] = useState<ApiUser | null>(null);
  const [roleTargetUser, setRoleTargetUser] = useState<ApiUser | null>(null);
  const [roleDraft, setRoleDraft] = useState<ApiUserRole>("user");
  const [pendingRoleConfirmation, setPendingRoleConfirmation] =
    useState<PendingRoleConfirmation | null>(null);
  const [pendingStatusAction, setPendingStatusAction] = useState<PendingStatusAction | null>(null);
  const [deleteTargetUser, setDeleteTargetUser] = useState<ApiUser | null>(null);
  const [deleteTargetInvitation, setDeleteTargetInvitation] = useState<ApiUserInvitation | null>(null);
  const [formState, setFormState] = useState<UserFormState>(createInitialFormState);
  const [invitationFormState, setInvitationFormState] =
    useState<InvitationFormState>(createInitialInvitationFormState);

  const availableDepartments = allDepartments.length > 0 ? allDepartments : departments;
  const isCompanyInvitationManager = user?.role === "company_admin" && Boolean(user.company_id);
  const invitationDepartmentOptions = buildInvitationOptions(
    DEFAULT_INVITATION_DEPARTMENTS,
    availableDepartments.map((department) => department.name),
  );
  const invitationJobTitleOptions = [...DEFAULT_INVITATION_JOB_TITLES];
  const invitationSummaryCompany = user?.company_name?.trim() || "BC SKILLS";
  const assignableRoles = getAssignableRoles(user);
  const trimmedSearch = searchQuery.trim();

  useEffect(() => {
    let isMounted = true;

    async function loadUsers() {
      if (!token || !canManageUsers(user)) {
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

  useEffect(() => {
    let isMounted = true;

    async function loadInvitations() {
      if (!token || !isCompanyInvitationManager) {
        if (isMounted) {
          setInvitations([]);
          setIsInvitationsLoading(false);
        }
        return;
      }

      setIsInvitationsLoading(true);
      try {
        const nextInvitations = await usersApi.listInvitations(token);
        if (isMounted) {
          setInvitations(nextInvitations);
        }
      } catch (error) {
        if (isMounted) {
          setInvitations([]);
          toast.error("Invitations indisponibles", {
            description: normalizeError(error, "Le tableau des invitations n'a pas pu etre charge."),
          });
        }
      } finally {
        if (isMounted) {
          setIsInvitationsLoading(false);
        }
      }
    }

    void loadInvitations();

    return () => {
      isMounted = false;
    };
  }, [token, isCompanyInvitationManager, invitationReloadKey]);

  if (!canManageUsers(user)) {
    return (
      <div className="p-6">
        <div className="rounded-[28px] border border-red-200 bg-red-50 p-6 text-[#B91C1C]">
          Acces refuse. Cette fonctionnalite est reservee aux administrateurs plateforme et entreprise.
        </div>
      </div>
    );
  }

  const totalUsers = users.length;
  const adminCount = users.filter(
    (item) => item.role === "admin" || item.role === "company_admin",
  ).length;
  const managerCount = users.filter((item) => item.role === "manager").length;
  const analystCount = users.filter((item) => item.role === "analyst").length;
  const activeCount = users.filter((item) => item.status === "active").length;
  const pendingCount = users.filter((item) => item.status === "pending").length;
  const pendingUsers = users.filter((item) => item.status === "pending");
  const invitationSentCount = invitations.length;
  const invitationAcceptedCount = invitations.filter((item) => item.status === "accepted").length;
  const invitationPendingCount = invitations.filter((item) => item.status === "pending").length;
  const invitationExpiredCount = invitations.filter((item) => item.status === "expired").length;

  function refreshUsers(showLoader = false) {
    if (showLoader) {
      setIsRefreshing(true);
    }
    setReloadKey((currentValue) => currentValue + 1);
  }

  function refreshInvitations() {
    setInvitationReloadKey((currentValue) => currentValue + 1);
  }

  function refreshInvitationWorkspace() {
    refreshInvitations();
    refreshUsers();
  }

  function openCreateDialog() {
    setEditingUser(null);
    setFormState(createInitialFormState());
    setIsFormOpen(true);
  }

  function openInvitationDialog() {
    setInvitationFormState(createInitialInvitationFormState());
    setIsInvitationDialogOpen(true);
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
        account_status: formState.status,
      });
      return;
    }

    const payload: UpdateUserPayload = {
      full_name: fullName,
      email,
      role: formState.role,
      department_id: departmentId,
      is_active: isActive,
      account_status: formState.status,
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

  async function handleInvitationSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      return;
    }

    const fullName = invitationFormState.full_name.trim();
    const email = invitationFormState.email.trim().toLowerCase();
    const department = resolveInvitationDepartment(invitationFormState);
    const jobTitle = resolveInvitationJobTitle(invitationFormState);

    if (fullName.length < 2) {
      toast.error("Nom invalide", {
        description: "Renseignez le nom complet du collaborateur.",
      });
      return;
    }

    if (!EMAIL_PATTERN.test(email)) {
      toast.warning("Email invalide", {
        description: "Renseignez une adresse email professionnelle valide.",
      });
      return;
    }

    if (department.length < 2) {
      toast.error("Departement invalide", {
        description: "Selectionnez un departement ou renseignez-en un nouveau.",
      });
      return;
    }

    if (jobTitle.length < 2) {
      toast.error("Fonction invalide", {
        description: "Selectionnez une fonction ou renseignez-en une nouvelle.",
      });
      return;
    }

    setIsInvitationSubmitting(true);
    try {
      const result = await usersApi.createInvitation(token, {
        full_name: fullName,
        email,
        phone: invitationFormState.phone.trim() || null,
        department,
        job_title: jobTitle,
        expiration: invitationFormState.expiration,
      });

      if (result.code === "INVITATION_ALREADY_SENT") {
        toast.warning(getInvitationToastTitleFromCode(result.code), {
          description: result.message,
        });
        refreshInvitationWorkspace();
        return;
      }

      setIsInvitationDialogOpen(false);
      setInvitationFormState(createInitialInvitationFormState());
      toast.success(getInvitationToastTitleFromCode(result.code), {
        description: result.message,
      });
      refreshInvitationWorkspace();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === "INVITATION_ALREADY_MEMBER") {
          toast.warning("Utilisateur deja membre", {
            description: error.message,
          });
          refreshInvitationWorkspace();
          return;
        }
        if (error.code === "INVITATION_OTHER_ORGANIZATION") {
          toast.warning("Utilisateur dans une autre organisation", {
            description: error.message,
          });
          return;
        }
        if (error.code === "INVITATION_INVALID_EMAIL") {
          toast.warning("Email invalide", {
            description: error.message,
          });
          return;
        }
      }

      toast.error("Envoi impossible", {
        description: normalizeError(error, "L'invitation collaborateur n'a pas pu etre creee."),
      });
    } finally {
      setIsInvitationSubmitting(false);
    }
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
      await usersApi.setStatus(token, pendingStatusAction.user.id, {
        status: pendingStatusAction.nextStatus,
      });

      const isPendingApproval = pendingStatusAction.user.status === "pending";
      const title =
        pendingStatusAction.nextStatus === "active"
          ? isPendingApproval
            ? "Demande acceptee"
            : "Compte reactive"
          : pendingStatusAction.nextStatus === "rejected"
            ? "Demande refusee"
            : "Compte suspendu";
      const description =
        pendingStatusAction.nextStatus === "active"
          ? `${pendingStatusAction.user.full_name} peut maintenant se connecter.`
          : pendingStatusAction.nextStatus === "rejected"
            ? `${pendingStatusAction.user.full_name} reste bloque tant qu'une nouvelle decision n'est pas prise.`
            : `${pendingStatusAction.user.full_name} ne pourra plus acceder a l'application.`;
      toast.success(title, { description });
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

  function handleViewInvitation(invitation: ApiUserInvitation) {
    window.open(invitation.invitation_url, "_blank", "noopener,noreferrer");
  }

  async function handleResendInvitation(invitation: ApiUserInvitation) {
    if (!token) {
      return;
    }

    setIsInvitationSubmitting(true);
    try {
      const result = await usersApi.resendInvitation(token, invitation.id);
      toast.success("Invitation renvoyee", {
        description: result.message,
      });
      refreshInvitationWorkspace();
    } catch (error) {
      toast.error("Renvoi impossible", {
        description: normalizeError(error, "L'invitation n'a pas pu etre renvoyee."),
      });
    } finally {
      setIsInvitationSubmitting(false);
    }
  }

  async function handleCancelInvitation(invitationId: number) {
    if (!token) {
      return;
    }

    setIsInvitationSubmitting(true);
    try {
      await usersApi.cancelInvitation(token, invitationId);
      toast.success("Invitation annulee", {
        description: "Le lien ne pourra plus etre utilise.",
      });
      refreshInvitationWorkspace();
    } catch (error) {
      toast.error("Annulation impossible", {
        description: normalizeError(error, "L'invitation n'a pas pu etre annulee."),
      });
    } finally {
      setIsInvitationSubmitting(false);
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

  async function handleConfirmInvitationDelete() {
    if (!token || !deleteTargetInvitation) {
      return;
    }

    setIsInvitationSubmitting(true);
    try {
      await usersApi.deleteInvitation(token, deleteTargetInvitation.id);
      toast.success("Invitation supprimee", {
        description: `${deleteTargetInvitation.email} a ete retire de la liste des invitations.`,
      });
      setDeleteTargetInvitation(null);
      refreshInvitationWorkspace();
    } catch (error) {
      toast.error("Suppression impossible", {
        description: normalizeError(error, "L'invitation n'a pas pu etre supprimee."),
      });
    } finally {
      setIsInvitationSubmitting(false);
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
              Les administrateurs plateforme et les admins entreprise peuvent consulter cette page,
              modifier les comptes, activer les demandes en attente et arbitrer les changements de role autorises.
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
          description="Plateforme et entreprise"
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
          title="En attente"
          value={String(pendingCount)}
          description="Demandes a valider"
          icon={Power}
          color="orange"
          density="compact"
        />
        {isCompanyInvitationManager ? (
          <KPICard
            title="Invitations envoyees"
            value={String(invitationSentCount)}
            description="Historique total"
            icon={Mail}
            color="blue"
            density="compact"
          />
        ) : null}
        {isCompanyInvitationManager ? (
          <KPICard
            title="Invitations acceptees"
            value={String(invitationAcceptedCount)}
            description="Collaborateurs actives"
            icon={CheckCircle2}
            color="green"
            density="compact"
          />
        ) : null}
        {isCompanyInvitationManager ? (
          <KPICard
            title="Invitations en attente"
            value={String(invitationPendingCount)}
            description="Liens encore valides"
            icon={UserPlus}
            color="cyan"
            density="compact"
          />
        ) : null}
        {isCompanyInvitationManager ? (
          <KPICard
            title="Invitations expirees"
            value={String(invitationExpiredCount)}
            description="A renvoyer si besoin"
            icon={Ban}
            color="orange"
            density="compact"
          />
        ) : null}
      </div>

      {isCompanyInvitationManager ? (
        <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-[0_22px_60px_-40px_rgba(15,23,42,0.32)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#DBEAFE] bg-[#EFF6FF] px-4 py-2 text-sm font-semibold text-[#1D4ED8]">
                <Mail className="h-4 w-4" />
                <span>Invitations envoyees</span>
              </div>
              <h2 className="mt-4 text-2xl font-semibold tracking-tight text-[#0F172A]">
                Invitez vos collaborateurs par email depuis votre entreprise.
              </h2>
              <p className="mt-2 text-sm leading-7 text-[#64748B]">
                Chaque invitation ouvre un lien securise qui pre-remplit l'entreprise, le departement,
                le poste et le role collaborateur avant activation immediate du compte.
              </p>
            </div>

            <button
              type="button"
              onClick={openInvitationDialog}
              className="inline-flex items-center gap-2 rounded-2xl bg-[#2563EB] px-4 py-3 text-sm font-semibold text-white shadow-[0_18px_34px_-18px_rgba(37,99,235,0.55)] transition-all hover:-translate-y-0.5 hover:bg-[#1D4ED8]"
            >
              <Plus className="h-4 w-4" />
              <span>Inviter un collaborateur</span>
            </button>
          </div>

          <div className="mt-5 overflow-hidden rounded-[24px] border border-slate-200">
            <div className="overflow-x-auto">
              <table className="min-w-[1120px] w-full">
                <thead className="border-b border-slate-200 bg-[#F8FAFC]">
                  <tr>
                    <th className="px-5 py-4 text-left text-sm font-semibold text-[#0F172A]">Nom</th>
                    <th className="px-5 py-4 text-left text-sm font-semibold text-[#0F172A]">Email</th>
                    <th className="px-5 py-4 text-left text-sm font-semibold text-[#0F172A]">Departement</th>
                    <th className="px-5 py-4 text-left text-sm font-semibold text-[#0F172A]">Fonction</th>
                    <th className="px-5 py-4 text-left text-sm font-semibold text-[#0F172A]">Envoi</th>
                    <th className="px-5 py-4 text-left text-sm font-semibold text-[#0F172A]">Expiration</th>
                    <th className="px-5 py-4 text-left text-sm font-semibold text-[#0F172A]">Statut</th>
                    <th className="px-5 py-4 text-left text-sm font-semibold text-[#0F172A]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {isInvitationsLoading ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-12 text-center text-sm text-[#64748B]">
                        Chargement des invitations...
                      </td>
                    </tr>
                  ) : invitations.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-5 py-12 text-center text-sm text-[#64748B]">
                        Aucune invitation envoyee pour le moment.
                      </td>
                    </tr>
                  ) : (
                    invitations.map((invitation) => (
                      <tr key={invitation.id} className="transition-colors hover:bg-[#F8FAFC]">
                        <td className="px-5 py-4 align-top">
                          <div className="space-y-1">
                            <p className="font-semibold text-[#0F172A]">{invitation.full_name}</p>
                            <p className="text-xs text-[#64748B]">{formatRoleLabel(invitation.role)}</p>
                          </div>
                        </td>
                        <td className="px-5 py-4 align-top text-sm text-[#475569]">
                          <div className="space-y-1">
                            <p>{invitation.email}</p>
                            <p className="text-xs text-[#94A3B8]">{invitation.phone || "Telephone non renseigne"}</p>
                          </div>
                        </td>
                        <td className="px-5 py-4 align-top text-sm text-[#475569]">
                          {invitation.department}
                        </td>
                        <td className="px-5 py-4 align-top text-sm text-[#475569]">
                          {invitation.job_title}
                        </td>
                        <td className="px-5 py-4 align-top text-sm text-[#475569]">
                          {formatDateTime(invitation.created_at)}
                        </td>
                        <td className="px-5 py-4 align-top text-sm text-[#475569]">
                          {formatDateTime(invitation.expiration_date)}
                        </td>
                        <td className="px-5 py-4 align-top">
                          <Badge className={getInvitationStatusBadgeClass(invitation.status)}>
                            {getInvitationStatusLabel(invitation.status)}
                          </Badge>
                        </td>
                        <td className="px-5 py-4 align-top">
                          <div className="flex min-w-[340px] flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => handleViewInvitation(invitation)}
                              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-[#475569] transition-all hover:-translate-y-0.5 hover:bg-[#F8FAFC]"
                            >
                              <Eye className="h-4 w-4" />
                              <span>Voir</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleResendInvitation(invitation)}
                              disabled={invitation.status === "accepted"}
                              className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-medium text-[#6D28D9] transition-all hover:-translate-y-0.5 hover:bg-violet-100"
                            >
                              <RefreshCw className="h-4 w-4" />
                              <span>Renvoyer</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleCancelInvitation(invitation.id)}
                              disabled={!canCancelInvitation(invitation)}
                              className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-[#B45309] transition-all hover:-translate-y-0.5 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-55"
                            >
                              <Ban className="h-4 w-4" />
                              <span>Annuler</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTargetInvitation(invitation)}
                              className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-[#DC2626] transition-all hover:-translate-y-0.5 hover:bg-red-100"
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
          </div>
        </section>
      ) : null}

      <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-[0_22px_60px_-40px_rgba(15,23,42,0.32)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#FDE68A] bg-[#FFFBEB] px-4 py-2 text-sm font-semibold text-[#B45309]">
              <Users2 className="h-4 w-4" />
              <span>Demandes en attente</span>
            </div>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight text-[#0F172A]">
              Validez ou refusez rapidement les inscriptions collaborateurs.
            </h2>
            <p className="mt-2 text-sm leading-7 text-[#64748B]">
              Les comptes issus du parcours collaborateur restent en attente tant qu'un administrateur ne prend pas de decision.
            </p>
          </div>
          <Badge className="w-fit border-[#FDE68A] bg-[#FFFBEB] text-[#B45309]">
            {pendingUsers.length} demande(s)
          </Badge>
        </div>

        <div className="mt-5 overflow-hidden rounded-[24px] border border-slate-200">
          <div className="overflow-x-auto">
            <table className="min-w-[860px] w-full">
              <thead className="border-b border-slate-200 bg-[#F8FAFC]">
                <tr>
                  <th className="px-5 py-4 text-left text-sm font-semibold text-[#0F172A]">Nom</th>
                  <th className="px-5 py-4 text-left text-sm font-semibold text-[#0F172A]">Email</th>
                  <th className="px-5 py-4 text-left text-sm font-semibold text-[#0F172A]">Departement</th>
                  <th className="px-5 py-4 text-left text-sm font-semibold text-[#0F172A]">Poste</th>
                  <th className="px-5 py-4 text-left text-sm font-semibold text-[#0F172A]">Date</th>
                  <th className="px-5 py-4 text-left text-sm font-semibold text-[#0F172A]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {pendingUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-sm text-[#64748B]">
                      Aucune demande en attente pour le moment.
                    </td>
                  </tr>
                ) : (
                  pendingUsers.map((pendingUser) => (
                    <tr key={pendingUser.id} className="transition-colors hover:bg-[#F8FAFC]">
                      <td className="px-5 py-4 align-top">
                        <div className="font-semibold text-[#0F172A]">{pendingUser.full_name}</div>
                      </td>
                      <td className="px-5 py-4 align-top text-sm text-[#475569]">{pendingUser.email}</td>
                      <td className="px-5 py-4 align-top text-sm text-[#475569]">
                        {pendingUser.department_name ?? pendingUser.requested_department ?? "Non renseigne"}
                      </td>
                      <td className="px-5 py-4 align-top text-sm text-[#475569]">
                        {pendingUser.job_profile ?? "Non renseignee"}
                      </td>
                      <td className="px-5 py-4 align-top text-sm text-[#475569]">
                        {formatDateTime(pendingUser.created_at)}
                      </td>
                      <td className="px-5 py-4 align-top">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setPendingStatusAction({
                                user: pendingUser,
                                nextStatus: "active",
                              })
                            }
                            className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-[#15803D] transition-all hover:-translate-y-0.5 hover:bg-emerald-100"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            <span>Accepter</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setPendingStatusAction({
                                user: pendingUser,
                                nextStatus: "rejected",
                              })
                            }
                            className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-[#DC2626] transition-all hover:-translate-y-0.5 hover:bg-red-100"
                          >
                            <XCircle className="h-4 w-4" />
                            <span>Refuser</span>
                          </button>
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
              <option value="company_admin">Admins entreprise</option>
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
              <option value="pending">En attente</option>
              <option value="rejected">Rejetes</option>
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
                    {(() => {
                      const isCurrentUserRow = isCurrentAdmin(item);
                      const canManageRow = canManageTargetUser(user, item);
                      const actionsDisabled = isCurrentUserRow || !canManageRow;
                      const disabledReason = isCurrentUserRow
                        ? "Vous ne pouvez pas modifier votre propre compte depuis cette action."
                        : "Un admin entreprise ne peut pas gerer les comptes administrateurs.";

                      return (
                        <>
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
                                  {isCurrentUserRow ? (
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
                              <span>{item.department_name ?? item.requested_department ?? "Non renseigne"}</span>
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
                                disabled={actionsDisabled}
                                onClick={() => openEditDialog(item)}
                                className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-[#1D4ED8] transition-all hover:-translate-y-0.5 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-55"
                                title={actionsDisabled ? disabledReason : undefined}
                              >
                                <Pencil className="h-4 w-4" />
                                <span>Modifier</span>
                              </button>

                              <button
                                type="button"
                                disabled={actionsDisabled}
                                onClick={() =>
                                  setPendingStatusAction({
                                    user: item,
                                    nextStatus: item.status === "active" ? "suspended" : "active",
                                  })
                                }
                                className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-[#B45309] transition-all hover:-translate-y-0.5 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-55"
                                title={actionsDisabled ? disabledReason : undefined}
                              >
                                <Power className="h-4 w-4" />
                                <span>
                                  {item.status === "active"
                                    ? "Suspendre"
                                    : item.status === "pending"
                                      ? "Valider"
                                      : "Activer"}
                                </span>
                              </button>

                              <button
                                type="button"
                                disabled={actionsDisabled}
                                onClick={() => openRoleDialog(item)}
                                className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-medium text-[#6D28D9] transition-all hover:-translate-y-0.5 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-55"
                                title={actionsDisabled ? disabledReason : undefined}
                              >
                                <UserCog className="h-4 w-4" />
                                <span>Changer role</span>
                              </button>

                              <button
                                type="button"
                                disabled={actionsDisabled}
                                onClick={() => setDeleteTargetUser(item)}
                                className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-[#DC2626] transition-all hover:-translate-y-0.5 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-55"
                                title={actionsDisabled ? disabledReason : undefined}
                              >
                                <Trash2 className="h-4 w-4" />
                                <span>Supprimer</span>
                              </button>
                            </div>
                          </td>
                        </>
                      );
                    })()}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <Dialog
        open={isInvitationDialogOpen}
        onOpenChange={(open) => !open && !isInvitationSubmitting && setIsInvitationDialogOpen(false)}
      >
        <DialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            invitationNameInputRef.current?.focus();
          }}
          className="w-[calc(100vw-1.5rem)] max-w-[1100px] overflow-hidden rounded-[36px] border border-white/55 bg-[linear-gradient(135deg,rgba(255,255,255,0.94)_0%,rgba(239,246,255,0.96)_42%,rgba(237,233,254,0.94)_100%)] p-0 shadow-[0_42px_140px_-56px_rgba(15,23,42,0.62)] backdrop-blur-2xl sm:max-w-[1100px]"
        >
          <motion.form
            onSubmit={(event) => void handleInvitationSubmit(event)}
            initial={{ opacity: 0, scale: 0.97, y: 18 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="flex max-h-[90vh] flex-col overflow-hidden"
          >
            <div className="relative flex-1 overflow-y-auto">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.17),transparent_58%),radial-gradient(circle_at_top_right,rgba(124,58,237,0.14),transparent_54%)]"
              />

              <div className="relative grid gap-0 md:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.9fr)] xl:grid-cols-[minmax(0,7fr)_minmax(320px,3fr)]">
                <div className="px-5 py-6 sm:px-7 sm:py-7 lg:px-9 lg:py-9">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/72 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-[#1D4ED8] shadow-[0_14px_30px_-24px_rgba(37,99,235,0.45)] backdrop-blur-xl">
                    <Mail className="h-4 w-4" />
                    <span>Invitation securisee</span>
                  </div>

                  <DialogHeader className="mt-5 max-w-2xl text-left">
                    <DialogTitle className="text-[clamp(2rem,2.8vw,2.45rem)] font-semibold tracking-tight text-[#0F172A]">
                      Inviter un collaborateur
                    </DialogTitle>
                    <DialogDescription className="max-w-2xl text-[15px] leading-7 text-[#475569]">
                      Renseignez l&apos;identite professionnelle du collaborateur. L&apos;invitation
                      sera envoyee par email avec un lien direct d&apos;inscription, deja rattache
                      a votre environnement FleetConnect IA.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="mt-8 space-y-5">
                    <div className="grid gap-5 md:grid-cols-2">
                      <label className="block">
                        <span className={INVITATION_LABEL_CLASS}>Nom complet</span>
                        <input
                          ref={invitationNameInputRef}
                          value={invitationFormState.full_name}
                          onChange={(event) =>
                            setInvitationFormState((currentState) => ({
                              ...currentState,
                              full_name: event.target.value,
                            }))
                          }
                          placeholder="Ex: Ahmed Benali"
                          className={INVITATION_CONTROL_CLASS}
                        />
                      </label>

                      <label className="block">
                        <span className={INVITATION_LABEL_CLASS}>Email professionnel</span>
                        <input
                          type="email"
                          value={invitationFormState.email}
                          onChange={(event) =>
                            setInvitationFormState((currentState) => ({
                              ...currentState,
                              email: event.target.value,
                            }))
                          }
                          placeholder="prenom.nom@entreprise.ma"
                          className={INVITATION_CONTROL_CLASS}
                        />
                      </label>
                    </div>

                    <div className="grid gap-5 md:grid-cols-2">
                      <label className="block">
                        <span className={INVITATION_LABEL_CLASS}>Telephone</span>
                        <input
                          value={invitationFormState.phone}
                          onChange={(event) =>
                            setInvitationFormState((currentState) => ({
                              ...currentState,
                              phone: event.target.value,
                            }))
                          }
                          placeholder="+212 6 00 00 00 00"
                          className={INVITATION_CONTROL_CLASS}
                        />
                      </label>

                      <label className="block">
                        <span className={INVITATION_LABEL_CLASS}>Departement</span>
                        <select
                          value={invitationFormState.departmentOption}
                          onChange={(event) =>
                            setInvitationFormState((currentState) => ({
                              ...currentState,
                              departmentOption: event.target.value,
                            }))
                          }
                          className={INVITATION_CONTROL_CLASS}
                        >
                          {invitationDepartmentOptions.map((department) => (
                            <option key={department} value={department}>
                              {department}
                            </option>
                          ))}
                          <option value="__other__">Autre</option>
                        </select>
                      </label>
                    </div>

                    <AnimatePresence initial={false}>
                      {invitationFormState.departmentOption === "__other__" ? (
                        <motion.div
                          initial={{ opacity: 0, y: -10, height: 0 }}
                          animate={{ opacity: 1, y: 0, height: "auto" }}
                          exit={{ opacity: 0, y: -10, height: 0 }}
                          transition={{ duration: 0.2, ease: "easeOut" }}
                          className="grid gap-5 overflow-hidden md:grid-cols-2"
                        >
                          <div className="hidden md:block" aria-hidden="true" />
                          <label className="block">
                            <span className={INVITATION_LABEL_CLASS}>Nouveau departement</span>
                            <input
                              value={invitationFormState.customDepartment}
                              onChange={(event) =>
                                setInvitationFormState((currentState) => ({
                                  ...currentState,
                                  customDepartment: event.target.value,
                                }))
                              }
                              placeholder="Saisir le departement"
                              className={INVITATION_CONTROL_CLASS}
                            />
                          </label>
                        </motion.div>
                      ) : null}
                    </AnimatePresence>

                    <div className="grid gap-5 md:grid-cols-2">
                      <label className="block">
                        <span className={INVITATION_LABEL_CLASS}>Fonction</span>
                        <select
                          value={invitationFormState.jobTitleOption}
                          onChange={(event) =>
                            setInvitationFormState((currentState) => ({
                              ...currentState,
                              jobTitleOption: event.target.value,
                            }))
                          }
                          className={INVITATION_CONTROL_CLASS}
                        >
                          {invitationJobTitleOptions.map((jobTitle) => (
                            <option key={jobTitle} value={jobTitle}>
                              {jobTitle}
                            </option>
                          ))}
                          <option value="__other__">Autre</option>
                        </select>
                      </label>

                      <label className="block">
                        <span className={INVITATION_LABEL_CLASS}>Expiration</span>
                        <select
                          value={invitationFormState.expiration}
                          onChange={(event) =>
                            setInvitationFormState((currentState) => ({
                              ...currentState,
                              expiration: event.target.value as ApiInvitationExpiration,
                            }))
                          }
                          className={INVITATION_CONTROL_CLASS}
                        >
                          {INVITATION_EXPIRATION_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <AnimatePresence initial={false}>
                      {invitationFormState.jobTitleOption === "__other__" ? (
                        <motion.div
                          initial={{ opacity: 0, y: -10, height: 0 }}
                          animate={{ opacity: 1, y: 0, height: "auto" }}
                          exit={{ opacity: 0, y: -10, height: 0 }}
                          transition={{ duration: 0.2, ease: "easeOut" }}
                          className="grid gap-5 overflow-hidden md:grid-cols-2"
                        >
                          <label className="block">
                            <span className={INVITATION_LABEL_CLASS}>Nom du poste</span>
                            <input
                              value={invitationFormState.customJobTitle}
                              onChange={(event) =>
                                setInvitationFormState((currentState) => ({
                                  ...currentState,
                                  customJobTitle: event.target.value,
                                }))
                              }
                              placeholder="Saisir la fonction"
                              className={INVITATION_CONTROL_CLASS}
                            />
                          </label>
                          <div className="hidden md:block" aria-hidden="true" />
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </div>
                </div>

                <aside className="border-t border-white/60 bg-[linear-gradient(180deg,rgba(248,250,252,0.72)_0%,rgba(219,234,254,0.5)_46%,rgba(237,233,254,0.58)_100%)] px-5 py-6 sm:px-7 sm:py-7 md:border-t-0 md:border-l md:border-white/60 lg:px-8">
                  <div className={`${INVITATION_SURFACE_CLASS} p-5 sm:p-6`}>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#64748B]">
                          Resume
                        </p>
                        <h3 className="mt-2 text-xl font-semibold tracking-tight text-[#0F172A]">
                          Resume de l&apos;invitation
                        </h3>
                      </div>
                      <div className="rounded-2xl bg-[linear-gradient(135deg,#2563EB_0%,#7C3AED_100%)] p-3 text-white shadow-[0_18px_34px_-18px_rgba(99,102,241,0.46)]">
                        <Building2 className="h-5 w-5" />
                      </div>
                    </div>

                    <div className="mt-6 space-y-4">
                      {[
                        { label: "Entreprise", value: invitationSummaryCompany },
                        {
                          label: "Departement",
                          value: resolveInvitationDepartment(invitationFormState) || "Finance",
                        },
                        {
                          label: "Fonction",
                          value: resolveInvitationJobTitle(invitationFormState) || "Analyste",
                        },
                        {
                          label: "Expiration",
                          value: getInvitationExpirationLabel(invitationFormState.expiration),
                        },
                      ].map((item) => (
                        <div
                          key={item.label}
                          className="rounded-[22px] border border-white/70 bg-white/82 px-4 py-3 shadow-[0_18px_36px_-28px_rgba(15,23,42,0.22)]"
                        >
                          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#94A3B8]">
                            {item.label}
                          </p>
                          <p className="mt-2 text-[15px] font-semibold text-[#0F172A]">
                            {item.value}
                          </p>
                        </div>
                      ))}
                    </div>

                    <div className="mt-5 rounded-[22px] border border-[#DBEAFE] bg-[linear-gradient(135deg,#EFF6FF_0%,#EEF2FF_100%)] px-4 py-4 shadow-[0_18px_34px_-24px_rgba(37,99,235,0.26)]">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#64748B]">
                        Statut
                      </p>
                      <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-[#BFDBFE] bg-white px-3 py-1.5 text-xs font-semibold text-[#1D4ED8]">
                        <CheckCircle2 className="h-4 w-4" />
                        <span>Invitation prete</span>
                      </div>
                    </div>
                  </div>
                </aside>
              </div>
            </div>

            <div className="border-t border-white/65 bg-white/76 px-5 py-4 backdrop-blur-xl sm:px-7 lg:px-9">
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setIsInvitationDialogOpen(false)}
                  disabled={isInvitationSubmitting}
                  className="inline-flex h-12 items-center justify-center rounded-2xl border border-slate-200/90 bg-white/90 px-5 text-sm font-medium text-[#475569] transition-all duration-200 hover:-translate-y-0.5 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isInvitationSubmitting}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#2563EB_0%,#7C3AED_100%)] px-5 text-sm font-semibold text-white shadow-[0_20px_38px_-20px_rgba(99,102,241,0.55)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_26px_44px_-20px_rgba(99,102,241,0.6)] disabled:cursor-not-allowed disabled:opacity-65"
                >
                  {isInvitationSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                  <span>{isInvitationSubmitting ? "Envoi..." : "Envoyer l'invitation"}</span>
                </button>
              </div>
            </div>
          </motion.form>
        </DialogContent>
      </Dialog>

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
                      {selectedUser.department_name ?? selectedUser.requested_department ?? "Non renseigne"}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">
                      Telephone
                    </p>
                    <p className="mt-2 text-sm font-semibold text-[#0F172A]">
                      {selectedUser.phone ?? "Non renseigne"}
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
                  <div className="rounded-2xl border border-slate-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-[#64748B]">
                      Fonction
                    </p>
                    <p className="mt-2 text-sm font-semibold text-[#0F172A]">
                      {selectedUser.job_profile ?? "Non renseignee"}
                    </p>
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap gap-3" data-export-ignore="true">
                  <button
                    type="button"
                    onClick={() => openEditDialog(selectedUser)}
                    disabled={!canManageTargetUser(user, selectedUser) || isCurrentAdmin(selectedUser)}
                    className="inline-flex items-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-medium text-[#1D4ED8] transition-all hover:-translate-y-0.5 hover:bg-blue-100"
                  >
                    <Pencil className="h-4 w-4" />
                    <span>Modifier</span>
                  </button>
                  <button
                    type="button"
                    disabled={!canManageTargetUser(user, selectedUser) || isCurrentAdmin(selectedUser)}
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
                    {assignableRoles.map((role) => (
                      <option key={role} value={role}>
                        {formatRoleLabel(role)}
                      </option>
                    ))}
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
                    <option value="pending">En attente</option>
                    <option value="rejected">Rejete</option>
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
                    {assignableRoles.map((role) => (
                      <option key={role} value={role}>
                        {formatRoleLabel(role)}
                      </option>
                    ))}
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
              <span className="block">
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
              </span>
              <span className="block">
                Les permissions du compte seront mises a jour immediatement apres validation.
              </span>
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
              {getPendingStatusDialogTitle(pendingStatusAction)}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3 text-sm leading-6 text-[#64748B]">
              <span className="block">
                {getPendingStatusDialogDescription(pendingStatusAction)}
              </span>
              <span className="block">
                Compte cible :{" "}
                <span className="font-semibold text-[#0F172A]">
                  {pendingStatusAction?.user.full_name}
                </span>
                .
              </span>
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
              {isSubmitting ? "Validation..." : getPendingStatusActionLabel(pendingStatusAction)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(deleteTargetInvitation)}
        onOpenChange={(open) => !open && !isInvitationSubmitting && setDeleteTargetInvitation(null)}
      >
        <AlertDialogContent className="rounded-[30px] border border-red-200 bg-white shadow-[0_30px_90px_-38px_rgba(15,23,42,0.28)]">
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle className="text-2xl font-semibold text-[#0F172A]">
              Supprimer cette invitation ?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3 text-sm leading-6 text-[#64748B]">
              <span className="block">
                Cette action retire definitivement l'invitation de la liste et empeche toute reutilisation ulterieure.
              </span>
              <span className="block">
                Invitation cible :{" "}
                <span className="font-semibold text-[#0F172A]">{deleteTargetInvitation?.email}</span>.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter className="gap-3">
            <AlertDialogCancel className="h-11 rounded-2xl border-slate-200 text-[#475569]">
              Annuler
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmInvitationDelete();
              }}
              className="h-11 rounded-2xl bg-[#DC2626] text-white hover:bg-[#B91C1C]"
            >
              {isInvitationSubmitting ? "Suppression..." : "Supprimer l'invitation"}
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
              <span className="block">
                Cette action supprimera le compte{" "}
                <span className="font-semibold text-[#0F172A]">
                  {deleteTargetUser?.full_name}
                </span>
                .
              </span>
              <span className="block">
                La suppression est irreversible. Si vous souhaitez simplement bloquer l&apos;acces,
                preferez la desactivation.
              </span>
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

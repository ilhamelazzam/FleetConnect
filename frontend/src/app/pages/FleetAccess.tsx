import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  Activity,
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  KeyRound,
  Laptop,
  Lock,
  PackagePlus,
  Phone,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Tablet,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "../components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { useAuth } from "../context/AuthContext";
import { useDepartments } from "../context/DepartmentsContext";
import {
  ApiError,
  fleetAccessApi,
  formatRoleLabel,
  type ApiDepartment,
  type ApiFleetResource,
  type ApiFleetResourceStatus,
  type ApiFleetResourceType,
  type ApiResourceComplianceOverview,
  type ApiResourceActiveAssignment,
  type ApiResourceAssignment,
  type ApiResourceUsagePolicyPayload,
  type ApiUser,
  type ApiUsageComplianceStatus,
  type ApiUsagePolicyMode,
  type ApiUsageSeverity,
} from "../lib/api";
import {
  areSameProfiles,
  getAllowedProfilesForPolicy,
  getAvailableFleetProfiles,
  getRecommendedProfilesForPolicy,
  getResourceProfilePolicy,
  isUserAuthorizedForResource,
  type ResourceProfileSelectionMode,
} from "../lib/fleet-access-profiles";
import {
  canAccessAdminCenter,
  canApplyOperationalChanges,
} from "../lib/roles";

const resourceTypes: Array<{ value: ApiFleetResourceType; label: string }> = [
  { value: "phone_line", label: "Ligne mobile" },
  { value: "mobile_phone", label: "Telephone mobile" },
  { value: "tablet", label: "Tablette" },
  { value: "laptop", label: "PC portable" },
  { value: "internet_connection", label: "Connexion internet" },
];

type ResourceFormState = {
  resourceType: ApiFleetResourceType;
  identifier: string;
  label: string;
  departmentId: string;
  isPremium: boolean;
  isShareable: boolean;
  maxAssignments: number;
  authorizedProfiles: string[];
  notes: string;
  profileSelectionMode: ResourceProfileSelectionMode;
};

function buildInitialResourceForm(): ResourceFormState {
  const defaultPolicy = getResourceProfilePolicy("phone_line", false);

  return {
    resourceType: "phone_line",
    identifier: "",
    label: "",
    departmentId: "",
    isPremium: false,
    isShareable: false,
    maxAssignments: 1,
    authorizedProfiles: [...defaultPolicy.recommended],
    notes: "",
    profileSelectionMode: "recommended",
  };
}

type UsagePolicyFormState = {
  policyMode: ApiUsagePolicyMode;
  acceptableUseRules: string;
  securityLevel: "standard" | "sensitive" | "critical";
  allowedCategories: string;
  restrictedCategories: string;
  exceptionRoles: string;
  complianceThreshold: number;
  monitoringEnabled: boolean;
  autoAlertEnabled: boolean;
  autoSuspendOnCritical: boolean;
};

type UsageLogFormState = {
  userId: string;
  activityType: string;
  activityCategory: string;
  activityLabel: string;
  usageVolumeMb: string;
  durationMinutes: string;
};

type FleetAccessView = "resources" | "governance" | "assignment" | "history";

function normalizeError(error: unknown, fallbackMessage: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallbackMessage;
}

function getResourceTypeLabel(type: ApiFleetResourceType): string {
  return resourceTypes.find((item) => item.value === type)?.label ?? type;
}

function getResourceIcon(type: ApiFleetResourceType) {
  if (type === "phone_line") return Phone;
  if (type === "mobile_phone") return Smartphone;
  if (type === "tablet") return Tablet;
  if (type === "internet_connection") return Activity;
  return Laptop;
}

function getStatusLabel(status: ApiFleetResourceStatus): string {
  if (status === "available") return "Disponible";
  if (status === "assigned") return "Attribuee";
  if (status === "suspended") return "Bloquee";
  return "Restreinte";
}

function getStatusClasses(status: ApiFleetResourceStatus): string {
  if (status === "available") return "border-emerald-200 bg-emerald-50 text-[#059669]";
  if (status === "assigned") return "border-blue-200 bg-blue-50 text-[#1D4ED8]";
  if (status === "suspended") return "border-red-200 bg-red-50 text-[#DC2626]";
  return "border-amber-200 bg-amber-50 text-[#D97706]";
}

function getComplianceLabel(status: ApiUsageComplianceStatus): string {
  if (status === "compliant") return "Conforme";
  if (status === "under_monitoring") return "Sous surveillance";
  if (status === "non_compliant") return "Non conforme";
  return "Bloque";
}

function getComplianceClasses(status: ApiUsageComplianceStatus): string {
  if (status === "compliant") return "border-emerald-200 bg-emerald-50 text-[#059669]";
  if (status === "under_monitoring") return "border-amber-200 bg-amber-50 text-[#D97706]";
  if (status === "non_compliant") return "border-red-200 bg-red-50 text-[#DC2626]";
  return "border-gray-300 bg-gray-100 text-[#334155]";
}

function getPolicyModeLabel(mode: ApiUsagePolicyMode): string {
  if (mode === "professional_only") return "Usage strictement professionnel";
  if (mode === "mixed_limited") return "Usage mixte limite";
  return "Usage libre controle";
}

function getSeverityLabel(severity: ApiUsageSeverity | null): string {
  if (severity === "critical") return "Critique";
  if (severity === "moderate") return "Moderee";
  if (severity === "warning") return "Avertissement";
  return "Info";
}

function parseProfiles(rawValue: string): string[] {
  return rawValue
    .split(",")
    .map((profile) => profile.trim())
    .filter(Boolean);
}

function resolveProfileSelectionMode(
  selectedProfiles: string[],
  recommendedProfiles: string[],
): ResourceProfileSelectionMode {
  if (selectedProfiles.length === 0) {
    return "open";
  }

  return areSameProfiles(selectedProfiles, recommendedProfiles)
    ? "recommended"
    : "custom";
}

function applyProfilesToForm(
  current: ResourceFormState,
  selectedProfiles: string[],
): ResourceFormState {
  const policy = getResourceProfilePolicy(current.resourceType, current.isPremium);
  const recommendedProfiles = [...policy.recommended];
  const normalizedProfiles = policy.allowed.filter((profile) => selectedProfiles.includes(profile));

  return {
    ...current,
    authorizedProfiles: normalizedProfiles,
    profileSelectionMode: resolveProfileSelectionMode(normalizedProfiles, recommendedProfiles),
  };
}

function syncResourceFormWithPolicy(
  current: ResourceFormState,
  updates: Partial<Pick<ResourceFormState, "resourceType" | "isPremium">>,
): ResourceFormState {
  const nextResourceType = updates.resourceType ?? current.resourceType;
  const nextIsPremium = updates.isPremium ?? current.isPremium;
  const nextPolicy = getResourceProfilePolicy(nextResourceType, nextIsPremium);
  const nextRecommendedProfiles = [...nextPolicy.recommended];

  if (current.profileSelectionMode === "open") {
    return {
      ...current,
      ...updates,
      authorizedProfiles: [],
      profileSelectionMode: "open",
    };
  }

  if (current.profileSelectionMode === "recommended") {
    return {
      ...current,
      ...updates,
      authorizedProfiles: [...nextRecommendedProfiles],
      profileSelectionMode: "recommended",
    };
  }

  const nextAllowedSelection = nextPolicy.allowed.filter((profile) =>
    current.authorizedProfiles.includes(profile),
  );

  if (nextAllowedSelection.length > 0) {
    return {
      ...current,
      ...updates,
      authorizedProfiles: nextAllowedSelection,
      profileSelectionMode: resolveProfileSelectionMode(
        nextAllowedSelection,
        nextRecommendedProfiles,
      ),
    };
  }

  return {
    ...current,
    ...updates,
    authorizedProfiles: [...nextRecommendedProfiles],
    profileSelectionMode: "recommended",
  };
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function isResourceBlocked(resource: ApiFleetResource): boolean {
  return resource.status === "suspended" || resource.status === "restricted";
}

function isResourceAlreadyAssignedToUser(resource: ApiFleetResource, userId: number): boolean {
  return resource.active_assignments.some((assignment) => assignment.user_id === userId);
}

export default function FleetAccess() {
  const { token, user } = useAuth();
  const { departments } = useDepartments();
  const canManageAssignments = canApplyOperationalChanges(user);
  const canCreateResources = canAccessAdminCenter(user);
  const [resources, setResources] = useState<ApiFleetResource[]>([]);
  const [assignments, setAssignments] = useState<ApiResourceAssignment[]>([]);
  const [assignableUsers, setAssignableUsers] = useState<ApiUser[]>([]);
  const [resourceForm, setResourceForm] = useState<ResourceFormState>(() => buildInitialResourceForm());
  const [selectedUserIdsByResource, setSelectedUserIdsByResource] = useState<Record<number, number[]>>({});
  const [reasonByResource, setReasonByResource] = useState<Record<number, string>>({});
  const [notesByResource, setNotesByResource] = useState<Record<number, string>>({});
  const [blockReasonByResource, setBlockReasonByResource] = useState<Record<number, string>>({});
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedResourceIdsForUser, setSelectedResourceIdsForUser] = useState<number[]>([]);
  const [userAssignmentReason, setUserAssignmentReason] = useState("");
  const [userAssignmentNotes, setUserAssignmentNotes] = useState("");
  const [selectedUserAssignments, setSelectedUserAssignments] = useState<ApiResourceAssignment[]>([]);
  const [governanceResourceId, setGovernanceResourceId] = useState("");
  const [activeView, setActiveView] = useState<FleetAccessView>("resources");
  const [expandedResourceId, setExpandedResourceId] = useState<number | null>(null);
  const [complianceOverview, setComplianceOverview] = useState<ApiResourceComplianceOverview | null>(null);
  const [isComplianceLoading, setIsComplianceLoading] = useState(false);
  const [policyForm, setPolicyForm] = useState<UsagePolicyFormState>({
    policyMode: "professional_only" as ApiUsagePolicyMode,
    acceptableUseRules: "",
    securityLevel: "standard" as "standard" | "sensitive" | "critical",
    allowedCategories: "",
    restrictedCategories: "",
    exceptionRoles: "",
    complianceThreshold: 85,
    monitoringEnabled: true,
    autoAlertEnabled: true,
    autoSuspendOnCritical: false,
  });
  const [usageLogForm, setUsageLogForm] = useState<UsageLogFormState>({
    userId: "",
    activityType: "navigation",
    activityCategory: "social_media",
    activityLabel: "",
    usageVolumeMb: "",
    durationMinutes: "",
  });
  const [isUserAssignmentsLoading, setIsUserAssignmentsLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function loadFleetAccess(): Promise<void> {
    if (!token) {
      setResources([]);
      setAssignments([]);
      setAssignableUsers([]);
      setSelectedUserAssignments([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const [resourceResponse, assignmentResponse, usersResponse] =
        await Promise.all([
          fleetAccessApi.resources(token),
          fleetAccessApi.assignments(token, true),
          fleetAccessApi.users(token),
        ]);

      setResources(resourceResponse);
      setAssignments(assignmentResponse);
      setAssignableUsers(usersResponse);
    } catch (error) {
      setErrorMessage(normalizeError(error, "Impossible de charger les acces aux ressources."));
    } finally {
      setIsLoading(false);
    }
  }

  async function loadSelectedUserAssignments(userId: string): Promise<void> {
    if (!token || !userId) {
      setSelectedUserAssignments([]);
      return;
    }

    setIsUserAssignmentsLoading(true);
    try {
      const response = await fleetAccessApi.userAssignments(token, Number(userId), true);
      setSelectedUserAssignments(response);
    } catch (error) {
      toast.error("Lecture utilisateur impossible", {
        description: normalizeError(error, "Impossible de charger les ressources de cet utilisateur."),
      });
    } finally {
      setIsUserAssignmentsLoading(false);
    }
  }

  function hydratePolicyForm(overview: ApiResourceComplianceOverview): void {
    setPolicyForm({
      policyMode: overview.policy.policy_mode,
      acceptableUseRules: overview.policy.acceptable_use_rules,
      securityLevel: overview.policy.security_level,
      allowedCategories: overview.policy.allowed_activity_categories.join(", "),
      restrictedCategories: overview.policy.restricted_activity_categories.join(", "),
      exceptionRoles: overview.policy.exception_roles.join(", "),
      complianceThreshold: overview.policy.compliance_threshold,
      monitoringEnabled: overview.policy.monitoring_enabled,
      autoAlertEnabled: overview.policy.auto_alert_enabled,
      autoSuspendOnCritical: overview.policy.auto_suspend_on_critical,
    });
  }

  async function loadResourceCompliance(resourceId: string): Promise<void> {
    if (!token || !resourceId) {
      setComplianceOverview(null);
      return;
    }

    setIsComplianceLoading(true);
    try {
      const response = await fleetAccessApi.resourceCompliance(token, Number(resourceId));
      setComplianceOverview(response);
      hydratePolicyForm(response);
    } catch (error) {
      toast.error("Conformite indisponible", {
        description: normalizeError(error, "Impossible de charger la gouvernance d'usage."),
      });
    } finally {
      setIsComplianceLoading(false);
    }
  }

  useEffect(() => {
    void loadFleetAccess();
  }, [token]);

  useEffect(() => {
    void loadSelectedUserAssignments(selectedUserId);
  }, [selectedUserId, token]);

  useEffect(() => {
    if (!governanceResourceId && resources.length > 0) {
      setGovernanceResourceId(String(resources[0].id));
    }
  }, [governanceResourceId, resources]);

  useEffect(() => {
    if (expandedResourceId !== null && !resources.some((resource) => resource.id === expandedResourceId)) {
      setExpandedResourceId(null);
    }
  }, [expandedResourceId, resources]);

  useEffect(() => {
    void loadResourceCompliance(governanceResourceId);
  }, [governanceResourceId, token]);

  const summary = useMemo(
    () => ({
      total: resources.length,
      available: resources.filter((resource) => resource.available_assignment_slots > 0).length,
      assigned: resources.filter((resource) => resource.active_assignment_count > 0).length,
      blocked: resources.filter(isResourceBlocked).length,
    }),
    [resources],
  );

  const activeAssignments = useMemo(
    () => assignments.filter((assignment) => assignment.status === "active"),
    [assignments],
  );

  const availableProfiles = useMemo(
    () => getAvailableFleetProfiles(assignableUsers, resources),
    [assignableUsers, resources],
  );

  function toggleResourceUser(resourceId: number, userId: number): void {
    setSelectedUserIdsByResource((current) => {
      const selectedIds = current[resourceId] ?? [];
      const nextSelectedIds = selectedIds.includes(userId)
        ? selectedIds.filter((selectedId) => selectedId !== userId)
        : [...selectedIds, userId];
      return { ...current, [resourceId]: nextSelectedIds };
    });
  }

  function toggleUserResource(resourceId: number): void {
    setSelectedResourceIdsForUser((current) =>
      current.includes(resourceId)
        ? current.filter((selectedId) => selectedId !== resourceId)
        : [...current, resourceId],
    );
  }

  async function refreshAfterMutation(): Promise<void> {
    await loadFleetAccess();
    if (selectedUserId) {
      await loadSelectedUserAssignments(selectedUserId);
    }
    if (governanceResourceId) {
      await loadResourceCompliance(governanceResourceId);
    }
  }

  async function handleCreateResource() {
    if (!token || !canCreateResources) return;

    setIsSubmitting(true);
    try {
      await fleetAccessApi.createResource(token, {
        resource_type: resourceForm.resourceType,
        identifier: resourceForm.identifier,
        label: resourceForm.label,
        department_id: resourceForm.departmentId ? Number(resourceForm.departmentId) : null,
        is_premium: resourceForm.isPremium,
        is_shareable: resourceForm.isShareable,
        max_assignments: resourceForm.isShareable ? resourceForm.maxAssignments : 1,
        authorized_profiles: resourceForm.authorizedProfiles,
        notes: resourceForm.notes || null,
      });
      setResourceForm(buildInitialResourceForm());
      toast.success("Ressource creee", {
        description: "La ressource est disponible avec ses limites d'attribution.",
      });
      await refreshAfterMutation();
    } catch (error) {
      toast.error("Creation impossible", {
        description: normalizeError(error, "Impossible de creer cette ressource."),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAssignResourceToUsers(resource: ApiFleetResource) {
    if (!token || !canManageAssignments) return;

    const selectedUserIds = selectedUserIdsByResource[resource.id] ?? [];
    if (selectedUserIds.length === 0) {
      toast.error("Utilisateur requis", { description: "Selectionnez au moins un utilisateur." });
      return;
    }

    setIsSubmitting(true);
    try {
      await fleetAccessApi.assignResourceToUsers(token, resource.id, {
        user_ids: selectedUserIds,
        assignment_reason: reasonByResource[resource.id] || null,
        notes: notesByResource[resource.id] || null,
      });
      setSelectedUserIdsByResource((current) => ({ ...current, [resource.id]: [] }));
      setReasonByResource((current) => ({ ...current, [resource.id]: "" }));
      setNotesByResource((current) => ({ ...current, [resource.id]: "" }));
      toast.success("Attribution effectuee", {
        description: `${resource.label} est liee a ${selectedUserIds.length} utilisateur(s).`,
      });
      await refreshAfterMutation();
    } catch (error) {
      toast.error("Attribution refusee", {
        description: normalizeError(error, "Les regles metier bloquent cette attribution."),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAssignResourcesToUser() {
    if (!token || !canManageAssignments) return;

    const userId = Number(selectedUserId);
    if (!userId) {
      toast.error("Utilisateur requis", { description: "Selectionnez un utilisateur cible." });
      return;
    }
    if (selectedResourceIdsForUser.length === 0) {
      toast.error("Ressource requise", { description: "Selectionnez au moins une ressource." });
      return;
    }

    setIsSubmitting(true);
    try {
      await fleetAccessApi.assignResourcesToUser(token, userId, {
        resource_ids: selectedResourceIdsForUser,
        assignment_reason: userAssignmentReason || null,
        notes: userAssignmentNotes || null,
      });
      setSelectedResourceIdsForUser([]);
      setUserAssignmentReason("");
      setUserAssignmentNotes("");
      toast.success("Ressources attribuees", {
        description: `${selectedResourceIdsForUser.length} ressource(s) liee(s) a l'utilisateur.`,
      });
      await refreshAfterMutation();
    } catch (error) {
      toast.error("Attribution refusee", {
        description: normalizeError(error, "Impossible d'attribuer ces ressources."),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRevokeAssignment(assignment: ApiResourceActiveAssignment | ApiResourceAssignment) {
    if (!token || !canManageAssignments) return;

    setIsSubmitting(true);
    try {
      await fleetAccessApi.revokeAssignment(token, assignment.id, {
        reason: "Retrait individuel depuis le centre d'acces flotte.",
      });
      toast.success("Attribution retiree", {
        description: "Le lien utilisateur-ressource a ete historise.",
      });
      await refreshAfterMutation();
    } catch (error) {
      toast.error("Retrait impossible", {
        description: normalizeError(error, "Impossible de retirer cette attribution."),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleBlockResource(resource: ApiFleetResource) {
    if (!token || !canManageAssignments) return;

    setIsSubmitting(true);
    try {
      await fleetAccessApi.blockResource(token, resource.id, {
        status: "suspended",
        reason: blockReasonByResource[resource.id] || "Blocage temporaire par le gestionnaire.",
      });
      toast.success("Acces bloque", { description: `${resource.label} est suspendue temporairement.` });
      await refreshAfterMutation();
    } catch (error) {
      toast.error("Blocage impossible", {
        description: normalizeError(error, "Impossible de bloquer cette ressource."),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleUnblockResource(resource: ApiFleetResource) {
    if (!token || !canManageAssignments) return;

    setIsSubmitting(true);
    try {
      await fleetAccessApi.unblockResource(token, resource.id);
      toast.success("Acces restaure", { description: `${resource.label} est de nouveau exploitable.` });
      await refreshAfterMutation();
    } catch (error) {
      toast.error("Deblocage impossible", {
        description: normalizeError(error, "Impossible de debloquer cette ressource."),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSaveUsagePolicy() {
    if (!token || !canCreateResources || !governanceResourceId) return;

    const restrictedCategories = parseProfiles(policyForm.restrictedCategories).map((item) =>
      item.toLowerCase().replace(/\s+/g, "_"),
    );
    const payload: ApiResourceUsagePolicyPayload = {
      policy_mode: policyForm.policyMode,
      acceptable_use_rules: policyForm.acceptableUseRules,
      security_level: policyForm.securityLevel,
      allowed_activity_categories: parseProfiles(policyForm.allowedCategories).map((item) =>
        item.toLowerCase().replace(/\s+/g, "_"),
      ),
      restricted_activity_categories: restrictedCategories,
      exception_roles: parseProfiles(policyForm.exceptionRoles).map((item) => item.toLowerCase()),
      exception_department_ids: [],
      monitoring_enabled: policyForm.monitoringEnabled,
      auto_alert_enabled: policyForm.autoAlertEnabled,
      auto_suspend_on_critical: policyForm.autoSuspendOnCritical,
      compliance_threshold: policyForm.complianceThreshold,
      restrictions: restrictedCategories.map((category) => ({
        category,
        action: policyForm.autoSuspendOnCritical ? "block" : "alert",
        severity: policyForm.securityLevel === "critical" ? "critical" : "moderate",
        exception_roles: [],
        exception_department_ids: [],
        notes: "Restriction configuree depuis le centre de gouvernance.",
        is_active: true,
      })),
    };

    setIsSubmitting(true);
    try {
      await fleetAccessApi.updateUsagePolicy(token, Number(governanceResourceId), payload);
      toast.success("Politique mise a jour", {
        description: "Les regles d'usage professionnel sont appliquees a la ressource.",
      });
      await refreshAfterMutation();
    } catch (error) {
      toast.error("Mise a jour refusee", {
        description: normalizeError(error, "Impossible de mettre a jour la politique."),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRecordUsageLog() {
    if (!token || !governanceResourceId) return;

    const userId = Number(usageLogForm.userId);
    if (!userId) {
      toast.error("Utilisateur requis", {
        description: "Selectionnez l'utilisateur associe a l'usage observe.",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await fleetAccessApi.recordUsageLog(token, Number(governanceResourceId), {
        user_id: userId,
        activity_type: usageLogForm.activityType,
        activity_category: usageLogForm.activityCategory,
        activity_label: usageLogForm.activityLabel || null,
        usage_volume_mb: usageLogForm.usageVolumeMb ? Number(usageLogForm.usageVolumeMb) : null,
        duration_minutes: usageLogForm.durationMinutes ? Number(usageLogForm.durationMinutes) : null,
      });
      setUsageLogForm((current) => ({
        ...current,
        activityLabel: "",
        usageVolumeMb: "",
        durationMinutes: "",
      }));
      toast.success("Usage enregistre", {
        description: "Le log a ete evalue selon la politique de conformite.",
      });
      await refreshAfterMutation();
    } catch (error) {
      toast.error("Enregistrement impossible", {
        description: normalizeError(error, "Impossible d'enregistrer ce log d'usage."),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResolveComplianceAlert(alertId: number) {
    if (!token || !canManageAssignments) return;

    setIsSubmitting(true);
    try {
      await fleetAccessApi.resolveComplianceAlert(token, alertId, "Incident traite depuis Acces flotte.");
      toast.success("Incident resolu", { description: "L'alerte de conformite est historisee." });
      await refreshAfterMutation();
    } catch (error) {
      toast.error("Resolution impossible", {
        description: normalizeError(error, "Impossible de resoudre cette alerte."),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-5 p-6">
      <section className="overflow-hidden rounded-[28px] bg-[linear-gradient(135deg,#0F172A,#1D4ED8_58%,#06B6D4)] p-6 text-white shadow-[0_26px_80px_-48px_rgba(29,78,216,0.9)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.28em] text-white/70">Fleet Access</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">Acces aux ressources de flotte</h1>
            <p className="mt-2 text-sm text-white/80">
              Vue compacte des ressources, attributions et regles d'usage.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadFleetAccess()}
            disabled={isLoading}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-[#1D4ED8] transition-all hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            <span>Rafraichir</span>
          </button>
        </div>
      </section>

      {errorMessage ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {errorMessage}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="Ressources" value={summary.total} icon={KeyRound} tone="blue" />
        <SummaryCard title="Disponibles" value={summary.available} icon={CheckCircle2} tone="green" />
        <SummaryCard title="Attributions" value={activeAssignments.length} icon={Users} tone="blue" />
        <SummaryCard title="Bloquees" value={summary.blocked} icon={Lock} tone="red" />
      </div>

      <Tabs
        value={activeView}
        onValueChange={(value) => setActiveView(value as FleetAccessView)}
        className="gap-4"
      >
        <TabsList className="grid h-auto w-full grid-cols-2 gap-3 bg-transparent p-0 xl:grid-cols-4">
          <TabsTrigger
            value="resources"
            className="h-auto rounded-2xl border border-[#DCE5F1] bg-white px-4 py-4 text-left data-[state=active]:border-[#93C5FD] data-[state=active]:bg-[#EFF6FF]"
          >
            <div className="w-full text-left">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-[#0F172A]">Ressources</span>
                <Badge className="border-blue-200 bg-blue-50 text-[#2563EB]">{summary.total}</Badge>
              </div>
              <p className="mt-2 text-xs leading-5 text-[#64748B]">Cartes compactes, un seul detail ouvert.</p>
            </div>
          </TabsTrigger>
          <TabsTrigger
            value="governance"
            className="h-auto rounded-2xl border border-[#DCE5F1] bg-white px-4 py-4 text-left data-[state=active]:border-[#C4B5FD] data-[state=active]:bg-[#F5F3FF]"
          >
            <div className="w-full text-left">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-[#0F172A]">Gouvernance</span>
                <Badge className="border-violet-200 bg-violet-50 text-[#7C3AED]">
                  {complianceOverview?.open_alert_count ?? 0}
                </Badge>
              </div>
              <p className="mt-2 text-xs leading-5 text-[#64748B]">Conformite, politique et incidents.</p>
            </div>
          </TabsTrigger>
          <TabsTrigger
            value="assignment"
            className="h-auto rounded-2xl border border-[#DCE5F1] bg-white px-4 py-4 text-left data-[state=active]:border-[#86EFAC] data-[state=active]:bg-[#ECFDF5]"
          >
            <div className="w-full text-left">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-[#0F172A]">Attribution</span>
                <Badge className="border-emerald-200 bg-emerald-50 text-[#059669]">
                  {selectedUserAssignments.filter((assignment) => assignment.status === "active").length}
                </Badge>
              </div>
              <p className="mt-2 text-xs leading-5 text-[#64748B]">Vue utilisateur et attribution multiple.</p>
            </div>
          </TabsTrigger>
          <TabsTrigger
            value="history"
            className="h-auto rounded-2xl border border-[#DCE5F1] bg-white px-4 py-4 text-left data-[state=active]:border-[#FCD34D] data-[state=active]:bg-[#FFFBEB]"
          >
            <div className="w-full text-left">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-[#0F172A]">Historique</span>
                <Badge className="border-amber-200 bg-amber-50 text-[#D97706]">
                  {assignments.slice(0, 10).length}
                </Badge>
              </div>
              <p className="mt-2 text-xs leading-5 text-[#64748B]">Dernieres distributions visibles.</p>
            </div>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="resources" className="mt-0 space-y-4">
          {canCreateResources ? (
            <CreateResourcePanel
              availableProfiles={availableProfiles}
              departments={departments}
              isSubmitting={isSubmitting}
              resourceForm={resourceForm}
              onResourceFormChange={setResourceForm}
              onCreate={() => void handleCreateResource()}
            />
          ) : null}

          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-[#0F172A]">Ressources</h2>
                <p className="mt-1 text-sm text-[#64748B]">
                  Vue compacte par ressource, avec details a la demande.
                </p>
              </div>
              <Badge className="border-[#DCE5F1] bg-[#F8FAFC] px-3 py-1 text-[#475569]">
                Une seule carte detaillee a la fois
              </Badge>
            </div>

            <div className="mt-4 space-y-3">
              {isLoading ? (
                <div className="rounded-2xl border border-gray-200 bg-white px-6 py-12 text-center text-sm text-[#64748B]">
                  Chargement des ressources...
                </div>
              ) : resources.length === 0 ? (
                <div className="rounded-2xl border border-gray-200 bg-white px-6 py-12 text-center text-sm text-[#64748B]">
                  Aucune ressource accessible avec votre role actuel.
                </div>
              ) : (
                resources.map((resource) => (
                  <ResourceCard
                    key={resource.id}
                    resource={resource}
                    users={assignableUsers}
                    canManage={canManageAssignments}
                    isSubmitting={isSubmitting}
                    isOpen={expandedResourceId === resource.id}
                    selectedUserIds={selectedUserIdsByResource[resource.id] ?? []}
                    reason={reasonByResource[resource.id] ?? ""}
                    notes={notesByResource[resource.id] ?? ""}
                    blockReason={blockReasonByResource[resource.id] ?? ""}
                    onToggleOpen={() =>
                      setExpandedResourceId((current) => (current === resource.id ? null : resource.id))
                    }
                    onToggleUser={(userId) => toggleResourceUser(resource.id, userId)}
                    onReasonChange={(value) =>
                      setReasonByResource((current) => ({ ...current, [resource.id]: value }))
                    }
                    onNotesChange={(value) =>
                      setNotesByResource((current) => ({ ...current, [resource.id]: value }))
                    }
                    onBlockReasonChange={(value) =>
                      setBlockReasonByResource((current) => ({ ...current, [resource.id]: value }))
                    }
                    onAssign={() => void handleAssignResourceToUsers(resource)}
                    onRevoke={(assignment) => void handleRevokeAssignment(assignment)}
                    onBlock={() => void handleBlockResource(resource)}
                    onUnblock={() => void handleUnblockResource(resource)}
                    onShowUserResources={(userId) => {
                      setSelectedUserId(String(userId));
                      setActiveView("assignment");
                    }}
                  />
                ))
              )}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="governance" className="mt-0">
          <UsageGovernancePanel
            resources={resources}
            selectedResourceId={governanceResourceId}
            overview={complianceOverview}
            isLoading={isComplianceLoading}
            isSubmitting={isSubmitting}
            canConfigure={canCreateResources}
            canManage={canManageAssignments}
            policyForm={policyForm}
            usageLogForm={usageLogForm}
            onSelectedResourceChange={setGovernanceResourceId}
            onPolicyFormChange={setPolicyForm}
            onUsageLogFormChange={setUsageLogForm}
            onSavePolicy={() => void handleSaveUsagePolicy()}
            onRecordUsage={() => void handleRecordUsageLog()}
            onResolveAlert={(alertId) => void handleResolveComplianceAlert(alertId)}
          />
        </TabsContent>

        <TabsContent value="assignment" className="mt-0">
          <UserResourcePanel
            users={assignableUsers}
            resources={resources}
            selectedUserId={selectedUserId}
            selectedResourceIds={selectedResourceIdsForUser}
            assignments={selectedUserAssignments}
            isLoading={isUserAssignmentsLoading}
            isSubmitting={isSubmitting}
            canManage={canManageAssignments}
            reason={userAssignmentReason}
            notes={userAssignmentNotes}
            onSelectedUserChange={setSelectedUserId}
            onToggleResource={toggleUserResource}
            onReasonChange={setUserAssignmentReason}
            onNotesChange={setUserAssignmentNotes}
            onAssign={() => void handleAssignResourcesToUser()}
            onRevoke={(assignment) => void handleRevokeAssignment(assignment)}
          />
        </TabsContent>

        <TabsContent value="history" className="mt-0">
          <AssignmentHistory assignments={assignments} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CreateResourcePanel({
  availableProfiles,
  departments,
  isSubmitting,
  resourceForm,
  onResourceFormChange,
  onCreate,
}: {
  availableProfiles: string[];
  departments: ApiDepartment[];
  isSubmitting: boolean;
  resourceForm: ResourceFormState;
  onResourceFormChange: Dispatch<SetStateAction<ResourceFormState>>;
  onCreate: () => void;
}) {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const policy = getResourceProfilePolicy(resourceForm.resourceType, resourceForm.isPremium);
  const recommendedProfiles = getRecommendedProfilesForPolicy(policy, availableProfiles);
  const allowedProfiles = getAllowedProfilesForPolicy(policy, availableProfiles);
  const additionalProfiles = allowedProfiles.filter(
    (profile) =>
      !recommendedProfiles.includes(profile) && !resourceForm.authorizedProfiles.includes(profile),
  );

  const selectionTone =
    resourceForm.profileSelectionMode === "recommended"
      ? "Profils recommandes appliques"
      : resourceForm.profileSelectionMode === "custom"
        ? "Selection personnalisee"
        : "Ressource ouverte a tous les profils";

  function toggleAuthorizedProfile(profile: string): void {
    onResourceFormChange((current) => {
      const nextProfiles = current.authorizedProfiles.includes(profile)
        ? current.authorizedProfiles.filter((item) => item !== profile)
        : [...current.authorizedProfiles, profile];

      return applyProfilesToForm(current, nextProfiles);
    });
  }

  function applyRecommendedProfiles(): void {
    onResourceFormChange((current) => ({
      ...current,
      authorizedProfiles: [...recommendedProfiles],
      profileSelectionMode: recommendedProfiles.length > 0 ? "recommended" : "open",
    }));
  }

  function clearAuthorizedProfiles(): void {
    onResourceFormChange((current) => ({
      ...current,
      authorizedProfiles: [],
      profileSelectionMode: "open",
    }));
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[#0F172A]">Ajouter une ressource</h2>
          <p className="mt-1 text-sm text-[#64748B]">Formulaire reduit, profils proposes selon le type.</p>
        </div>
        <Badge className="w-fit border-[#DCE5F1] bg-[#F8FAFC] px-3 py-1 text-[#475569]">
          {policy.title}
        </Badge>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1.1fr_1fr_1fr_auto]">
        <select
          value={resourceForm.resourceType}
          onChange={(event) =>
            onResourceFormChange((current) =>
              syncResourceFormWithPolicy(current, {
                resourceType: event.target.value as ApiFleetResourceType,
              }),
            )
          }
          className="rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm"
        >
          {resourceTypes.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={resourceForm.label}
          onChange={(event) =>
            onResourceFormChange((current) => ({ ...current, label: event.target.value }))
          }
          placeholder="Libelle"
          className="rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm"
        />
        <input
          type="text"
          value={resourceForm.identifier}
          onChange={(event) =>
            onResourceFormChange((current) => ({ ...current, identifier: event.target.value }))
          }
          placeholder="Identifiant / IMEI / numero"
          className="rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm"
        />
        <select
          value={resourceForm.departmentId}
          onChange={(event) =>
            onResourceFormChange((current) => ({ ...current, departmentId: event.target.value }))
          }
          className="rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm"
        >
          <option value="">Aucun service reserve</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onCreate}
          disabled={isSubmitting || !resourceForm.identifier || !resourceForm.label}
          className="inline-flex items-center justify-center rounded-xl bg-[#2D6CDF] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60"
        >
          Creer
        </button>
      </div>

      <div className="mt-4 rounded-2xl border border-[#DCE5F1] bg-[#F8FAFC] p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-[#0F172A]">Profils autorises</p>
              <Badge className="border-gray-200 bg-white text-[#475569]">{selectionTone}</Badge>
              {resourceForm.isPremium ? (
                <Badge className="border-violet-200 bg-violet-50 text-[#6D28D9]">Premium</Badge>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-[#64748B]">
              Selectionnez uniquement les profils ayant un besoin reel d'usage.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={applyRecommendedProfiles}
              disabled={isSubmitting || areSameProfiles(resourceForm.authorizedProfiles, recommendedProfiles)}
              className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-[#1D4ED8] transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <CheckCircle2 className="h-4 w-4" />
              Recommandation
            </button>
            <button
              type="button"
              onClick={clearAuthorizedProfiles}
              disabled={isSubmitting || resourceForm.authorizedProfiles.length === 0}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-[#475569] transition-colors hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Ban className="h-4 w-4" />
              Ouvrir a tous
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {recommendedProfiles.map((profile) => {
            const isSelected = resourceForm.authorizedProfiles.includes(profile);

            return (
              <button
                key={profile}
                type="button"
                onClick={() => toggleAuthorizedProfile(profile)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  isSelected
                    ? "border-blue-200 bg-blue-50 text-[#1D4ED8]"
                    : "border-gray-200 bg-white text-[#475569] hover:bg-[#EFF6FF]"
                }`}
              >
                <span>{profile}</span>
                {isSelected ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
              </button>
            );
          })}
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="rounded-xl border border-white bg-white p-3">
            <p className="text-xs uppercase tracking-[0.16em] text-[#64748B]">Selection en cours</p>
            {resourceForm.authorizedProfiles.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {resourceForm.authorizedProfiles.map((profile) => (
                  <button
                    key={profile}
                    type="button"
                    onClick={() => toggleAuthorizedProfile(profile)}
                    className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-[#1D4ED8] hover:bg-blue-100"
                  >
                    <span>{profile}</span>
                    <X className="h-3.5 w-3.5" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-[#64748B]">
                Aucun profil selectionne : ressource accessible a tous.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-white bg-white p-3">
            <p className="text-xs uppercase tracking-[0.16em] text-[#64748B]">Ajouter un profil coherent</p>
            <select
              value=""
              onChange={(event) => {
                const nextProfile = event.target.value;
                if (!nextProfile) return;
                toggleAuthorizedProfile(nextProfile);
              }}
              disabled={isSubmitting || additionalProfiles.length === 0}
              className="mt-2 w-full rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm"
            >
              <option value="">
                {additionalProfiles.length > 0 ? "Choisir un profil autorise" : "Aucun profil additionnel"}
              </option>
              {additionalProfiles.map((profile) => (
                <option key={profile} value={profile}>
                  {profile}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-[#64748B]">{policy.guidance}</p>
          </div>
        </div>
      </div>

      <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
        <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-[#0F172A]">Options avancees</p>
              <p className="mt-1 text-xs text-[#64748B]">Premium, partage, capacite et notes.</p>
            </div>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-[#475569] hover:bg-[#F8FAFC]"
              >
                {isAdvancedOpen ? "Masquer" : "Options avancees"}
                {isAdvancedOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            </CollapsibleTrigger>
          </div>

          <CollapsibleContent className="space-y-3 pt-4">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm font-medium text-[#0F172A]">
                <input
                  type="checkbox"
                  checked={resourceForm.isPremium}
                  onChange={(event) =>
                    onResourceFormChange((current) =>
                      syncResourceFormWithPolicy(current, {
                        isPremium: event.target.checked,
                      }),
                    )
                  }
                  className="h-4 w-4"
                />
                Ressource premium
              </label>
              <label className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm font-medium text-[#0F172A]">
                <input
                  type="checkbox"
                  checked={resourceForm.isShareable}
                  onChange={(event) =>
                    onResourceFormChange((current) => ({
                      ...current,
                      isShareable: event.target.checked,
                      maxAssignments: event.target.checked ? current.maxAssignments : 1,
                    }))
                  }
                  className="h-4 w-4"
                />
                Ressource partageable
              </label>
              <input
                type="number"
                min={1}
                max={500}
                value={resourceForm.maxAssignments}
                disabled={!resourceForm.isShareable}
                onChange={(event) =>
                  onResourceFormChange((current) => ({
                    ...current,
                    maxAssignments: Math.max(1, Number(event.target.value) || 1),
                  }))
                }
                placeholder="Nombre maximal"
                className="rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm disabled:opacity-60"
              />
            </div>

            <textarea
              value={resourceForm.notes}
              onChange={(event) =>
                onResourceFormChange((current) => ({ ...current, notes: event.target.value }))
              }
              rows={2}
              placeholder="Notes internes"
              className="w-full resize-none rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm"
            />
          </CollapsibleContent>
        </div>
      </Collapsible>
    </section>
  );
}

function SummaryCard({
  title,
  value,
  icon: Icon,
  tone,
}: {
  title: string;
  value: number;
  icon: typeof KeyRound;
  tone: "blue" | "green" | "red";
}) {
  const toneClasses = {
    blue: "from-[#2D6CDF] to-[#06B6D4]",
    green: "from-[#16A34A] to-[#10B981]",
    red: "from-[#DC2626] to-[#F97316]",
  }[tone];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-[#64748B]">{title}</p>
          <p className="mt-1.5 text-2xl font-bold text-[#0F172A]">{value}</p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br ${toneClasses} text-white`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function ResourceCard({
  resource,
  users,
  canManage,
  isSubmitting,
  isOpen,
  selectedUserIds,
  reason,
  notes,
  blockReason,
  onToggleOpen,
  onToggleUser,
  onReasonChange,
  onNotesChange,
  onBlockReasonChange,
  onAssign,
  onRevoke,
  onBlock,
  onUnblock,
  onShowUserResources,
}: {
  resource: ApiFleetResource;
  users: ApiUser[];
  canManage: boolean;
  isSubmitting: boolean;
  isOpen: boolean;
  selectedUserIds: number[];
  reason: string;
  notes: string;
  blockReason: string;
  onToggleOpen: () => void;
  onToggleUser: (userId: number) => void;
  onReasonChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onBlockReasonChange: (value: string) => void;
  onAssign: () => void;
  onRevoke: (assignment: ApiResourceActiveAssignment) => void;
  onBlock: () => void;
  onUnblock: () => void;
  onShowUserResources: (userId: number) => void;
}) {
  const Icon = getResourceIcon(resource.resource_type);
  const isBlocked = isResourceBlocked(resource);
  const assignableUsers = users.filter((item) => !isResourceAlreadyAssignedToUser(resource, item.id));
  const eligibleAssignableUsers = assignableUsers.filter((item) =>
    isUserAuthorizedForResource(item, resource),
  );
  const hiddenAssignableUsersCount = assignableUsers.length - eligibleAssignableUsers.length;
  const selectedUserCount = selectedUserIds.length;
  const canAssignMore = canManage && !isBlocked && resource.available_assignment_slots > 0;
  const primaryAssignment = resource.active_assignments[0] ?? null;
  const profileSummary =
    resource.authorized_profiles.length > 0
      ? resource.authorized_profiles.slice(0, 2).join(", ")
      : "Tous profils";

  return (
    <article className={`rounded-2xl border bg-white p-4 shadow-sm transition-all ${isOpen ? "border-[#93C5FD]" : "border-gray-200"}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#2D6CDF]">
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-base font-semibold text-[#0F172A]">{resource.label}</h3>
                <Badge className={getStatusClasses(resource.status)}>{getStatusLabel(resource.status)}</Badge>
                {resource.is_premium ? (
                  <Badge className="border-violet-200 bg-violet-50 text-[#6D28D9]">Premium</Badge>
                ) : null}
              </div>
              <p className="mt-1 truncate text-sm text-[#64748B]">
                {getResourceTypeLabel(resource.resource_type)} • {resource.identifier}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#64748B]">
                <span>
                  Principal: {primaryAssignment ? primaryAssignment.user_name : profileSummary}
                </span>
                <span>
                  Disponibilite: {resource.available_assignment_slots} place(s)
                </span>
                <span>{resource.department_name ?? "Sans service reserve"}</span>
                <span>
                  {getComplianceLabel(resource.usage_compliance_status)} {resource.usage_compliance_score}%
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge className="border-gray-200 bg-[#F8FAFC] text-[#475569]">
            {resource.is_shareable
              ? `${resource.active_assignment_count}/${resource.max_assignments} utilisees`
              : resource.active_assignment_count > 0
                ? "Occupee"
                : "Disponible"}
          </Badge>
          <button
            type="button"
            onClick={onToggleOpen}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-[#0F172A] transition-colors hover:bg-[#F8FAFC]"
          >
            <Eye className="h-4 w-4" />
            {isOpen ? "Masquer" : "Voir details"}
          </button>
        </div>
      </div>

      {isOpen ? (
        <div className="mt-4 space-y-4 border-t border-gray-100 pt-4">
          {resource.restriction_reason ? (
            <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-[#B91C1C]">
              {resource.restriction_reason}
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-[#0F172A]">Utilisateurs lies</p>
                    <p className="mt-1 text-xs text-[#64748B]">
                      {resource.active_assignment_count} attribution(s) active(s)
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {resource.authorized_profiles.length > 0 ? (
                      resource.authorized_profiles.map((profile) => (
                        <Badge key={profile} className="border-blue-200 bg-blue-50 text-[#1D4ED8]">
                          {profile}
                        </Badge>
                      ))
                    ) : (
                      <Badge className="border-gray-200 bg-white text-[#475569]">Tous profils autorises</Badge>
                    )}
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {resource.active_assignments.map((assignment) => (
                    <div key={assignment.id} className="rounded-lg border border-gray-200 bg-white p-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-[#0F172A]">{assignment.user_name}</p>
                          <p className="mt-1 truncate text-xs text-[#64748B]">{assignment.user_email}</p>
                          <p className="mt-2 text-xs text-[#94A3B8]">
                            {formatDateTime(assignment.assigned_at)}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => onShowUserResources(assignment.user_id)}
                            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-[#475569] hover:bg-[#F8FAFC]"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            Voir ressources
                          </button>
                          {canManage ? (
                            <button
                              type="button"
                              onClick={() => onRevoke(assignment)}
                              disabled={isSubmitting}
                              className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-[#DC2626] hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <X className="h-3.5 w-3.5" />
                              Retirer
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}

                  {resource.active_assignments.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-gray-200 bg-white px-4 py-6 text-center text-sm text-[#64748B]">
                      Aucun utilisateur lie.
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            {canManage ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[#0F172A]">Attribuer</p>
                      <p className="mt-1 text-xs text-[#64748B]">
                        {resource.available_assignment_slots} place(s) restante(s)
                      </p>
                    </div>
                    <UserPlus className="h-5 w-5 text-[#2D6CDF]" />
                  </div>

                  <div className="mt-3 max-h-48 space-y-2 overflow-auto pr-1">
                    {eligibleAssignableUsers.map((item) => {
                      const isSelected = selectedUserIds.includes(item.id);
                      const isDisabled =
                        !canAssignMore ||
                        (!isSelected && selectedUserCount >= resource.available_assignment_slots);

                      return (
                        <label
                          key={item.id}
                          className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
                            isSelected
                              ? "border-blue-200 bg-blue-50 text-[#1D4ED8]"
                              : "border-gray-200 bg-white text-[#475569]"
                          } ${isDisabled ? "cursor-not-allowed opacity-50" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={isDisabled}
                            onChange={() => onToggleUser(item.id)}
                            className="h-4 w-4"
                          />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold">{item.full_name}</span>
                            <span className="block truncate text-xs">
                              {item.job_profile ?? formatRoleLabel(item.role)}
                            </span>
                          </span>
                        </label>
                      );
                    })}

                    {eligibleAssignableUsers.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-gray-200 px-4 py-5 text-center text-sm text-[#64748B]">
                        Aucun profil compatible.
                      </div>
                    ) : null}
                  </div>

                  {hiddenAssignableUsersCount > 0 ? (
                    <p className="mt-3 text-xs text-[#64748B]">
                      {hiddenAssignableUsersCount} utilisateur(s) masque(s) car non autorise(s).
                    </p>
                  ) : null}

                  <input
                    type="text"
                    value={reason}
                    onChange={(event) => onReasonChange(event.target.value)}
                    placeholder="Motif"
                    className="mt-3 w-full rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm"
                  />
                  <textarea
                    value={notes}
                    onChange={(event) => onNotesChange(event.target.value)}
                    placeholder="Notes"
                    rows={2}
                    className="mt-3 w-full resize-none rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm"
                  />
                  <button
                    type="button"
                    onClick={onAssign}
                    disabled={isSubmitting || selectedUserCount === 0 || !canAssignMore}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#2D6CDF] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <UserPlus className="h-4 w-4" />
                    Attribuer
                  </button>
                </div>

                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <p className="text-sm font-semibold text-[#0F172A]">Statut d'acces</p>
                  <input
                    type="text"
                    value={blockReason}
                    onChange={(event) => onBlockReasonChange(event.target.value)}
                    placeholder="Motif de blocage"
                    className="mt-3 w-full rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm"
                  />

                  {isBlocked ? (
                    <button
                      type="button"
                      onClick={onUnblock}
                      disabled={isSubmitting}
                      className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-[#059669] transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Debloquer
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={onBlock}
                      disabled={isSubmitting}
                      className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-[#DC2626] transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Ban className="h-4 w-4" />
                      Bloquer
                    </button>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function UsageGovernancePanel({
  resources,
  selectedResourceId,
  overview,
  isLoading,
  isSubmitting,
  canConfigure,
  canManage,
  policyForm,
  usageLogForm,
  onSelectedResourceChange,
  onPolicyFormChange,
  onUsageLogFormChange,
  onSavePolicy,
  onRecordUsage,
  onResolveAlert,
}: {
  resources: ApiFleetResource[];
  selectedResourceId: string;
  overview: ApiResourceComplianceOverview | null;
  isLoading: boolean;
  isSubmitting: boolean;
  canConfigure: boolean;
  canManage: boolean;
  policyForm: UsagePolicyFormState;
  usageLogForm: UsageLogFormState;
  onSelectedResourceChange: (value: string) => void;
  onPolicyFormChange: Dispatch<SetStateAction<UsagePolicyFormState>>;
  onUsageLogFormChange: Dispatch<SetStateAction<UsageLogFormState>>;
  onSavePolicy: () => void;
  onRecordUsage: () => void;
  onResolveAlert: (alertId: number) => void;
}) {
  const [isPolicyOpen, setIsPolicyOpen] = useState(false);
  const [isUsageLogOpen, setIsUsageLogOpen] = useState(false);
  const [isIncidentsOpen, setIsIncidentsOpen] = useState(false);
  const selectedResource = resources.find((resource) => String(resource.id) === selectedResourceId);
  const assignedUsers = selectedResource?.active_assignments ?? [];

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <ShieldAlert className="h-5 w-5 text-[#2D6CDF]" />
        <div>
          <h2 className="text-lg font-semibold text-[#0F172A]">Gouvernance d'usage</h2>
          <p className="text-sm text-[#64748B]">Vue compacte de la conformite par ressource.</p>
        </div>
      </div>

      <select
        value={selectedResourceId}
        onChange={(event) => onSelectedResourceChange(event.target.value)}
        className="mt-4 w-full rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm"
      >
        <option value="">Selectionner une ressource</option>
        {resources.map((resource) => (
          <option key={resource.id} value={resource.id}>
            {resource.label} - {getResourceTypeLabel(resource.resource_type)}
          </option>
        ))}
      </select>

      {isLoading ? (
        <div className="mt-4 rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-[#64748B]">
          Chargement de la conformite...
        </div>
      ) : overview ? (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-[#94A3B8]">Score</p>
              <p className="mt-2 text-2xl font-bold text-[#0F172A]">{overview.compliance_score}%</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-[#94A3B8]">Statut</p>
              <Badge className={`mt-2 ${getComplianceClasses(overview.compliance_status)}`}>
                {getComplianceLabel(overview.compliance_status)}
              </Badge>
            </div>
            <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-[#94A3B8]">Alertes ouvertes</p>
              <p className="mt-2 text-2xl font-bold text-[#0F172A]">{overview.open_alert_count}</p>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[#0F172A]">
                  {getPolicyModeLabel(overview.policy.policy_mode)}
                </p>
                <p className="mt-1 text-xs leading-5 text-[#64748B]">
                  {overview.policy.acceptable_use_rules}
                </p>
              </div>
              <Badge className="border-gray-200 bg-[#F8FAFC] text-[#475569]">
                {overview.policy.security_level}
              </Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {overview.policy.restricted_activity_categories.length > 0 ? (
                overview.policy.restricted_activity_categories.slice(0, 4).map((category) => (
                  <Badge key={category} className="border-red-200 bg-red-50 text-[#DC2626]">
                    {category}
                  </Badge>
                ))
              ) : (
                <Badge className="border-emerald-200 bg-emerald-50 text-[#059669]">Aucune restriction</Badge>
              )}
            </div>
          </div>

          {canConfigure ? (
            <Collapsible open={isPolicyOpen} onOpenChange={setIsPolicyOpen}>
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[#0F172A]">Parametrer la politique</p>
                    <p className="mt-1 text-xs text-[#64748B]">Section fermee par defaut.</p>
                  </div>
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-[#475569] hover:bg-[#F8FAFC]"
                    >
                      {isPolicyOpen ? "Masquer" : "Voir"}
                      {isPolicyOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                  </CollapsibleTrigger>
                </div>
                <CollapsibleContent className="space-y-3 pt-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <select
                      value={policyForm.policyMode}
                      onChange={(event) =>
                        onPolicyFormChange((current) => ({
                          ...current,
                          policyMode: event.target.value as ApiUsagePolicyMode,
                        }))
                      }
                      className="rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm"
                    >
                      <option value="professional_only">Usage strictement professionnel</option>
                      <option value="mixed_limited">Usage mixte limite</option>
                      <option value="controlled_free">Usage libre controle</option>
                    </select>
                    <select
                      value={policyForm.securityLevel}
                      onChange={(event) =>
                        onPolicyFormChange((current) => ({
                          ...current,
                          securityLevel: event.target.value as "standard" | "sensitive" | "critical",
                        }))
                      }
                      className="rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm"
                    >
                      <option value="standard">Niveau standard</option>
                      <option value="sensitive">Ressource sensible</option>
                      <option value="critical">Ressource critique</option>
                    </select>
                  </div>
                  <textarea
                    value={policyForm.acceptableUseRules}
                    onChange={(event) =>
                      onPolicyFormChange((current) => ({
                        ...current,
                        acceptableUseRules: event.target.value,
                      }))
                    }
                    rows={3}
                    className="w-full resize-none rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm"
                    placeholder="Charte d'utilisation"
                  />
                  <div className="grid gap-3 md:grid-cols-2">
                    <input
                      type="text"
                      value={policyForm.restrictedCategories}
                      onChange={(event) =>
                        onPolicyFormChange((current) => ({
                          ...current,
                          restrictedCategories: event.target.value,
                        }))
                      }
                      className="rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm"
                      placeholder="Categories interdites"
                    />
                    <input
                      type="text"
                      value={policyForm.exceptionRoles}
                      onChange={(event) =>
                        onPolicyFormChange((current) => ({
                          ...current,
                          exceptionRoles: event.target.value,
                        }))
                      }
                      className="rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm"
                      placeholder="Roles en exception"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-[#475569]">
                    <input
                      type="checkbox"
                      checked={policyForm.autoSuspendOnCritical}
                      onChange={(event) =>
                        onPolicyFormChange((current) => ({
                          ...current,
                          autoSuspendOnCritical: event.target.checked,
                        }))
                      }
                    />
                    Suspendre automatiquement en cas critique
                  </label>
                  <button
                    type="button"
                    onClick={onSavePolicy}
                    disabled={isSubmitting || !policyForm.acceptableUseRules}
                    className="inline-flex items-center justify-center rounded-lg bg-[#2D6CDF] px-4 py-3 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Enregistrer
                  </button>
                </CollapsibleContent>
              </div>
            </Collapsible>
          ) : null}

          {canManage ? (
            <Collapsible open={isUsageLogOpen} onOpenChange={setIsUsageLogOpen}>
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[#0F172A]">Journal d'usage</p>
                    <p className="mt-1 text-xs text-[#64748B]">Enregistrement manuel d'un incident.</p>
                  </div>
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-[#475569] hover:bg-[#F8FAFC]"
                    >
                      {isUsageLogOpen ? "Masquer" : "Voir"}
                      {isUsageLogOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                  </CollapsibleTrigger>
                </div>
                <CollapsibleContent className="space-y-3 pt-4">
                  <select
                    value={usageLogForm.userId}
                    onChange={(event) =>
                      onUsageLogFormChange((current) => ({ ...current, userId: event.target.value }))
                    }
                    className="w-full rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm"
                  >
                    <option value="">Utilisateur attribue</option>
                    {assignedUsers.map((assignment) => (
                      <option key={assignment.id} value={assignment.user_id}>
                        {assignment.user_name}
                      </option>
                    ))}
                  </select>
                  <div className="grid gap-3 md:grid-cols-2">
                    <input
                      type="text"
                      value={usageLogForm.activityType}
                      onChange={(event) =>
                        onUsageLogFormChange((current) => ({
                          ...current,
                          activityType: event.target.value,
                        }))
                      }
                      className="rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm"
                      placeholder="Type"
                    />
                    <input
                      type="text"
                      value={usageLogForm.activityCategory}
                      onChange={(event) =>
                        onUsageLogFormChange((current) => ({
                          ...current,
                          activityCategory: event.target.value,
                        }))
                      }
                      className="rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm"
                      placeholder="Categorie"
                    />
                  </div>
                  <input
                    type="text"
                    value={usageLogForm.activityLabel}
                    onChange={(event) =>
                      onUsageLogFormChange((current) => ({
                        ...current,
                        activityLabel: event.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm"
                    placeholder="Libelle"
                  />
                  <button
                    type="button"
                    onClick={onRecordUsage}
                    disabled={isSubmitting || !usageLogForm.userId || !usageLogForm.activityCategory}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-[#1D4ED8] hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Activity className="h-4 w-4" />
                    Evaluer l'usage
                  </button>
                </CollapsibleContent>
              </div>
            </Collapsible>
          ) : null}

          <Collapsible open={isIncidentsOpen} onOpenChange={setIsIncidentsOpen}>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[#0F172A]">Incidents et recommandations</p>
                  <p className="mt-1 text-xs text-[#64748B]">Alerte recente, puis actions recommandees.</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className="border-red-200 bg-red-50 text-[#DC2626]">
                    {overview.open_alert_count}
                  </Badge>
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-[#475569] hover:bg-[#F8FAFC]"
                    >
                      {isIncidentsOpen ? "Masquer" : "Voir"}
                      {isIncidentsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                  </CollapsibleTrigger>
                </div>
              </div>
              <CollapsibleContent className="space-y-3 pt-4">
                <div className="space-y-3">
                  {overview.recent_alerts.slice(0, 3).map((alert) => (
                    <div key={alert.id} className="rounded-lg border border-gray-200 bg-[#F8FAFC] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-[#0F172A]">{alert.title}</p>
                          <p className="mt-1 text-xs text-[#64748B]">
                            {alert.user_name} • {formatDateTime(alert.created_at)}
                          </p>
                        </div>
                        <Badge className="border-red-200 bg-red-50 text-[#DC2626]">
                          {getSeverityLabel(alert.severity)}
                        </Badge>
                      </div>
                      <p className="mt-2 text-sm text-[#475569]">{alert.description}</p>
                      {canManage && alert.status !== "resolved" ? (
                        <button
                          type="button"
                          onClick={() => onResolveAlert(alert.id)}
                          disabled={isSubmitting}
                          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-[#1D4ED8] hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Resoudre
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {overview.recent_alerts.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-[#64748B]">
                      Aucun incident d'usage.
                    </div>
                  ) : null}
                </div>

                {overview.recommendations.length > 0 ? (
                  <div className="rounded-lg border border-gray-200 bg-white p-3">
                    <p className="text-sm font-semibold text-[#0F172A]">Recommandations IA</p>
                    <div className="mt-3 space-y-2">
                      {overview.recommendations.slice(0, 3).map((recommendation) => (
                        <div
                          key={recommendation}
                          className="flex gap-2 rounded-lg bg-[#F8FAFC] p-3 text-sm text-[#475569]"
                        >
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#D97706]" />
                          <span>{recommendation}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </CollapsibleContent>
            </div>
          </Collapsible>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-[#64748B]">
          Selectionnez une ressource pour voir la gouvernance.
        </div>
      )}
    </section>
  );
}

function UserResourcePanel({
  users,
  resources,
  selectedUserId,
  selectedResourceIds,
  assignments,
  isLoading,
  isSubmitting,
  canManage,
  reason,
  notes,
  onSelectedUserChange,
  onToggleResource,
  onReasonChange,
  onNotesChange,
  onAssign,
  onRevoke,
}: {
  users: ApiUser[];
  resources: ApiFleetResource[];
  selectedUserId: string;
  selectedResourceIds: number[];
  assignments: ApiResourceAssignment[];
  isLoading: boolean;
  isSubmitting: boolean;
  canManage: boolean;
  reason: string;
  notes: string;
  onSelectedUserChange: (value: string) => void;
  onToggleResource: (resourceId: number) => void;
  onReasonChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onAssign: () => void;
  onRevoke: (assignment: ApiResourceAssignment) => void;
}) {
  const [isAssignPanelOpen, setIsAssignPanelOpen] = useState(false);
  const userId = Number(selectedUserId);
  const selectedUser = users.find((item) => item.id === userId);
  const activeAssignments = assignments.filter((assignment) => assignment.status === "active");
  const selectableResources = selectedUser
    ? resources.filter((resource) => isUserAuthorizedForResource(selectedUser, resource))
    : resources;
  const hiddenResourcesCount = selectedUser ? resources.length - selectableResources.length : 0;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <PackagePlus className="h-5 w-5 text-[#2D6CDF]" />
        <div>
          <h2 className="text-lg font-semibold text-[#0F172A]">Vue utilisateur</h2>
          <p className="text-sm text-[#64748B]">Affectations visibles et attribution multiple sur demande.</p>
        </div>
      </div>

      <select
        value={selectedUserId}
        onChange={(event) => onSelectedUserChange(event.target.value)}
        className="mt-5 w-full rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm"
      >
        <option value="">Selectionner un utilisateur</option>
        {users.map((item) => (
          <option key={item.id} value={item.id}>
            {item.full_name} - {formatRoleLabel(item.role)}
          </option>
        ))}
      </select>

      {selectedUser ? (
        <div className="mt-4 rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
          <p className="font-semibold text-[#0F172A]">{selectedUser.full_name}</p>
          <p className="mt-1 text-sm text-[#64748B]">
            {selectedUser.job_profile ?? "Profil non renseigne"} - {formatRoleLabel(selectedUser.role)}
          </p>
          <p className="mt-2 text-xs text-[#64748B]">
            Les ressources proposees ci-dessous respectent les profils autorises enregistres.
          </p>
        </div>
      ) : null}

      <div className="mt-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold text-[#0F172A]">Ressources attribuees</h3>
          <Badge className="border-blue-200 bg-blue-50 text-[#1D4ED8]">{activeAssignments.length}</Badge>
        </div>

        <div className="mt-3 space-y-2">
          {isLoading ? (
            <div className="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-[#64748B]">
              Chargement...
            </div>
          ) : activeAssignments.length > 0 ? (
            activeAssignments.map((assignment) => (
              <div key={assignment.id} className="rounded-lg border border-gray-200 bg-[#F8FAFC] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-[#0F172A]">{assignment.resource_label}</p>
                    <p className="mt-1 text-xs text-[#64748B]">
                      {getResourceTypeLabel(assignment.resource_type)} - {assignment.resource_identifier}
                    </p>
                    <p className="mt-2 text-xs text-[#94A3B8]">{formatDateTime(assignment.assigned_at)}</p>
                  </div>
                  {canManage ? (
                    <button
                      type="button"
                      onClick={() => onRevoke(assignment)}
                      disabled={isSubmitting}
                      className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-[#DC2626] hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <X className="h-3.5 w-3.5" />
                      Retirer
                    </button>
                  ) : null}
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-[#64748B]">
              Aucune ressource active pour cet utilisateur.
            </div>
          )}
        </div>
      </div>

      {canManage ? (
        <Collapsible open={isAssignPanelOpen} onOpenChange={setIsAssignPanelOpen}>
          <div className="mt-6 border-t border-gray-100 pt-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-[#0F172A]">Attribuer plusieurs ressources</h3>
                <p className="mt-1 text-xs text-[#64748B]">Section fermee par defaut.</p>
              </div>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-[#475569] hover:bg-[#F8FAFC]"
                >
                  {isAssignPanelOpen ? "Masquer" : "Voir"}
                  {isAssignPanelOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
              </CollapsibleTrigger>
            </div>

            <CollapsibleContent className="space-y-3 pt-4">
              <div className="max-h-64 space-y-2 overflow-auto pr-1">
                {selectableResources.map((resource) => {
                  const isSelected = selectedResourceIds.includes(resource.id);
                  const alreadyAssigned = userId > 0 && isResourceAlreadyAssignedToUser(resource, userId);
                  const disabled =
                    !selectedUserId ||
                    alreadyAssigned ||
                    isResourceBlocked(resource) ||
                    (!isSelected && resource.available_assignment_slots <= 0);
                  const Icon = getResourceIcon(resource.resource_type);

                  return (
                    <label
                      key={resource.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 text-sm ${
                        isSelected
                          ? "border-blue-200 bg-blue-50 text-[#1D4ED8]"
                          : "border-gray-200 bg-white text-[#475569]"
                      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={disabled}
                        onChange={() => onToggleResource(resource.id)}
                        className="mt-1 h-4 w-4"
                      />
                      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{resource.label}</span>
                        <span className="block truncate text-xs">
                          {resource.department_name ?? "Non reservee"} - {resource.available_assignment_slots} place(s)
                        </span>
                        <span className="mt-1 block truncate text-xs text-[#94A3B8]">
                          {resource.authorized_profiles.length > 0
                            ? resource.authorized_profiles.join(", ")
                            : "Tous profils autorises"}
                        </span>
                        {alreadyAssigned ? (
                          <span className="mt-1 block text-xs text-[#059669]">Deja attribuee</span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
                {selectedUser && selectableResources.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-[#64748B]">
                    Aucune ressource compatible avec ce profil.
                  </div>
                ) : null}
                {selectedUser && hiddenResourcesCount > 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-200 px-4 py-4 text-center text-sm text-[#64748B]">
                    {hiddenResourcesCount} ressource(s) masque(e)s car incompatibles avec le profil.
                  </div>
                ) : null}
              </div>

              <input
                type="text"
                value={reason}
                onChange={(event) => onReasonChange(event.target.value)}
                placeholder="Motif"
                className="w-full rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm"
              />
              <textarea
                value={notes}
                onChange={(event) => onNotesChange(event.target.value)}
                placeholder="Notes"
                rows={2}
                className="w-full resize-none rounded-xl border border-gray-200 bg-[#F8FAFC] px-4 py-3 text-sm"
              />
              <button
                type="button"
                onClick={onAssign}
                disabled={isSubmitting || !selectedUserId || selectedResourceIds.length === 0}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#2D6CDF] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <PackagePlus className="h-4 w-4" />
                Attribuer les ressources selectionnees
              </button>
            </CollapsibleContent>
          </div>
        </Collapsible>
      ) : null}
    </section>
  );
}

function AssignmentHistory({ assignments }: { assignments: ApiResourceAssignment[] }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-5 w-5 text-[#2D6CDF]" />
        <div>
          <h2 className="text-lg font-semibold text-[#0F172A]">Historique d'attribution</h2>
          <p className="text-sm text-[#64748B]">Dernieres affectations visibles.</p>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {assignments.slice(0, 8).map((assignment) => (
          <div key={assignment.id} className="rounded-lg border border-gray-200 bg-[#F8FAFC] p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-[#0F172A]">{assignment.resource_label}</p>
                <p className="mt-1 text-xs text-[#64748B]">
                  {assignment.user_name} • {assignment.resource_identifier}
                </p>
              </div>
              <Badge className={assignment.status === "active" ? getStatusClasses("assigned") : "border-gray-200 bg-white text-[#64748B]"}>
                {assignment.status === "active" ? "Active" : "Retiree"}
              </Badge>
            </div>
            <p className="mt-2 text-xs text-[#94A3B8]">
              {assignment.department_name ?? "Sans departement"} • {formatDateTime(assignment.assigned_at)}
            </p>
            {assignment.assignment_reason ? (
              <p className="mt-2 text-sm text-[#475569]">{assignment.assignment_reason}</p>
            ) : null}
          </div>
        ))}
        {assignments.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-[#64748B]">
            Aucun historique visible.
          </div>
        ) : null}
      </div>
    </section>
  );
}

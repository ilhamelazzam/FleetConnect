import type { ApiUser } from "./api";

export type AppRole =
  | "super_admin"
  | "admin"
  | "company_admin"
  | "manager"
  | "user"
  | "analyst";

export type AppModule =
  | "dashboard"
  | "phone_lines"
  | "fleet_access"
  | "plans"
  | "plan_assignments"
  | "consumption"
  | "fraud_cdr"
  | "predictions"
  | "recommendations"
  | "reports"
  | "customer_risk"
  | "users"
  | "settings"
  | "profile"
  | "admin_center"
  | "super_admin";

export type NavigationLabelKey =
  | "dashboard"
  | "lines"
  | "fleetAccess"
  | "plans"
  | "assignedPlans"
  | "spending"
  | "suspiciousCalls"
  | "predictions"
  | "recommendations"
  | "reports"
  | "customerRisk"
  | "users"
  | "settings";

export interface NavigationItemConfig {
  module: AppModule;
  path: string;
  labelKey: NavigationLabelKey;
  matchPrefixes?: string[];
}

type RoleAwareUser = Pick<ApiUser, "role"> | null | undefined;

const PUBLIC_APP_PATHS = new Set([
  "/",
  "/choose-profile",
  "/choisir-profil",
  "/register",
  "/register-company",
  "/inscription-entreprise",
  "/login",
  "/admin/login",
  "/forgot-password",
  "/reset-password",
]);

export const ROLE_CAPABILITIES: Record<AppRole, string[]> = {
  super_admin: [
    "Pilotage complet de la plateforme et des inscriptions entreprises",
    "Validation ou refus des demandes d'inscription",
    "Gestion des comptes sensibles et des roles eleves",
    "Vue transverse sur les entreprises et les administrateurs crees",
    "Acces a tous les modules de supervision et de configuration",
  ],
  admin: [
    "Gestion complete de la plateforme",
    "Gestion des acces aux ressources de flotte",
    "Administration des forfaits et des comptes",
    "Configuration systeme et securite",
    "Acces aux modules de supervision avances",
  ],
  company_admin: [
    "Administration operationnelle de l'entreprise",
    "Gestion courante des lignes, forfaits et utilisateurs metier",
    "Suivi des tableaux de bord et rapports de la flotte",
    "Execution des actions de supervision autorisees",
    "Aucun acces aux validations super admin",
  ],
  manager: [
    "Pilotage operationnel de la flotte",
    "Attribution des ressources du departement",
    "Actions metier et exploitation courante",
    "Lecture des tableaux de bord et rapports",
    "Validation des recommandations metier",
  ],
  user: [
    "Acces aux ressources personnelles attribuees",
    "Consultation de ses lignes et equipements",
    "Historique personnel des attributions",
    "Aucune action d'administration ou d'attribution",
  ],
  analyst: [
    "Consultation en lecture seule",
    "Acces aux ressources personnelles attribuees",
    "Analyse des tableaux de bord et des rapports",
    "Export des vues metier autorisees",
    "Suivi des indicateurs sans action de configuration",
  ],
};

export const NAVIGATION_ITEMS: readonly NavigationItemConfig[] = [
  { module: "dashboard", path: "/dashboard", labelKey: "dashboard" },
  { module: "phone_lines", path: "/lignes", labelKey: "lines" },
  { module: "fleet_access", path: "/acces-flotte", labelKey: "fleetAccess" },
  { module: "plans", path: "/forfaits", labelKey: "plans" },
  {
    module: "plan_assignments",
    path: "/forfaits/attributions",
    labelKey: "assignedPlans",
  },
  { module: "consumption", path: "/consommations", labelKey: "spending" },
  {
    module: "fraud_cdr",
    path: "/fraude-cdr",
    labelKey: "suspiciousCalls",
    matchPrefixes: ["/fraude-cdr", "/anomalies"],
  },
  { module: "predictions", path: "/predictions", labelKey: "predictions" },
  {
    module: "recommendations",
    path: "/recommandations",
    labelKey: "recommendations",
  },
  { module: "reports", path: "/rapports", labelKey: "reports" },
  { module: "customer_risk", path: "/risque-client", labelKey: "customerRisk" },
  { module: "users", path: "/utilisateurs", labelKey: "users" },
  { module: "settings", path: "/parametres", labelKey: "settings" },
];

const ALL_MODULES: readonly AppModule[] = [
  "dashboard",
  "phone_lines",
  "fleet_access",
  "plans",
  "plan_assignments",
  "consumption",
  "fraud_cdr",
  "predictions",
  "recommendations",
  "reports",
  "customer_risk",
  "users",
  "settings",
  "profile",
  "admin_center",
  "super_admin",
];

export const ROLE_PERMISSIONS: Record<AppRole, readonly AppModule[]> = {
  super_admin: ALL_MODULES,
  admin: [
    "dashboard",
    "phone_lines",
    "fleet_access",
    "plans",
    "plan_assignments",
    "consumption",
    "fraud_cdr",
    "predictions",
    "recommendations",
    "reports",
    "customer_risk",
    "users",
    "settings",
    "profile",
    "admin_center",
  ],
  company_admin: [
    "dashboard",
    "phone_lines",
    "fleet_access",
    "plans",
    "plan_assignments",
    "consumption",
    "fraud_cdr",
    "predictions",
    "recommendations",
    "reports",
    "customer_risk",
    "users",
    "profile",
  ],
  manager: [
    "dashboard",
    "phone_lines",
    "fleet_access",
    "plans",
    "plan_assignments",
    "consumption",
    "predictions",
    "recommendations",
    "reports",
    "profile",
  ],
  analyst: [
    "dashboard",
    "consumption",
    "fraud_cdr",
    "predictions",
    "recommendations",
    "reports",
    "profile",
  ],
  user: ["dashboard", "profile"],
};

export function normalizeRole(role: string | null | undefined): AppRole | null {
  const normalizedRole = role?.trim().toLowerCase();

  if (
    normalizedRole === "super_admin" ||
    normalizedRole === "admin" ||
    normalizedRole === "company_admin" ||
    normalizedRole === "manager" ||
    normalizedRole === "user" ||
    normalizedRole === "analyst"
  ) {
    return normalizedRole;
  }

  return null;
}

export function normalizeAppPath(pathname: string | null | undefined): string {
  if (!pathname) {
    return "/";
  }

  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }

  return pathname;
}

export function isPublicAppPath(pathname: string | null | undefined): boolean {
  return PUBLIC_APP_PATHS.has(normalizeAppPath(pathname));
}

export function hasAnyRole(
  user: RoleAwareUser,
  allowedRoles: readonly AppRole[],
): boolean {
  const role = normalizeRole(user?.role);
  return role !== null && allowedRoles.includes(role);
}

export function canAccessModule(user: RoleAwareUser, module: AppModule): boolean {
  const role = normalizeRole(user?.role);
  return role !== null && ROLE_PERMISSIONS[role].includes(module);
}

export function getAccessibleModules(user: RoleAwareUser): AppModule[] {
  const role = normalizeRole(user?.role);
  return role ? [...ROLE_PERMISSIONS[role]] : [];
}

export function canAccessAdminCenter(user: RoleAwareUser): boolean {
  return canAccessModule(user, "admin_center") || canAccessSuperAdmin(user);
}

export function canManageUsers(user: RoleAwareUser): boolean {
  return canAccessModule(user, "users") || canAccessSuperAdmin(user);
}

export function canAccessSettings(user: RoleAwareUser): boolean {
  return canAccessModule(user, "settings") || canAccessSuperAdmin(user);
}

export function canAccessSuperAdmin(user: RoleAwareUser): boolean {
  return hasAnyRole(user, ["super_admin"]);
}

export function canManagePlans(user: RoleAwareUser): boolean {
  return hasAnyRole(user, ["super_admin", "admin", "company_admin"]);
}

export function canApplyOperationalChanges(user: RoleAwareUser): boolean {
  return hasAnyRole(user, ["super_admin", "admin", "company_admin", "manager"]);
}

export function resolveModuleFromPath(pathname: string | null | undefined): AppModule | null {
  const normalizedPath = normalizeAppPath(pathname);

  if (normalizedPath === "/dashboard") return "dashboard";
  if (normalizedPath === "/lignes" || normalizedPath.startsWith("/lignes/")) return "phone_lines";
  if (normalizedPath === "/acces-flotte") return "fleet_access";
  if (normalizedPath === "/forfaits") return "plans";
  if (normalizedPath === "/forfaits/attributions") return "plan_assignments";
  if (normalizedPath === "/consommations") return "consumption";
  if (
    normalizedPath === "/fraude-cdr" ||
    normalizedPath.startsWith("/fraude-cdr/") ||
    normalizedPath === "/anomalies" ||
    normalizedPath.startsWith("/anomalies/")
  ) {
    return "fraud_cdr";
  }
  if (normalizedPath === "/predictions") return "predictions";
  if (normalizedPath === "/recommandations") return "recommendations";
  if (normalizedPath === "/rapports") return "reports";
  if (normalizedPath === "/risque-client") return "customer_risk";
  if (normalizedPath === "/utilisateurs") return "users";
  if (normalizedPath === "/parametres") return "settings";
  if (normalizedPath === "/profil") return "profile";
  if (normalizedPath === "/admin-center") return "admin_center";
  if (normalizedPath.startsWith("/admin")) return "super_admin";
  return null;
}

export function canAccessPath(user: RoleAwareUser, pathname: string | null | undefined): boolean {
  if (isPublicAppPath(pathname)) {
    return true;
  }

  const module = resolveModuleFromPath(pathname);
  if (!module) {
    return false;
  }

  return canAccessModule(user, module);
}

export function isNavigationItemActive(
  item: NavigationItemConfig,
  pathname: string | null | undefined,
): boolean {
  const normalizedPath = normalizeAppPath(pathname);
  const prefixes = item.matchPrefixes ?? [item.path];
  return prefixes.some(
    (prefix) =>
      normalizedPath === prefix ||
      normalizedPath.startsWith(`${prefix}/`),
  );
}

export function getDefaultAuthenticatedPath(user: RoleAwareUser): string {
  if (canAccessSuperAdmin(user)) {
    return "/admin/dashboard";
  }

  const preferredPaths = [
    "/dashboard",
    "/consommations",
    "/predictions",
    "/recommandations",
    "/fraude-cdr",
    "/rapports",
  ];

  const accessiblePath = preferredPaths.find((path) => canAccessPath(user, path));
  return accessiblePath ?? "/dashboard";
}

export function resolvePostLoginPath(
  user: RoleAwareUser,
  requestedPath: string | null | undefined,
): string {
  const defaultPath = getDefaultAuthenticatedPath(user);
  const normalizedPath = normalizeAppPath(requestedPath?.trim());

  if (
    !normalizedPath ||
    normalizedPath === "/" ||
    normalizedPath === "/login" ||
    normalizedPath === "/admin/login"
  ) {
    return defaultPath;
  }

  return canAccessPath(user, normalizedPath) ? normalizedPath : defaultPath;
}

export function getRoleCapabilities(user: RoleAwareUser): string[] {
  const role = normalizeRole(user?.role);
  return role ? ROLE_CAPABILITIES[role] : [];
}

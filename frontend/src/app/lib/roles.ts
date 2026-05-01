import type { ApiUser } from "./api";

export type AppRole = "admin" | "manager" | "user" | "analyst";

type RoleAwareUser = Pick<ApiUser, "role"> | null | undefined;

export const ROLE_CAPABILITIES: Record<AppRole, string[]> = {
  admin: [
    "Gestion complete de la plateforme",
    "Gestion des acces aux ressources de flotte",
    "Administration des forfaits et des comptes",
    "Configuration systeme et securite",
    "Acces aux modules de supervision avances",
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

export function normalizeRole(role: string | null | undefined): AppRole | null {
  const normalizedRole = role?.trim().toLowerCase();

  if (
    normalizedRole === "admin" ||
    normalizedRole === "manager" ||
    normalizedRole === "user" ||
    normalizedRole === "analyst"
  ) {
    return normalizedRole;
  }

  return null;
}

export function hasAnyRole(
  user: RoleAwareUser,
  allowedRoles: readonly AppRole[],
): boolean {
  const role = normalizeRole(user?.role);
  return role !== null && allowedRoles.includes(role);
}

export function isAdminUser(user: RoleAwareUser): boolean {
  return hasAnyRole(user, ["admin"]);
}

export function canAccessAdminCenter(user: RoleAwareUser): boolean {
  return hasAnyRole(user, ["admin"]);
}

export function canAccessSettings(user: RoleAwareUser): boolean {
  return hasAnyRole(user, ["admin"]);
}

export function canManagePlans(user: RoleAwareUser): boolean {
  return hasAnyRole(user, ["admin"]);
}

export function canApplyOperationalChanges(user: RoleAwareUser): boolean {
  return hasAnyRole(user, ["admin", "manager"]);
}

export function getRoleCapabilities(user: RoleAwareUser): string[] {
  const role = normalizeRole(user?.role);
  return role ? ROLE_CAPABILITIES[role] : [];
}

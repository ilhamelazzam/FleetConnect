import {
  formatRoleLabel,
  type ApiFleetResource,
  type ApiFleetResourceType,
  type ApiUser,
} from "./api";

export const FLEET_PROFILE_CATALOG = {
  Direction: {
    description: "Gouvernance, arbitrage executive et decision strategique.",
  },
  Executive: {
    description: "Comite executif et profils a forte exposition metier.",
  },
  Manager: {
    description: "Pilotage d'equipe, coordination transverse et suivi operationnel.",
  },
  "Commercial terrain": {
    description: "Mobilite client, interventions terrain et activite nomade.",
  },
  "Support IT": {
    description: "Support technique, maintenance et continuite de service.",
  },
  Finance: {
    description: "Controle budgetaire, supervision et pilotage des couts.",
  },
} as const;

export type FleetBusinessProfile = keyof typeof FLEET_PROFILE_CATALOG;
export type ResourceProfileSelectionMode = "recommended" | "custom" | "open";

export interface ResourceProfilePolicy {
  title: string;
  description: string;
  rationale: string;
  guidance: string;
  recommended: FleetBusinessProfile[];
  allowed: FleetBusinessProfile[];
}

type ResourceProfilePolicyMatrix = Record<
  ApiFleetResourceType,
  {
    standard: Omit<ResourceProfilePolicy, "guidance">;
    premium?: Omit<ResourceProfilePolicy, "guidance">;
  }
>;

const DEFAULT_POLICY_GUIDANCE =
  "Les profils autorises sont proposes selon le type de ressource pour respecter le principe du moindre privilege.";

export const RESOURCE_PROFILE_POLICY_MATRIX: ResourceProfilePolicyMatrix = {
  phone_line: {
    standard: {
      title: "Ligne mobile standard",
      description: "Usage voix/data quotidien pour activites terrain et coordination.",
      rationale:
        "Une ligne mobile standard couvre surtout les profils mobiles, le pilotage d'equipe et le support de proximite.",
      recommended: ["Commercial terrain", "Manager", "Support IT"],
      allowed: ["Commercial terrain", "Manager", "Support IT", "Direction"],
    },
    premium: {
      title: "Ligne mobile premium",
      description: "Ligne a forte valeur, roaming, priorite service ou cout eleve.",
      rationale:
        "Une ligne premium doit rester ciblee sur les profils a forte criticite ou exposition executive.",
      recommended: ["Direction", "Executive", "Manager"],
      allowed: ["Direction", "Executive", "Manager", "Commercial terrain"],
    },
  },
  mobile_phone: {
    standard: {
      title: "Terminal mobile standard",
      description: "Telephone d'usage regulier pour collaborateurs mobiles et managers.",
      rationale:
        "Le terminal standard est pertinent pour les equipes mobiles, le management et le support technique.",
      recommended: ["Commercial terrain", "Manager", "Support IT"],
      allowed: ["Commercial terrain", "Manager", "Support IT", "Direction"],
    },
    premium: {
      title: "Terminal mobile premium",
      description: "Smartphone couteux ou sensible pour activite executive ou management critique.",
      rationale:
        "Un terminal premium doit rester reserve aux profils avec besoin metier fort ou responsabilite de pilotage.",
      recommended: ["Direction", "Executive", "Manager"],
      allowed: ["Direction", "Executive", "Manager", "Commercial terrain"],
    },
  },
  tablet: {
    standard: {
      title: "Tablette metier",
      description: "Equipement nomade pour consultation, demonstration ou reporting mobile.",
      rationale:
        "La tablette standard sert surtout les profils terrain, managers et presentations metier.",
      recommended: ["Commercial terrain", "Manager"],
      allowed: ["Commercial terrain", "Manager", "Executive", "Direction"],
    },
    premium: {
      title: "Tablette premium",
      description: "Tablette haut de gamme pour pilotage, representation ou usage executive.",
      rationale:
        "Une tablette premium doit cibler les usages a forte visibilite et les besoins de pilotage mobile.",
      recommended: ["Direction", "Executive", "Manager"],
      allowed: ["Direction", "Executive", "Manager", "Commercial terrain"],
    },
  },
  laptop: {
    standard: {
      title: "Ressource technique / support",
      description: "PC portable pour support technique, coordination et travail metier structure.",
      rationale:
        "Le poste standard privilegie le support IT et le management, avec ouverture limitee a la finance.",
      recommended: ["Support IT", "Manager"],
      allowed: ["Support IT", "Manager", "Finance"],
    },
    premium: {
      title: "Poste sensible ou de direction",
      description: "PC portable couteux ou critique pour direction, supervision ou usages sensibles.",
      rationale:
        "Un poste premium doit rester reserve a la direction, l'executive et aux managers a fort besoin.",
      recommended: ["Direction", "Executive", "Manager"],
      allowed: ["Direction", "Executive", "Manager", "Support IT"],
    },
  },
  internet_connection: {
    standard: {
      title: "Connexion de pilotage / supervision",
      description: "Acces internet professionnel pour supervision, finance ou management critique.",
      rationale:
        "La connectivite metier doit servir en priorite le pilotage, la finance et la supervision.",
      recommended: ["Finance", "Manager", "Support IT"],
      allowed: ["Finance", "Manager", "Support IT", "Direction"],
    },
    premium: {
      title: "Connexion critique ou executive",
      description: "Connexion couteuse, prioritaire ou reservee a la supervision strategique.",
      rationale:
        "Une connexion premium doit rester ciblee sur la direction, l'executive et la finance de pilotage.",
      recommended: ["Finance", "Direction", "Executive"],
      allowed: ["Finance", "Direction", "Executive", "Manager"],
    },
  },
};

const PROFILE_ORDER = Object.keys(FLEET_PROFILE_CATALOG) as FleetBusinessProfile[];

function normalizeProfile(profile: string): string {
  return profile.trim().toLowerCase();
}

function dedupeProfiles(profiles: Iterable<string>): string[] {
  const uniqueProfiles: string[] = [];
  const seenProfiles = new Set<string>();

  for (const profile of profiles) {
    const trimmedProfile = profile.trim();
    if (!trimmedProfile) continue;

    const normalizedProfile = normalizeProfile(trimmedProfile);
    if (seenProfiles.has(normalizedProfile)) continue;

    seenProfiles.add(normalizedProfile);
    uniqueProfiles.push(trimmedProfile);
  }

  return uniqueProfiles;
}

function sortProfiles(profiles: Iterable<string>): string[] {
  return dedupeProfiles(profiles).sort((left, right) => {
    const leftIndex = PROFILE_ORDER.findIndex((profile) => profile === left);
    const rightIndex = PROFILE_ORDER.findIndex((profile) => profile === right);

    if (leftIndex >= 0 && rightIndex >= 0) {
      return leftIndex - rightIndex;
    }
    if (leftIndex >= 0) {
      return -1;
    }
    if (rightIndex >= 0) {
      return 1;
    }

    return left.localeCompare(right, "fr", { sensitivity: "base" });
  });
}

export function getResourceProfilePolicy(
  resourceType: ApiFleetResourceType,
  isPremium: boolean,
): ResourceProfilePolicy {
  const resourcePolicy = RESOURCE_PROFILE_POLICY_MATRIX[resourceType];
  const selectedPolicy =
    isPremium && resourcePolicy.premium ? resourcePolicy.premium : resourcePolicy.standard;

  return {
    ...selectedPolicy,
    guidance: DEFAULT_POLICY_GUIDANCE,
  };
}

export function getAvailableFleetProfiles(
  users: ApiUser[],
  resources: ApiFleetResource[],
): string[] {
  const profilesFromUsers = users.flatMap((user) => (user.job_profile ? [user.job_profile] : []));
  const profilesFromResources = resources.flatMap((resource) => resource.authorized_profiles);

  return sortProfiles([
    ...PROFILE_ORDER,
    ...profilesFromUsers,
    ...profilesFromResources,
  ]);
}

export function getRecommendedProfilesForPolicy(
  policy: ResourceProfilePolicy,
  availableProfiles: string[],
): string[] {
  const availableProfileSet = new Set(availableProfiles.map(normalizeProfile));

  return policy.recommended.filter((profile) => availableProfileSet.has(normalizeProfile(profile)));
}

export function getAllowedProfilesForPolicy(
  policy: ResourceProfilePolicy,
  availableProfiles: string[],
): string[] {
  const availableProfileSet = new Set(availableProfiles.map(normalizeProfile));

  return policy.allowed.filter((profile) => availableProfileSet.has(normalizeProfile(profile)));
}

export function reconcileProfilesWithPolicy(
  selectedProfiles: string[],
  policy: ResourceProfilePolicy,
): string[] {
  const selectedProfileSet = new Set(dedupeProfiles(selectedProfiles).map(normalizeProfile));

  return policy.allowed.filter((profile) => selectedProfileSet.has(normalizeProfile(profile)));
}

export function areSameProfiles(left: string[], right: string[]): boolean {
  const leftProfiles = sortProfiles(left).map(normalizeProfile);
  const rightProfiles = sortProfiles(right).map(normalizeProfile);

  if (leftProfiles.length !== rightProfiles.length) {
    return false;
  }

  return leftProfiles.every((profile, index) => profile === rightProfiles[index]);
}

export function isUserAuthorizedForProfiles(
  user: ApiUser,
  authorizedProfiles: string[],
): boolean {
  if (authorizedProfiles.length === 0) {
    return true;
  }

  const normalizedAuthorizedProfiles = authorizedProfiles.map(normalizeProfile);
  const normalizedJobProfile = normalizeProfile(user.job_profile ?? "");
  const normalizedRoleLabel = normalizeProfile(formatRoleLabel(user.role));

  return (
    normalizedAuthorizedProfiles.includes(normalizedJobProfile) ||
    normalizedAuthorizedProfiles.includes(normalizedRoleLabel)
  );
}

export function isUserAuthorizedForResource(
  user: ApiUser,
  resource: ApiFleetResource,
): boolean {
  return isUserAuthorizedForProfiles(user, resource.authorized_profiles);
}

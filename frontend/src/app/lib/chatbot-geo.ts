import type {
  ApiRoamingIntelligenceResponse,
  ApiRoamingRiskLevel,
} from "./api";

export interface GeoQuestionAssistantContent {
  text: string;
  bullets?: string[];
  recommendation?: string;
  sources?: string[];
}

type GeoQuestionIntent = "alerts" | "comparison" | "consumption" | "cost";

interface GeoZoneSnapshot {
  label: string;
  city: string | null;
  country: string | null;
  totalRoamingCostMad: number;
  activeDevices: number;
  alerts: number;
  criticalAlerts: number;
  fraudSignals: number;
  riskLevel: ApiRoamingRiskLevel | null;
  explanation: string | null;
}

const GEO_QUESTION_PATTERNS = [
  /\bquelle\s+region\b/,
  /\bquelle\s+zone\b/,
  /\bcompare(?:r)?\b.*\bregions?\b/,
  /\bconsommation\b.*\bregions?\b/,
  /\bcout\b.*\broaming\b/,
  /\broaming\b.*\bregion\b/,
  /\broaming\b.*\bzone\b/,
  /\balertes?\s+geographiques?\b/,
  /\bzones?\s+critiques?\b/,
  /\bcart(?:e|ographie)\b/,
  /\blocalisation\b/,
  /\bgeospatiale?\b/,
  /\bgeographique\b/,
];

const GEO_QUESTION_KEYWORDS = [
  "region",
  "regions",
  "zone",
  "zones",
  "carte",
  "cartographie",
  "localisation",
  "geographique",
  "geospatiale",
  "ville",
  "pays",
  "roaming",
  "cout roaming",
  "consommation par region",
  "zones critiques",
];

function normalizeGeoText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  values.forEach((value) => {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      return;
    }

    const normalizedKey = normalizedValue.toLowerCase();
    if (seen.has(normalizedKey)) {
      return;
    }

    seen.add(normalizedKey);
    result.push(normalizedValue);
  });

  return result;
}

function formatMadAmount(value: number): string {
  if (!Number.isFinite(value)) {
    return "0 MAD";
  }

  return `${new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 0,
  }).format(Math.max(0, Math.round(value)))} MAD`;
}

function formatRiskLevel(value: ApiRoamingRiskLevel | null | undefined): string {
  if (value === "critical") {
    return "critique";
  }
  if (value === "high") {
    return "eleve";
  }
  if (value === "medium") {
    return "moyen";
  }
  return "faible";
}

function formatGeneratedAt(value: string): string {
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return value;
  }

  return parsedDate.toLocaleString("fr-FR");
}

function buildZoneKey(zone: GeoZoneSnapshot): string {
  return normalizeGeoText([zone.label, zone.city ?? "", zone.country ?? ""].join("::"));
}

function buildZoneLabel(zone: GeoZoneSnapshot): string {
  const city = zone.city?.trim();
  const country = zone.country?.trim();
  const label = zone.label.trim();

  if (city && country) {
    return `${city}, ${country}`;
  }
  if (city) {
    return city;
  }
  if (label) {
    return label;
  }
  return country || "Zone geographique prioritaire";
}

function buildDerivedExplanation(zone: GeoZoneSnapshot): string {
  const factors: string[] = [];

  if (zone.totalRoamingCostMad > 0) {
    factors.push("un cout roaming fortement concentre");
  }
  if (zone.criticalAlerts > 0) {
    factors.push(`${zone.criticalAlerts} alerte(s) critique(s)`);
  }
  if (zone.fraudSignals > 0) {
    factors.push(`${zone.fraudSignals} signal(s) de fraude potentielle`);
  }
  if (zone.activeDevices > 0) {
    factors.push(`${zone.activeDevices} ligne(s) concernee(s)`);
  }

  if (factors.length === 0) {
    return "Les usages observes indiquent une exposition roaming a surveiller de pres.";
  }

  return `Les usages observes indiquent ${factors.join(", ")} sur cette zone.`;
}

function buildRecommendation(zone: GeoZoneSnapshot): string {
  const actions = [
    "verifier les lignes concernees",
    zone.fraudSignals > 0 || zone.criticalAlerts > 0
      ? "renforcer la surveillance roaming"
      : "revoir la politique de roaming active",
    "limiter le roaming non justifie",
    zone.criticalAlerts > 0 ? "activer une regle d'alerte automatique" : "",
  ];

  return `${dedupeStrings(actions)
    .filter(Boolean)
    .join(", ")}.`;
}

function detectGeoIntent(question: string): GeoQuestionIntent {
  const normalizedQuestion = normalizeGeoText(question);

  if (/\bcompare|comparaison|versus\b/.test(normalizedQuestion)) {
    return "comparison";
  }
  if (/\balertes?\b|\bcritiques?\b/.test(normalizedQuestion)) {
    return "alerts";
  }
  if (/\bconsommation\b|\busage\b|\btrafic\b/.test(normalizedQuestion)) {
    return "consumption";
  }
  return "cost";
}

function buildZoneSnapshots(data: ApiRoamingIntelligenceResponse): GeoZoneSnapshot[] {
  const snapshots: GeoZoneSnapshot[] = [];

  data.critical_zones.forEach((zone) => {
    snapshots.push({
      label: zone.label,
      city: zone.city,
      country: zone.country,
      totalRoamingCostMad: zone.total_roaming_cost_mad,
      activeDevices: zone.active_devices,
      alerts: zone.alerts,
      criticalAlerts: zone.critical_alerts,
      fraudSignals: zone.fraud_signals,
      riskLevel: zone.risk_level,
      explanation: zone.explanation,
    });
  });

  if (snapshots.length === 0) {
    data.heatmap.forEach((zone) => {
      snapshots.push({
        label: zone.label,
        city: zone.city,
        country: zone.country,
        totalRoamingCostMad: zone.total_roaming_cost_mad,
        activeDevices: zone.device_count,
        alerts: zone.critical_alerts,
        criticalAlerts: zone.critical_alerts,
        fraudSignals: zone.fraud_signals,
        riskLevel: zone.risk_level,
        explanation: null,
      });
    });
  }

  if (snapshots.length === 0) {
    data.country_insights.forEach((country) => {
      snapshots.push({
        label: country.country,
        city: null,
        country: country.country,
        totalRoamingCostMad: country.total_roaming_cost_mad,
        activeDevices: country.active_devices,
        alerts: country.critical_alerts,
        criticalAlerts: country.critical_alerts,
        fraudSignals: country.fraud_signals,
        riskLevel: country.risk_level,
        explanation: country.explanation,
      });
    });
  }

  if (snapshots.length === 0) {
    data.stats.top_cost_countries.forEach((country) => {
      snapshots.push({
        label: country.country,
        city: null,
        country: country.country,
        totalRoamingCostMad: country.total_roaming_cost_mad,
        activeDevices: country.device_count,
        alerts: country.critical_alerts,
        criticalAlerts: country.critical_alerts,
        fraudSignals: country.fraud_signals,
        riskLevel: country.critical_alerts > 0 ? "critical" : "medium",
        explanation: null,
      });
    });
  }

  const mergedSnapshots = new Map<string, GeoZoneSnapshot>();
  snapshots.forEach((zone) => {
    const key = buildZoneKey(zone);
    const existingZone = mergedSnapshots.get(key);
    if (!existingZone) {
      mergedSnapshots.set(key, zone);
      return;
    }

    const shouldReplace =
      zone.totalRoamingCostMad > existingZone.totalRoamingCostMad ||
      zone.criticalAlerts > existingZone.criticalAlerts ||
      zone.activeDevices > existingZone.activeDevices;

    if (shouldReplace) {
      mergedSnapshots.set(key, zone);
    }
  });

  return Array.from(mergedSnapshots.values());
}

function sortZones(zones: GeoZoneSnapshot[], intent: GeoQuestionIntent): GeoZoneSnapshot[] {
  return [...zones].sort((leftZone, rightZone) => {
    if (intent === "alerts") {
      return (
        rightZone.criticalAlerts - leftZone.criticalAlerts ||
        rightZone.alerts - leftZone.alerts ||
        rightZone.totalRoamingCostMad - leftZone.totalRoamingCostMad
      );
    }

    if (intent === "consumption") {
      return (
        rightZone.activeDevices - leftZone.activeDevices ||
        rightZone.totalRoamingCostMad - leftZone.totalRoamingCostMad ||
        rightZone.criticalAlerts - leftZone.criticalAlerts
      );
    }

    return (
      rightZone.totalRoamingCostMad - leftZone.totalRoamingCostMad ||
      rightZone.criticalAlerts - leftZone.criticalAlerts ||
      rightZone.activeDevices - leftZone.activeDevices
    );
  });
}

export function isGeoQuestion(question: string): boolean {
  const normalizedQuestion = normalizeGeoText(question);

  if (!normalizedQuestion) {
    return false;
  }

  return (
    GEO_QUESTION_PATTERNS.some((pattern) => pattern.test(normalizedQuestion)) ||
    GEO_QUESTION_KEYWORDS.some((keyword) => normalizedQuestion.includes(keyword))
  );
}

export function buildGeoQuestionUnavailableContent(
  reason: "empty" | "unavailable" = "unavailable",
): GeoQuestionAssistantContent {
  if (reason === "empty") {
    return {
      text:
        "Aucune zone critique detectee actuellement. Les donnees geographiques ne mettent pas en evidence de concentration roaming prioritaire.",
      recommendation:
        "Poursuivre la surveillance geospatiale et verifier l'alimentation des donnees roaming.",
      sources: ["Source: Cartographie roaming /api/v1/roaming/map"],
    };
  }

  return {
    text: "Les donnees geographiques ne sont pas disponibles actuellement.",
    recommendation:
      "Verifier la disponibilite du service de cartographie roaming puis relancer l'analyse.",
    sources: ["Source: Cartographie roaming /api/v1/roaming/map"],
  };
}

export function buildGeoQuestionAssistantContent(
  question: string,
  data: ApiRoamingIntelligenceResponse,
): GeoQuestionAssistantContent {
  const zones = buildZoneSnapshots(data);

  if (zones.length === 0) {
    return buildGeoQuestionUnavailableContent("empty");
  }

  const intent = detectGeoIntent(question);
  const rankedZones = sortZones(zones, intent);
  const topZone = rankedZones[0];
  const topZoneLabel = buildZoneLabel(topZone);
  const riskLevel = formatRiskLevel(topZone.riskLevel);
  const explanation = topZone.explanation?.trim() || buildDerivedExplanation(topZone);
  const recommendation = buildRecommendation(topZone);
  const baseSources = [
    "Source: Cartographie roaming /api/v1/roaming/map",
    `Generation: ${formatGeneratedAt(data.generated_at)}`,
    `Zones analysees: ${zones.length}`,
  ];

  if (intent === "comparison") {
    const comparisonLines = rankedZones.slice(0, 3).map((zone) => {
      const zoneLabel = buildZoneLabel(zone);
      return `${zoneLabel}: ${formatMadAmount(zone.totalRoamingCostMad)} et ${zone.criticalAlerts} alerte(s) critique(s)`;
    });

    return {
      text: `La comparaison geographique montre une concentration prioritaire sur ${comparisonLines.join(
        ", ",
      )}. ${topZoneLabel} reste la zone la plus exposee avec un risque ${riskLevel} et ${topZone.activeDevices} ligne(s) concernee(s).`,
      bullets: comparisonLines,
      recommendation,
      sources: baseSources,
    };
  }

  if (intent === "alerts") {
    return {
      text: `La zone qui concentre le plus d'alertes critiques est ${topZoneLabel} avec ${topZone.criticalAlerts} alerte(s) critique(s), ${formatMadAmount(
        topZone.totalRoamingCostMad,
      )} de cout roaming et un risque ${riskLevel}. ${explanation} La priorite est de ${recommendation}`,
      bullets: [
        `Zone prioritaire: ${topZoneLabel}`,
        `Alertes critiques: ${topZone.criticalAlerts}`,
        `Impact roaming: ${formatMadAmount(topZone.totalRoamingCostMad)}`,
        `Lignes concernees: ${topZone.activeDevices}`,
      ],
      recommendation,
      sources: baseSources,
    };
  }

  if (intent === "consumption") {
    return {
      text: `La zone la plus sollicitee est ${topZoneLabel} avec ${topZone.activeDevices} ligne(s) concernee(s), ${formatMadAmount(
        topZone.totalRoamingCostMad,
      )} de cout roaming et un niveau de risque ${riskLevel}. ${explanation} Une revue des usages roaming sur cette zone permettrait de prioriser les lignes les plus actives.`,
      bullets: [
        `Zone la plus sollicitee: ${topZoneLabel}`,
        `Lignes concernees: ${topZone.activeDevices}`,
        `Cout roaming: ${formatMadAmount(topZone.totalRoamingCostMad)}`,
        `Alertes critiques: ${topZone.criticalAlerts}`,
      ],
      recommendation,
      sources: baseSources,
    };
  }

  return {
    text: `La region la plus exposee est ${topZoneLabel} avec environ ${formatMadAmount(
      topZone.totalRoamingCostMad,
    )} de cout roaming. Cette zone concentre un niveau de risque ${riskLevel} avec ${topZone.criticalAlerts} alerte(s) critique(s) et ${topZone.activeDevices} ligne(s) concernee(s). ${explanation} La priorite est de ${recommendation}`,
    bullets: [
      `Region prioritaire: ${topZoneLabel}`,
      `Cout roaming: ${formatMadAmount(topZone.totalRoamingCostMad)}`,
      `Alertes critiques: ${topZone.criticalAlerts}`,
      `Signaux de fraude: ${topZone.fraudSignals}`,
    ],
    recommendation,
    sources: baseSources,
  };
}

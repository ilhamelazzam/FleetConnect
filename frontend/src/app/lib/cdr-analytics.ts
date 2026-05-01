export function formatMadValue(value: number): string {
  return `${value.toLocaleString("fr-FR", {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })} MAD`;
}

export function formatRiskScore(value: number): string {
  return `${value.toFixed(1)}/100`;
}

export function formatSeverityLabel(severity: string): string {
  if (severity === "critique") {
    return "Critique";
  }
  if (severity === "eleve") {
    return "Eleve";
  }
  if (severity === "moyen") {
    return "Moyen";
  }
  return "Faible";
}

export function getSeverityClasses(severity: string): string {
  if (severity === "critique") {
    return "bg-red-50 text-[#DC2626]";
  }
  if (severity === "eleve") {
    return "bg-orange-50 text-[#F97316]";
  }
  if (severity === "moyen") {
    return "bg-amber-50 text-[#CA8A04]";
  }
  return "bg-emerald-50 text-[#16A34A]";
}

export function getSeverityChartColor(severity: string): string {
  if (severity === "critique") {
    return "#DC2626";
  }
  if (severity === "eleve") {
    return "#F97316";
  }
  if (severity === "moyen") {
    return "#CA8A04";
  }
  return "#16A34A";
}

export function formatFraudTypeLabel(fraudType: string): string {
  const normalized = fraudType.trim().toLowerCase();

  if (normalized === "none") {
    return "Aucune";
  }

  const fraudTypeMap: Record<string, string> = {
    sim_box_fraud: "Fraude SIM box",
    roaming_abuse: "Abus de roaming",
    wangiri: "Wangiri",
    international_fraud: "Fraude internationale",
    premium_rate_abuse: "Abus de numeros surtaxes",
    unknown: "Inconnue",
    inconnu: "Inconnue",
  };

  if (fraudTypeMap[normalized]) {
    return fraudTypeMap[normalized];
  }

  return fraudType
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatCallZoneLabel(callZone: string): string {
  const normalized = callZone.trim().toLowerCase();

  if (normalized === "roaming") {
    return "Itinerance";
  }
  if (normalized === "international") {
    return "International";
  }

  return callZone;
}

export function formatCallTypeLabel(callType: string): string {
  const normalized = callType.trim().toLowerCase();

  if (normalized === "international") {
    return "International";
  }
  if (normalized === "local") {
    return "Local";
  }
  if (normalized === "national") {
    return "National";
  }

  return callType;
}

export function formatTransactionStatusLabel(transactionStatus: string): string {
  const normalized = transactionStatus.trim().toLowerCase();

  if (normalized === "fraudulent") {
    return "Frauduleux";
  }
  if (normalized === "suspicious") {
    return "Suspect";
  }
  if (normalized === "normal") {
    return "Normal";
  }

  return transactionStatus;
}

export function formatCdrDateTime(value: string): string {
  const normalized = value.replace(" ", "T");
  const parsedDate = new Date(normalized);

  if (Number.isNaN(parsedDate.getTime())) {
    return value;
  }

  return parsedDate.toLocaleString("fr-FR", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getOperatorStyles(operator: string): { backgroundColor: string; color: string } {
  if (operator === "Orange Maroc") {
    return { backgroundColor: "#FFF5EB", color: "#FF6600" };
  }

  if (operator === "Maroc Telecom") {
    return { backgroundColor: "#FFEEF0", color: "#E60012" };
  }

  if (operator === "inwi") {
    return { backgroundColor: "#E6F7FF", color: "#009FE3" };
  }

  return { backgroundColor: "#F3F4F6", color: "#6B7280" };
}

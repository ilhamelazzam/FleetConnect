import { formatMadValue, getOperatorStyles } from "./cdr-analytics";

export { formatMadValue, getOperatorStyles };

export function formatCustomerRiskLabel(riskLevel: string): string {
  if (riskLevel === "Eleve") {
    return "Eleve";
  }
  return riskLevel;
}

export function getCustomerRiskClasses(riskLevel: string): string {
  if (riskLevel === "Critique") {
    return "bg-red-50 text-[#DC2626]";
  }
  if (riskLevel === "Eleve") {
    return "bg-orange-50 text-[#F97316]";
  }
  if (riskLevel === "Moyen") {
    return "bg-amber-50 text-[#CA8A04]";
  }
  return "bg-emerald-50 text-[#16A34A]";
}

export function getCustomerRiskColor(riskLevel: string): string {
  if (riskLevel === "Critique") {
    return "#DC2626";
  }
  if (riskLevel === "Eleve") {
    return "#F97316";
  }
  if (riskLevel === "Moyen") {
    return "#CA8A04";
  }
  return "#16A34A";
}

export function formatChurnLabel(value: boolean): string {
  return value ? "Oui" : "Non";
}

export function formatContractLabel(contract: string): string {
  const normalized = contract.trim().toLowerCase();

  if (normalized === "month-to-month") {
    return "Mensuel";
  }
  if (normalized === "one year") {
    return "Un an";
  }
  if (normalized === "two year") {
    return "Deux ans";
  }

  return contract;
}

export function formatInternetServiceLabel(service: string): string {
  const normalized = service.trim().toLowerCase();

  if (normalized === "fiber optic") {
    return "Fibre optique";
  }
  if (normalized === "no internet service") {
    return "Sans service internet";
  }

  return service;
}

export function formatPaymentMethodLabel(paymentMethod: string): string {
  const normalized = paymentMethod.trim().toLowerCase();

  if (normalized === "electronic check") {
    return "Cheque electronique";
  }
  if (normalized === "mailed check") {
    return "Cheque envoye";
  }
  if (normalized === "bank transfer (automatic)") {
    return "Virement bancaire automatique";
  }
  if (normalized === "credit card (automatic)") {
    return "Carte bancaire automatique";
  }

  return paymentMethod;
}

export function formatCustomerFactorLabel(factor: string): string {
  const normalized = factor.trim().toLowerCase().replace(/_/g, " ");

  const factorMap: Record<string, string> = {
    "month-to-month": "contrat mensuel",
    "fiber optic": "fibre optique",
    dsl: "dsl",
    "electronic check": "cheque electronique",
    "mailed check": "cheque envoye",
    "bank transfer (automatic)": "virement bancaire automatique",
    "credit card (automatic)": "carte bancaire automatique",
    "high monthly charges": "facturation mensuelle elevee",
    "monthly charges": "facturation mensuelle",
    "short tenure": "faible anciennete",
    tenure: "anciennete",
    "paperless billing": "facturation dematerialisee",
    "online security": "securite en ligne",
    "online backup": "sauvegarde en ligne",
    "device protection": "protection appareil",
    "tech support": "support technique",
    "streaming tv": "streaming tv",
    "streaming movies": "streaming films",
    "multiple lines": "lignes multiples",
    "senior citizen": "senior",
    "no internet service": "sans service internet",
  };

  return factorMap[normalized] ?? factor.replace(/_/g, " ");
}

export function getChurnClasses(value: boolean): string {
  return value ? "bg-red-50 text-[#DC2626]" : "bg-emerald-50 text-[#16A34A]";
}

export function formatRiskProbability(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatRiskScore(value: number): string {
  return `${value.toFixed(1)}/100`;
}

export function formatTenure(value: number): string {
  return `${value} mois`;
}

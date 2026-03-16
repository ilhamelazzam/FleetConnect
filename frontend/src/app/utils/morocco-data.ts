// Opérateurs télécoms marocains
export const moroccanOperators = {
  ORANGE: {
    name: "Orange Maroc",
    color: "#FF6600",
    bgColor: "#FFF5EB",
  },
  MAROC_TELECOM: {
    name: "Maroc Telecom",
    color: "#E60012",
    bgColor: "#FFEEF0",
  },
  INWI: {
    name: "inwi",
    color: "#009FE3",
    bgColor: "#E6F7FF",
  },
};

// Fonction pour générer un numéro marocain aléatoire
export function generateMoroccanPhoneNumber(): string {
  const prefixes = ["6", "7"]; // Préfixes mobiles au Maroc
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const number = Math.floor(10000000 + Math.random() * 90000000).toString();
  return `+212 ${prefix} ${number.slice(0, 2)} ${number.slice(2, 4)} ${number.slice(4, 6)} ${number.slice(6, 8)}`;
}

// Fonction pour formater un prix en MAD
export function formatMAD(euroAmount: number): string {
  // Conversion approximative: 1 EUR ≈ 10 MAD
  const madAmount = euroAmount * 10;
  return `${madAmount.toFixed(0)} MAD`;
}

// Fonction pour obtenir le badge d'opérateur
export function getOperatorBadge(operatorKey: keyof typeof moroccanOperators) {
  const operator = moroccanOperators[operatorKey];
  return {
    name: operator.name,
    color: operator.color,
    bgColor: operator.bgColor,
  };
}

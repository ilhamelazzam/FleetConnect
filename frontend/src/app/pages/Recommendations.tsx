import { useState } from "react";
import { Check, Eye, Lightbulb, TrendingDown, X } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";

type Recommendation = {
  id: string;
  line: string;
  user: string;
  action: string;
  reason: string;
  impact: string;
  saving: string;
  priority: "Élevée" | "Moyenne" | "Faible";
  confidence: number;
};

const recommendations: Recommendation[] = [
  {
    id: "R-001",
    line: "+212 6 12 34 56 78",
    user: "Hassan Alami",
    action: "Passer du forfait Premium 50Go au forfait Business 100Go",
    reason: "Dépassements récurrents de data (moyenne 78Go/mois)",
    impact: "Élimination des frais de dépassement",
    saving: "450 MAD",
    priority: "Élevée",
    confidence: 95,
  },
  {
    id: "R-002",
    line: "+212 6 67 89 01 23",
    user: "Salma Chraibi",
    action: "Activer une limite data à 45Go",
    reason: "Consommation moyenne de 42Go avec pics à 52Go",
    impact: "Contrôle des dépassements",
    saving: "320 MAD",
    priority: "Élevée",
    confidence: 88,
  },
  {
    id: "R-003",
    line: "+212 7 78 90 12 34",
    user: "Karim Senhaji",
    action: "Désactiver l'option roaming international",
    reason: "Aucun déplacement professionnel prévu dans les 6 prochains mois",
    impact: "Économie sur frais fixes",
    saving: "280 MAD",
    priority: "Moyenne",
    confidence: 82,
  },
  {
    id: "R-004",
    line: "+212 7 34 56 78 90",
    user: "Youssef Tazi",
    action: "Réduire au forfait Standard 20Go",
    reason: "Consommation moyenne de seulement 15Go/mois",
    impact: "Optimisation du forfait",
    saving: "200 MAD",
    priority: "Moyenne",
    confidence: 91,
  },
  {
    id: "R-005",
    line: "+212 6 89 01 23 45",
    user: "Zineb El Fassi",
    action: "Grouper avec forfait famille entreprise",
    reason: "Possibilité de mutualisation avec 3 autres lignes",
    impact: "Réduction groupe",
    saving: "380 MAD",
    priority: "Faible",
    confidence: 75,
  },
  {
    id: "R-006",
    line: "+212 6 23 45 67 89",
    user: "Fatima Benali",
    action: "Activer alerte seuil à 80% du forfait",
    reason: "Tendance à dépasser légèrement le forfait",
    impact: "Prévention des dépassements",
    saving: "150 MAD",
    priority: "Faible",
    confidence: 68,
  },
];

function parseSaving(saving: Recommendation["saving"]): number {
  return Number.parseInt(saving.replace(" MAD", ""), 10);
}

function getPriorityBadgeClass(priority: Recommendation["priority"]): string {
  if (priority === "Élevée") {
    return "bg-red-50 text-[#DC2626]";
  }

  if (priority === "Moyenne") {
    return "bg-orange-50 text-[#F59E0B]";
  }

  return "bg-blue-50 text-[#2563EB]";
}

function getDecisionWindow(priority: Recommendation["priority"]): string {
  if (priority === "Élevée") {
    return "Sous 7 jours";
  }

  if (priority === "Moyenne") {
    return "Ce mois-ci";
  }

  return "Lors de la prochaine revue";
}

function getReviewChecklist(recommendation: Recommendation): string[] {
  const action = recommendation.action.toLowerCase();
  const checks = [
    "Vérifier l'historique des 6 derniers mois avant validation.",
    "Confirmer l'impact métier avec l'utilisateur ou son manager.",
  ];

  if (action.includes("forfait")) {
    checks.push("Comparer le forfait cible avec l'offre actuellement active.");
  }

  if (action.includes("roaming")) {
    checks.push("Confirmer l'absence de déplacements internationaux à venir.");
  }

  if (action.includes("limite data")) {
    checks.push("S'assurer que la limite proposée couvre les usages critiques.");
  }

  if (action.includes("alerte seuil")) {
    checks.push("Définir le canal de notification le plus pertinent.");
  }

  return checks;
}

export default function Recommendations() {
  const [selectedRecommendation, setSelectedRecommendation] = useState<Recommendation | null>(null);

  const totalSavings = recommendations.reduce((sum, recommendation) => sum + parseSaving(recommendation.saving), 0);
  const highPriority = recommendations.filter((recommendation) => recommendation.priority === "Élevée").length;

  return (
    <>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="mb-2 text-2xl font-bold text-[#0F172A]">Recommandations d'optimisation</h1>
            <p className="text-[#64748B]">Actions suggérées par l'intelligence artificielle</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="rounded-xl bg-gradient-to-br from-[#16A34A] to-[#059669] p-6 text-white">
            <div className="mb-2 flex items-center gap-2">
              <TrendingDown className="h-6 w-6" />
              <h3 className="text-lg font-semibold">Économies potentielles</h3>
            </div>
            <p className="mb-1 text-4xl font-bold">{totalSavings.toLocaleString()} MAD</p>
            <p className="text-sm text-white/80">par mois</p>
            <div className="mt-4 rounded-lg bg-white/20 p-3 backdrop-blur-sm">
              <p className="text-sm">Soit {(totalSavings * 12).toLocaleString()} MAD / an</p>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="mb-2 flex items-center gap-2">
              <Lightbulb className="h-6 w-6 text-[#F59E0B]" />
              <h3 className="text-lg font-semibold text-[#0F172A]">Recommandations</h3>
            </div>
            <p className="mb-1 text-4xl font-bold text-[#0F172A]">{recommendations.length}</p>
            <p className="mb-4 text-sm text-[#64748B]">actions proposées</p>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-[#DC2626]">
                {highPriority} priorité élevée
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="mb-2 flex items-center gap-2">
              <Check className="h-6 w-6 text-[#2563EB]" />
              <h3 className="text-lg font-semibold text-[#0F172A]">Lignes optimisables</h3>
            </div>
            <p className="mb-1 text-4xl font-bold text-[#0F172A]">{recommendations.length}</p>
            <p className="mb-4 text-sm text-[#64748B]">sur 342 lignes</p>
            <div className="h-2 overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-[#2563EB]"
                style={{ width: `${(recommendations.length / 342) * 100}%` }}
              />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {recommendations.map((recommendation) => (
            <div
              key={recommendation.id}
              className="rounded-xl border-2 border-gray-200 bg-white p-6 transition-all hover:border-[#2563EB]"
            >
              <div className="mb-4 flex items-start justify-between">
                <div className="flex-1">
                  <div className="mb-2 flex items-center gap-3">
                    <span className="text-sm font-medium text-[#64748B]">{recommendation.id}</span>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${getPriorityBadgeClass(recommendation.priority)}`}
                    >
                      Priorité {recommendation.priority.toLowerCase()}
                    </span>
                    <div className="flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1">
                      <div className="h-2 w-2 rounded-full bg-[#16A34A]" />
                      <span className="text-xs font-medium text-[#16A34A]">
                        Confiance {recommendation.confidence}%
                      </span>
                    </div>
                  </div>
                  <h3 className="mb-1 text-lg font-bold text-[#0F172A]">{recommendation.action}</h3>
                  <div className="mb-3 flex items-center gap-2 text-sm text-[#64748B]">
                    <span>{recommendation.line}</span>
                    <span>•</span>
                    <span>{recommendation.user}</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="mb-1 text-sm text-[#64748B]">Économie estimée</p>
                  <p className="text-3xl font-bold text-[#16A34A]">{recommendation.saving}</p>
                  <p className="text-xs text-[#64748B]">/mois</p>
                </div>
              </div>

              <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-lg bg-[#F8FAFC] p-4">
                  <p className="mb-1 text-xs font-semibold text-[#64748B]">Justification IA</p>
                  <p className="text-sm text-[#0F172A]">{recommendation.reason}</p>
                </div>
                <div className="rounded-lg bg-[#F8FAFC] p-4">
                  <p className="mb-1 text-xs font-semibold text-[#64748B]">Impact attendu</p>
                  <p className="text-sm text-[#0F172A]">{recommendation.impact}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-lg bg-[#16A34A] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#15803d]"
                >
                  <Check className="h-4 w-4" />
                  <span>Accepter</span>
                </button>
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-lg bg-[#DC2626] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#b91c1c]"
                >
                  <X className="h-4 w-4" />
                  <span>Rejeter</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedRecommendation(recommendation)}
                  className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-[#64748B] transition-colors hover:border-[#2563EB] hover:bg-[#F8FAFC] hover:text-[#2563EB]"
                >
                  <Eye className="h-4 w-4" />
                  <span>Examiner</span>
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-xl bg-gradient-to-br from-[#7C3AED] to-[#2D6CDF] p-6 text-white">
          <div className="mb-4 flex items-center gap-2">
            <Lightbulb className="h-6 w-6" />
            <h2 className="text-xl font-bold">Analyse IA globale</h2>
          </div>
          <div className="space-y-3">
            <p className="text-white/90">
              En appliquant l'ensemble de ces recommandations, vous pourriez économiser{" "}
              <span className="font-bold">{totalSavings.toLocaleString()} MAD par mois</span>, soit{" "}
              <span className="font-bold">{(totalSavings * 12).toLocaleString()} MAD par an</span>.
            </p>
            <p className="text-white/90">
              Les recommandations prioritaires concernent principalement les dépassements de forfait et les
              options inutilisées. L'application de ces 2 actions prioritaires permettrait d'économiser{" "}
              <span className="font-bold">770 MAD/mois</span> à elle seule.
            </p>
            <p className="text-white/90">
              Notre système a analysé 6 mois d'historique de consommation pour générer ces recommandations
              avec un niveau de confiance moyen de <span className="font-bold">83%</span>.
            </p>
          </div>
        </div>
      </div>

      <Dialog
        open={selectedRecommendation !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setSelectedRecommendation(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto border border-gray-200 bg-white sm:max-w-3xl">
          {selectedRecommendation ? (
            <>
              <DialogHeader className="pr-8">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-medium text-[#64748B]">{selectedRecommendation.id}</span>
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${getPriorityBadgeClass(selectedRecommendation.priority)}`}
                  >
                    Priorité {selectedRecommendation.priority.toLowerCase()}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-[#16A34A]">
                    Confiance {selectedRecommendation.confidence}%
                  </span>
                </div>
                <DialogTitle className="text-2xl font-bold text-[#0F172A]">
                  Examiner la recommandation
                </DialogTitle>
                <DialogDescription className="text-sm text-[#64748B]">
                  Analyse détaillée avant validation ou rejet de l'action suggérée.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-6">
                <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-[#EFF6FF] via-white to-[#F8FAFC] p-5">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="max-w-2xl">
                      <p className="text-sm font-medium text-[#2D6CDF]">Action recommandée</p>
                      <h3 className="mt-2 text-xl font-bold text-[#0F172A]">
                        {selectedRecommendation.action}
                      </h3>
                      <p className="mt-3 text-sm text-[#64748B]">
                        Ligne {selectedRecommendation.line} • {selectedRecommendation.user}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-blue-100">
                        <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">
                          Gain mensuel
                        </p>
                        <p className="mt-2 text-lg font-bold text-[#16A34A]">
                          {selectedRecommendation.saving}
                        </p>
                      </div>
                      <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-blue-100">
                        <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">
                          Gain annuel
                        </p>
                        <p className="mt-2 text-lg font-bold text-[#0F172A]">
                          {(parseSaving(selectedRecommendation.saving) * 12).toLocaleString()} MAD
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">Priorité</p>
                    <p className="mt-2 text-sm font-semibold text-[#0F172A]">
                      {selectedRecommendation.priority}
                    </p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">
                      Fenêtre d'action
                    </p>
                    <p className="mt-2 text-sm font-semibold text-[#0F172A]">
                      {getDecisionWindow(selectedRecommendation.priority)}
                    </p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">
                      Niveau de confiance
                    </p>
                    <p className="mt-2 text-sm font-semibold text-[#0F172A]">
                      {selectedRecommendation.confidence}%
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-gray-200 bg-white p-5">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">
                      Justification IA
                    </p>
                    <p className="mt-3 text-sm leading-6 text-[#0F172A]">
                      {selectedRecommendation.reason}
                    </p>
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white p-5">
                    <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">
                      Impact attendu
                    </p>
                    <p className="mt-3 text-sm leading-6 text-[#0F172A]">
                      {selectedRecommendation.impact}
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-gray-200 bg-[#F8FAFC] p-5">
                  <p className="text-xs font-medium uppercase tracking-wide text-[#64748B]">
                    Points de contrôle avant décision
                  </p>
                  <ul className="mt-3 space-y-3">
                    {getReviewChecklist(selectedRecommendation).map((item) => (
                      <li key={item} className="flex items-start gap-3 text-sm text-[#0F172A]">
                        <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[#2563EB]" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <DialogFooter className="mt-6 gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedRecommendation(null)}
                  className="rounded-lg border border-gray-200 px-4 py-2.5 font-medium text-[#64748B] transition-colors hover:bg-[#F8FAFC]"
                >
                  Fermer
                </button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

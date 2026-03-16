import { useParams, Link } from "react-router";
import { ArrowLeft, AlertCircle, Phone, Calendar, Brain, Check, X, Send, FileDown } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const anomalyPattern = [
  { hour: "00h", normal: 50, detected: 52 },
  { hour: "04h", normal: 45, detected: 48 },
  { hour: "08h", normal: 320, detected: 325 },
  { hour: "12h", normal: 180, detected: 185 },
  { hour: "14h", normal: 220, detected: 1250, anomaly: true },
  { hour: "16h", normal: 280, detected: 285 },
  { hour: "20h", normal: 150, detected: 155 },
];

const timeline = [
  { time: "14:32", event: "Détection de l'anomalie", status: "detected", user: "Système IA" },
  { time: "14:35", event: "Alerte créée et envoyée", status: "created", user: "Système" },
  { time: "14:45", event: "Notification email envoyée", status: "notified", user: "Système" },
  { time: "15:20", event: "Consultation par Admin", status: "viewed", user: "Admin" },
];

export default function AlertDetail() {
  const { id } = useParams();

  return (
    <div className="p-6 space-y-6">
      {/* Back Button */}
      <Link
        to="/anomalies"
        className="inline-flex items-center gap-2 text-[#2563EB] hover:text-[#1d4ed8] font-medium"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Retour aux alertes</span>
      </Link>

      {/* Alert Header */}
      <div className="bg-white rounded-xl border-2 border-[#DC2626] p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 bg-red-100 rounded-xl flex items-center justify-center">
              <AlertCircle className="w-8 h-8 text-[#DC2626]" />
            </div>
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-2xl font-bold text-[#0F172A]">Alerte {id}</h1>
                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-red-50 text-[#DC2626]">
                  Critique
                </span>
                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-orange-50 text-[#F59E0B]">
                  Ouverte
                </span>
              </div>
              <p className="text-lg text-[#0F172A] font-medium mb-1">Dépassement data exceptionnel</p>
              <p className="text-[#64748B]">Détecté le 9 mars 2026 à 14:32</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-[#64748B] mb-1">Score de risque</p>
            <p className="text-4xl font-bold text-[#DC2626]">95</p>
            <p className="text-sm text-[#64748B]">/100</p>
          </div>
        </div>
      </div>

      {/* Line Information */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-[#0F172A] mb-4">Ligne concernée</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Phone className="w-4 h-4 text-[#64748B]" />
              <p className="text-sm text-[#64748B]">Numéro de ligne</p>
            </div>
            <p className="font-semibold text-[#0F172A]">+212 6 12 34 56 78</p>
            <Link to="/lignes/L-001" className="text-sm text-[#2563EB] hover:text-[#1d4ed8]">
              Voir la ligne
            </Link>
          </div>
          <div>
            <p className="text-sm text-[#64748B] mb-2">Utilisateur</p>
            <p className="font-semibold text-[#0F172A]">Dupont Jean</p>
            <p className="text-sm text-[#64748B]">Commercial</p>
          </div>
          <div>
            <p className="text-sm text-[#64748B] mb-2">Opérateur</p>
            <p className="font-semibold text-[#0F172A]">Orange</p>
            <p className="text-sm text-[#64748B]">Premium 50Go</p>
          </div>
          <div>
            <p className="text-sm text-[#64748B] mb-2">Coût impact</p>
            <p className="font-semibold text-[#DC2626] text-xl">+42 MAD</p>
            <p className="text-sm text-[#64748B]">Frais dépassement</p>
          </div>
        </div>
      </div>

      {/* Anomaly Details */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Description */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-[#0F172A] mb-4">Description de l'anomalie</h2>
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium text-[#64748B] mb-1">Type d'anomalie</p>
              <p className="text-[#0F172A]">Consommation excessive de data mobile</p>
            </div>
            <div>
              <p className="text-sm font-medium text-[#64748B] mb-1">Description détaillée</p>
              <p className="text-[#0F172A]">
                Consommation anormale de 8.5 Go de data mobile en seulement 2 heures (entre 14h00 et 16h00).
                Ce comportement représente 17% du forfait mensuel en 2 heures, soit 85 fois la consommation horaire normale.
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-[#64748B] mb-1">Contexte</p>
              <p className="text-[#0F172A]">
                L'utilisateur était en déplacement professionnel. Consommation principalement via streaming vidéo et téléchargement de fichiers volumineux.
              </p>
            </div>
          </div>
        </div>

        {/* AI Explanation */}
        <div className="bg-gradient-to-br from-[#7C3AED] to-[#2563EB] rounded-xl p-6 text-white">
          <div className="flex items-center gap-2 mb-4">
            <Brain className="w-6 h-6" />
            <h2 className="text-lg font-semibold">Explication IA</h2>
          </div>
          <div className="space-y-3">
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3">
              <p className="text-sm font-semibold mb-1">Méthode de détection</p>
              <p className="text-sm text-white/90">
                Isolation Forest + Z-score sur fenêtre glissante de 2 heures
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3">
              <p className="text-sm font-semibold mb-1">Écart par rapport à la normale</p>
              <p className="text-sm text-white/90">
                +850% vs moyenne historique (consommation normale: 1 Go/jour)
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3">
              <p className="text-sm font-semibold mb-1">Confiance de la détection</p>
              <p className="text-sm text-white/90">
                98% - Très forte probabilité d'anomalie réelle
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3">
              <p className="text-sm font-semibold mb-1">Facteurs contribuants</p>
              <ul className="text-sm text-white/90 list-disc list-inside">
                <li>Absence de pattern similaire sur 6 mois</li>
                <li>Horaire inhabituel pour forte consommation</li>
                <li>Dépassement de 3 seuils d'alerte</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Anomaly Pattern Chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-[#0F172A] mb-4">
          Pattern de consommation le 9 mars 2026
        </h2>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={anomalyPattern}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="hour" stroke="#64748B" />
            <YAxis stroke="#64748B" label={{ value: "Data (Mo)", angle: -90, position: "insideLeft" }} />
            <Tooltip />
            <Line
              type="monotone"
              dataKey="normal"
              stroke="#16A34A"
              strokeWidth={2}
              strokeDasharray="5 5"
              name="Comportement normal"
            />
            <Line
              type="monotone"
              dataKey="detected"
              stroke="#DC2626"
              strokeWidth={3}
              name="Consommation détectée"
              dot={(props) => {
                const { cx, cy, payload } = props;
                if (payload.anomaly) {
                  return (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={8}
                      fill="#DC2626"
                      stroke="#fff"
                      strokeWidth={2}
                    />
                  );
                }
                return <circle cx={cx} cy={cy} r={4} fill="#DC2626" />;
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Recommended Actions */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-[#0F172A] mb-4">Actions recommandées</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="w-10 h-10 bg-[#2563EB] bg-opacity-10 rounded-lg flex items-center justify-center mb-3">
              <span className="text-[#2563EB] font-bold">1</span>
            </div>
            <h3 className="font-semibold text-[#0F172A] mb-2">Contacter l'utilisateur</h3>
            <p className="text-sm text-[#64748B] mb-3">
              Vérifier si cette consommation était prévue et sensibiliser aux bonnes pratiques.
            </p>
            <button className="w-full px-4 py-2 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#1d4ed8] transition-colors">
              Envoyer notification
            </button>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="w-10 h-10 bg-[#F59E0B] bg-opacity-10 rounded-lg flex items-center justify-center mb-3">
              <span className="text-[#F59E0B] font-bold">2</span>
            </div>
            <h3 className="font-semibold text-[#0F172A] mb-2">Ajuster le forfait</h3>
            <p className="text-sm text-[#64748B] mb-3">
              Passer au forfait Business 100Go pour éviter les dépassements futurs.
            </p>
            <button className="w-full px-4 py-2 border border-gray-200 text-[#64748B] rounded-lg text-sm font-medium hover:bg-[#F8FAFC] transition-colors">
              Voir les forfaits
            </button>
          </div>
          <div className="border border-gray-200 rounded-lg p-4">
            <div className="w-10 h-10 bg-[#16A34A] bg-opacity-10 rounded-lg flex items-center justify-center mb-3">
              <span className="text-[#16A34A] font-bold">3</span>
            </div>
            <h3 className="font-semibold text-[#0F172A] mb-2">Activer limite data</h3>
            <p className="text-sm text-[#64748B] mb-3">
              Configurer une alerte automatique à 80% du forfait.
            </p>
            <button className="w-full px-4 py-2 border border-gray-200 text-[#64748B] rounded-lg text-sm font-medium hover:bg-[#F8FAFC] transition-colors">
              Configurer
            </button>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-[#0F172A] mb-4">Historique de traitement</h2>
        <div className="space-y-4">
          {timeline.map((item, idx) => (
            <div key={idx} className="flex items-start gap-4">
              <div className="flex flex-col items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  item.status === "detected" ? "bg-red-100 text-[#DC2626]" :
                  item.status === "created" ? "bg-orange-100 text-[#F59E0B]" :
                  item.status === "notified" ? "bg-blue-100 text-[#2563EB]" :
                  "bg-green-100 text-[#16A34A]"
                }`}>
                  <Calendar className="w-4 h-4" />
                </div>
                {idx < timeline.length - 1 && (
                  <div className="w-0.5 h-full bg-gray-200 mt-2" />
                )}
              </div>
              <div className="flex-1 pb-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="font-medium text-[#0F172A]">{item.event}</p>
                  <p className="text-sm text-[#64748B]">{item.time}</p>
                </div>
                <p className="text-sm text-[#64748B]">Par: {item.user}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-3">
        <button className="flex items-center gap-2 px-6 py-3 bg-[#16A34A] text-white rounded-lg font-medium hover:bg-[#15803d] transition-colors">
          <Check className="w-5 h-5" />
          <span>Valider l'alerte</span>
        </button>
        <button className="flex items-center gap-2 px-6 py-3 bg-[#2563EB] text-white rounded-lg font-medium hover:bg-[#1d4ed8] transition-colors">
          <Send className="w-5 h-5" />
          <span>Notifier l'utilisateur</span>
        </button>
        <button className="flex items-center gap-2 px-6 py-3 border border-gray-200 text-[#64748B] rounded-lg font-medium hover:bg-[#F8FAFC] transition-colors">
          <FileDown className="w-5 h-5" />
          <span>Exporter le rapport</span>
        </button>
        <button className="flex items-center gap-2 px-6 py-3 border border-[#DC2626] text-[#DC2626] rounded-lg font-medium hover:bg-red-50 transition-colors">
          <X className="w-5 h-5" />
          <span>Clôturer (faux positif)</span>
        </button>
      </div>
    </div>
  );
}

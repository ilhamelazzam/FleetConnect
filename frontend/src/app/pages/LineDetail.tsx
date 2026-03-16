import { useParams, Link } from "react-router";
import { ArrowLeft, Phone, User, Building2, AlertTriangle, TrendingUp } from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const consumptionHistory = [
  { month: "Sep", data: 42, voix: 180, sms: 250 },
  { month: "Oct", data: 45, voix: 195, sms: 280 },
  { month: "Nov", data: 48, voix: 205, sms: 310 },
  { month: "Déc", data: 52, voix: 210, sms: 290 },
  { month: "Jan", data: 47, voix: 190, sms: 270 },
  { month: "Fév", data: 51, voix: 220, sms: 305 },
  { month: "Mar", data: 55, voix: 235, sms: 320 },
];

const alerts = [
  { id: "A-2401", type: "Dépassement data", date: "2026-03-09", severity: "critique" },
  { id: "A-2105", type: "Pic de consommation", date: "2026-02-15", severity: "moyen" },
  { id: "A-1887", type: "Roaming inhabituel", date: "2026-01-22", severity: "faible" },
];

const recommendations = [
  { action: "Passer au forfait Business 100Go", saving: "45 MAD/mois", priority: "Élevée" },
  { action: "Activer limite data à 90Go", saving: "20 MAD/mois", priority: "Moyenne" },
];

export default function LineDetail() {
  const { id } = useParams();

  return (
    <div className="p-6 space-y-6">
      {/* Back Button */}
      <Link
        to="/lignes"
        className="inline-flex items-center gap-2 text-[#2563EB] hover:text-[#1d4ed8] font-medium"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Retour aux lignes</span>
      </Link>

      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 bg-gradient-to-br from-[#2563EB] to-[#06B6D4] rounded-xl flex items-center justify-center">
              <Phone className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[#0F172A] mb-2">+212 6 12 34 56 78</h1>
              <p className="text-[#64748B] mb-3">Identifiant: {id}</p>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-50 text-[#16A34A]">
                  Actif
                </span>
                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-red-50 text-[#DC2626]">
                  Score risque: Élevé
                </span>
              </div>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-[#64748B] mb-1">Coût mensuel moyen</p>
            <p className="text-3xl font-bold text-[#0F172A]">485 MAD</p>
          </div>
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-3">
            <User className="w-5 h-5 text-[#2563EB]" />
            <p className="text-sm text-[#64748B]">Utilisateur</p>
          </div>
          <p className="font-semibold text-[#0F172A]">Dupont Jean</p>
          <p className="text-sm text-[#64748B]">j.dupont@entreprise.fr</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-3">
            <Building2 className="w-5 h-5 text-[#2563EB]" />
            <p className="text-sm text-[#64748B]">Département</p>
          </div>
          <p className="font-semibold text-[#0F172A]">Commercial</p>
          <p className="text-sm text-[#64748B]">Manager: M. Durand</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-3">
            <Phone className="w-5 h-5 text-[#2563EB]" />
            <p className="text-sm text-[#64748B]">Opérateur</p>
          </div>
          <p className="font-semibold text-[#0F172A]">Orange</p>
          <p className="text-sm text-[#64748B]">Contrat Pro</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-3">
            <TrendingUp className="w-5 h-5 text-[#2563EB]" />
            <p className="text-sm text-[#64748B]">Forfait actuel</p>
          </div>
          <p className="font-semibold text-[#0F172A]">Premium 50Go</p>
          <p className="text-sm text-[#64748B]">55 MAD/mois</p>
        </div>
      </div>

      {/* Current Consumption */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-[#0F172A] mb-4">Consommation en cours (Mars 2026)</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div>
            <p className="text-sm text-[#64748B] mb-2">Data mobile</p>
            <p className="text-2xl font-bold text-[#0F172A] mb-1">55 Go</p>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-[#DC2626] rounded-full" style={{ width: "110%" }} />
            </div>
            <p className="text-xs text-[#DC2626] mt-1">110% du forfait (50 Go)</p>
          </div>
          <div>
            <p className="text-sm text-[#64748B] mb-2">Appels voix</p>
            <p className="text-2xl font-bold text-[#0F172A] mb-1">235 min</p>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-[#16A34A] rounded-full" style={{ width: "45%" }} />
            </div>
            <p className="text-xs text-[#64748B] mt-1">Forfait illimité</p>
          </div>
          <div>
            <p className="text-sm text-[#64748B] mb-2">SMS</p>
            <p className="text-2xl font-bold text-[#0F172A] mb-1">320</p>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-[#16A34A] rounded-full" style={{ width: "32%" }} />
            </div>
            <p className="text-xs text-[#64748B] mt-1">Forfait illimité</p>
          </div>
          <div>
            <p className="text-sm text-[#64748B] mb-2">Roaming</p>
            <p className="text-2xl font-bold text-[#0F172A] mb-1">2.3 Go</p>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-[#F59E0B] rounded-full" style={{ width: "46%" }} />
            </div>
            <p className="text-xs text-[#64748B] mt-1">5 Go inclus Europe</p>
          </div>
        </div>
      </div>

      {/* Consumption History Chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-[#0F172A] mb-4">Historique de consommation (6 mois)</h2>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={consumptionHistory}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="month" stroke="#64748B" />
            <YAxis stroke="#64748B" />
            <Tooltip />
            <Line type="monotone" dataKey="data" stroke="#06B6D4" strokeWidth={2} name="Data (Go)" />
            <Line type="monotone" dataKey="voix" stroke="#2563EB" strokeWidth={2} name="Voix (min)" />
            <Line type="monotone" dataKey="sms" stroke="#7C3AED" strokeWidth={2} name="SMS" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Alerts and Recommendations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Associated Alerts */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5 text-[#F59E0B]" />
            <h2 className="text-lg font-semibold text-[#0F172A]">Alertes associées</h2>
          </div>
          <div className="space-y-3">
            {alerts.map((alert) => (
              <Link
                key={alert.id}
                to={`/anomalies/${alert.id}`}
                className="block p-3 bg-[#F8FAFC] rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-[#0F172A]">{alert.id}</span>
                  <span
                    className={`text-xs px-2 py-1 rounded-full ${
                      alert.severity === "critique"
                        ? "bg-red-100 text-[#DC2626]"
                        : alert.severity === "moyen"
                        ? "bg-orange-100 text-[#F59E0B]"
                        : "bg-blue-100 text-[#2563EB]"
                    }`}
                  >
                    {alert.severity}
                  </span>
                </div>
                <p className="text-sm text-[#64748B] mb-1">{alert.type}</p>
                <p className="text-xs text-[#64748B]">{alert.date}</p>
              </Link>
            ))}
          </div>
        </div>

        {/* AI Recommendations */}
        <div className="bg-gradient-to-br from-[#7C3AED] to-[#2563EB] rounded-xl p-6 text-white">
          <h2 className="text-lg font-semibold mb-4">Recommandations IA pour cette ligne</h2>
          <div className="space-y-3">
            {recommendations.map((rec, idx) => (
              <div key={idx} className="bg-white/10 backdrop-blur-sm rounded-lg p-3 border border-white/20">
                <div className="flex items-center justify-between mb-2">
                  <span
                    className={`text-xs px-2 py-1 rounded-full ${
                      rec.priority === "Élevée"
                        ? "bg-red-400 text-white"
                        : "bg-orange-400 text-white"
                    }`}
                  >
                    {rec.priority}
                  </span>
                  <span className="text-sm font-bold text-[#16A34A]">{rec.saving}</span>
                </div>
                <p className="text-sm">{rec.action}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button className="px-6 py-3 bg-[#2563EB] text-white rounded-lg font-medium hover:bg-[#1d4ed8] transition-colors">
          Modifier la ligne
        </button>
        <button className="px-6 py-3 border border-gray-200 text-[#64748B] rounded-lg font-medium hover:bg-[#F8FAFC] transition-colors">
          Changer de forfait
        </button>
        <button className="px-6 py-3 border border-[#DC2626] text-[#DC2626] rounded-lg font-medium hover:bg-red-50 transition-colors">
          Suspendre la ligne
        </button>
      </div>
    </div>
  );
}

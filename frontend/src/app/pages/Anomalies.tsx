import { AlertTriangle, AlertCircle, Filter, Search } from "lucide-react";
import { Link } from "react-router";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  ZAxis,
} from "recharts";

const anomalyData = [
  { day: 1, normal: 620, detected: 620 },
  { day: 2, normal: 630, detected: 630 },
  { day: 3, normal: 615, detected: 615 },
  { day: 4, normal: 625, detected: 625 },
  { day: 5, normal: 640, detected: 1250, anomaly: true },
  { day: 6, normal: 635, detected: 635 },
  { day: 7, normal: 650, detected: 650 },
  { day: 8, normal: 645, detected: 645 },
  { day: 9, normal: 660, detected: 980, anomaly: true },
  { day: 10, normal: 655, detected: 655 },
];

const alerts = [
  {
    id: "A-2401",
    line: "+212 6 12 34 56 78",
    user: "Dupont Jean",
    type: "Dépassement data",
    anomalyType: "Consommation excessive",
    score: 95,
    severity: "critique",
    date: "2026-03-09 14:32",
    status: "Ouverte",
    description: "Consommation de 8.5Go en 2 heures",
  },
  {
    id: "A-2402",
    line: "+212 6 23 45 67 89",
    user: "Martin Sophie",
    type: "Roaming inhabituel",
    anomalyType: "Comportement anormal",
    score: 78,
    severity: "moyen",
    date: "2026-03-09 11:15",
    status: "En cours",
    description: "Activité roaming non prévue à Londres",
  },
  {
    id: "A-2403",
    line: "+212 6 34 56 78 90",
    user: "Bernard Luc",
    type: "Pic de consommation",
    anomalyType: "Variation anormale",
    score: 65,
    severity: "moyen",
    date: "2026-03-08 18:45",
    status: "Validée",
    description: "Appels internationaux inhabituels",
  },
  {
    id: "A-2404",
    line: "+212 6 45 67 89 01",
    user: "Dubois Marie",
    type: "Usage nocturne",
    anomalyType: "Horaire inhabituel",
    score: 42,
    severity: "faible",
    date: "2026-03-08 03:22",
    status: "Clôturée",
    description: "Transfert data important à 3h du matin",
  },
  {
    id: "A-2405",
    line: "+212 6 56 78 90 12",
    user: "Petit Paul",
    type: "Dépassement forfait",
    anomalyType: "Seuil dépassé",
    score: 88,
    severity: "critique",
    date: "2026-03-07 16:30",
    status: "Ouverte",
    description: "150% du forfait data consommé",
  },
  {
    id: "A-2406",
    line: "+212 6 67 89 01 23",
    user: "Robert Claire",
    type: "Multiple destinations",
    anomalyType: "Pattern inhabituel",
    score: 55,
    severity: "faible",
    date: "2026-03-07 10:15",
    status: "En cours",
    description: "Appels vers 15 pays différents en 24h",
  },
  {
    id: "A-2407",
    line: "+212 6 78 90 12 34",
    user: "Simon Thomas",
    type: "Coût anormal",
    anomalyType: "Coût élevé",
    score: 72,
    severity: "moyen",
    date: "2026-03-06 14:50",
    status: "Validée",
    description: "Facture mensuelle +180% vs moyenne",
  },
];

export default function Anomalies() {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A] mb-2">Anomalies & Alertes</h1>
          <p className="text-[#64748B]">Détection automatique par intelligence artificielle</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-[#64748B]">Anomalies détectées</p>
            <AlertTriangle className="w-5 h-5 text-[#F59E0B]" />
          </div>
          <p className="text-3xl font-bold text-[#0F172A]">23</p>
          <p className="text-sm text-[#DC2626] mt-1">+5 aujourd'hui</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-[#64748B]">Alertes ouvertes</p>
            <AlertCircle className="w-5 h-5 text-[#2563EB]" />
          </div>
          <p className="text-3xl font-bold text-[#0F172A]">15</p>
          <p className="text-sm text-[#64748B] mt-1">À traiter</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-[#64748B]">Alertes critiques</p>
            <AlertCircle className="w-5 h-5 text-[#DC2626]" />
          </div>
          <p className="text-3xl font-bold text-[#DC2626]">7</p>
          <p className="text-sm text-[#DC2626] mt-1">Action urgente</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-[#64748B]">Score moyen de risque</p>
            <div className="w-5 h-5 bg-orange-100 rounded-full flex items-center justify-center text-xs font-bold text-[#F59E0B]">
              72
            </div>
          </div>
          <p className="text-3xl font-bold text-[#F59E0B]">72/100</p>
          <p className="text-sm text-[#64748B] mt-1">Niveau élevé</p>
        </div>
      </div>

      {/* Anomaly Detection Chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-[#0F172A] mb-4">
          Détection d'anomalies sur 10 jours
        </h2>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={anomalyData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="day" stroke="#64748B" label={{ value: "Jours", position: "insideBottom", offset: -5 }} />
            <YAxis stroke="#64748B" label={{ value: "Coût (MAD)", angle: -90, position: "insideLeft" }} />
            <Tooltip />
            <Line type="monotone" dataKey="normal" stroke="#16A34A" strokeWidth={2} name="Comportement normal" strokeDasharray="5 5" />
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
                return <circle cx={cx} cy={cy} r={4} fill="#2563EB" />;
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[#64748B]" />
            <input
              type="text"
              placeholder="Rechercher une alerte..."
              className="w-full pl-10 pr-4 py-2 bg-[#F8FAFC] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent"
            />
          </div>
          <select className="px-4 py-2 bg-[#F8FAFC] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent">
            <option>Toutes sévérités</option>
            <option>Critique</option>
            <option>Moyen</option>
            <option>Faible</option>
          </select>
          <select className="px-4 py-2 bg-[#F8FAFC] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent">
            <option>Tous statuts</option>
            <option>Ouverte</option>
            <option>En cours</option>
            <option>Validée</option>
            <option>Clôturée</option>
          </select>
          <select className="px-4 py-2 bg-[#F8FAFC] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent">
            <option>Tous types</option>
            <option>Dépassement data</option>
            <option>Roaming inhabituel</option>
            <option>Pic de consommation</option>
            <option>Usage nocturne</option>
          </select>
          <button className="flex items-center justify-center gap-2 px-4 py-2 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#1d4ed8] transition-colors">
            <Filter className="w-4 h-4" />
            <span>Filtrer</span>
          </button>
        </div>
      </div>

      {/* Alerts Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-[#0F172A]">Liste des alertes</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[#F8FAFC] border-b border-gray-200">
              <tr>
                <th className="text-left px-6 py-3 text-sm font-semibold text-[#0F172A]">ID</th>
                <th className="text-left px-6 py-3 text-sm font-semibold text-[#0F172A]">Ligne</th>
                <th className="text-left px-6 py-3 text-sm font-semibold text-[#0F172A]">Utilisateur</th>
                <th className="text-left px-6 py-3 text-sm font-semibold text-[#0F172A]">Type d'anomalie</th>
                <th className="text-left px-6 py-3 text-sm font-semibold text-[#0F172A]">Score</th>
                <th className="text-left px-6 py-3 text-sm font-semibold text-[#0F172A]">Sévérité</th>
                <th className="text-left px-6 py-3 text-sm font-semibold text-[#0F172A]">Date</th>
                <th className="text-left px-6 py-3 text-sm font-semibold text-[#0F172A]">Statut</th>
                <th className="text-left px-6 py-3 text-sm font-semibold text-[#0F172A]">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {alerts.map((alert) => (
                <tr key={alert.id} className="hover:bg-[#F8FAFC] transition-colors">
                  <td className="px-6 py-4">
                    <p className="font-medium text-[#0F172A]">{alert.id}</p>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm font-medium text-[#0F172A]">{alert.line}</p>
                  </td>
                  <td className="px-6 py-4 text-sm text-[#64748B]">{alert.user}</td>
                  <td className="px-6 py-4">
                    <p className="text-sm font-medium text-[#0F172A]">{alert.type}</p>
                    <p className="text-xs text-[#64748B]">{alert.anomalyType}</p>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden max-w-[60px]">
                        <div
                          className={`h-full rounded-full ${
                            alert.score >= 80
                              ? "bg-[#DC2626]"
                              : alert.score >= 60
                              ? "bg-[#F59E0B]"
                              : "bg-[#16A34A]"
                          }`}
                          style={{ width: `${alert.score}%` }}
                        />
                      </div>
                      <span className="text-sm font-semibold text-[#0F172A]">{alert.score}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                        alert.severity === "critique"
                          ? "bg-red-50 text-[#DC2626]"
                          : alert.severity === "moyen"
                          ? "bg-orange-50 text-[#F59E0B]"
                          : "bg-blue-50 text-[#2563EB]"
                      }`}
                    >
                      {alert.severity}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-[#64748B]">{alert.date}</td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                        alert.status === "Ouverte"
                          ? "bg-red-50 text-[#DC2626]"
                          : alert.status === "En cours"
                          ? "bg-orange-50 text-[#F59E0B]"
                          : alert.status === "Validée"
                          ? "bg-blue-50 text-[#2563EB]"
                          : "bg-green-50 text-[#16A34A]"
                      }`}
                    >
                      {alert.status}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <Link
                      to={`/anomalies/${alert.id}`}
                      className="text-sm text-[#2563EB] hover:text-[#1d4ed8] font-medium"
                    >
                      Détails
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Logs Section */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-[#0F172A] mb-4">
          Logs des alertes récentes
        </h2>
        <div className="space-y-2">
          <div className="flex items-center gap-3 p-3 bg-[#F8FAFC] rounded-lg text-sm">
            <div className="w-2 h-2 bg-[#DC2626] rounded-full" />
            <span className="text-[#64748B]">09/03/2026 14:32</span>
            <span className="text-[#0F172A]">Alerte A-2401 créée - Dépassement data critique</span>
          </div>
          <div className="flex items-center gap-3 p-3 bg-[#F8FAFC] rounded-lg text-sm">
            <div className="w-2 h-2 bg-[#F59E0B] rounded-full" />
            <span className="text-[#64748B]">09/03/2026 11:15</span>
            <span className="text-[#0F172A]">Alerte A-2402 créée - Roaming inhabituel détecté</span>
          </div>
          <div className="flex items-center gap-3 p-3 bg-[#F8FAFC] rounded-lg text-sm">
            <div className="w-2 h-2 bg-[#16A34A] rounded-full" />
            <span className="text-[#64748B]">08/03/2026 19:20</span>
            <span className="text-[#0F172A]">Alerte A-2403 validée par admin</span>
          </div>
          <div className="flex items-center gap-3 p-3 bg-[#F8FAFC] rounded-lg text-sm">
            <div className="w-2 h-2 bg-[#16A34A] rounded-full" />
            <span className="text-[#64748B]">08/03/2026 10:45</span>
            <span className="text-[#0F172A]">Alerte A-2404 clôturée - Faux positif confirmé</span>
          </div>
        </div>
      </div>
    </div>
  );
}

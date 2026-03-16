import { Download, Calendar } from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

const evolutionData = [
  { month: "Sep 2025", voix: 3200, data: 8500, sms: 1200, roaming: 2100 },
  { month: "Oct 2025", voix: 3400, data: 9100, sms: 1150, roaming: 2300 },
  { month: "Nov 2025", voix: 3100, data: 8800, sms: 1100, roaming: 1950 },
  { month: "Déc 2025", voix: 3500, data: 9500, sms: 1300, roaming: 2450 },
  { month: "Jan 2026", voix: 3300, data: 9200, sms: 1180, roaming: 2200 },
  { month: "Fév 2026", voix: 3600, data: 9800, sms: 1250, roaming: 2500 },
  { month: "Mar 2026", voix: 3800, data: 10200, sms: 1350, roaming: 2650 },
];

const lineConsumption = [
  { line: "+212 6 12 34 56 78", cost: 485 },
  { line: "+212 6 23 45 67 89", cost: 392 },
  { line: "+212 6 34 56 78 90", cost: 367 },
  { line: "+212 6 45 67 89 01", cost: 345 },
  { line: "+212 6 56 78 90 12", cost: 328 },
  { line: "+212 6 67 89 01 23", cost: 315 },
  { line: "+212 6 78 90 12 34", cost: 298 },
  { line: "+212 6 89 01 23 45", cost: 285 },
];

const usageDistribution = [
  { name: "Voix", value: 35, color: "#2563EB" },
  { name: "Data", value: 45, color: "#06B6D4" },
  { name: "SMS", value: 10, color: "#7C3AED" },
  { name: "Roaming", value: 10, color: "#F59E0B" },
];

const consumptionEvents = [
  { date: "2026-03-09 14:32", line: "+212 6 12 34 56 78", user: "Dupont Jean", type: "Data", amount: "2.5 Go", cost: "12 MAD.50", location: "Paris" },
  { date: "2026-03-09 12:15", line: "+212 6 23 45 67 89", user: "Martin Sophie", type: "Voix", amount: "45 min", cost: "8 MAD.90", location: "Lyon" },
  { date: "2026-03-09 10:47", line: "+212 6 34 56 78 90", user: "Bernard Luc", type: "Roaming", amount: "350 Mo", cost: "15 MAD.20", location: "Bruxelles" },
  { date: "2026-03-09 09:23", line: "+212 6 45 67 89 01", user: "Dubois Marie", type: "SMS", amount: "125 msg", cost: "3 MAD.75", location: "Paris" },
  { date: "2026-03-08 18:55", line: "+212 6 56 78 90 12", user: "Petit Paul", type: "Data", amount: "1.8 Go", cost: "9 MAD.00", location: "Marseille" },
  { date: "2026-03-08 16:30", line: "+212 6 67 89 01 23", user: "Robert Claire", type: "Voix", amount: "32 min", cost: "6 MAD.40", location: "Toulouse" },
  { date: "2026-03-08 14:12", line: "+212 6 78 90 12 34", user: "Simon Thomas", type: "Data", amount: "3.2 Go", cost: "16 MAD.00", location: "Nantes" },
  { date: "2026-03-08 11:45", line: "+212 6 89 01 23 45", user: "Laurent Emma", type: "Roaming", amount: "520 Mo", cost: "22 MAD.50", location: "Londres" },
];

export default function Consumption() {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A] mb-2">Historique de consommation</h1>
          <p className="text-[#64748B]">Analysez les consommations de votre flotte</p>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-2 px-4 py-2 border border-gray-200 text-[#64748B] rounded-lg font-medium hover:bg-[#F8FAFC] transition-colors">
            <Calendar className="w-4 h-4" />
            <span>Période</span>
          </button>
          <button className="flex items-center gap-2 px-4 py-2 bg-[#2563EB] text-white rounded-lg font-medium hover:bg-[#1d4ed8] transition-colors">
            <Download className="w-4 h-4" />
            <span>Export Excel</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <input
            type="date"
            className="px-4 py-2 bg-[#F8FAFC] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent"
          />
          <select className="px-4 py-2 bg-[#F8FAFC] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent">
            <option>Toutes les lignes</option>
            <option>Ligne spécifique</option>
          </select>
          <select className="px-4 py-2 bg-[#F8FAFC] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent">
            <option>Tous départements</option>
            <option>Commercial</option>
            <option>IT</option>
            <option>Direction</option>
          </select>
          <select className="px-4 py-2 bg-[#F8FAFC] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent">
            <option>Tous opérateurs</option>
            <option>Orange</option>
            <option>SFR</option>
            <option>Bouygues</option>
          </select>
          <select className="px-4 py-2 bg-[#F8FAFC] border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent">
            <option>Tous types</option>
            <option>Voix</option>
            <option>Data</option>
            <option>SMS</option>
            <option>Roaming</option>
          </select>
        </div>
      </div>

      {/* Evolution Chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-[#0F172A] mb-4">
          Évolution de la consommation par type
        </h2>
        <ResponsiveContainer width="100%" height={350}>
          <LineChart data={evolutionData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="month" stroke="#64748B" />
            <YAxis stroke="#64748B" />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="voix" stroke="#2563EB" strokeWidth={2} name="Voix (MAD)" />
            <Line type="monotone" dataKey="data" stroke="#06B6D4" strokeWidth={2} name="Data (MAD)" />
            <Line type="monotone" dataKey="sms" stroke="#7C3AED" strokeWidth={2} name="SMS (MAD)" />
            <Line type="monotone" dataKey="roaming" stroke="#F59E0B" strokeWidth={2} name="Roaming (MAD)" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Secondary Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cost by Line */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-[#0F172A] mb-4">
            Coût par ligne (Top 8)
          </h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={lineConsumption} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis type="number" stroke="#64748B" />
              <YAxis dataKey="line" type="category" stroke="#64748B" width={120} />
              <Tooltip />
              <Bar dataKey="cost" fill="#2563EB" radius={[0, 8, 8, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Usage Distribution */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-[#0F172A] mb-4">
            Distribution des usages
          </h2>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={usageDistribution}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, value }) => `${name} ${value}%`}
                outerRadius={100}
                fill="#8884d8"
                dataKey="value"
              >
                {usageDistribution.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Detailed Events Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-[#0F172A]">
            Événements de consommation détaillés
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[#F8FAFC] border-b border-gray-200">
              <tr>
                <th className="text-left px-6 py-3 text-sm font-semibold text-[#0F172A]">Date & Heure</th>
                <th className="text-left px-6 py-3 text-sm font-semibold text-[#0F172A]">Numéro</th>
                <th className="text-left px-6 py-3 text-sm font-semibold text-[#0F172A]">Utilisateur</th>
                <th className="text-left px-6 py-3 text-sm font-semibold text-[#0F172A]">Type</th>
                <th className="text-left px-6 py-3 text-sm font-semibold text-[#0F172A]">Quantité</th>
                <th className="text-left px-6 py-3 text-sm font-semibold text-[#0F172A]">Coût</th>
                <th className="text-left px-6 py-3 text-sm font-semibold text-[#0F172A]">Localisation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {consumptionEvents.map((event, idx) => (
                <tr key={idx} className="hover:bg-[#F8FAFC] transition-colors">
                  <td className="px-6 py-3 text-sm text-[#0F172A]">{event.date}</td>
                  <td className="px-6 py-3 text-sm font-medium text-[#0F172A]">{event.line}</td>
                  <td className="px-6 py-3 text-sm text-[#64748B]">{event.user}</td>
                  <td className="px-6 py-3">
                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                        event.type === "Data"
                          ? "bg-cyan-50 text-[#06B6D4]"
                          : event.type === "Voix"
                          ? "bg-blue-50 text-[#2563EB]"
                          : event.type === "SMS"
                          ? "bg-purple-50 text-[#7C3AED]"
                          : "bg-orange-50 text-[#F59E0B]"
                      }`}
                    >
                      {event.type}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-sm text-[#0F172A]">{event.amount}</td>
                  <td className="px-6 py-3 text-sm font-semibold text-[#0F172A]">{event.cost}</td>
                  <td className="px-6 py-3 text-sm text-[#64748B]">{event.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Data Quality Status */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-[#0F172A] mb-4">
          Qualité des données
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="text-center p-4 bg-[#F8FAFC] rounded-lg">
            <div className="w-3 h-3 bg-[#16A34A] rounded-full mx-auto mb-2 animate-pulse" />
            <p className="text-sm text-[#64748B] mb-1">Dernière synchronisation</p>
            <p className="text-sm font-semibold text-[#0F172A]">Il y a 5 minutes</p>
          </div>
          <div className="text-center p-4 bg-[#F8FAFC] rounded-lg">
            <p className="text-2xl font-bold text-[#2563EB] mb-1">99.8%</p>
            <p className="text-sm text-[#64748B]">Fiabilité des données</p>
          </div>
          <div className="text-center p-4 bg-[#F8FAFC] rounded-lg">
            <p className="text-2xl font-bold text-[#2563EB] mb-1">2.3M</p>
            <p className="text-sm text-[#64748B]">Événements traités</p>
          </div>
          <div className="text-center p-4 bg-[#F8FAFC] rounded-lg">
            <p className="text-2xl font-bold text-[#16A34A] mb-1">Opérationnel</p>
            <p className="text-sm text-[#64748B]">Statut pipeline</p>
          </div>
        </div>
      </div>
    </div>
  );
}

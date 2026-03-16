import {
  Coins,
  Phone,
  AlertTriangle,
  TrendingUp,
  Activity,
  AlertCircle,
  Database,
  PiggyBank,
} from "lucide-react";
import KPICard from "../components/KPICard";
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
import { Link } from "react-router";

import { usePhoneLineStats } from "../hooks/usePhoneLineStats";

function formatNewLinesLabel(count: number): string {
  if (count === 0) {
    return "Aucune nouvelle ce mois";
  }

  if (count === 1) {
    return "1 nouvelle ce mois";
  }

  return `${count} nouvelles ce mois`;
}

const monthlyData = [
  { month: "Sep", cost: 185000 },
  { month: "Oct", cost: 192000 },
  { month: "Nov", cost: 188000 },
  { month: "Déc", cost: 201000 },
  { month: "Jan", cost: 195000 },
  { month: "Fév", cost: 208000 },
  { month: "Mar", cost: 212000 },
];

const consumptionData = [
  { name: "Voix", value: 35, color: "#2D6CDF" },
  { name: "Data", value: 45, color: "#06B6D4" },
  { name: "SMS", value: 10, color: "#7C3AED" },
  { name: "Roaming", value: 10, color: "#F59E0B" },
];

const topLines = [
  { number: "+212 6 12 34 56 78", user: "Hassan Alami", dept: "Commercial", cost: "4850 MAD", risk: "Élevé", operator: "Orange Maroc" },
  { number: "+212 6 23 45 67 89", user: "Fatima Benali", dept: "Direction", cost: "3920 MAD", risk: "Moyen", operator: "Maroc Telecom" },
  { number: "+212 7 34 56 78 90", user: "Youssef Tazi", dept: "IT", cost: "3670 MAD", risk: "Faible", operator: "inwi" },
  { number: "+212 6 45 67 89 01", user: "Amina Idrissi", dept: "RH", cost: "3450 MAD", risk: "Moyen", operator: "Orange Maroc" },
  { number: "+212 7 56 78 90 12", user: "Mehdi Benjelloun", dept: "Commercial", cost: "3280 MAD", risk: "Faible", operator: "Maroc Telecom" },
];

const recentAlerts = [
  { id: "A-2401", line: "+212 6 12 34 56 78", type: "Dépassement data", severity: "critique", time: "Il y a 2h" },
  { id: "A-2402", line: "+212 6 23 45 67 89", type: "Roaming inhabituel", severity: "moyen", time: "Il y a 5h" },
  { id: "A-2403", line: "+212 7 34 56 78 90", type: "Pic de consommation", severity: "faible", time: "Il y a 1j" },
];

const recommendations = [
  { line: "+212 6 12 34 56 78", action: "Passer au forfait Premium", saving: "450 MAD/mois" },
  { line: "+212 6 67 89 01 23", action: "Activer limite data", saving: "320 MAD/mois" },
  { line: "+212 7 78 90 12 34", action: "Désactiver roaming", saving: "280 MAD/mois" },
];

const departmentData = [
  { name: "Commercial", lines: 125, cost: 86500 },
  { name: "IT", lines: 45, cost: 32000 },
  { name: "Direction", lines: 32, cost: 48000 },
  { name: "RH", lines: 28, cost: 21000 },
  { name: "Support", lines: 62, cost: 34500 },
  { name: "Autre", lines: 50, cost: 25000 },
];

const dataConsumptionData = [
  { month: "Sep", data: 3200 },
  { month: "Oct", data: 3500 },
  { month: "Nov", data: 3800 },
  { month: "Déc", data: 4100 },
  { month: "Jan", data: 4300 },
  { month: "Fév", data: 4600 },
  { month: "Mar", data: 4950 },
];

export default function Dashboard() {
  const { totalLines, newLinesThisMonth, lineStatsError, isLoading } = usePhoneLineStats();

  return (
    <div className="p-6 space-y-6">
      {/* Page Title */}
      <div>
        <h1 className="text-2xl font-bold text-[#0F172A] mb-2">Tableau de bord</h1>
        <p className="text-[#64748B]">Vue d'ensemble de votre flotte téléphonique</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Nombre total de lignes"
          value={isLoading && totalLines === null ? "--" : String(totalLines ?? 0)}
          trend={
            lineStatsError
              ? "Donnees indisponibles"
              : isLoading && newLinesThisMonth === null
                ? "Chargement..."
                : formatNewLinesLabel(newLinesThisMonth ?? 0)
          }
          trendUp={!lineStatsError && (newLinesThisMonth ?? 0) > 0}
          icon={Phone}
          color="blue"
          variant="total-lines"
        />
        <KPICard
          title="Consommation moyenne data"
          value="14.5 GB"
          trend="12% vs mois dernier"
          trendUp={true}
          icon={Database}
          color="cyan"
        />
        <KPICard
          title="Alertes IA détectées"
          value="23"
          trend="7 critiques"
          trendUp={false}
          icon={AlertTriangle}
          color="orange"
        />
        <KPICard
          title="Économies estimées"
          value="12 450 MAD"
          trend="Potentiel ce mois"
          trendUp={true}
          icon={PiggyBank}
          color="green"
        />
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <KPICard
          title="Coût total mensuel"
          value="212 000 MAD"
          trend="8.5% vs mois dernier"
          trendUp={false}
          icon={Coins}
          color="purple"
        />
        <KPICard
          title="Coût moyen/ligne"
          value="620 MAD"
          trend="3.2% vs mois dernier"
          trendUp={true}
          icon={Activity}
          color="blue"
        />
        <KPICard
          title="Tendance prédictive"
          value="+12%"
          trend="Prédiction IA"
          trendUp={true}
          icon={TrendingUp}
          color="green"
        />
      </div>

      {/* Main Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly Cost Evolution */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-[#0F172A] mb-4">
            Évolution des coûts mensuels
          </h2>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="month" stroke="#64748B" />
              <YAxis stroke="#64748B" />
              <Tooltip
                formatter={(value: number) => `${value.toLocaleString()} MAD`}
              />
              <Line
                type="monotone"
                dataKey="cost"
                name="Coût"
                stroke="#2D6CDF"
                strokeWidth={3}
                dot={false}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Data Consumption Evolution */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-[#0F172A] mb-4">
            Évolution consommation data (GB)
          </h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={dataConsumptionData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="month" stroke="#64748B" />
              <YAxis stroke="#64748B" />
              <Tooltip formatter={(value: number) => `${value} GB`} />
              <Bar dataKey="data" name="Data" fill="#06B6D4" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Consumption and Department Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Consumption by Type */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-[#0F172A] mb-4">
            Répartition consommation
          </h2>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={consumptionData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, value }) => `${name} ${value}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {consumptionData.map((entry, index) => (
                  <Cell key={`cell-${entry.name}-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Department Distribution */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-[#0F172A] mb-4">
            Coût par département
          </h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={departmentData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="name" stroke="#64748B" />
              <YAxis stroke="#64748B" />
              <Tooltip
                formatter={(value: number) => `${value.toLocaleString()} MAD`}
              />
              <Bar dataKey="cost" name="Coût" fill="#2D6CDF" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top Lines and Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Lines */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-[#0F172A] mb-4">
            Top lignes consommatrices
          </h2>
          <div className="space-y-3">
            {topLines.map((line, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-3 bg-[#F8FAFC] rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="flex-1">
                  <p className="font-medium text-[#0F172A]">{line.number}</p>
                  <p className="text-sm text-[#64748B]">
                    {line.user} • {line.dept}
                  </p>
                  <span
                    className="inline-block text-xs px-2 py-0.5 rounded-full mt-1"
                    style={{
                      backgroundColor: line.operator === "Orange Maroc" ? "#FFF5EB" :
                                      line.operator === "Maroc Telecom" ? "#FFEEF0" : "#E6F7FF",
                      color: line.operator === "Orange Maroc" ? "#FF6600" :
                            line.operator === "Maroc Telecom" ? "#E60012" : "#009FE3",
                    }}
                  >
                    {line.operator}
                  </span>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-[#0F172A]">{line.cost}</p>
                  <span
                    className={`text-xs px-2 py-1 rounded-full ${
                      line.risk === "Élevé"
                        ? "bg-red-100 text-[#DC2626]"
                        : line.risk === "Moyen"
                        ? "bg-orange-100 text-[#F59E0B]"
                        : "bg-green-100 text-[#16A34A]"
                    }`}
                  >
                    {line.risk}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Alerts */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-[#0F172A]">Alertes récentes</h2>
            <Link
              to="/anomalies"
              className="text-sm text-[#2D6CDF] hover:text-[#1d4ed8] font-medium"
            >
              Voir tout
            </Link>
          </div>
          <div className="space-y-3">
            {recentAlerts.map((alert) => (
              <Link
                key={alert.id}
                to={`/anomalies/${alert.id}`}
                className="block p-3 bg-[#F8FAFC] rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-[#0F172A]">{alert.id}</span>
                      <span
                        className={`text-xs px-2 py-1 rounded-full ${
                          alert.severity === "critique"
                            ? "bg-red-100 text-[#DC2626]"
                            : alert.severity === "moyen"
                            ? "bg-orange-100 text-[#F59E0B]"
                            : "bg-blue-100 text-[#2D6CDF]"
                        }`}
                      >
                        {alert.severity}
                      </span>
                    </div>
                    <p className="text-sm text-[#64748B] mb-1">{alert.line}</p>
                    <p className="text-sm text-[#0F172A]">{alert.type}</p>
                  </div>
                  <p className="text-xs text-[#64748B]">{alert.time}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Recommendations */}
      <div className="bg-gradient-to-br from-[#7C3AED] to-[#2D6CDF] rounded-xl p-6 text-white">
        <h2 className="text-lg font-semibold mb-4">Recommandations IA</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {recommendations.map((rec, idx) => (
            <div key={idx} className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20">
              <p className="text-sm text-white/80 mb-2">{rec.line}</p>
              <p className="font-medium mb-2">{rec.action}</p>
              <p className="text-sm text-[#16A34A] bg-white/20 rounded px-2 py-1 inline-block">
                Économie: {rec.saving}
              </p>
            </div>
          ))}
        </div>
        <Link
          to="/recommandations"
          className="mt-4 block text-center bg-white/20 hover:bg-white/30 backdrop-blur-sm rounded-lg py-2 transition-colors"
        >
          Voir toutes les recommandations
        </Link>
      </div>
    </div>
  );
}

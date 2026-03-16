import { TrendingUp, Brain, Target, Zap } from "lucide-react";
import {
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts";

const forecastData = [
  { month: "Sep", type: "Réel", value: 18500 },
  { month: "Oct", type: "Réel", value: 19200 },
  { month: "Nov", type: "Réel", value: 18800 },
  { month: "Déc", type: "Réel", value: 20100 },
  { month: "Jan", type: "Réel", value: 19500 },
  { month: "Fév", type: "Réel", value: 20800 },
  { month: "Mar", type: "Réel", value: 21200 },
  { month: "Avr", type: "Prévision", value: 23450, lower: 22100, upper: 24800 },
  { month: "Mai", type: "Prévision", value: 24200, lower: 22800, upper: 25600 },
  { month: "Juin", type: "Prévision", value: 23900, lower: 22500, upper: 25300 },
];

const deptForecast = [
  { dept: "Commercial", current: 8650, predicted: 9820 },
  { dept: "IT", current: 3200, predicted: 3580 },
  { dept: "Direction", current: 4800, predicted: 5420 },
  { dept: "RH", current: 2100, predicted: 2280 },
  { dept: "Support", current: 3450, predicted: 3850 },
];

const operatorForecast = [
  { operator: "Orange", current: 12400, predicted: 14200 },
  { operator: "SFR", current: 5200, predicted: 5850 },
  { operator: "Bouygues", current: 2800, predicted: 2900 },
  { operator: "Free", current: 800, predicted: 950 },
];

const influencingFactors = [
  { factor: "Croissance de l'équipe", impact: 85, direction: "up" },
  { factor: "Tendance data mobile", impact: 72, direction: "up" },
  { factor: "Saisonnalité commerciale", impact: 68, direction: "up" },
  { factor: "Roaming international", impact: 45, direction: "up" },
  { factor: "Optimisation forfaits", impact: 35, direction: "down" },
];

export default function Predictions() {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A] mb-2">Prédictions & Analytics</h1>
          <p className="text-[#64748B]">Prévisions de coûts basées sur l'intelligence artificielle</p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#7C3AED] to-[#2563EB] text-white rounded-lg">
          <Brain className="w-5 h-5" />
          <span className="font-medium">Modèle IA actif</span>
        </div>
      </div>

      {/* Key Predictions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gradient-to-br from-[#2563EB] to-[#06B6D4] rounded-xl p-6 text-white">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-6 h-6" />
            <h3 className="text-lg font-semibold">Prédiction mois prochain</h3>
          </div>
          <p className="text-4xl font-bold mb-2">23 450 MAD</p>
          <p className="text-white/80 text-sm mb-4">Avril 2026</p>
          <div className="bg-white/20 backdrop-blur-sm rounded-lg p-3">
            <p className="text-sm">Variation estimée</p>
            <p className="text-2xl font-bold">+10.6</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Target className="w-6 h-6 text-[#2563EB]" />
            <h3 className="text-lg font-semibold text-[#0F172A]">Budget prévu</h3>
          </div>
          <p className="text-4xl font-bold text-[#0F172A] mb-2">22 500 MAD</p>
          <p className="text-[#64748B] text-sm mb-4">Objectif mensuel</p>
          <div className="bg-red-50 rounded-lg p-3">
            <p className="text-sm text-[#64748B]">Écart probable</p>
            <p className="text-2xl font-bold text-[#DC2626]">+950 MAD</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-6 h-6 text-[#F59E0B]" />
            <h3 className="text-lg font-semibold text-[#0F172A]">Fiabilité du modèle</h3>
          </div>
          <p className="text-4xl font-bold text-[#0F172A] mb-2">94</p>
          <p className="text-[#64748B] text-sm mb-4">Confiance prédictive</p>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full bg-[#16A34A] rounded-full" style={{ width: "94%" }} />
          </div>
        </div>
      </div>

      {/* Main Forecast Chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-[#0F172A] mb-4">
          Historique réel et prévisions futures
        </h2>
        <ResponsiveContainer width="100%" height={400}>
          <AreaChart data={forecastData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="month" stroke="#64748B" />
            <YAxis stroke="#64748B" />
            <Tooltip />
            <Legend />
            {/* Area for confidence interval */}
            <Area
              type="monotone"
              dataKey="upper"
              stroke="none"
              fill="#e9d5ff"
              fillOpacity={0.3}
            />
            <Area
              type="monotone"
              dataKey="lower"
              stroke="none"
              fill="#fff"
            />
            {/* Main line */}
            <Line
              type="monotone"
              dataKey="value"
              stroke="#2563EB"
              strokeWidth={3}
              dot={(props: any) => {
                const { cx, cy, payload } = props;
                if (payload.type === "Prévision") {
                  return <circle key={`dot-${cx}`} cx={cx} cy={cy} r={5} fill="#7C3AED" stroke="#fff" strokeWidth={2} />;
                }
                return <circle key={`dot-${cx}`} cx={cx} cy={cy} r={5} fill="#2563EB" stroke="#fff" strokeWidth={2} />;
              }}
              name="Coût (MAD)"
            />
          </AreaChart>
        </ResponsiveContainer>
        <div className="mt-4 flex items-center justify-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-4 h-0.5 bg-[#2563EB]" />
            <span className="text-[#64748B]">Historique réel</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-0.5 bg-[#7C3AED] border-dashed" />
            <span className="text-[#64748B]">Prévision IA</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-3 bg-purple-100 rounded" />
            <span className="text-[#64748B]">Intervalle de confiance</span>
          </div>
        </div>
      </div>

      {/* Department and Operator Forecasts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Department Forecast */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-[#0F172A] mb-4">
            Prévisions par département
          </h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={deptForecast}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="dept" stroke="#64748B" />
              <YAxis stroke="#64748B" />
              <Tooltip />
              <Legend />
              <Bar dataKey="current" fill="#2563EB" radius={[8, 8, 0, 0]} name="Actuel (MAD)" />
              <Bar dataKey="predicted" fill="#7C3AED" radius={[8, 8, 0, 0]} name="Prévu (MAD)" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Operator Forecast */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-[#0F172A] mb-4">
            Prévisions par opérateur
          </h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={operatorForecast}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="operator" stroke="#64748B" />
              <YAxis stroke="#64748B" />
              <Tooltip />
              <Legend />
              <Bar dataKey="current" fill="#06B6D4" radius={[8, 8, 0, 0]} name="Actuel (MAD)" />
              <Bar dataKey="predicted" fill="#F59E0B" radius={[8, 8, 0, 0]} name="Prévu (MAD)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Influencing Factors */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-[#0F172A] mb-4">
          Variables les plus influentes
        </h2>
        <div className="space-y-4">
          {influencingFactors.map((factor, idx) => (
            <div key={idx} className="flex items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-[#0F172A]">{factor.factor}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-[#0F172A]">{factor.impact}</span>
                    <span className={`text-lg ${factor.direction === "up" ? "text-[#DC2626]" : "text-[#16A34A]"}`}>
                      {factor.direction === "up" ? "↑" : "↓"}
                    </span>
                  </div>
                </div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      factor.impact >= 70
                        ? "bg-[#DC2626]"
                        : factor.impact >= 50
                        ? "bg-[#F59E0B]"
                        : "bg-[#2563EB]"
                    }`}
                    style={{ width: `${factor.impact}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Interpretation Block */}
      <div className="bg-gradient-to-br from-[#F8FAFC] to-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-[#0F172A] mb-4">
          Interprétation simple
        </h2>
        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 bg-[#2563EB] text-white rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold">
              1
            </div>
            <p className="text-[#64748B]">
              Vos coûts devraient augmenter de <span className="font-semibold text-[#DC2626]">10.6</span> le mois prochain, principalement en raison de la croissance de l'équipe et de l'augmentation de la consommation data.
            </p>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 bg-[#2563EB] text-white rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold">
              2
            </div>
            <p className="text-[#64748B]">
              Le département Commercial sera le principal contributeur avec une prévision de <span className="font-semibold text-[#0F172A]">9 820 MAD</span>, soit une hausse de 13.5.
            </p>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 bg-[#2563EB] text-white rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold">
              3
            </div>
            <p className="text-[#64748B]">
              Notre modèle prévoit un dépassement de <span className="font-semibold text-[#DC2626]">950 MAD</span> par rapport au budget prévu. Consultez les recommandations pour optimiser vos coûts.
            </p>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 bg-[#16A34A] text-white rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold">
              ✓
            </div>
            <p className="text-[#64748B]">
              Le modèle affiche une confiance de <span className="font-semibold text-[#16A34A]">94</span> basée sur l'analyse de 2.3M événements historiques.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

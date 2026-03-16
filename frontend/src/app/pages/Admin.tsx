import {
  Shield,
  Users,
  Database,
  Activity,
  Settings,
  TrendingUp,
  AlertTriangle,
  Server,
  LogOut,
} from "lucide-react";
import { useNavigate } from "react-router";

import { usePhoneLineStats } from "../hooks/usePhoneLineStats";
import { useAuth } from "../context/AuthContext";
import { formatRoleLabel } from "../lib/api";
import logoImage from "../../assets/2285601bb4e4d491e253f51df33e674aefdb2011.png";

export default function Admin() {
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const { totalLines, newLinesThisMonth, lineStatsError, isLoading } = usePhoneLineStats();
  const normalizedRole = user?.role.trim().toLowerCase() ?? "";
  const isAdminSession = normalizedRole === "admin";
  const rolePermissions: Record<string, string[]> = {
    admin: [
      "Gestion totale",
      "Analytics avances",
      "Configuration systeme",
      "Gestion utilisateurs",
    ],
    manager: [
      "Lecture et ecriture",
      "Suivi des lignes",
      "Consultation des rapports",
      "Validation des alertes",
    ],
    analyst: [
      "Lecture seule",
      "Analyse des consommations",
      "Exports basiques",
      "Consultation des rapports",
    ],
  };

  const adminInfo = {
    name: user?.full_name ?? "Utilisateur connecte",
    email: user?.email ?? "-",
    role: user ? formatRoleLabel(user.role) : "Utilisateur",
    company: "BC SKILLS",
    createdAt: user?.created_at ?? null,
    permissions: rolePermissions[normalizedRole] ?? ["Acces a la plateforme"],
  };

  const systemStats = [
    {
      label: "Lignes actives",
      value: isLoading && totalLines === null ? "--" : String(totalLines ?? 0),
      change: lineStatsError ? "Indispo." : `${newLinesThisMonth ?? 0} ce mois`,
      icon: Users,
      color: "from-blue-500 to-cyan-500",
    },
    {
      label: "Base de donnees",
      value: "98%",
      change: "Normal",
      icon: Database,
      color: "from-purple-500 to-pink-500",
    },
    {
      label: "Uptime",
      value: "99.9%",
      change: "30j",
      icon: Activity,
      color: "from-green-500 to-emerald-500",
    },
    {
      label: "Alertes actives",
      value: "8",
      change: "+2",
      icon: AlertTriangle,
      color: "from-orange-500 to-red-500",
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="bg-gradient-to-br from-[#2D6CDF] to-[#7C3AED] rounded-2xl shadow-2xl p-8 text-white">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-6">
            <div className="bg-white p-4 rounded-xl shadow-lg">
              <img src={logoImage} alt="BC SKILLS" className="h-16 w-auto" />
            </div>
            <div>
              <div className="flex items-center gap-3 mb-2">
                <Shield className="w-8 h-8" />
                <h1 className="text-3xl font-bold">
                  {isAdminSession ? "Panneau Administrateur" : "Espace Utilisateur"}
                </h1>
              </div>
              <p className="text-white/80 text-lg">
                {user ? `${user.full_name} - ${formatRoleLabel(user.role)}` : "BC SKILLS FleetConnect AI Platform"}
              </p>
            </div>
          </div>

          <div className="text-right">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-white/20 backdrop-blur-sm rounded-full text-sm font-medium">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              Systeme operationnel
            </div>
            <button
              type="button"
              onClick={() => {
                logout();
                navigate("/login", { replace: true });
              }}
              className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-white text-[#2D6CDF] rounded-lg text-sm font-semibold hover:bg-white/90 transition-colors shadow-lg"
            >
              <LogOut className="w-4 h-4" />
              <span>Deconnecter</span>
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="border-b border-gray-200 p-6">
          <h2 className="text-xl font-bold text-[#0F172A] flex items-center gap-2">
            <Users className="w-6 h-6 text-[#2D6CDF]" />
            Informations de l utilisateur connecte
          </h2>
        </div>
        <div className="p-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-[#64748B]">Nom complet</label>
                <p className="text-lg font-semibold text-[#0F172A] mt-1">{adminInfo.name}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-[#64748B]">Email</label>
                <p className="text-lg font-semibold text-[#0F172A] mt-1">{adminInfo.email}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-[#64748B]">Role</label>
                <div className="mt-1">
                  <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-[#7C3AED] to-[#EC4899] text-white rounded-lg text-sm font-semibold">
                    <Shield className="w-4 h-4" />
                    {adminInfo.role}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-[#64748B]">Entreprise</label>
                <p className="text-lg font-semibold text-[#0F172A] mt-1">{adminInfo.company}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-[#64748B]">Compte crée le</label>
                <p className="text-lg font-semibold text-[#0F172A] mt-1">
                  {adminInfo.createdAt
                    ? new Date(adminInfo.createdAt).toLocaleDateString("fr-FR")
                    : "Date indisponible"}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-[#64748B] mb-2 block">Permissions</label>
                <div className="flex flex-wrap gap-2">
                  {adminInfo.permissions.map((permission, index) => (
                    <span
                      key={index}
                      className="px-3 py-1 bg-[#F8FAFC] border border-gray-200 rounded-full text-xs font-medium text-[#0F172A]"
                    >
                      {permission}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
        {systemStats.map((stat, index) => (
          <div key={index} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className={`h-2 bg-gradient-to-r ${stat.color}`} />
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className={`w-12 h-12 bg-gradient-to-br ${stat.color} rounded-xl flex items-center justify-center`}>
                  <stat.icon className="w-6 h-6 text-white" />
                </div>
                <span className="text-sm font-medium text-green-600 bg-green-50 px-2 py-1 rounded-full">
                  {stat.change}
                </span>
              </div>
              <p className="text-3xl font-bold text-[#0F172A] mb-1">{stat.value}</p>
              <p className="text-sm text-[#64748B]">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="border-b border-gray-200 p-6">
          <h2 className="text-xl font-bold text-[#0F172A] flex items-center gap-2">
            <Settings className="w-6 h-6 text-[#2D6CDF]" />
            Actions rapides
          </h2>
        </div>
        <div className="p-6">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <button className="flex items-center gap-3 p-4 bg-gradient-to-r from-[#2D6CDF] to-[#06B6D4] text-white rounded-lg hover:opacity-90 transition-opacity shadow-lg">
              <Users className="w-5 h-5" />
              <span className="font-medium">Gerer utilisateurs</span>
            </button>
            <button className="flex items-center gap-3 p-4 bg-gradient-to-r from-[#7C3AED] to-[#EC4899] text-white rounded-lg hover:opacity-90 transition-opacity shadow-lg">
              <Database className="w-5 h-5" />
              <span className="font-medium">Base de donnees</span>
            </button>
            <button className="flex items-center gap-3 p-4 bg-gradient-to-r from-[#16A34A] to-[#10B981] text-white rounded-lg hover:opacity-90 transition-opacity shadow-lg">
              <Settings className="w-5 h-5" />
              <span className="font-medium">Configuration</span>
            </button>
            <button className="flex items-center gap-3 p-4 bg-gradient-to-r from-[#F59E0B] to-[#EAB308] text-white rounded-lg hover:opacity-90 transition-opacity shadow-lg">
              <Activity className="w-5 h-5" />
              <span className="font-medium">Logs systeme</span>
            </button>
            <button className="flex items-center gap-3 p-4 bg-gradient-to-r from-[#DC2626] to-[#EF4444] text-white rounded-lg hover:opacity-90 transition-opacity shadow-lg">
              <AlertTriangle className="w-5 h-5" />
              <span className="font-medium">Alertes critiques</span>
            </button>
            <button className="flex items-center gap-3 p-4 bg-gradient-to-r from-[#06B6D4] to-[#14B8A6] text-white rounded-lg hover:opacity-90 transition-opacity shadow-lg">
              <TrendingUp className="w-5 h-5" />
              <span className="font-medium">Analytics IA</span>
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="border-b border-gray-200 p-6">
          <h2 className="text-xl font-bold text-[#0F172A] flex items-center gap-2">
            <Server className="w-6 h-6 text-[#2D6CDF]" />
            Informations Systeme
          </h2>
        </div>
        <div className="p-6">
          <div className="grid md:grid-cols-3 gap-6">
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-[#64748B]">Version plateforme</span>
                <span className="text-sm font-semibold text-[#0F172A]">v2.5.0</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-[#64748B]">Environnement</span>
                <span className="text-sm font-semibold text-[#0F172A]">Production</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-[#64748B]">Base de donnees</span>
                <span className="text-sm font-semibold text-[#0F172A]">PostgreSQL 15</span>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-[#64748B]">Serveur</span>
                <span className="text-sm font-semibold text-[#0F172A]">AWS eu-west-1</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-[#64748B]">CPU Usage</span>
                <span className="text-sm font-semibold text-[#0F172A]">42%</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-[#64748B]">RAM Usage</span>
                <span className="text-sm font-semibold text-[#0F172A]">68%</span>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-[#64748B]">Stockage</span>
                <span className="text-sm font-semibold text-[#0F172A]">2.4TB / 5TB</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-[#64748B]">Backup</span>
                <span className="text-sm font-semibold text-green-600">Actif</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-[#64748B]">SSL</span>
                <span className="text-sm font-semibold text-green-600">Actif</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

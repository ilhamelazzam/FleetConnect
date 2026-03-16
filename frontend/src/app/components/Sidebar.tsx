import { Link, useLocation } from "react-router";
import {
  LayoutDashboard,
  Phone,
  Package,
  Activity,
  AlertTriangle,
  TrendingUp,
  Lightbulb,
  FileText,
  Users,
  Settings,
} from "lucide-react";

const menuItems = [
  { path: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { path: "/lignes", label: "Lignes", icon: Phone },
  { path: "/forfaits", label: "Forfaits", icon: Package },
  { path: "/consommations", label: "Consommations", icon: Activity },
  { path: "/anomalies", label: "Anomalies & Alertes", icon: AlertTriangle },
  { path: "/predictions", label: "Prédictions IA", icon: TrendingUp },
  { path: "/recommandations", label: "Recommandations IA", icon: Lightbulb },
  { path: "/rapports", label: "Rapports", icon: FileText },
  { path: "/utilisateurs", label: "Utilisateurs", icon: Users },
  { path: "/parametres", label: "Paramètres", icon: Settings },
];

export default function Sidebar() {
  const location = useLocation();

  return (
    <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-[#2D6CDF] to-[#06B6D4] rounded-lg flex items-center justify-center">
            <Phone className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-[#0F172A]">BC SKILLS</h1>
            <p className="text-xs text-[#64748B]">FleetConnect AI</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-4 overflow-y-auto">
        <ul className="space-y-1">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;

            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                    isActive
                      ? "bg-[#2D6CDF] text-white"
                      : "text-[#64748B] hover:bg-gray-50 hover:text-[#0F172A]"
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-sm font-medium">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="p-4 border-t border-gray-200">
        <div className="bg-gradient-to-br from-[#7C3AED] to-[#06B6D4] rounded-lg p-4 text-white">
          <p className="text-xs font-semibold mb-1">IA Prédictive</p>
          <p className="text-xs opacity-90">Modèle actif et opérationnel</p>
          <div className="mt-2 flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-[#16A34A] animate-pulse" />
            <span className="text-xs">En ligne</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

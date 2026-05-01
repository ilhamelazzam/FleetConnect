import { Link, useLocation } from "react-router";
import {
  LayoutDashboard,
  Phone,
  Package,
  ChartBar,
  Activity,
  AlertTriangle,
  TrendingUp,
  Lightbulb,
  FileText,
  ShieldCheck,
  Target,
  Settings,
  KeyRound,
} from "lucide-react";

import { useAuth } from "../context/AuthContext";
import { canAccessSettings, hasAnyRole, type AppRole } from "../lib/roles";

interface MenuItem {
  path: string;
  label: string;
  icon: typeof LayoutDashboard;
  allowedRoles?: AppRole[];
}

const menuItems: MenuItem[] = [
  { path: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { path: "/lignes", label: "Lignes", icon: Phone },
  { path: "/acces-flotte", label: "Acces flotte", icon: KeyRound },
  { path: "/forfaits", label: "Forfaits", icon: Package },
  { path: "/forfaits/attributions", label: "Forfaits attribues", icon: ChartBar },
  { path: "/consommations", label: "Consommations", icon: Activity },
  { path: "/anomalies", label: "Fraude CDR", icon: AlertTriangle },
  { path: "/predictions", label: "Predictions IA", icon: TrendingUp },
  { path: "/recommandations", label: "Recommandations IA", icon: Lightbulb },
  { path: "/rapports", label: "Rapports", icon: FileText },
  { path: "/risque-client", label: "Risque client", icon: Target },
  { path: "/utilisateurs", label: "Utilisateurs", icon: ShieldCheck, allowedRoles: ["admin"] },
  { path: "/parametres", label: "Parametres", icon: Settings, allowedRoles: ["admin"] },
];

export default function Sidebar() {
  const location = useLocation();
  const { user } = useAuth();
  const visibleMenuItems = menuItems.filter((item) => {
    if (item.allowedRoles) {
      return hasAnyRole(user, item.allowedRoles);
    }

    return true;
  });

  return (
    <aside className="flex w-64 flex-col border-r border-[var(--bc-neutral-border)] bg-white transition-colors duration-300 dark:bg-[#08101f]">
      <div className="border-b border-[var(--bc-neutral-border)] p-6">
        <div className="flex items-center gap-3">
          <div className="bc-gradient-primary flex h-10 w-10 items-center justify-center rounded-lg shadow-[0_12px_24px_rgba(59,130,246,0.22)]">
            <Phone className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-[var(--bc-neutral-strong)]">BC SKILLS</h1>
            <p className="text-xs text-[var(--bc-neutral-body)]">FleetConnect IA</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-4">
        <ul className="space-y-1">
          {visibleMenuItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;

            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                    isActive
                      ? "bg-[var(--bc-primary)] text-white shadow-[0_10px_24px_rgba(59,130,246,0.2)]"
                      : "text-[var(--bc-neutral-body)] hover:bg-[var(--bc-primary-soft)] hover:text-[var(--bc-primary)] dark:hover:bg-white/5"
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-sm font-medium">
                    {item.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-[var(--bc-neutral-border)] p-4">
        <div className="bc-gradient-ai rounded-2xl p-4 text-white shadow-[0_18px_34px_rgba(99,102,241,0.2)]">
          <p className="text-xs font-semibold mb-1">
            {canAccessSettings(user) ? "Console admin" : "IA predictive"}
          </p>
          <p className="text-xs opacity-90">
            {canAccessSettings(user)
              ? "Acces et configuration securises"
              : "Modele actif et operationnel"}
          </p>
          <div className="mt-2 flex items-center gap-1">
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--bc-success)]" />
            <span className="text-xs">En ligne</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

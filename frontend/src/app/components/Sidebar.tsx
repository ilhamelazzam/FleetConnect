import { Link, useLocation, useNavigate } from "react-router";
import {
  Activity,
  AlertTriangle,
  Building2,
  ChartBar,
  CheckCircle2,
  FileText,
  KeyRound,
  LayoutDashboard,
  Lightbulb,
  LogOut,
  Package,
  Phone,
  Settings,
  ShieldCheck,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";

import { useAuth } from "../context/AuthContext";
import { useLanguage } from "../context/LanguageContext";
import {
  NAVIGATION_ITEMS,
  canAccessModule,
  canAccessSettings,
  canAccessSuperAdmin,
  isNavigationItemActive,
} from "../lib/roles";

interface MenuItem {
  module?: string;
  path: string;
  icon: typeof LayoutDashboard;
  label?: string;
  labelKey?: string;
}

const regularMenuIcons = {
  dashboard: LayoutDashboard,
  phone_lines: Phone,
  fleet_access: KeyRound,
  plans: Package,
  plan_assignments: ChartBar,
  consumption: Activity,
  fraud_cdr: AlertTriangle,
  predictions: TrendingUp,
  recommendations: Lightbulb,
  reports: FileText,
  customer_risk: Target,
  users: ShieldCheck,
  settings: Settings,
} as const;

const superAdminMenuItems: MenuItem[] = [
  { path: "/admin/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  {
    path: "/admin/company-requests",
    label: "Demandes d'entreprises",
    icon: Building2,
  },
  { path: "/admin/companies", label: "Entreprises", icon: Building2 },
  { path: "/admin/users", label: "Utilisateurs", icon: Users },
  { path: "/admin/documents", label: "Documents", icon: FileText },
  { path: "/admin/validation", label: "Validation", icon: CheckCircle2 },
  { path: "/admin/settings", label: "Parametres", icon: Settings },
];

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { language } = useLanguage();
  const isSuperAdmin = canAccessSuperAdmin(user);
  const regularMenuItems: MenuItem[] = NAVIGATION_ITEMS.map((item) => ({
    module: item.module,
    path: item.path,
    labelKey: item.labelKey,
    icon: regularMenuIcons[item.module as keyof typeof regularMenuIcons],
  }));

  const copy =
    language === "ar"
      ? {
          appName: "FleetConnect AI",
            menu: {
              dashboard: "Tableau de bord",
              lines: "Lignes",
              fleetAccess: "Acces flotte",
              plans: "Forfaits",
              assignedPlans: "Forfaits attribues",
              spending: "Consommations",
              suspiciousCalls: "Fraude CDR",
              predictions: "Predictions IA",
              recommendations: "Recommandations IA",
              reports: "Rapports",
              customerRisk: "Risque client",
              users: "Utilisateurs",
            settings: "Parametres",
          },
          adminSpace: "Administration",
          decisionSupport: "Aide a la decision",
          securedAccess: "Acces et reglages securises",
          activeTracking: "Suivi actif de votre flotte",
          online: "En ligne",
        }
      : language === "en"
        ? {
            appName: "FleetConnect AI",
            menu: {
              dashboard: "Dashboard",
              lines: "Lines",
              fleetAccess: "Fleet access",
              plans: "Plans",
              assignedPlans: "Assigned plans",
              spending: "Consumption",
              suspiciousCalls: "CDR fraud",
              predictions: "AI predictions",
              recommendations: "AI recommendations",
              reports: "Reports",
              customerRisk: "Customer risk",
              users: "Users",
              settings: "Settings",
            },
            adminSpace: "Administration space",
            decisionSupport: "Decision support",
            securedAccess: "Secure access and settings",
            activeTracking: "Active fleet monitoring",
            online: "Online",
          }
        : {
            appName: "FleetConnect IA",
            menu: {
              dashboard: "Tableau de bord",
              lines: "Lignes",
              fleetAccess: "Acces a la flotte",
              plans: "Forfaits",
              assignedPlans: "Forfaits attribues",
              spending: "Consommations",
              suspiciousCalls: "Fraude CDR",
              predictions: "Predictions IA",
              recommendations: "Recommandations IA",
              reports: "Rapports",
              customerRisk: "Risque client",
              users: "Utilisateurs",
              settings: "Parametres",
            },
            adminSpace: "Espace d'administration",
            decisionSupport: "Aide a la decision",
            securedAccess: "Acces et reglages securises",
            activeTracking: "Suivi actif de votre flotte",
            online: "En ligne",
          };

  const visibleMenuItems = (isSuperAdmin ? superAdminMenuItems : regularMenuItems).filter((item) =>
    item.module ? canAccessModule(user, item.module as Parameters<typeof canAccessModule>[1]) : true,
  );

  const handleLogout = () => {
    logout();
    navigate(isSuperAdmin ? "/admin/login" : "/login", { replace: true });
  };

  return (
    <aside className="flex w-64 flex-col border-r border-[var(--bc-neutral-border)] bg-white transition-colors duration-300 dark:bg-[#08101f]">
      <div className="border-b border-[var(--bc-neutral-border)] p-6">
        <div className="flex items-center gap-3">
          <div className="bc-gradient-primary flex h-10 w-10 items-center justify-center rounded-lg shadow-[0_12px_24px_rgba(59,130,246,0.22)]">
            <Phone className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-[var(--bc-neutral-strong)]">BC SKILLS</h1>
            <p className="text-xs text-[var(--bc-neutral-body)]">
              {isSuperAdmin ? "FleetConnect IA - Super Admin" : copy.appName}
            </p>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-4">
        <ul className="space-y-1">
          {visibleMenuItems.map((item) => {
            const Icon = item.icon;
            const navigationItem = NAVIGATION_ITEMS.find((candidate) => candidate.path === item.path);
            const isActive = navigationItem
              ? isNavigationItemActive(navigationItem, location.pathname)
              : location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);

            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                    isActive
                      ? "bg-[var(--bc-primary)] text-white shadow-[0_10px_24px_rgba(59,130,246,0.2)]"
                      : "text-[var(--bc-neutral-body)] hover:bg-[var(--bc-primary-soft)] hover:text-[var(--bc-primary)] dark:hover:bg-white/5"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  <span className="text-sm font-medium">
                    {item.label ?? copy.menu[item.labelKey as keyof typeof copy.menu]}
                  </span>
                </Link>
              </li>
            );
          })}
          {isSuperAdmin ? (
            <li className="pt-3">
              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-left text-[#B91C1C] transition-colors hover:bg-red-100"
              >
                <LogOut className="h-5 w-5" />
                <span className="text-sm font-medium">Deconnexion</span>
              </button>
            </li>
          ) : null}
        </ul>
      </nav>

      <div className="border-t border-[var(--bc-neutral-border)] p-4">
        <div className="bc-gradient-ai rounded-2xl p-4 text-white shadow-[0_18px_34px_rgba(99,102,241,0.2)]">
          <p className="mb-1 text-xs font-semibold">
            {isSuperAdmin
              ? "Supervision plateforme"
              : canAccessSettings(user)
                ? copy.adminSpace
                : copy.decisionSupport}
          </p>
          <p className="text-xs opacity-90">
            {isSuperAdmin
              ? "Validation des entreprises, gestion des workspaces et audit centralise."
              : canAccessSettings(user)
                ? copy.securedAccess
                : copy.activeTracking}
          </p>
          <div className="mt-2 flex items-center gap-1">
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--bc-success)]" />
            <span className="text-xs">{copy.online}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

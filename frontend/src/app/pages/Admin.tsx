import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useNavigate } from "react-router";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Brain,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Cpu,
  Database,
  Eye,
  FileText,
  LogOut,
  MapPin,
  MoonStar,
  RefreshCw,
  Server,
  Settings,
  Shield,
  ShieldAlert,
  Sparkles,
  SunMedium,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Brush,
  CartesianGrid,
  Line,
  LineChart,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

import { Badge } from "../components/ui/badge";
import { Switch } from "../components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { useAuth } from "../context/AuthContext";
import { usePhoneLineStats } from "../hooks/usePhoneLineStats";
import { formatRoleLabel } from "../lib/api";
import { applyTheme, resolveTheme, type ThemeMode } from "../lib/theme";
import logoImage from "../../assets/2285601bb4e4d491e253f51df33e674aefdb2011.png";

type HealthState = "Stable" | "Attention" | "Critique";
type AlertLevel = "Critique" | "Eleve";

interface HealthPalette {
  badgeClassName: string;
  bannerClassName: string;
  panelAccentClassName: string;
  chartColor: string;
}
interface AlertItem {
  id: string;
  title: string;
  level: AlertLevel;
  timestamp: string;
  source: string;
  description: string;
  path: string;
}
interface QuickAction {
  key: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  gradientClassName: string;
  type: "navigate" | "notify";
  path?: string;
  message: string;
  description: string;
}
interface ShortcutItem {
  title: string;
  subtitle: string;
  path: string;
  icon: LucideIcon;
  accentClassName: string;
}

const panelClassName =
  "rounded-[28px] border border-white/60 bg-white/85 p-6 shadow-[0_20px_70px_-36px_rgba(15,23,42,0.45)] backdrop-blur-xl transition-all duration-300 dark:border-white/10 dark:bg-[#08101f]/80 dark:shadow-[0_20px_70px_-36px_rgba(2,6,23,0.95)]";
const surfaceButtonClassName =
  "inline-flex items-center gap-2 rounded-2xl border border-slate-200/80 bg-white/90 px-4 py-2.5 text-sm font-medium text-[#0F172A] transition-all duration-300 hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white hover:shadow-lg dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:border-white/20 dark:hover:bg-white/10";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
function formatDateTime(value: string | null | undefined) {
  if (!value) return "Non disponible";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
function formatShortTime(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
function formatMadValue(value: number | null) {
  if (value === null || Number.isNaN(value)) return "--";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "MAD",
    maximumFractionDigits: 0,
  }).format(value);
}
function formatRelativeDate(minutesAgo: number) {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}
function buildRealtimeSeries(baseValue: number, liveTick: number, amplitude: number) {
  const formatter = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const now = Date.now();

  return Array.from({ length: 18 }, (_, index) => {
    const timeOffset = (17 - index) * 5 * 60_000;
    const noise = Math.sin((liveTick + index) / 2.4) * amplitude + Math.cos((liveTick + index) / 3.2) * amplitude * 0.45;
    const boost = index > 13 ? Math.sin((liveTick + index) / 1.1) * 1.9 : 0;
    const value = clamp(baseValue + noise + boost, 10, 99);
    return { label: formatter.format(new Date(now - timeOffset)), value: Number(value.toFixed(1)) };
  });
}
function getMetricStatus(value: number) {
  if (value >= 85) return { label: "Critique", className: "border-red-200 bg-red-50 text-[#DC2626] dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300" };
  if (value >= 65) return { label: "Sous tension", className: "border-orange-200 bg-orange-50 text-[#F97316] dark:border-orange-400/20 dark:bg-orange-500/10 dark:text-orange-300" };
  return { label: "Stable", className: "border-emerald-200 bg-emerald-50 text-[#16A34A] dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-300" };
}
function getHealthPalette(state: HealthState): HealthPalette {
  if (state === "Critique") return {
    badgeClassName: "border-red-200 bg-red-50 text-[#DC2626] dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300",
    bannerClassName: "border-red-200/70 bg-red-50/90 text-[#991B1B] dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200",
    panelAccentClassName: "from-[#F97316] via-[#EF4444] to-[#DC2626]",
    chartColor: "#EF4444",
  };
  if (state === "Attention") return {
    badgeClassName: "border-orange-200 bg-orange-50 text-[#F97316] dark:border-orange-400/20 dark:bg-orange-500/10 dark:text-orange-300",
    bannerClassName: "border-orange-200/70 bg-orange-50/90 text-[#9A3412] dark:border-orange-400/20 dark:bg-orange-500/10 dark:text-orange-200",
    panelAccentClassName: "from-[#F59E0B] via-[#F97316] to-[#FB7185]",
    chartColor: "#F97316",
  };
  return {
    badgeClassName: "border-emerald-200 bg-emerald-50 text-[#16A34A] dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-300",
    bannerClassName: "border-emerald-200/70 bg-emerald-50/90 text-[#166534] dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-200",
    panelAccentClassName: "from-[#34D399] via-[#10B981] to-[#06B6D4]",
    chartColor: "#10B981",
  };
}
function InfoTooltip({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200/70 bg-white/80 text-[#64748B] transition-colors hover:border-slate-300 hover:text-[#0F172A] dark:border-white/10 dark:bg-white/5 dark:text-slate-400 dark:hover:text-white">
          <CircleHelp className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent sideOffset={8} className="max-w-xs bg-[#0F172A] text-white dark:bg-slate-100 dark:text-[#0F172A]">{label}</TooltipContent>
    </Tooltip>
  );
}
function SectionCard({ icon: Icon, title, subtitle, action, className = "", children }: { icon: LucideIcon; title: string; subtitle?: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`${panelClassName} ${className}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#2D6CDF]/15 to-[#7C3AED]/20 text-[#2D6CDF] dark:from-[#60A5FA]/15 dark:to-[#A855F7]/15 dark:text-sky-300"><Icon className="h-6 w-6" /></div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-[#0F172A] dark:text-white">{title}</h2>
            {subtitle ? <p className="mt-1 text-sm text-[#64748B] dark:text-slate-400">{subtitle}</p> : null}
          </div>
        </div>
        {action}
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}
function GaugeWidget({ title, value, description, note, detailLabel, detailValue, accentColor, tooltip }: { title: string; value: number; description: string; note: string; detailLabel: string; detailValue: string; accentColor: string; tooltip: string }) {
  const metricStatus = getMetricStatus(value);
  return (
    <div className={`${panelClassName} group hover:-translate-y-1 hover:shadow-[0_28px_80px_-42px_rgba(15,23,42,0.55)]`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2"><p className="text-sm font-medium text-[#64748B] dark:text-slate-400">{title}</p><InfoTooltip label={tooltip} /></div>
          <p className="mt-2 text-sm text-[#94A3B8] dark:text-slate-500">{description}</p>
        </div>
        <Badge className={metricStatus.className}>{metricStatus.label}</Badge>
      </div>
      <div className="mt-6 h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart data={[{ name: title, value, fill: accentColor }]} startAngle={180} endAngle={0} innerRadius="70%" outerRadius="100%" barSize={18} cx="50%" cy="76%">
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar background cornerRadius={999} dataKey="value" />
          </RadialBarChart>
        </ResponsiveContainer>
      </div>
      <div className="-mt-16 flex flex-col items-center text-center">
        <p className="text-4xl font-semibold tracking-tight text-[#0F172A] dark:text-white">{value}%</p>
        <p className="mt-2 text-sm text-[#64748B] dark:text-slate-400">{note}</p>
      </div>
      <div className="mt-6 flex items-center justify-between rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3 dark:border-white/10 dark:bg-white/5">
        <span className="text-sm text-[#64748B] dark:text-slate-400">{detailLabel}</span>
        <span className="text-sm font-semibold text-[#0F172A] dark:text-white">{detailValue}</span>
      </div>
    </div>
  );
}
function ProgressWidget({ title, value, topValue, description, tooltip, accentClassName, footerLeft, footerRight }: { title: string; value: number; topValue: string; description: string; tooltip: string; accentClassName: string; footerLeft: string; footerRight: string }) {
  const metricStatus = getMetricStatus(value);
  return (
    <div className={`${panelClassName} group hover:-translate-y-1 hover:shadow-[0_28px_80px_-42px_rgba(15,23,42,0.55)]`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2"><p className="text-sm font-medium text-[#64748B] dark:text-slate-400">{title}</p><InfoTooltip label={tooltip} /></div>
          <p className="mt-2 text-4xl font-semibold tracking-tight text-[#0F172A] dark:text-white">{topValue}</p>
        </div>
        <Badge className={metricStatus.className}>{metricStatus.label}</Badge>
      </div>
      <p className="mt-5 text-sm text-[#64748B] dark:text-slate-400">{description}</p>
      <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className={`h-full rounded-full bg-gradient-to-r ${accentClassName} transition-all duration-700`} style={{ width: `${clamp(value, 0, 100)}%` }} /></div>
      <div className="mt-3 flex items-center justify-between text-sm"><span className="text-[#64748B] dark:text-slate-400">{footerLeft}</span><span className="font-semibold text-[#0F172A] dark:text-white">{footerRight}</span></div>
    </div>
  );
}

export default function Admin() {
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const { totalLines, averageDataUsageGb, averageDataUsageChangePct, totalAiAlerts, criticalAiAlerts, estimatedMonthlySavingsMad, lineStatsError, isLoading, refresh } = usePhoneLineStats();
  const refreshRef = useRef(refresh);
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [liveTick, setLiveTick] = useState(0);
  const [activeActionKey, setActiveActionKey] = useState<string | null>(null);
  const [resolvedAlertIds, setResolvedAlertIds] = useState<string[]>([]);
  const [isAuditRunning, setIsAuditRunning] = useState(false);

  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  useEffect(() => { setTheme(resolveTheme()); }, []);
  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => {
    const liveInterval = window.setInterval(() => setLiveTick((currentTick) => currentTick + 1), 5_000);
    const refreshInterval = window.setInterval(() => { void refreshRef.current(); }, 45_000);
    return () => { window.clearInterval(liveInterval); window.clearInterval(refreshInterval); };
  }, []);

  const normalizedRole = user?.role.trim().toLowerCase() ?? "";
  const isAdminSession = normalizedRole === "admin" || normalizedRole === "super_admin";
  const rolePermissions: Record<string, string[]> = {
    super_admin: ["Validation entreprises", "Supervision multi-entreprises", "Configuration systeme", "Gestion des roles eleves"],
    admin: ["Gestion totale", "Analytique avancee", "Configuration systeme", "Gestion utilisateurs"],
    company_admin: ["Administration entreprise", "Gestion operationnelle", "Suivi des lignes", "Lecture des rapports"],
    manager: ["Lecture et ecriture", "Suivi des lignes", "Consultation des rapports", "Validation des alertes"],
    analyst: ["Lecture seule", "Analyse des consommations", "Exports basiques", "Consultation des rapports"],
  };

  const totalAlerts = totalAiAlerts ?? 8;
  const criticalAlerts = criticalAiAlerts ?? 2;
  const cpuUsage = Math.round(clamp(34 + (averageDataUsageChangePct ?? 6) * 0.85 + criticalAlerts * 4, 18, 97));
  const ramUsage = Math.round(clamp(48 + (averageDataUsageGb ?? 7) * 2.6 + totalAlerts * 0.7, 30, 98));
  const storageUsedTb = Number((2.4 + (totalLines ?? 0) * 0.004).toFixed(1));
  const storageUsage = Math.round(clamp((storageUsedTb / 5) * 100, 18, 97));
  const dbHealth = Math.round(clamp(98 - criticalAlerts * 2.6 - Math.max(0, cpuUsage - 75) * 0.2 - (lineStatsError ? 12 : 0), 68, 99));
  const uptimePct = Number(clamp(99.97 - criticalAlerts * 0.03 - (lineStatsError ? 0.75 : 0), 96.4, 99.99).toFixed(2));
  const latencyMs = Math.round(clamp(118 + totalAlerts * 4 + criticalAlerts * 12, 96, 250));
  const activityLevel = user?.last_login_at && Date.now() - new Date(user.last_login_at).getTime() <= 12 * 60 * 60 * 1000 ? "Eleve" : user?.last_login_at ? "Modere" : "Faible";

  const uptimeScore = clamp(((uptimePct - 95) / 5) * 100, 0, 100);
  const alertScore = clamp(100 - totalAlerts * 1.7 - criticalAlerts * 8.5, 15, 100);
  const performanceScore = clamp(100 - (((cpuUsage + ramUsage) / 2) - 45) * 2.4, 20, 100);
  const healthScore = Math.round(uptimeScore * 0.32 + alertScore * 0.26 + performanceScore * 0.24 + dbHealth * 0.18);

  const anomalies = useMemo(() => {
    const detected: string[] = [];
    if (lineStatsError) detected.push("Flux de supervision degrade -> verification des metriques recommandee");
    if (criticalAlerts > 0) detected.push(`${criticalAlerts} alertes critiques en file d'attente sur la fraude CDR`);
    if (ramUsage >= 70) detected.push("Charge RAM elevee -> optimisation recommandee");
    if (cpuUsage >= 75) detected.push("CPU sous tension sur le noeud analytics");
    if (dbHealth <= 90) detected.push("Base de donnees sous pression -> surveiller la latence");
    if ((averageDataUsageChangePct ?? 0) >= 12) detected.push("Pic inhabituel de consommation data sur la flotte");
    return detected.length > 0 ? detected : ["Aucune anomalie majeure detectee sur la derniere fenetre de controle"];
  }, [averageDataUsageChangePct, cpuUsage, criticalAlerts, dbHealth, lineStatsError, ramUsage]);

  const healthState: HealthState = healthScore < 72 || criticalAlerts >= 4 || cpuUsage >= 88 || ramUsage >= 92 ? "Critique" : healthScore < 89 || criticalAlerts > 0 || anomalies.length > 1 ? "Attention" : "Stable";
  const healthPalette = getHealthPalette(healthState);
  const aiRecommendation = lineStatsError ? "Les flux telemetry sont incomplets -> relancer la collecte et verifier les integrations." : criticalAlerts > 0 ? "Traiter les alertes P1 et lancer une analyse IA guidee sur la fraude CDR." : ramUsage >= 70 ? "Charge RAM elevee -> optimisation recommandee avant la prochaine pointe." : dbHealth <= 90 ? "Stabiliser la base PostgreSQL et purger les sessions longues." : "Plateforme stable -> maintenir la surveillance et automatiser les actions a faible risque.";
  const systemBannerMessage = healthState === "Stable" ? "Plateforme stable" : healthState === "Attention" ? "Attention : anomalies detectees" : "Critique : intervention immediate requise";
  const adminInfo = {
    name: user?.full_name ?? "Utilisateur connecte",
    email: user?.email ?? "-",
    role: user ? formatRoleLabel(user.role) : "Utilisateur",
    company: "BC SKILLS",
    createdAt: user?.created_at ?? null,
    lastLogin: user?.last_login_at ?? null,
    location: user?.last_login_at ? "Session web - localisation non verifiee" : "Non disponible",
    activityLevel,
    permissions: rolePermissions[normalizedRole] ?? ["Acces a la plateforme"],
  };

  const cpuSeries = useMemo(() => buildRealtimeSeries(cpuUsage, liveTick, 4.8), [cpuUsage, liveTick]);
  const ramSeries = useMemo(() => buildRealtimeSeries(ramUsage, liveTick + 2, 4.2), [liveTick, ramUsage]);
  const alerts7Days = useMemo(() => {
    const dayFormatter = new Intl.DateTimeFormat("fr-FR", { weekday: "short" });
    const now = Date.now();
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(now - (6 - index) * 24 * 60 * 60 * 1000);
      const baseline = Math.max(1, Math.round(totalAlerts * (0.66 + Math.sin((liveTick + index) / 2.8) * 0.2) + (index % 2 === 0 ? 1 : 0)));
      const critical = Math.max(0, Math.min(baseline, Math.round(criticalAlerts * (0.7 + Math.cos((liveTick + index) / 2.5) * 0.25) + (index === 6 ? 1 : 0))));
      return { label: dayFormatter.format(date).replace(".", ""), total: baseline, critical };
    });
  }, [criticalAlerts, liveTick, totalAlerts]);

  const recentAlerts = useMemo<AlertItem[]>(
    () => [
      { id: "cdr-risk", title: "Fraude CDR a priorite haute", level: criticalAlerts >= 3 ? "Critique" : "Eleve", timestamp: formatRelativeDate(6), source: "Module fraude CDR", description: `${Math.max(criticalAlerts, 1)} evenement(s) P1 avec signal international et recommandation IA.`, path: "/anomalies" },
      { id: "ram-pressure", title: "Charge RAM sur le cluster analytics", level: ramUsage >= 80 ? "Critique" : "Eleve", timestamp: formatRelativeDate(18), source: "Monitoring infrastructure", description: `Memoire a ${ramUsage}% -> revoir le dimensionnement des workers et les caches.`, path: "/parametres" },
      { id: "db-latency", title: "Latence base de donnees en hausse", level: dbHealth <= 85 ? "Critique" : "Eleve", timestamp: formatRelativeDate(31), source: "PostgreSQL 15", description: `Temps de reponse moyen ${latencyMs} ms -> surveiller index et requetes longues.`, path: "/rapports" },
      { id: "usage-spike", title: "Variation inhabituelle de consommation", level: (averageDataUsageChangePct ?? 0) >= 15 ? "Critique" : "Eleve", timestamp: formatRelativeDate(47), source: "Fleet usage analytics", description: `${Math.max(averageDataUsageChangePct ?? 7, 4).toFixed(1)}% de variation sur la fenetre courante.`, path: "/consommations" },
    ],
    [averageDataUsageChangePct, criticalAlerts, dbHealth, latencyMs, ramUsage],
  );
  const visibleAlerts = recentAlerts.filter((alert) => !resolvedAlertIds.includes(alert.id));

  const quickActions: QuickAction[] = [
    { key: "users", title: "Gerer utilisateurs", subtitle: "Roles, acces et activite admin", icon: Users, gradientClassName: "from-[#2D6CDF] to-[#06B6D4]", type: "navigate", path: "/utilisateurs", message: "Ouverture de la console utilisateurs", description: "Les roles, comptes et acces administrateurs sont disponibles." },
    { key: "database", title: "Base de donnees", subtitle: "Sante, latence et pression ecriture", icon: Database, gradientClassName: "from-[#7C3AED] to-[#EC4899]", type: "notify", message: "Diagnostic base de donnees pret", description: `Sante ${dbHealth}% et latence moyenne ${latencyMs} ms.` },
    { key: "config", title: "Configuration", subtitle: "Parametres, politique et reseau", icon: Settings, gradientClassName: "from-[#16A34A] to-[#10B981]", type: "navigate", path: "/parametres", message: "Acces aux parametres systeme", description: "La configuration centrale est disponible." },
    { key: "anomalies", title: "Analyser anomalies", subtitle: "Lancer la revue IA des signaux critiques", icon: Sparkles, gradientClassName: "from-[#F97316] to-[#EF4444]", type: "navigate", path: "/anomalies", message: "Analyse IA redirigee vers les alertes", description: "Les alertes fraude CDR sont ouvertes avec priorisation P1." },
    { key: "optimize", title: "Optimiser systeme", subtitle: "Reduire la pression CPU et RAM", icon: Cpu, gradientClassName: "from-[#0F766E] to-[#14B8A6]", type: "notify", message: "Plan d'optimisation genere", description: aiRecommendation },
    { key: "report", title: "Generer rapport automatique", subtitle: "Exporter une synthese directionnelle", icon: FileText, gradientClassName: "from-[#1D4ED8] to-[#7C3AED]", type: "navigate", path: "/rapports", message: "Generation du rapport automatique", description: "Le centre de supervision ouvre la vue rapports pour finaliser l'export." },
  ];

  const shortcuts: ShortcutItem[] = [
    { title: "Risque client", subtitle: "Pilotage des comptes sensibles et churn", path: "/risque-client", icon: Users, accentClassName: "from-[#2563EB] to-[#06B6D4]" },
    { title: "Fraude CDR", subtitle: "Signalements critiques, roaming et appels suspects", path: "/anomalies", icon: ShieldAlert, accentClassName: "from-[#F97316] to-[#EF4444]" },
    { title: "Recommandations IA", subtitle: "Actions suggerees pour arbitrage rapide", path: "/recommandations", icon: Brain, accentClassName: "from-[#7C3AED] to-[#EC4899]" },
  ];

  const activityItems = [
    { id: "login", title: "Connexion admin validee", description: `${adminInfo.name} a repris la session de supervision.`, timestamp: adminInfo.lastLogin ?? formatRelativeDate(22), icon: Shield, badgeClassName: "border-emerald-200 bg-emerald-50 text-[#16A34A] dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-300", badgeLabel: "Connexion" },
    { id: "automation", title: "Regles IA actualisees", description: "Le moteur de priorisation a recalcule les seuils de confiance.", timestamp: formatRelativeDate(54), icon: Sparkles, badgeClassName: "border-blue-200 bg-blue-50 text-[#2563EB] dark:border-blue-400/20 dark:bg-blue-500/10 dark:text-sky-300", badgeLabel: "Action admin" },
    { id: "security", title: "Anomalie securite contenue", description: "Tentative d'acces non autorisee bloquee et journalisee.", timestamp: formatRelativeDate(112), icon: AlertTriangle, badgeClassName: "border-orange-200 bg-orange-50 text-[#F97316] dark:border-orange-400/20 dark:bg-orange-500/10 dark:text-orange-300", badgeLabel: "Securite" },
    { id: "ssl", title: "Verification SSL et backup terminee", description: "Les controles critiques sont passes avec succes sur l'environnement de production.", timestamp: formatRelativeDate(210), icon: CheckCircle2, badgeClassName: "border-cyan-200 bg-cyan-50 text-[#0891B2] dark:border-cyan-400/20 dark:bg-cyan-500/10 dark:text-cyan-300", badgeLabel: "Controle" },
  ];

  const chartGridColor = theme === "dark" ? "rgba(148, 163, 184, 0.16)" : "#E2E8F0";
  const chartTextColor = theme === "dark" ? "#94A3B8" : "#64748B";
  const tooltipStyle = {
    backgroundColor: theme === "dark" ? "#08101f" : "rgba(255,255,255,0.98)",
    borderColor: theme === "dark" ? "rgba(255,255,255,0.12)" : "rgba(226,232,240,0.9)",
    borderRadius: 16,
    color: theme === "dark" ? "#E2E8F0" : "#0F172A",
    boxShadow: "0 20px 50px -30px rgba(15,23,42,0.6)",
  } satisfies CSSProperties;

  function triggerActionFeedback(key: string, title: string, description: string) {
    setActiveActionKey(key);
    window.setTimeout(() => setActiveActionKey((currentKey) => (currentKey === key ? null : currentKey)), 1_200);
    toast.success(title, { description });
  }
  function handleQuickAction(action: QuickAction) {
    triggerActionFeedback(action.key, action.message, action.description);
    if (action.type === "navigate" && action.path) navigate(action.path);
  }
  function handleViewAlert(alert: AlertItem) {
    toast.message(alert.title, { description: `${alert.source} - ${alert.description}` });
    navigate(alert.path);
  }
  function handleResolveAlert(alert: AlertItem) {
    setResolvedAlertIds((currentIds) => (currentIds.includes(alert.id) ? currentIds : [...currentIds, alert.id]));
    toast.success("Alerte marquee comme resolue", { description: `${alert.title} a quitte la file prioritaire.` });
  }
  function handleSecurityAudit() {
    setIsAuditRunning(true);
    window.setTimeout(() => setIsAuditRunning(false), 1_000);
    toast.success("Audit securite lance", { description: "Verification des sessions admin, du SSL et des signaux CDR en cours." });
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,#DBEAFE_0%,#EFF6FF_36%,#F8FAFC_100%)] p-6 transition-colors dark:bg-[radial-gradient(circle_at_top_left,#14213D_0%,#020617_45%,#050B16_100%)]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-16 top-10 h-64 w-64 rounded-full bg-[#2D6CDF]/10 blur-3xl dark:bg-[#38BDF8]/10" />
        <div className="absolute right-0 top-0 h-72 w-72 rounded-full bg-[#7C3AED]/10 blur-3xl dark:bg-[#A855F7]/10" />
        <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-[#06B6D4]/10 blur-3xl dark:bg-[#14B8A6]/10" />
      </div>

      <div className="relative space-y-6">
        <section className="relative overflow-hidden rounded-[32px] bg-gradient-to-br from-[#2D6CDF] via-[#4F46E5] to-[#7C3AED] p-8 text-white shadow-[0_35px_120px_-48px_rgba(79,70,229,0.9)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.18),transparent_38%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.18),transparent_34%)]" />
          <div className="absolute -right-12 -top-10 h-48 w-48 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute -bottom-12 left-32 h-40 w-40 rounded-full bg-cyan-300/15 blur-3xl" />

          <div className="relative flex flex-col gap-8 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-col gap-5 md:flex-row md:items-center">
                <div className="flex h-28 w-28 items-center justify-center rounded-[26px] bg-white p-4 shadow-2xl shadow-black/10">
                  <img src={logoImage} alt="BC SKILLS" className="h-16 w-auto" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-md">
                      <Shield className="h-7 w-7" />
                    </div>
                    <div>
                      <p className="text-sm uppercase tracking-[0.3em] text-white/65">Admin Control Center</p>
                      <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
                        {isAdminSession ? "Panneau Administrateur" : "Centre de supervision"}
                      </h1>
                    </div>
                  </div>
                  <p className="mt-4 max-w-3xl text-base text-white/80 sm:text-lg">
                    {user ? `${user.full_name} - ${formatRoleLabel(user.role)}` : "Plateforme BC SKILLS FleetConnect IA"}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <div className="rounded-full border border-white/20 bg-white/10 px-4 py-2 backdrop-blur-md">
                      <p className="text-xs uppercase tracking-[0.2em] text-white/65">Score sante</p>
                      <p className="mt-1 text-lg font-semibold">{healthScore}/100</p>
                    </div>
                    <div className="rounded-full border border-white/20 bg-white/10 px-4 py-2 backdrop-blur-md">
                      <p className="text-xs uppercase tracking-[0.2em] text-white/65">Alertes P1</p>
                      <p className="mt-1 text-lg font-semibold">{criticalAlerts}</p>
                    </div>
                    <div className="rounded-full border border-white/20 bg-white/10 px-4 py-2 backdrop-blur-md">
                      <p className="text-xs uppercase tracking-[0.2em] text-white/65">Economies IA</p>
                      <p className="mt-1 text-lg font-semibold">{formatMadValue(estimatedMonthlySavingsMad)}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-start gap-4 xl:items-end">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-3 rounded-full border border-white/20 bg-white/10 px-4 py-2.5 backdrop-blur-md">
                  <SunMedium className="h-4 w-4 text-white/80" />
                  <Switch checked={theme === "dark"} onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")} className="data-[state=checked]:bg-[#0F172A] data-[state=unchecked]:bg-white/50" aria-label="Basculer le theme" />
                  <MoonStar className="h-4 w-4 text-white/80" />
                  <span className="text-sm font-medium text-white/90">{theme === "dark" ? "Dark" : "Light"}</span>
                </div>

                <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/12 px-4 py-2.5 text-sm font-medium backdrop-blur-md">
                  <div className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  Systeme operationnel
                </div>
              </div>

              <div className="rounded-[24px] border border-white/15 bg-white/10 p-4 backdrop-blur-md">
                <div className="flex items-center gap-3">
                  <RefreshCw className="h-4 w-4 text-white/80" />
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-white/65">Derniere synchro</p>
                    <p className="mt-1 text-sm font-medium text-white/90">{formatShortTime(new Date().toISOString())}</p>
                  </div>
                </div>
              </div>

              <button type="button" onClick={() => { logout(); navigate("/login", { replace: true }); }} className="inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-[#2D6CDF] transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/90 hover:shadow-lg">
                <LogOut className="h-4 w-4" />
                <span>Deconnecter</span>
              </button>
            </div>
          </div>
        </section>
        <div className={`flex flex-col gap-4 rounded-[24px] border px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${healthPalette.bannerClassName}`}>
          <div className="flex items-start gap-3">
            {healthState === "Stable" ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />}
            <div>
              <p className="font-semibold">{systemBannerMessage}</p>
              <p className="mt-1 text-sm opacity-90">{anomalies[0]} {healthState === "Stable" ? "Aucune action immediate n'est requise." : "Une revue rapide est recommandee."}</p>
            </div>
          </div>
          <button type="button" onClick={() => handleQuickAction({ key: "banner-analysis", title: "Analyser anomalies", subtitle: "", icon: Sparkles, gradientClassName: "", type: "navigate", path: "/anomalies", message: "Analyse guidee ouverte", description: "Le cockpit bascule vers la priorisation des anomalies." })} className="inline-flex items-center gap-2 rounded-2xl bg-white/80 px-4 py-2.5 text-sm font-medium text-[#0F172A] transition-all duration-300 hover:-translate-y-0.5 hover:bg-white dark:bg-white/10 dark:text-white dark:hover:bg-white/15">
            <Sparkles className="h-4 w-4" />
            <span>Analyser anomalies</span>
          </button>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_420px]">
          <SectionCard icon={Brain} title="Analyse IA systeme" subtitle="Synthese intelligente, priorisation automatique et guidance decisionnelle." className="relative overflow-hidden">
            <div className={`absolute right-0 top-0 h-32 w-32 bg-gradient-to-br opacity-10 blur-3xl ${healthPalette.panelAccentClassName}`} />
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_320px]">
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge className={healthPalette.badgeClassName}>{healthState}</Badge>
                  <span className="text-sm text-[#64748B] dark:text-slate-400">Etat global</span>
                </div>

                <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/90 p-5 dark:border-white/10 dark:bg-white/5">
                  <p className="text-xs uppercase tracking-[0.2em] text-[#64748B] dark:text-slate-500">Anomalies detectees</p>
                  <div className="mt-4 space-y-3">
                    {anomalies.map((anomaly) => (
                      <div key={anomaly} className="flex items-start gap-3 rounded-2xl bg-white/80 px-4 py-3 text-sm text-[#334155] shadow-sm dark:bg-[#020617]/80 dark:text-slate-300">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#F97316]" />
                        <span>{anomaly}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[24px] bg-gradient-to-r from-[#0F172A] to-[#1E293B] p-5 text-white shadow-lg shadow-slate-900/10">
                  <div className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-cyan-300" /><p className="text-xs uppercase tracking-[0.2em] text-slate-300">Recommandation automatique</p></div>
                  <p className="mt-3 text-lg font-semibold">{aiRecommendation}</p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button type="button" onClick={() => handleQuickAction(quickActions.find((action) => action.key === "optimize") ?? quickActions[4])} className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-sm font-medium text-[#0F172A] transition-all duration-300 hover:-translate-y-0.5 hover:bg-slate-100">
                      <Cpu className="h-4 w-4" />
                      <span>Optimiser systeme</span>
                    </button>
                    <button type="button" onClick={() => navigate("/recommandations")} className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/15">
                      <ArrowRight className="h-4 w-4" />
                      <span>Voir les recommandations IA</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/80 p-5 dark:border-white/10 dark:bg-white/5">
                  <p className="text-xs uppercase tracking-[0.2em] text-[#64748B] dark:text-slate-500">Impact supervision</p>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-white/90 p-4 shadow-sm dark:bg-[#020617]/80"><p className="text-sm text-[#64748B] dark:text-slate-400">Lignes actives</p><p className="mt-2 text-2xl font-semibold text-[#0F172A] dark:text-white">{isLoading && totalLines === null ? "--" : totalLines ?? 0}</p></div>
                    <div className="rounded-2xl bg-white/90 p-4 shadow-sm dark:bg-[#020617]/80"><p className="text-sm text-[#64748B] dark:text-slate-400">Alertes actives</p><p className="mt-2 text-2xl font-semibold text-[#0F172A] dark:text-white">{totalAlerts}</p></div>
                    <div className="rounded-2xl bg-white/90 p-4 shadow-sm dark:bg-[#020617]/80"><p className="text-sm text-[#64748B] dark:text-slate-400">Uptime</p><p className="mt-2 text-2xl font-semibold text-[#0F172A] dark:text-white">{uptimePct}%</p></div>
                    <div className="rounded-2xl bg-white/90 p-4 shadow-sm dark:bg-[#020617]/80"><p className="text-sm text-[#64748B] dark:text-slate-400">DB health</p><p className="mt-2 text-2xl font-semibold text-[#0F172A] dark:text-white">{dbHealth}%</p></div>
                  </div>
                </div>

                <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/80 p-5 dark:border-white/10 dark:bg-white/5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-[#64748B] dark:text-slate-500">Etat de collecte</p>
                      <p className="mt-2 text-lg font-semibold text-[#0F172A] dark:text-white">{lineStatsError ? "Mode degrade" : "Monitoring en direct"}</p>
                    </div>
                    <button type="button" onClick={() => { void refreshRef.current(); triggerActionFeedback("manual-refresh", "Metriques actualisees", "Le cockpit a relance la collecte temps reel."); }} className={surfaceButtonClassName}>
                      <RefreshCw className={`h-4 w-4 ${activeActionKey === "manual-refresh" ? "animate-spin" : ""}`} />
                      <span>Actualiser</span>
                    </button>
                  </div>
                  <p className="mt-3 text-sm text-[#64748B] dark:text-slate-400">{lineStatsError ? "Les donnees issues des lignes sont partiellement indisponibles. L'IA garde les autres signaux actifs." : "Les metriques de flotte, de performance et d'alertes alimentent le scoring automatiquement."}</p>
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard icon={TrendingUp} title="Score sante plateforme" subtitle="Calcul dynamique base sur uptime, alertes, charge et base de donnees.">
            <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/80 p-5 dark:border-white/10 dark:bg-white/5">
              <div className="flex items-start justify-between gap-4">
                <div><p className="text-sm text-[#64748B] dark:text-slate-400">Score sante plateforme</p><p className="mt-2 text-5xl font-semibold tracking-tight text-[#0F172A] dark:text-white">{healthScore}/100</p></div>
                <Badge className={healthPalette.badgeClassName}>{healthState}</Badge>
              </div>
              <div className="mt-6 h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className={`h-full rounded-full bg-gradient-to-r ${healthPalette.panelAccentClassName} transition-all duration-700`} style={{ width: `${healthScore}%` }} /></div>
              <div className="mt-6 space-y-4">
                {[{ label: "Uptime", value: Math.round(uptimeScore), helper: `${uptimePct}%` }, { label: "Alertes", value: Math.round(alertScore), helper: `${criticalAlerts} P1 / ${totalAlerts} actives` }, { label: "CPU / RAM", value: Math.round(performanceScore), helper: `${cpuUsage}% / ${ramUsage}%` }, { label: "Base de donnees", value: dbHealth, helper: `${latencyMs} ms` }].map((item) => (
                  <div key={item.label}>
                    <div className="mb-2 flex items-center justify-between gap-3 text-sm"><span className="text-[#64748B] dark:text-slate-400">{item.label}</span><span className="font-medium text-[#0F172A] dark:text-white">{item.helper}</span></div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className={`h-full rounded-full bg-gradient-to-r ${healthPalette.panelAccentClassName}`} style={{ width: `${item.value}%` }} /></div>
                  </div>
                ))}
              </div>
            </div>
          </SectionCard>
        </div>
        <div className="grid gap-6 xl:grid-cols-4">
          <GaugeWidget title="CPU" value={cpuUsage} description="Charge calculee a partir des flux analytics et des alertes critiques." note="Jauge en temps quasi reel" detailLabel="Tendance" detailValue={`${Math.max(averageDataUsageChangePct ?? 4, 1).toFixed(1)}% sur la fenetre`} accentColor="#2D6CDF" tooltip="Le CPU est surveille pour anticiper la saturation lors des calculs IA et des pics d'alertes." />
          <GaugeWidget title="RAM" value={ramUsage} description="Usage memoire du cluster d'analyse et des traitements de fond." note="Surveillance du tampon analytique" detailLabel="Memoire utilisee" detailValue={`${(averageDataUsageGb ?? 7).toFixed(1)} Go en moyenne`} accentColor="#8B5CF6" tooltip="La RAM est critique pour la stabilite des workers et des traitements de prediction." />
          <ProgressWidget title="Stockage" value={storageUsage} topValue={`${storageUsage}%`} description={`${storageUsedTb.toFixed(1)} TB utilises sur 5 TB avec marge de securite maintenue.`} tooltip="Le stockage suit les journaux, les exports et les historiques d'alertes." accentClassName="from-[#06B6D4] to-[#2DD4BF]" footerLeft="Capacite restante" footerRight={`${(5 - storageUsedTb).toFixed(1)} TB`} />
          <ProgressWidget title="Base de donnees" value={dbHealth} topValue={`${dbHealth}%`} description={`Sante PostgreSQL et latence moyenne ${latencyMs} ms sur l'environnement de production.`} tooltip="Cette valeur combine latence, stabilite des requetes et pression d'ecriture." accentClassName="from-[#10B981] to-[#22C55E]" footerLeft="Version / backup" footerRight="PostgreSQL 15 / Actif" />
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <SectionCard icon={Users} title="Informations utilisateur enrichies" subtitle="Contexte de session, activite et droits pour une prise de decision immediate.">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-4">
                <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/80 p-5 dark:border-white/10 dark:bg-white/5"><p className="text-sm text-[#64748B] dark:text-slate-400">Nom complet</p><p className="mt-2 text-lg font-semibold text-[#0F172A] dark:text-white">{adminInfo.name}</p></div>
                <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/80 p-5 dark:border-white/10 dark:bg-white/5"><p className="text-sm text-[#64748B] dark:text-slate-400">Email</p><p className="mt-2 text-lg font-semibold text-[#0F172A] dark:text-white">{adminInfo.email}</p></div>
                <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/80 p-5 dark:border-white/10 dark:bg-white/5">
                  <p className="text-sm text-[#64748B] dark:text-slate-400">Role</p>
                  <div className="mt-3"><span className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-[#7C3AED] to-[#EC4899] px-3 py-2 text-sm font-semibold text-white"><Shield className="h-4 w-4" />{adminInfo.role}</span></div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/80 p-5 dark:border-white/10 dark:bg-white/5"><p className="text-sm text-[#64748B] dark:text-slate-400">Entreprise</p><p className="mt-2 text-lg font-semibold text-[#0F172A] dark:text-white">{adminInfo.company}</p></div>
                <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/80 p-5 dark:border-white/10 dark:bg-white/5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div><div className="flex items-center gap-2 text-sm text-[#64748B] dark:text-slate-400"><Clock3 className="h-4 w-4" /><span>Derniere connexion</span></div><p className="mt-2 font-semibold text-[#0F172A] dark:text-white">{formatDateTime(adminInfo.lastLogin)}</p></div>
                    <div><div className="flex items-center gap-2 text-sm text-[#64748B] dark:text-slate-400"><MapPin className="h-4 w-4" /><span>Localisation</span></div><p className="mt-2 font-semibold text-[#0F172A] dark:text-white">{adminInfo.location}</p></div>
                    <div><p className="text-sm text-[#64748B] dark:text-slate-400">Compte cree le</p><p className="mt-2 font-semibold text-[#0F172A] dark:text-white">{formatDateTime(adminInfo.createdAt)}</p></div>
                    <div>
                      <p className="text-sm text-[#64748B] dark:text-slate-400">Niveau d'activite</p>
                      <div className="mt-2">
                        <Badge className={adminInfo.activityLevel === "Eleve" ? "border-emerald-200 bg-emerald-50 text-[#16A34A] dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-300" : adminInfo.activityLevel === "Modere" ? "border-orange-200 bg-orange-50 text-[#F97316] dark:border-orange-400/20 dark:bg-orange-500/10 dark:text-orange-300" : "border-slate-200 bg-slate-50 text-[#64748B] dark:border-white/10 dark:bg-white/5 dark:text-slate-300"}>{adminInfo.activityLevel}</Badge>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/80 p-5 dark:border-white/10 dark:bg-white/5">
                  <p className="text-sm text-[#64748B] dark:text-slate-400">Permissions</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {adminInfo.permissions.map((permission) => <span key={permission} className="rounded-full border border-slate-200 bg-white/90 px-3 py-1.5 text-xs font-medium text-[#0F172A] shadow-sm dark:border-white/10 dark:bg-[#020617]/80 dark:text-slate-200">{permission}</span>)}
                  </div>
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard icon={ShieldAlert} title="Activite recente" subtitle="Connexions, actions admin et evenements de securite." action={<button type="button" onClick={handleSecurityAudit} className={`${surfaceButtonClassName} ${isAuditRunning ? "border-emerald-300 bg-emerald-50 text-[#16A34A] dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-300" : ""}`}><Shield className={`h-4 w-4 ${isAuditRunning ? "animate-pulse" : ""}`} /><span>Audit securite</span></button>}>
            <div className="space-y-4">
              {activityItems.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.id} className="rounded-[24px] border border-slate-200/80 bg-slate-50/80 p-5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg dark:border-white/10 dark:bg-white/5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-4">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-[#2D6CDF] shadow-sm dark:bg-[#020617] dark:text-sky-300"><Icon className="h-5 w-5" /></div>
                        <div>
                          <p className="font-semibold text-[#0F172A] dark:text-white">{item.title}</p>
                          <p className="mt-1 text-sm leading-6 text-[#64748B] dark:text-slate-400">{item.description}</p>
                          <p className="mt-3 text-xs uppercase tracking-[0.18em] text-[#94A3B8] dark:text-slate-500">{formatDateTime(item.timestamp)}</p>
                        </div>
                      </div>
                      <Badge className={item.badgeClassName}>{item.badgeLabel}</Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        </div>
        <SectionCard icon={AlertTriangle} title="Alertes critiques recentes" subtitle="Detection prioritaire, horodatage et resolution rapide depuis le cockpit.">
          <div className="grid gap-4 xl:grid-cols-2">
            {visibleAlerts.length > 0 ? visibleAlerts.map((alert) => (
              <div key={alert.id} className="rounded-[24px] border border-slate-200/80 bg-slate-50/80 p-5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg dark:border-white/10 dark:bg-white/5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-semibold text-[#0F172A] dark:text-white">{alert.title}</p>
                      <Badge className={alert.level === "Critique" ? "border-red-200 bg-red-50 text-[#DC2626] dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300" : "border-orange-200 bg-orange-50 text-[#F97316] dark:border-orange-400/20 dark:bg-orange-500/10 dark:text-orange-300"}>{alert.level}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-[#64748B] dark:text-slate-400">{alert.source}</p>
                    <p className="mt-3 text-sm leading-6 text-[#475569] dark:text-slate-300">{alert.description}</p>
                  </div>
                  <div className="rounded-2xl bg-white/90 px-3 py-2 text-right shadow-sm dark:bg-[#020617]/80">
                    <p className="text-xs uppercase tracking-[0.18em] text-[#94A3B8] dark:text-slate-500">Timestamp</p>
                    <p className="mt-1 text-sm font-medium text-[#0F172A] dark:text-white">{formatDateTime(alert.timestamp)}</p>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <button type="button" onClick={() => handleViewAlert(alert)} className={surfaceButtonClassName}><Eye className="h-4 w-4" /><span>Voir details</span></button>
                  <button type="button" onClick={() => handleResolveAlert(alert)} className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-[#16A34A] transition-all duration-300 hover:-translate-y-0.5 hover:bg-emerald-100 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20"><CheckCircle2 className="h-4 w-4" /><span>Resoudre</span></button>
                </div>
              </div>
            )) : (
              <div className="xl:col-span-2">
                <div className="rounded-[24px] border border-dashed border-emerald-200 bg-emerald-50/70 px-6 py-10 text-center text-sm text-[#166534] dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-200">Toutes les alertes critiques de la file ont ete resolues.</div>
              </div>
            )}
          </div>
        </SectionCard>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <SectionCard icon={Activity} title="Actions rapides intelligentes" subtitle="Actions operationnelles enrichies par l'IA avec feedback visuel immediat.">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {quickActions.map((action) => {
                const Icon = action.icon;
                const isActive = activeActionKey === action.key;
                return (
                  <button key={action.key} type="button" onClick={() => handleQuickAction(action)} className={`group rounded-[24px] bg-gradient-to-r ${action.gradientClassName} p-[1px] text-left transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl ${isActive ? "scale-[1.02] shadow-2xl" : ""}`}>
                    <div className="h-full rounded-[23px] bg-white/96 p-5 dark:bg-[#08101f]/92">
                      <div className="flex items-start justify-between gap-4">
                        <div className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${action.gradientClassName} text-white shadow-lg`}><Icon className="h-5 w-5" /></div>
                        {isActive ? <Badge className="border-emerald-200 bg-emerald-50 text-[#16A34A] dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-300">IA active</Badge> : null}
                      </div>
                      <p className="mt-5 text-lg font-semibold text-[#0F172A] dark:text-white">{action.title}</p>
                      <p className="mt-2 text-sm leading-6 text-[#64748B] dark:text-slate-400">{action.subtitle}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </SectionCard>

          <SectionCard icon={Server} title="Raccourcis supervision" subtitle="Passer directement aux modules metier relies au centre de controle.">
            <div className="space-y-4">
              {shortcuts.map((shortcut) => {
                const Icon = shortcut.icon;
                return (
                  <button key={shortcut.title} type="button" onClick={() => navigate(shortcut.path)} className={`w-full rounded-[24px] bg-gradient-to-r ${shortcut.accentClassName} p-[1px] text-left transition-all duration-300 hover:-translate-y-1 hover:shadow-xl`}>
                    <div className="flex items-center justify-between gap-4 rounded-[23px] bg-white/96 p-5 dark:bg-[#08101f]/92">
                      <div className="flex min-w-0 items-start gap-4">
                        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${shortcut.accentClassName} text-white shadow-lg`}><Icon className="h-5 w-5" /></div>
                        <div className="min-w-0">
                          <p className="font-semibold text-[#0F172A] dark:text-white">{shortcut.title}</p>
                          <p className="mt-1 text-sm leading-6 text-[#64748B] dark:text-slate-400">{shortcut.subtitle}</p>
                        </div>
                      </div>
                      <ArrowRight className="h-5 w-5 shrink-0 text-[#64748B] dark:text-slate-400" />
                    </div>
                  </button>
                );
              })}
            </div>
          </SectionCard>
        </div>
        <SectionCard icon={Activity} title="Monitoring temps reel" subtitle="Hover pour les details et zoom via la plage inferieure de chaque graphique.">
          <div className="grid gap-6 xl:grid-cols-2">
            <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/80 p-5 dark:border-white/10 dark:bg-white/5">
              <div className="mb-4 flex items-center gap-2"><Cpu className="h-5 w-5 text-[#2D6CDF]" /><h3 className="text-lg font-semibold text-[#0F172A] dark:text-white">CPU usage</h3></div>
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={cpuSeries}>
                    <CartesianGrid stroke={chartGridColor} strokeDasharray="3 3" />
                    <XAxis dataKey="label" stroke={chartTextColor} tickLine={false} axisLine={false} />
                    <YAxis stroke={chartTextColor} tickLine={false} axisLine={false} domain={[0, 100]} width={38} />
                    <RechartsTooltip contentStyle={tooltipStyle} formatter={(value: number) => [`${value.toFixed(1)}%`, "CPU"]} labelStyle={{ color: theme === "dark" ? "#E2E8F0" : "#0F172A" }} />
                    <Line type="monotone" dataKey="value" stroke="#2D6CDF" strokeWidth={3} dot={{ r: 0 }} activeDot={{ r: 5, strokeWidth: 0, fill: "#2D6CDF" }} />
                    <Brush dataKey="label" height={24} stroke="#2D6CDF" travellerWidth={10} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/80 p-5 dark:border-white/10 dark:bg-white/5">
              <div className="mb-4 flex items-center gap-2"><Activity className="h-5 w-5 text-[#8B5CF6]" /><h3 className="text-lg font-semibold text-[#0F172A] dark:text-white">RAM usage</h3></div>
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={ramSeries}>
                    <defs><linearGradient id="ramFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.38} /><stop offset="95%" stopColor="#8B5CF6" stopOpacity={0.04} /></linearGradient></defs>
                    <CartesianGrid stroke={chartGridColor} strokeDasharray="3 3" />
                    <XAxis dataKey="label" stroke={chartTextColor} tickLine={false} axisLine={false} />
                    <YAxis stroke={chartTextColor} tickLine={false} axisLine={false} domain={[0, 100]} width={38} />
                    <RechartsTooltip contentStyle={tooltipStyle} formatter={(value: number) => [`${value.toFixed(1)}%`, "RAM"]} labelStyle={{ color: theme === "dark" ? "#E2E8F0" : "#0F172A" }} />
                    <Area type="monotone" dataKey="value" stroke="#8B5CF6" fill="url(#ramFill)" strokeWidth={3} />
                    <Brush dataKey="label" height={24} stroke="#8B5CF6" travellerWidth={10} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/80 p-5 xl:col-span-2 dark:border-white/10 dark:bg-white/5">
              <div className="mb-4 flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-[#F97316]" /><h3 className="text-lg font-semibold text-[#0F172A] dark:text-white">Alertes sur 7 jours</h3></div>
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={alerts7Days}>
                    <CartesianGrid stroke={chartGridColor} strokeDasharray="3 3" />
                    <XAxis dataKey="label" stroke={chartTextColor} tickLine={false} axisLine={false} />
                    <YAxis stroke={chartTextColor} tickLine={false} axisLine={false} width={38} />
                    <RechartsTooltip contentStyle={tooltipStyle} labelStyle={{ color: theme === "dark" ? "#E2E8F0" : "#0F172A" }} />
                    <Bar dataKey="total" name="Alertes" fill="#FDBA74" radius={[10, 10, 0, 0]} />
                    <Bar dataKey="critical" name="Critiques" fill={healthPalette.chartColor} radius={[10, 10, 0, 0]} />
                    <Brush dataKey="label" height={24} stroke={healthPalette.chartColor} travellerWidth={10} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

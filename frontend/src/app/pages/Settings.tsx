import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Bell,
  Brain,
  CheckCircle2,
  Link2,
  MessageSquareMore,
  MoonStar,
  RefreshCw,
  Save,
  Settings as SettingsIcon,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  SunMedium,
  Wand2,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../components/ui/accordion";
import { Badge } from "../components/ui/badge";
import DepartmentManagementSection from "../components/settings/DepartmentManagementSection";
import { Slider } from "../components/ui/slider";
import { Switch } from "../components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { applyTheme, resolveTheme, type ThemeMode } from "../lib/theme";

type IntegrationStatus = "Connecte" | "Instable" | "Erreur";
type NotificationCadence = "Temps reel" | "Quotidienne" | "Hebdomadaire" | "Mensuelle";
type SectionTone = "primary" | "positive" | "warning" | "danger" | "ai" | "neutral";

interface SettingsState {
  companyName: string;
  currency: string;
  timezone: string;
  language: string;
  criticalThreshold: number;
  mediumThreshold: number;
  anomalyDetection: boolean;
  realtimeAlerts: boolean;
  anomalySensitivity: number;
  predictionHorizon: string;
  autoRecommendations: boolean;
  retrainFrequency: string;
  emailNotifications: boolean;
  appNotifications: boolean;
  weeklyReports: boolean;
  notificationCadence: NotificationCadence;
  twoFactor: boolean;
  sessionDuration: number;
  suspiciousActivityMonitoring: boolean;
}

interface OperatorIntegration {
  name: string;
  status: IntegrationStatus;
  latencyMs: number;
  errors24h: number;
  lastSync: string;
}

const panelClassName =
  "rounded-[26px] border border-white/70 bg-white/92 p-5 shadow-[0_20px_70px_-40px_rgba(15,23,42,0.32)] backdrop-blur-xl transition-all duration-300 dark:border-white/10 dark:bg-[#08101f]/84 dark:shadow-[0_20px_70px_-40px_rgba(2,6,23,0.94)]";
const fieldClassName =
  "w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-[#0F172A] transition-all duration-300 outline-none focus:border-[#2563EB] focus:ring-4 focus:ring-blue-100 dark:border-white/10 dark:bg-white/5 dark:text-white dark:focus:ring-blue-500/20";
const summaryItemClassName =
  "rounded-[22px] border border-slate-200/80 bg-white/90 p-3.5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md dark:border-white/10 dark:bg-white/5";

const initialSettings: SettingsState = {
  companyName: "Mon Entreprise SA",
  currency: "EUR (MAD)",
  timezone: "Europe/Paris (UTC+1)",
  language: "Francais",
  criticalThreshold: 90,
  mediumThreshold: 75,
  anomalyDetection: true,
  realtimeAlerts: true,
  anomalySensitivity: 62,
  predictionHorizon: "3 mois",
  autoRecommendations: true,
  retrainFrequency: "Hebdomadaire",
  emailNotifications: true,
  appNotifications: true,
  weeklyReports: true,
  notificationCadence: "Hebdomadaire",
  twoFactor: true,
  sessionDuration: 120,
  suspiciousActivityMonitoring: true,
};

const initialIntegrations: OperatorIntegration[] = [
  { name: "Orange", status: "Connecte", latencyMs: 118, errors24h: 0, lastSync: "Il y a 2 min" },
  { name: "SFR", status: "Connecte", latencyMs: 132, errors24h: 1, lastSync: "Il y a 5 min" },
  { name: "Bouygues Telecom", status: "Instable", latencyMs: 284, errors24h: 3, lastSync: "Il y a 12 min" },
  { name: "Free", status: "Connecte", latencyMs: 144, errors24h: 0, lastSync: "Il y a 4 min" },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatMadValue(value: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "MAD",
    maximumFractionDigits: 0,
  }).format(value);
}

function thresholdImpact(value: number) {
  if (value >= 92) return "Impact : peu d'alertes mais risque eleve non detecte.";
  if (value >= 86) return "Impact : equilibre prudent entre bruit operationnel et detection precoce.";
  return "Impact : plus d'alertes, mais meilleure anticipation des depassements critiques.";
}

function mediumThresholdImpact(value: number) {
  if (value >= 80) return "Impact : les alertes elevees remontent tard, le tri manuel augmente.";
  if (value >= 70) return "Impact : seuil adapte a une surveillance continue sans surcharge.";
  return "Impact : forte sensibilite, utile pour des flottes sous tension ou tres surveillees.";
}

function sensitivityImpact(value: number) {
  if (value >= 78) return "Impact : plus de signaux faibles detectes, avec un volume d'analyse plus eleve.";
  if (value >= 60) return "Impact : bon compromis entre precision et bruit de detection.";
  return "Impact : moins d'alertes, mais certaines anomalies complexes risquent d'etre ignorees.";
}

function sessionImpact(value: number) {
  if (value <= 90) return "Impact : securite forte et exposition reduite en cas de session oubliee.";
  if (value <= 150) return "Impact : confort utilisateur correct avec un niveau de risque maitrise.";
  return "Impact : experience souple, mais la surface d'exposition augmente en cas d'inactivite.";
}

function getToneClasses(tone: SectionTone) {
  if (tone === "primary") {
    return {
      surface: "bc-surface-primary",
      icon: "bc-icon-primary",
      badge: "border-[var(--bc-primary-border)] bg-[var(--bc-primary-soft)] text-[var(--bc-primary)]",
      text: "text-[var(--bc-primary)]",
    };
  }

  if (tone === "positive") {
    return {
      surface: "bc-surface-success",
      icon: "bc-icon-success",
      badge: "border-[var(--bc-success-border)] bg-[var(--bc-success-soft)] text-[var(--bc-success)]",
      text: "text-[var(--bc-success)]",
    };
  }

  if (tone === "warning") {
    return {
      surface: "bc-surface-warning",
      icon: "bc-icon-warning",
      badge: "border-[var(--bc-warning-border)] bg-[var(--bc-warning-soft)] text-[var(--bc-warning)]",
      text: "text-[var(--bc-warning)]",
    };
  }

  if (tone === "danger") {
    return {
      surface: "bc-surface-danger",
      icon: "bc-icon-danger",
      badge: "border-[var(--bc-danger-border)] bg-[var(--bc-danger-soft)] text-[var(--bc-danger)]",
      text: "text-[var(--bc-danger)]",
    };
  }

  if (tone === "ai") {
    return {
      surface: "bc-surface-ai",
      icon: "bc-icon-ai",
      badge: "border-[var(--bc-ai-border)] bg-[linear-gradient(135deg,rgba(99,102,241,0.14),rgba(139,92,246,0.16))] text-[var(--bc-ai-start)]",
      text: "text-[var(--bc-ai-start)]",
    };
  }

  return {
    surface: "bc-surface-neutral",
    icon: "bg-white text-[#475569] dark:bg-[#020617] dark:text-slate-200",
    badge: "border-slate-200 bg-white text-[#475569] dark:border-white/10 dark:bg-[#020617] dark:text-slate-200",
    text: "text-[#334155] dark:text-slate-200",
  };
}

function SectionCard({
  icon: Icon,
  title,
  subtitle,
  action,
  tone = "neutral",
  children,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  tone?: SectionTone;
  children: ReactNode;
}) {
  const styles = getToneClasses(tone);

  return (
    <section className={`${panelClassName} ${styles.surface}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${styles.icon}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-[#0F172A] dark:text-white">{title}</h2>
            {subtitle ? <p className="mt-1 text-sm text-[#64748B] dark:text-slate-400">{subtitle}</p> : null}
          </div>
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function ToggleRow({ title, description, checked, onCheckedChange }: { title: string; description: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[20px] border border-slate-200/70 bg-slate-50/85 p-3.5 transition-all duration-300 hover:border-slate-300 dark:border-white/10 dark:bg-white/5">
      <div>
        <p className="font-medium text-[#0F172A] dark:text-white">{title}</p>
        <p className="mt-1 text-sm text-[#64748B] dark:text-slate-400">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function SliderField({ label, value, min, max, step, onChange, helper, impact }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void; helper: string; impact: string }) {
  return (
    <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/85 p-4 dark:border-white/10 dark:bg-white/5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-medium text-[#0F172A] dark:text-white">{label}</p>
          <p className="mt-1 text-sm text-[#64748B] dark:text-slate-400">{helper}</p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-[#0F172A] shadow-sm dark:bg-[#020617] dark:text-white">{value}%</span>
      </div>
      <div className="mt-5">
        <Slider value={[value]} min={min} max={max} step={step} onValueChange={(values) => onChange(values[0] ?? value)} />
      </div>
      <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/80 px-4 py-3 text-sm text-[#1E3A8A] dark:border-blue-400/20 dark:bg-blue-500/10 dark:text-blue-200">{impact}</div>
    </div>
  );
}

export default function Settings() {
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [settings, setSettings] = useState<SettingsState>(initialSettings);
  const [savedSettings, setSavedSettings] = useState<SettingsState>(initialSettings);
  const [integrations, setIntegrations] = useState<OperatorIntegration[]>(initialIntegrations);
  const [simulationReady, setSimulationReady] = useState(false);
  const [testingOperator, setTestingOperator] = useState<string | null>(null);
  const [lastSavedSummary, setLastSavedSummary] = useState("Aucune modification recente.");

  useEffect(() => {
    setTheme(resolveTheme());
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const moduleFlags = [
    { label: "IA", active: settings.anomalyDetection && settings.autoRecommendations },
    { label: "Securite", active: settings.twoFactor && settings.suspiciousActivityMonitoring },
    { label: "Notifications", active: settings.emailNotifications || settings.appNotifications || settings.weeklyReports },
  ];

  const securityScore = useMemo(
    () =>
      clamp(
        (settings.twoFactor ? 32 : 10) +
          (settings.suspiciousActivityMonitoring ? 26 : 8) +
          (settings.sessionDuration <= 90 ? 24 : settings.sessionDuration <= 120 ? 20 : settings.sessionDuration <= 180 ? 14 : 8),
        18,
        100,
      ),
    [settings.sessionDuration, settings.suspiciousActivityMonitoring, settings.twoFactor],
  );

  const integrationAlertCount = integrations.filter((item) => item.status !== "Connecte" || item.errors24h > 0).length;
  const activeAlerts = Number(!settings.realtimeAlerts) + Number(!settings.anomalyDetection) + Number(settings.criticalThreshold >= 92) + Number(securityScore < 75) + integrationAlertCount;
  const completionChecks = [
    settings.companyName.trim().length > 2,
    settings.currency.length > 0,
    settings.timezone.length > 0,
    settings.language.length > 0,
    settings.anomalyDetection,
    settings.autoRecommendations,
    settings.realtimeAlerts,
    settings.twoFactor,
    settings.appNotifications || settings.emailNotifications,
    settings.criticalThreshold >= 84 && settings.criticalThreshold <= 90,
    settings.mediumThreshold >= 68 && settings.mediumThreshold <= 76,
    integrations.filter((item) => item.status !== "Erreur").length >= 3,
  ];
  const configCompletion = Math.round((completionChecks.filter(Boolean).length / completionChecks.length) * 100);
  const configStatus = configCompletion >= 84 && activeAlerts <= 3 && securityScore >= 78
    ? { label: "Optimise", className: "border-emerald-200 bg-emerald-50 text-[#16A34A] dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-300" }
    : configCompletion >= 68 && securityScore >= 60
      ? { label: "A ameliorer", className: "border-orange-200 bg-orange-50 text-[#F97316] dark:border-orange-400/20 dark:bg-orange-500/10 dark:text-orange-300" }
      : { label: "Risque", className: "border-red-200 bg-red-50 text-[#DC2626] dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300" };

  const recommendedCadence: NotificationCadence = activeAlerts <= 3 ? "Hebdomadaire" : activeAlerts <= 5 ? "Quotidienne" : "Temps reel";

  const simulationImpact = useMemo(() => {
    const alertsPerWeek = Math.round(8 + (100 - settings.criticalThreshold) * 0.45 + (100 - settings.mediumThreshold) * 0.28 + settings.anomalySensitivity * 0.08 + (settings.realtimeAlerts ? 3 : -1));
    const churnReduction = Number((0.9 + settings.anomalySensitivity * 0.018 + (settings.autoRecommendations ? 0.7 : 0.1) + (settings.realtimeAlerts ? 0.4 : 0) - (settings.criticalThreshold - 84) * 0.03).toFixed(1));
    const costSavings = Math.round(1200 + settings.anomalySensitivity * 22 + (100 - settings.criticalThreshold) * 42 + (settings.twoFactor ? 280 : 0) + (settings.autoRecommendations ? 700 : 0));
    return { alertsPerWeek, churnReduction: clamp(churnReduction, 0.4, 3.2), costSavings };
  }, [settings.anomalySensitivity, settings.autoRecommendations, settings.criticalThreshold, settings.mediumThreshold, settings.realtimeAlerts, settings.twoFactor]);

  const aiRecommendations = useMemo(() => {
    const items: Array<{ title: string; description: string }> = [];
    if (settings.anomalySensitivity < 70) items.push({ title: "Augmenter sensibilite anomalies", description: "Monter vers 76% pour mieux capter les signaux faibles sans saturer la file." });
    if (!settings.realtimeAlerts) items.push({ title: "Activer alertes temps reel", description: "Les incidents prioritaires seront pousses plus vite aux administrateurs." });
    if (settings.criticalThreshold > 88) items.push({ title: "Abaisser le seuil critique", description: "Passer autour de 86% reduit le risque de depassement tardif." });
    if (!settings.twoFactor) items.push({ title: "Activer la double authentification", description: "Le score securite remontera immediatement avec une exposition plus faible." });
    if (settings.notificationCadence !== recommendedCadence) items.push({ title: "Aligner la frequence de notifications", description: `${recommendedCadence} est plus adaptee au rythme actuel de la plateforme.` });
    return items.length > 0 ? items.slice(0, 4) : [{ title: "Configuration deja bien calibree", description: "Le systeme recommande surtout de maintenir la surveillance et tester les integrations instables." }];
  }, [recommendedCadence, settings.anomalySensitivity, settings.criticalThreshold, settings.notificationCadence, settings.realtimeAlerts, settings.twoFactor]);

  function updateSetting<Key extends keyof SettingsState>(key: Key, value: SettingsState[Key]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  const alertPreview = useMemo(() => {
    const usage = 88;
    const anomalyScore = Math.round(54 + settings.anomalySensitivity * 0.42 + (settings.anomalyDetection ? 8 : -6));
    const severity = usage >= settings.criticalThreshold ? "Critique" : usage >= settings.mediumThreshold ? "Elevee" : "Surveillance";
    const reason = usage >= settings.criticalThreshold
      ? "Le depassement franchit le seuil critique et doit partir en escalation."
      : usage >= settings.mediumThreshold
        ? "Le volume est eleve et justifie une verification proactive."
        : "Le forfait reste sous controle, mais l'IA maintient la ligne sous observation.";
    return { anomalyScore: clamp(anomalyScore, 22, 98), severity, reason };
  }, [settings.anomalyDetection, settings.anomalySensitivity, settings.criticalThreshold, settings.mediumThreshold]);

  function handleApplyAiRecommendations() {
    setSettings((current) => ({
      ...current,
      criticalThreshold: 86,
      mediumThreshold: 72,
      anomalySensitivity: 76,
      realtimeAlerts: true,
      autoRecommendations: true,
      notificationCadence: recommendedCadence,
      twoFactor: true,
      suspiciousActivityMonitoring: true,
      sessionDuration: Math.min(current.sessionDuration, 90),
    }));
    setSimulationReady(true);
    toast.success("Recommandations IA appliquees", {
      description: "Les seuils critiques, la sensibilite et la securite ont ete ajustes automatiquement.",
    });
  }

  function handleSimulation() {
    setSimulationReady(true);
    toast.success("Simulation de configuration prete", {
      description: `${simulationImpact.alertsPerWeek} alertes/semaine, churn a risque -${simulationImpact.churnReduction} pt, economie ${formatMadValue(simulationImpact.costSavings)}.`,
    });
  }

  function handleSave() {
    const changes: string[] = [];
    if (savedSettings.criticalThreshold !== settings.criticalThreshold) changes.push(`seuil critique ${savedSettings.criticalThreshold}% -> ${settings.criticalThreshold}%`);
    if (savedSettings.mediumThreshold !== settings.mediumThreshold) changes.push(`seuil eleve ${savedSettings.mediumThreshold}% -> ${settings.mediumThreshold}%`);
    if (savedSettings.anomalySensitivity !== settings.anomalySensitivity) changes.push(`sensibilite IA ${savedSettings.anomalySensitivity}% -> ${settings.anomalySensitivity}%`);
    if (savedSettings.notificationCadence !== settings.notificationCadence) changes.push(`notifications ${savedSettings.notificationCadence.toLowerCase()} -> ${settings.notificationCadence.toLowerCase()}`);
    if (savedSettings.sessionDuration !== settings.sessionDuration) changes.push(`session ${savedSettings.sessionDuration} min -> ${settings.sessionDuration} min`);
    if (savedSettings.twoFactor !== settings.twoFactor) changes.push(settings.twoFactor ? "2FA activee" : "2FA desactivee");

    const summary = changes.length > 0 ? changes.slice(0, 4).join(" | ") : "Preferences confirmees sans changement structurel.";
    setSavedSettings(settings);
    setLastSavedSummary(summary);
    toast.success("Parametres enregistres", {
      description: summary,
    });
  }

  function handleTestConnection(operatorName: string) {
    setTestingOperator(operatorName);
    window.setTimeout(() => {
      setIntegrations((currentItems) =>
        currentItems.map((item) => {
          if (item.name !== operatorName) return item;
          const nextLatency = clamp(item.latencyMs + (item.status === "Instable" ? -32 : 8), 96, 340);
          const nextErrors = Math.max(0, item.errors24h + (item.status === "Instable" ? -1 : 0));
          const nextStatus: IntegrationStatus = nextLatency > 300 || nextErrors >= 5 ? "Erreur" : nextLatency > 220 || nextErrors >= 2 ? "Instable" : "Connecte";
          return { ...item, latencyMs: nextLatency, errors24h: nextErrors, status: nextStatus, lastSync: "A l'instant" };
        }),
      );
      setTestingOperator(null);
      toast.success("Connexion testee", {
        description: `${operatorName} a ete verifie depuis le centre de configuration.`,
      });
    }, 650);
  }

  function handleViewLogs(operator: OperatorIntegration) {
    toast.message(`Logs ${operator.name}`, {
      description: `${operator.errors24h} erreur(s) sur 24h, latence ${operator.latencyMs} ms, derniere synchro ${operator.lastSync}.`,
    });
  }

  const configuredModuleCount = moduleFlags.filter((item) => item.active).length;
  const connectedIntegrations = integrations.filter((item) => item.status === "Connecte").length;
  const unstableIntegrations = integrations.filter((item) => item.status === "Instable").length;
  const failedIntegrations = integrations.filter((item) => item.status === "Erreur").length;
  const alertTone: SectionTone = activeAlerts >= 6 ? "danger" : activeAlerts >= 3 ? "warning" : "positive";
  const saveTone: SectionTone = lastSavedSummary === "Aucune modification recente." ? "primary" : "positive";
  const previewTone: SectionTone =
    alertPreview.severity === "Critique"
      ? "danger"
      : alertPreview.severity === "Elevee"
        ? "warning"
        : "primary";
  const summaryCards: Array<{
    title: string;
    value: string;
    helper: string;
    tone: SectionTone;
    icon: LucideIcon;
  }> = [
    {
      title: "Configuration",
      value: `${configCompletion}%`,
      helper: `${configuredModuleCount}/3 modules critiques actifs`,
      tone: "primary",
      icon: SettingsIcon,
    },
    {
      title: "Securite",
      value: `${securityScore}/100`,
      helper: settings.twoFactor ? "2FA actif et suivi renforce" : "2FA a consolider",
      tone: "positive",
      icon: ShieldCheck,
    },
    {
      title: "Alertes",
      value: String(activeAlerts),
      helper: "Seuils, securite et integrations a surveiller",
      tone: alertTone,
      icon: Bell,
    },
    {
      title: "IA",
      value: String(aiRecommendations.length),
      helper: "Recommandations immediates disponibles",
      tone: "ai",
      icon: Brain,
    },
    {
      title: "Sauvegarde",
      value: lastSavedSummary === "Aucune modification recente." ? "Prete" : "A jour",
      helper: lastSavedSummary,
      tone: saveTone,
      icon: CheckCircle2,
    },
  ];

  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,#DBEAFE_0%,#EFF6FF_35%,#F8FAFC_100%)] p-6 transition-colors dark:bg-[radial-gradient(circle_at_top_left,#14213D_0%,#020617_46%,#050B16_100%)]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-20 top-8 h-72 w-72 rounded-full bg-[#2D6CDF]/10 blur-3xl dark:bg-[#38BDF8]/10" />
        <div className="absolute right-0 top-0 h-80 w-80 rounded-full bg-[#7C3AED]/10 blur-3xl dark:bg-[#A855F7]/10" />
      </div>

      <div className="relative space-y-5">
        <section className="overflow-hidden rounded-[30px] bg-gradient-to-br from-[#0F172A] via-[#1D4ED8] to-[#7C3AED] p-6 text-white shadow-[0_35px_120px_-48px_rgba(29,78,216,0.82)]">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-4xl">
              <p className="text-xs uppercase tracking-[0.32em] text-white/65">Smart Configuration Center</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-[2.2rem]">Parametres</h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-white/80 sm:text-base">
                Une console plus compacte pour ajuster la plateforme, lire les priorites et atteindre
                les sections critiques sans scroll excessif.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-3 rounded-full border border-white/20 bg-white/10 px-4 py-2.5 backdrop-blur-md">
                <SunMedium className="h-4 w-4 text-white/80" />
                <Switch checked={theme === "dark"} onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")} className="data-[state=checked]:bg-[#0F172A] data-[state=unchecked]:bg-white/50" />
                <MoonStar className="h-4 w-4 text-white/80" />
                <span className="text-sm font-medium text-white/90">{theme === "dark" ? "Dark" : "Light"}</span>
              </div>
              <button type="button" onClick={handleSimulation} className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/15">
                <RefreshCw className="h-4 w-4" />
                <span>Simuler</span>
              </button>
              <button type="button" onClick={handleSave} className="inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-[#2563EB] transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/90">
                <Save className="h-4 w-4" />
                <span>Enregistrer</span>
              </button>
            </div>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {summaryCards.map((card) => {
              const styles = getToneClasses(card.tone);
              const Icon = card.icon;

              return (
                <article key={card.title} className="rounded-[22px] border border-white/14 bg-white/10 p-4 backdrop-blur-md">
                  <div className="flex items-start justify-between gap-3">
                    <div className={`rounded-2xl p-2.5 ${styles.icon}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <Badge className={`${styles.badge} bg-white/95`}>{card.title}</Badge>
                  </div>
                  <p className="mt-4 text-2xl font-semibold tracking-tight text-white">{card.value}</p>
                  <p className="mt-1 text-sm leading-6 text-white/75">{card.helper}</p>
                </article>
              );
            })}
          </div>
        </section>

        {simulationReady ? (
          <SectionCard tone="ai" icon={Workflow} title="Mode simulation" subtitle="Projection immediate des effets de la configuration actuelle.">
            <div className="grid gap-3 md:grid-cols-3">
              <div className={summaryItemClassName}><p className="text-sm text-[#64748B] dark:text-slate-400">Alertes/semaine</p><p className="mt-2 text-2xl font-semibold tracking-tight text-[#0F172A] dark:text-white">{simulationImpact.alertsPerWeek}</p><p className="mt-1 text-sm text-[#64748B] dark:text-slate-400">volume pertinent estime</p></div>
              <div className={summaryItemClassName}><p className="text-sm text-[#64748B] dark:text-slate-400">Impact churn</p><p className="mt-2 text-2xl font-semibold tracking-tight text-[#0F172A] dark:text-white">-{simulationImpact.churnReduction} pt</p><p className="mt-1 text-sm text-[#64748B] dark:text-slate-400">sur le churn a risque</p></div>
              <div className={summaryItemClassName}><p className="text-sm text-[#64748B] dark:text-slate-400">Impact cout</p><p className="mt-2 text-2xl font-semibold tracking-tight text-[#0F172A] dark:text-white">{formatMadValue(simulationImpact.costSavings)}</p><p className="mt-1 text-sm text-[#64748B] dark:text-slate-400">exposition evitable / mois</p></div>
            </div>
          </SectionCard>
        ) : null}

        <Tabs defaultValue="general" className="space-y-5">
          <div className="sticky top-4 z-10 rounded-[24px] border border-slate-200/80 bg-white/88 p-2 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-[#08101f]/88">
            <TabsList className="grid h-auto w-full grid-cols-2 gap-2 bg-transparent p-0 md:grid-cols-3 xl:grid-cols-6">
              <TabsTrigger value="general" className="rounded-2xl border border-transparent px-3 py-2.5 text-sm font-semibold data-[state=active]:border-[var(--bc-primary-border)] data-[state=active]:bg-[var(--bc-primary-soft)] data-[state=active]:text-[var(--bc-primary)]">General</TabsTrigger>
              <TabsTrigger value="departments" className="rounded-2xl border border-transparent px-3 py-2.5 text-sm font-semibold data-[state=active]:border-[var(--bc-primary-border)] data-[state=active]:bg-[var(--bc-primary-soft)] data-[state=active]:text-[var(--bc-primary)]">Departements</TabsTrigger>
              <TabsTrigger value="ai" className="rounded-2xl border border-transparent px-3 py-2.5 text-sm font-semibold data-[state=active]:border-[var(--bc-ai-border)] data-[state=active]:bg-[linear-gradient(135deg,rgba(99,102,241,0.14),rgba(139,92,246,0.16))] data-[state=active]:text-[var(--bc-ai-start)]">IA & reco</TabsTrigger>
              <TabsTrigger value="notifications" className="rounded-2xl border border-transparent px-3 py-2.5 text-sm font-semibold data-[state=active]:border-[var(--bc-warning-border)] data-[state=active]:bg-[var(--bc-warning-soft)] data-[state=active]:text-[var(--bc-warning)]">Notifications</TabsTrigger>
              <TabsTrigger value="security" className="rounded-2xl border border-transparent px-3 py-2.5 text-sm font-semibold data-[state=active]:border-[var(--bc-success-border)] data-[state=active]:bg-[var(--bc-success-soft)] data-[state=active]:text-[var(--bc-success)]">Securite</TabsTrigger>
              <TabsTrigger value="integrations" className="rounded-2xl border border-transparent px-3 py-2.5 text-sm font-semibold data-[state=active]:border-[var(--bc-success-border)] data-[state=active]:bg-[var(--bc-success-soft)] data-[state=active]:text-[var(--bc-success)]">Integrations</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="general" className="space-y-5">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.08fr)_320px]">
              <div className="space-y-5">
                <SectionCard tone="primary" icon={SlidersHorizontal} title="Parametres generaux" subtitle="Informations societe et contexte principal visibles immediatement.">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div><label className="mb-2 block text-sm font-medium text-[#0F172A] dark:text-white">Nom de l'entreprise</label><input type="text" value={settings.companyName} onChange={(event) => updateSetting("companyName", event.target.value)} className={fieldClassName} /></div>
                    <div><label className="mb-2 block text-sm font-medium text-[#0F172A] dark:text-white">Devise</label><select value={settings.currency} onChange={(event) => updateSetting("currency", event.target.value)} className={fieldClassName}><option>EUR (MAD)</option><option>USD ($)</option><option>GBP (GBP)</option></select></div>
                    <div><label className="mb-2 block text-sm font-medium text-[#0F172A] dark:text-white">Fuseau horaire</label><select value={settings.timezone} onChange={(event) => updateSetting("timezone", event.target.value)} className={fieldClassName}><option>Europe/Paris (UTC+1)</option><option>Africa/Casablanca (UTC+1)</option><option>Europe/London (UTC+0)</option></select></div>
                    <div><label className="mb-2 block text-sm font-medium text-[#0F172A] dark:text-white">Langue</label><select value={settings.language} onChange={(event) => updateSetting("language", event.target.value)} className={fieldClassName}><option>Francais</option><option>English</option><option>Espanol</option></select></div>
                  </div>
                </SectionCard>

                <SectionCard tone="warning" icon={Bell} title="Parametres avances" subtitle="Seuils et automatismes replies par defaut pour garder la page compacte.">
                  <Accordion type="single" collapsible className="space-y-3">
                    <AccordionItem value="advanced-alerts" className="rounded-[22px] border border-slate-200/80 bg-white/85 px-4 dark:border-white/10 dark:bg-white/5">
                      <AccordionTrigger className="py-4 hover:no-underline">
                        <div>
                          <div className="flex items-center gap-3"><Bell className="h-4 w-4 text-[#F59E0B]" /><p className="text-sm font-semibold text-[#0F172A] dark:text-white">Seuils et alertes</p></div>
                          <p className="mt-1 text-sm text-[#64748B] dark:text-slate-400">Critique, eleve, anomalies et alertes temps reel.</p>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-4 pb-1">
                          <SliderField label={`Seuil critique = ${settings.criticalThreshold}%`} value={settings.criticalThreshold} min={70} max={98} step={1} onChange={(value) => updateSetting("criticalThreshold", value)} helper="Controle le passage en escalation immediate." impact={thresholdImpact(settings.criticalThreshold)} />
                          <SliderField label={`Seuil eleve = ${settings.mediumThreshold}%`} value={settings.mediumThreshold} min={55} max={90} step={1} onChange={(value) => updateSetting("mediumThreshold", value)} helper="Definit l'entree dans la file d'analyse guidee." impact={mediumThresholdImpact(settings.mediumThreshold)} />
                          <ToggleRow title="Detection automatique des anomalies" description="L'IA detecte les comportements inhabituels." checked={settings.anomalyDetection} onCheckedChange={(checked) => updateSetting("anomalyDetection", checked)} />
                          <ToggleRow title="Alertes en temps reel" description="Escalade immediate sur les incidents prioritaires." checked={settings.realtimeAlerts} onCheckedChange={(checked) => updateSetting("realtimeAlerts", checked)} />
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </SectionCard>
              </div>

              <div className="space-y-5">
                <SectionCard tone="positive" icon={ShieldCheck} title="Statut securite" subtitle="Synthese visible en permanence pour arbitrer rapidement.">
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-[#10B981] via-[#3B82F6] to-[#6366F1]" style={{ width: `${securityScore}%` }} /></div>
                  <div className="mt-4 grid gap-3">
                    <div className={summaryItemClassName}><div className="flex items-center justify-between gap-3"><span className="text-sm text-[#64748B] dark:text-slate-400">2FA</span><span className="font-semibold text-[#0F172A] dark:text-white">{settings.twoFactor ? "Actif" : "Inactif"}</span></div></div>
                    <div className={summaryItemClassName}><div className="flex items-center justify-between gap-3"><span className="text-sm text-[#64748B] dark:text-slate-400">Duree session</span><span className="font-semibold text-[#0F172A] dark:text-white">{settings.sessionDuration} min</span></div></div>
                    <div className={summaryItemClassName}><div className="flex items-center justify-between gap-3"><span className="text-sm text-[#64748B] dark:text-slate-400">Activite suspecte</span><span className="font-semibold text-[#0F172A] dark:text-white">{settings.suspiciousActivityMonitoring ? "Surveillee" : "Partielle"}</span></div></div>
                  </div>
                </SectionCard>

                <SectionCard tone={saveTone} icon={CheckCircle2} title="Sauvegarde" subtitle="Dernier resume enregistre et niveau de stabilite courant.">
                  <div className={`rounded-[20px] border px-4 py-3 text-sm leading-6 ${getToneClasses(saveTone).badge}`}>
                    {lastSavedSummary}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge className={configStatus.className}>{configStatus.label}</Badge>
                    <Badge className={getToneClasses(alertTone).badge}>{activeAlerts} alertes actives</Badge>
                  </div>
                </SectionCard>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="departments">
            <DepartmentManagementSection
              panelClassName={panelClassName}
              fieldClassName={fieldClassName}
              compact
            />
          </TabsContent>

          <TabsContent value="ai" className="space-y-5">
            <div className="grid gap-5 xl:grid-cols-[1.08fr_0.92fr]">
              <SectionCard tone="ai" icon={Brain} title="Recommandations IA" subtitle="Actions prioritaires pour accelerer la configuration sans erreur." action={<button type="button" onClick={handleApplyAiRecommendations} className="inline-flex items-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#6366F1,#8B5CF6)] px-4 py-2.5 text-sm font-semibold text-white transition-all duration-300 hover:-translate-y-0.5 hover:opacity-95"><Wand2 className="h-4 w-4" /><span>Appliquer</span></button>}>
                <div className="grid gap-3 sm:grid-cols-2">
                  {aiRecommendations.map((item) => (
                    <div key={item.title} className="rounded-[20px] border border-[var(--bc-ai-border)] bg-white/85 p-4 dark:border-white/10 dark:bg-white/5">
                      <div className="flex items-start gap-3">
                        <div className="bc-icon-ai rounded-xl p-2"><Sparkles className="h-4 w-4" /></div>
                        <div>
                          <p className="font-medium text-[#0F172A] dark:text-white">{item.title}</p>
                          <p className="mt-1 text-sm leading-6 text-[#64748B] dark:text-slate-400">{item.description}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>

              <div className="space-y-5">
                <SectionCard tone={previewTone} icon={MessageSquareMore} title="Alerte exemple" subtitle="Apercu genere a partir des reglages courants.">
                  <div className={`rounded-[22px] border p-4 ${getToneClasses(previewTone).surface}`}>
                    <div className="flex items-center justify-between gap-4">
                      <p className="font-semibold text-[#0F172A] dark:text-white">Ligne FR-2041 - 88% du forfait</p>
                      <Badge className={getToneClasses(previewTone).badge}>{alertPreview.severity}</Badge>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-[#475569] dark:text-slate-300">{alertPreview.reason}</p>
                    <div className="mt-4 flex items-center justify-between rounded-2xl bg-white/90 px-4 py-3 text-sm shadow-sm dark:bg-[#020617]/80"><span className="text-[#64748B] dark:text-slate-400">Score IA</span><span className="font-semibold text-[#0F172A] dark:text-white">{alertPreview.anomalyScore}/100</span></div>
                  </div>
                </SectionCard>

                <SectionCard tone="ai" icon={Zap} title="Parametres des modeles IA" subtitle="Sensibilite, horizon et automatisation replies par defaut.">
                  <Accordion type="single" collapsible className="space-y-3">
                    <AccordionItem value="ai-models" className="rounded-[22px] border border-[var(--bc-ai-border)] bg-white/85 px-4 dark:border-white/10 dark:bg-white/5">
                      <AccordionTrigger className="py-4 hover:no-underline">
                        <div>
                          <div className="flex items-center gap-3"><Zap className="h-4 w-4 text-[#6366F1]" /><p className="text-sm font-semibold text-[#0F172A] dark:text-white">Parametres des modeles IA</p></div>
                          <p className="mt-1 text-sm text-[#64748B] dark:text-slate-400">Sensibilite, prediction et re-entrainement.</p>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-4 pb-1">
                          <SliderField label={`Sensibilite anomalies = ${settings.anomalySensitivity}%`} value={settings.anomalySensitivity} min={25} max={95} step={1} onChange={(value) => updateSetting("anomalySensitivity", value)} helper="Ajuste la precision et le volume des signaux remontes." impact={sensitivityImpact(settings.anomalySensitivity)} />
                          <div className="grid gap-4 md:grid-cols-2">
                            <div><label className="mb-2 block text-sm font-medium text-[#0F172A] dark:text-white">Horizon de prediction</label><select value={settings.predictionHorizon} onChange={(event) => updateSetting("predictionHorizon", event.target.value)} className={fieldClassName}><option>1 mois</option><option>3 mois</option><option>6 mois</option><option>12 mois</option></select></div>
                            <div><label className="mb-2 block text-sm font-medium text-[#0F172A] dark:text-white">Frequence de re-entrainement</label><select value={settings.retrainFrequency} onChange={(event) => updateSetting("retrainFrequency", event.target.value)} className={fieldClassName}><option>Quotidien</option><option>Hebdomadaire</option><option>Mensuel</option></select></div>
                          </div>
                          <ToggleRow title="Recommandations automatiques" description="L'IA propose des optimisations apres analyse." checked={settings.autoRecommendations} onCheckedChange={(checked) => updateSetting("autoRecommendations", checked)} />
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </SectionCard>
              </div>
            </div>

            <SectionCard tone="ai" icon={Workflow} title="Bloc intelligent" subtitle={`Cadence recommandee : ${recommendedCadence.toLowerCase()}.`}>
              <Accordion type="single" collapsible className="space-y-3">
                <AccordionItem value="smart-block" className="rounded-[22px] border border-[var(--bc-ai-border)] bg-white/85 px-4 dark:border-white/10 dark:bg-white/5">
                  <AccordionTrigger className="py-4 hover:no-underline">
                    <div>
                      <div className="flex items-center gap-3"><Brain className="h-4 w-4 text-[#6366F1]" /><p className="text-sm font-semibold text-[#0F172A] dark:text-white">Bloc intelligent</p></div>
                      <p className="mt-1 text-sm text-[#64748B] dark:text-slate-400">Simulation, cadence recommandee et moteurs actifs.</p>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="grid gap-3 md:grid-cols-3 pb-1">
                      <div className={summaryItemClassName}><p className="text-sm text-[#64748B] dark:text-slate-400">Cadence IA</p><p className="mt-2 text-lg font-semibold text-[#0F172A] dark:text-white">{recommendedCadence}</p></div>
                      <div className={summaryItemClassName}><p className="text-sm text-[#64748B] dark:text-slate-400">Modules IA actifs</p><p className="mt-2 text-lg font-semibold text-[#0F172A] dark:text-white">{configuredModuleCount}/3</p></div>
                      <div className={summaryItemClassName}><p className="text-sm text-[#64748B] dark:text-slate-400">Simulation</p><p className="mt-2 text-lg font-semibold text-[#0F172A] dark:text-white">{simulationReady ? "Prete" : "A lancer"}</p></div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </SectionCard>
          </TabsContent>

          <TabsContent value="notifications" className="space-y-5">
            <SectionCard tone="warning" icon={Bell} title="Alertes et notifications" subtitle="Les canaux essentiels restent visibles, le detail avance est replie.">
              <div className="grid gap-4 lg:grid-cols-2">
                <ToggleRow title="Notifications par email" description="Envoyer les syntheses et escalades majeures." checked={settings.emailNotifications} onCheckedChange={(checked) => updateSetting("emailNotifications", checked)} />
                <ToggleRow title="Notifications dans l'application" description="Monter les evenements prioritaires directement dans l'interface." checked={settings.appNotifications} onCheckedChange={(checked) => updateSetting("appNotifications", checked)} />
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
                <ToggleRow title="Rapports automatiques" description="Programmer une revue recurrente sans intervention manuelle." checked={settings.weeklyReports} onCheckedChange={(checked) => updateSetting("weeklyReports", checked)} />
                <div><label className="mb-2 block text-sm font-medium text-[#0F172A] dark:text-white">Cadence</label><select value={settings.notificationCadence} onChange={(event) => updateSetting("notificationCadence", event.target.value as NotificationCadence)} className={fieldClassName}><option>Temps reel</option><option>Quotidienne</option><option>Hebdomadaire</option><option>Mensuelle</option></select></div>
              </div>
            </SectionCard>

            <SectionCard tone="warning" icon={MessageSquareMore} title="Notifications avancees" subtitle="Preferences detaillees repliees par defaut.">
              <Accordion type="single" collapsible className="space-y-3">
                <AccordionItem value="advanced-notifications" className="rounded-[22px] border border-[var(--bc-warning-border)] bg-white/85 px-4 dark:border-white/10 dark:bg-white/5">
                  <AccordionTrigger className="py-4 hover:no-underline">
                    <div>
                      <div className="flex items-center gap-3"><MessageSquareMore className="h-4 w-4 text-[#F59E0B]" /><p className="text-sm font-semibold text-[#0F172A] dark:text-white">Notifications avancees</p></div>
                      <p className="mt-1 text-sm text-[#64748B] dark:text-slate-400">Rythme recommande et alertes immediates.</p>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-4 pb-1">
                      <ToggleRow title="Alertes en temps reel" description="Escalade instantanee sur les incidents prioritaires." checked={settings.realtimeAlerts} onCheckedChange={(checked) => updateSetting("realtimeAlerts", checked)} />
                      <div className="rounded-[20px] border border-[var(--bc-warning-border)] bg-[var(--bc-warning-soft)] px-4 py-3 text-sm text-[var(--bc-warning)]">
                        Frequence recommandee par l'IA : {recommendedCadence.toLowerCase()} pour votre niveau de charge actuel.
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </SectionCard>
          </TabsContent>

          <TabsContent value="security" className="space-y-5">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
              <SectionCard tone="positive" icon={ShieldCheck} title={`Score securite : ${securityScore}/100`} subtitle="Calcul base sur le 2FA, la duree de session et l'activite suspecte.">
                <div className="h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-[#10B981] via-[#3B82F6] to-[#6366F1]" style={{ width: `${securityScore}%` }} /></div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className={summaryItemClassName}><p className="text-sm text-[#64748B] dark:text-slate-400">2FA</p><p className="mt-2 text-lg font-semibold text-[#0F172A] dark:text-white">{settings.twoFactor ? "Actif" : "Inactif"}</p></div>
                  <div className={summaryItemClassName}><p className="text-sm text-[#64748B] dark:text-slate-400">Session</p><p className="mt-2 text-lg font-semibold text-[#0F172A] dark:text-white">{settings.sessionDuration} min</p></div>
                  <div className={summaryItemClassName}><p className="text-sm text-[#64748B] dark:text-slate-400">Surveillance</p><p className="mt-2 text-lg font-semibold text-[#0F172A] dark:text-white">{settings.suspiciousActivityMonitoring ? "Renforcee" : "Partielle"}</p></div>
                </div>
              </SectionCard>

              <SectionCard tone={saveTone} icon={CheckCircle2} title="Historique court" subtitle="Resume recent et statut des enregistrements.">
                <div className={`rounded-[20px] border px-4 py-3 text-sm leading-6 ${getToneClasses(saveTone).badge}`}>
                  {lastSavedSummary}
                </div>
              </SectionCard>
            </div>

            <SectionCard tone="danger" icon={Shield} title="Securite renforcee" subtitle="Controles avances replies par defaut.">
              <Accordion type="single" collapsible className="space-y-3">
                <AccordionItem value="advanced-security" className="rounded-[22px] border border-[var(--bc-danger-border)] bg-white/85 px-4 dark:border-white/10 dark:bg-white/5">
                  <AccordionTrigger className="py-4 hover:no-underline">
                    <div>
                      <div className="flex items-center gap-3"><Shield className="h-4 w-4 text-[#EF4444]" /><p className="text-sm font-semibold text-[#0F172A] dark:text-white">Securite renforcee</p></div>
                      <p className="mt-1 text-sm text-[#64748B] dark:text-slate-400">Controles d'acces et reduction du risque de session.</p>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-4 pb-1">
                      <ToggleRow title="Authentification a deux facteurs" description="Renforcer l'acces administrateur sur toute la plateforme." checked={settings.twoFactor} onCheckedChange={(checked) => updateSetting("twoFactor", checked)} />
                      <ToggleRow title="Surveillance de l'activite suspecte" description="Bloquer et journaliser les comportements inhabituels." checked={settings.suspiciousActivityMonitoring} onCheckedChange={(checked) => updateSetting("suspiciousActivityMonitoring", checked)} />
                      <SliderField label={`Duree de session = ${settings.sessionDuration} min`} value={settings.sessionDuration} min={30} max={240} step={15} onChange={(value) => updateSetting("sessionDuration", value)} helper="Controle la fenetre d'exposition en cas de poste laisse ouvert." impact={sessionImpact(settings.sessionDuration)} />
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </SectionCard>
          </TabsContent>

          <TabsContent value="integrations" className="space-y-5">
            <SectionCard tone="positive" icon={Link2} title="Integrations operateurs" subtitle="Connecteurs replies par defaut avec diagnostic a la demande.">
              <div className="mb-4 flex flex-wrap gap-2">
                <Badge className={getToneClasses("positive").badge}>{connectedIntegrations} connecte(s)</Badge>
                <Badge className={getToneClasses("warning").badge}>{unstableIntegrations} instable(s)</Badge>
                <Badge className={getToneClasses("danger").badge}>{failedIntegrations} en erreur</Badge>
              </div>
              <Accordion type="single" collapsible className="space-y-3">
                <AccordionItem value="operator-integrations" className="rounded-[22px] border border-[var(--bc-success-border)] bg-white/85 px-4 dark:border-white/10 dark:bg-white/5">
                  <AccordionTrigger className="py-4 hover:no-underline">
                    <div>
                      <div className="flex items-center gap-3"><Link2 className="h-4 w-4 text-[#10B981]" /><p className="text-sm font-semibold text-[#0F172A] dark:text-white">Integrations operateurs</p></div>
                      <p className="mt-1 text-sm text-[#64748B] dark:text-slate-400">Latence, erreurs et outils de diagnostic rapides.</p>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="grid gap-4 pb-1">
                      {integrations.map((operator) => {
                        const statusTone: SectionTone = operator.status === "Connecte" ? "positive" : operator.status === "Instable" ? "warning" : "danger";
                        return (
                          <div key={operator.name} className={`rounded-[22px] border p-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md ${getToneClasses(statusTone).surface}`}>
                            <div className="flex items-start justify-between gap-4">
                              <div><p className="font-semibold text-[#0F172A] dark:text-white">{operator.name}</p><p className="mt-1 text-sm text-[#64748B] dark:text-slate-400">Statut API, latence et erreurs de synchro.</p></div>
                              <Badge className={getToneClasses(statusTone).badge}>{operator.status}</Badge>
                            </div>
                            <div className="mt-4 grid gap-3 sm:grid-cols-3">
                              <div className="rounded-2xl bg-white/90 p-3 text-center shadow-sm dark:bg-[#020617]/80"><p className="text-xs uppercase tracking-[0.16em] text-[#94A3B8] dark:text-slate-500">Latence</p><p className="mt-2 font-semibold text-[#0F172A] dark:text-white">{operator.latencyMs} ms</p></div>
                              <div className="rounded-2xl bg-white/90 p-3 text-center shadow-sm dark:bg-[#020617]/80"><p className="text-xs uppercase tracking-[0.16em] text-[#94A3B8] dark:text-slate-500">Erreurs</p><p className="mt-2 font-semibold text-[#0F172A] dark:text-white">{operator.errors24h}</p></div>
                              <div className="rounded-2xl bg-white/90 p-3 text-center shadow-sm dark:bg-[#020617]/80"><p className="text-xs uppercase tracking-[0.16em] text-[#94A3B8] dark:text-slate-500">Derniere sync</p><p className="mt-2 font-semibold text-[#0F172A] dark:text-white">{operator.lastSync}</p></div>
                            </div>
                            <div className="mt-4 flex flex-wrap gap-3">
                              <button type="button" onClick={() => handleTestConnection(operator.name)} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-[#0F172A] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md dark:border-white/10 dark:bg-[#020617] dark:text-white">
                                <RefreshCw className={`h-4 w-4 ${testingOperator === operator.name ? "animate-spin" : ""}`} />
                                <span>{testingOperator === operator.name ? "Test en cours" : "Tester connexion"}</span>
                              </button>
                              <button type="button" onClick={() => handleViewLogs(operator)} className="inline-flex items-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-medium text-[#2563EB] transition-all duration-300 hover:-translate-y-0.5 hover:bg-blue-100 dark:border-blue-400/20 dark:bg-blue-500/10 dark:text-blue-200">
                                <SettingsIcon className="h-4 w-4" />
                                <span>Voir logs</span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </SectionCard>

            <SectionCard tone={saveTone} icon={Save} title="Historique / sauvegarde" subtitle="Resume detaille des changements, replie par defaut.">
              <Accordion type="single" collapsible className="space-y-3">
                <AccordionItem value="save-history" className="rounded-[22px] border border-slate-200/80 bg-white/85 px-4 dark:border-white/10 dark:bg-white/5">
                  <AccordionTrigger className="py-4 hover:no-underline">
                    <div>
                      <div className="flex items-center gap-3"><Save className="h-4 w-4 text-[#10B981]" /><p className="text-sm font-semibold text-[#0F172A] dark:text-white">Historique / sauvegarde</p></div>
                      <p className="mt-1 text-sm text-[#64748B] dark:text-slate-400">Trace courte des derniers arbitrages appliques.</p>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-3 pb-1">
                      <div className={`rounded-[20px] border px-4 py-3 text-sm leading-6 ${getToneClasses(saveTone).badge}`}>
                        {lastSavedSummary}
                      </div>
                      <div className="grid gap-3 md:grid-cols-3">
                        <div className={summaryItemClassName}><p className="text-sm text-[#64748B] dark:text-slate-400">Statut</p><p className="mt-2 text-lg font-semibold text-[#0F172A] dark:text-white">{configStatus.label}</p></div>
                        <div className={summaryItemClassName}><p className="text-sm text-[#64748B] dark:text-slate-400">Alertes</p><p className="mt-2 text-lg font-semibold text-[#0F172A] dark:text-white">{activeAlerts}</p></div>
                        <div className={summaryItemClassName}><p className="text-sm text-[#64748B] dark:text-slate-400">Integrations OK</p><p className="mt-2 text-lg font-semibold text-[#0F172A] dark:text-white">{connectedIntegrations}/{integrations.length}</p></div>
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </SectionCard>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

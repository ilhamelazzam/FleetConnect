import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  Smartphone,
  BarChart3,
  AlertTriangle,
  Lightbulb,
  Monitor,
  FileText,
  Upload,
  Bot,
  MapPin,
  Zap,
  Camera,
  Star,
  ArrowRight,
  CheckCircle,
  TrendingDown,
  Activity,
  Bell,
  Clock,
  ChevronDown,
  Menu,
  X,
  Wifi,
  Building2,
  Users,
  Calculator,
  Shield,
  Globe,
} from "lucide-react";

const colors = {
  primary: "#2563EB",
  primaryDark: "#1D4ED8",
  ink: "#0F172A",
  slate: "#475569",
  muted: "#64748B",
  border: "#E2E8F0",
  surface: "#F8FAFC",
  surfaceAlt: "#EFF6FF",
  dark: "#0F172A",
  darkAlt: "#1E293B",
  success: "#059669",
  warning: "#D97706",
  danger: "#DC2626",
  violet: "#7C3AED",
  cyan: "#0891B2",
};

// ─── Hook: Intersection Observer for scroll animations ───
function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setInView(true); obs.disconnect(); } },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, inView };
}

// ─── Animated counter ───
function AnimatedCounter({ target, suffix = "" }: { target: number; suffix?: string }) {
  const [count, setCount] = useState(0);
  const { ref, inView } = useInView();
  useEffect(() => {
    if (!inView) return;
    let start = 0;
    const duration = 1800;
    const step = 16;
    const increment = target / (duration / step);
    const timer = setInterval(() => {
      start += increment;
      if (start >= target) { setCount(target); clearInterval(timer); }
      else setCount(Math.floor(start));
    }, step);
    return () => clearInterval(timer);
  }, [inView, target]);
  return <span ref={ref}>{count}{suffix}</span>;
}

export default function LandingPage() {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollTo = (id: string) => {
    setMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* ── HEADER ── */}
      <header
        className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
        style={{
          background: scrolled ? "rgba(255,255,255,0.95)" : "transparent",
          backdropFilter: scrolled ? "blur(20px)" : "none",
          boxShadow: scrolled ? "0 1px 24px rgba(37,99,235,0.08)" : "none",
          borderBottom: scrolled ? "1px solid rgba(37,99,235,0.08)" : "none",
        }}
      >
        <div className="max-w-7xl mx-auto px-6 lg:px-8 flex items-center justify-between h-18" style={{ height: 72 }}>
          {/* Logo */}
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primaryDark} 100%)` }}>
              <Wifi className="w-5 h-5 text-white" />
            </div>
            <span style={{ fontSize: 20, fontWeight: 700, color: colors.ink, letterSpacing: "-0.02em" }}>
              FleetConnect <span style={{ color: colors.primary }}>IA</span>
            </span>
          </div>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-8">
            {[
              { label: "Fonctionnalités", id: "fonctionnalites" },
              { label: "Comment ça marche", id: "comment" },
              { label: "Modules IA", id: "modules" },
              { label: "Pour qui", id: "pourqui" },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => scrollTo(item.id)}
                className="transition-colors duration-200 hover:text-blue-600"
                style={{ fontSize: 15, fontWeight: 500, color: colors.slate, background: "none", border: "none", cursor: "pointer" }}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* CTA buttons */}
          <div className="hidden md:flex items-center gap-3">
            <button
              onClick={() => navigate("/login")}
              className="transition-all duration-200 hover:bg-gray-100"
              style={{ fontSize: 15, fontWeight: 500, color: colors.slate, background: "none", border: "none", cursor: "pointer", padding: "8px 16px", borderRadius: 10 }}
            >
              Connexion
            </button>
            <button
              onClick={() => navigate("/choose-profile")}
              className="transition-all duration-200 hover:opacity-90 hover:scale-[1.02] active:scale-[0.98]"
              style={{
                fontSize: 15, fontWeight: 600, color: "#fff", cursor: "pointer",
                padding: "10px 22px", borderRadius: 10, border: "none",
                background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primaryDark} 100%)`,
                boxShadow: "0 4px 14px rgba(37,99,235,0.35)",
              }}
            >
              Commencer
            </button>
          </div>

          {/* Mobile hamburger */}
          <button
            className="md:hidden p-2"
            onClick={() => setMenuOpen(!menuOpen)}
            style={{ background: "none", border: "none", cursor: "pointer", color: colors.slate }}
          >
            {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="md:hidden bg-white border-t border-gray-100 px-6 py-4 flex flex-col gap-4" style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.08)" }}>
            {[
              { label: "Fonctionnalités", id: "fonctionnalites" },
              { label: "Comment ça marche", id: "comment" },
              { label: "Modules IA", id: "modules" },
              { label: "Pour qui", id: "pourqui" },
            ].map((item) => (
              <button key={item.id} onClick={() => scrollTo(item.id)} style={{ textAlign: "left", background: "none", border: "none", cursor: "pointer", fontSize: 16, fontWeight: 500, color: colors.slate, padding: "6px 0" }}>
                {item.label}
              </button>
            ))}
            <div className="flex flex-col gap-2 pt-2 border-t border-gray-100">
              <button onClick={() => navigate("/login")} style={{ background: colors.surface, border: "none", cursor: "pointer", fontSize: 15, fontWeight: 500, color: colors.slate, padding: "12px", borderRadius: 10, textAlign: "center" }}>
                Connexion
              </button>
              <button onClick={() => navigate("/choose-profile")} style={{ background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primaryDark} 100%)`, border: "none", cursor: "pointer", fontSize: 15, fontWeight: 600, color: "#fff", padding: "12px", borderRadius: 10, textAlign: "center" }}>
                Commencer
              </button>
            </div>
          </div>
        )}
      </header>

      {/* ── HERO ── */}
      <section style={{ paddingTop: 140, paddingBottom: 100, background: `linear-gradient(160deg, ${colors.surfaceAlt} 0%, #ffffff 52%, ${colors.surface} 100%)`, position: "relative", overflow: "hidden" }}>
        {/* Background decorative blobs */}
        <div style={{ position: "absolute", top: -120, right: -120, width: 600, height: 600, borderRadius: "50%", background: "radial-gradient(circle, rgba(37,99,235,0.08) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: -80, left: -80, width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(37,99,235,0.05) 0%, transparent 70%)", pointerEvents: "none" }} />

        <div className="max-w-7xl mx-auto px-6 lg:px-8 text-center" style={{ position: "relative", zIndex: 1 }}>
          {/* Badge */}
          <div className="inline-flex items-center gap-2 mb-8" style={{
            background: "rgba(37,99,235,0.08)", borderRadius: 100, padding: "8px 18px",
            border: "1px solid rgba(37,99,235,0.15)"
          }}>
            <Zap className="w-4 h-4" style={{ color: colors.primary }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: colors.primary, letterSpacing: "0.02em" }}>
              Intelligence Artificielle · Gestion Télécom
            </span>
          </div>

          {/* Headline */}
          <h1 style={{
            fontSize: "clamp(36px, 5.5vw, 64px)", fontWeight: 800, color: colors.ink,
            lineHeight: 1.1, letterSpacing: "-0.03em", marginBottom: 24, maxWidth: 820, margin: "0 auto 24px"
          }}>
            Optimisez votre flotte téléphonique{" "}
            <span style={{ color: colors.primary, display: "inline" }}>avant qu'elle ne devienne coûteuse</span>
          </h1>

          {/* Subtitle */}
          <p style={{
            fontSize: "clamp(16px, 2vw, 20px)", color: "#64748b", lineHeight: 1.65,
            maxWidth: 680, margin: "0 auto 48px", fontWeight: 400
          }}>
            FleetConnect IA analyse vos lignes, forfaits, consommations, anomalies roaming et équipements pour réduire les coûts, détecter les risques et améliorer la gestion télécom en temps réel.
          </p>

          {/* CTA buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={() => navigate("/choose-profile")}
              className="transition-all duration-200 hover:opacity-90 hover:scale-[1.03] active:scale-[0.98]"
              style={{
                fontSize: 17, fontWeight: 700, color: "#fff", cursor: "pointer",
                padding: "16px 36px", borderRadius: 14, border: "none",
                background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primaryDark} 100%)`,
                boxShadow: "0 8px 30px rgba(37,99,235,0.4)",
                display: "flex", alignItems: "center", gap: 8
              }}
            >
              Commencer gratuitement <ArrowRight className="w-5 h-5" />
            </button>
            <button
              onClick={() => scrollTo("fonctionnalites")}
              className="transition-all duration-200 hover:bg-blue-50 hover:border-blue-200"
              style={{
                fontSize: 17, fontWeight: 600, color: colors.slate, cursor: "pointer",
                padding: "16px 36px", borderRadius: 14,
                background: "rgba(255,255,255,0.92)", border: `2px solid ${colors.border}`,
                display: "flex", alignItems: "center", gap: 8
              }}
            >
              Voir les fonctionnalités <ChevronDown className="w-5 h-5" />
            </button>
          </div>

          {/* Hero visual mock */}
          <div className="mt-20 relative" style={{ maxWidth: 900, margin: "80px auto 0" }}>
            <div style={{
              background: `linear-gradient(135deg, ${colors.dark} 0%, ${colors.darkAlt} 50%, ${colors.primary} 100%)`,
              borderRadius: 24, padding: "3px",
              boxShadow: "0 40px 100px rgba(37,99,235,0.3), 0 0 0 1px rgba(37,99,235,0.1)"
            }}>
              <div style={{ background: colors.dark, borderRadius: 21, padding: "20px 20px 0", overflow: "hidden" }}>
                {/* Fake browser bar */}
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-3 h-3 rounded-full" style={{ background: colors.danger }} />
                  <div className="w-3 h-3 rounded-full" style={{ background: colors.warning }} />
                  <div className="w-3 h-3 rounded-full" style={{ background: "#22c55e" }} />
                  <div className="flex-1 mx-4 h-6 rounded-md" style={{ background: "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", paddingLeft: 10 }}>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>fleetconnect.ma/dashboard</span>
                  </div>
                </div>
                {/* Dashboard mockup content */}
                <div style={{ background: colors.dark, borderRadius: "12px 12px 0 0", padding: 24, minHeight: 280 }}>
                  <div className="grid grid-cols-4 gap-4 mb-6">
                    {[
                      { label: "Lignes actives", value: "248", color: colors.primary, icon: "📱" },
                      { label: "Coût mensuel", value: "42,800 MAD", color: colors.success, icon: "💰" },
                      { label: "Anomalies", value: "7", color: colors.warning, icon: "⚠️" },
                      { label: "Économies IA", value: "-18%", color: colors.violet, icon: "🎯" },
                    ].map((kpi) => (
                      <div key={kpi.label} style={{ background: "rgba(255,255,255,0.05)", borderRadius: 12, padding: "12px 14px", border: "1px solid rgba(255,255,255,0.08)" }}>
                        <div style={{ fontSize: 18, marginBottom: 4 }}>{kpi.icon}</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: kpi.color }}>{kpi.value}</div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>{kpi.label}</div>
                      </div>
                    ))}
                  </div>
                  {/* Mini chart bars */}
                  <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "14px 16px", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 12 }}>Consommation · 6 derniers mois</div>
                    <div className="flex items-end gap-2" style={{ height: 60 }}>
                      {[40, 65, 55, 80, 60, 75].map((h, i) => (
                        <div key={i} className="flex-1 rounded-t-sm transition-all" style={{ height: `${h}%`, background: i === 5 ? colors.primary : "rgba(37,99,235,0.3)" }} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── KPI CARDS ── */}
      <section style={{ background: "#fff", padding: "80px 0" }}>
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { icon: <TrendingDown className="w-6 h-6" />, value: 30, suffix: "%", label: "Réduction des coûts", sub: "en moyenne sur 12 mois", color: colors.primary },
              { icon: <Activity className="w-6 h-6" />, value: 0, rawValue: "Temps réel", suffix: "", label: "Analyse continue", sub: "des consommations", color: colors.success },
              { icon: <Bell className="w-6 h-6" />, value: 0, rawValue: "Intelligentes", suffix: "", label: "Alertes proactives", sub: "avant dépassement", color: colors.warning },
              { icon: <Clock className="w-6 h-6" />, value: 0, rawValue: "24/7", suffix: "", label: "Suivi automatique", sub: "de toutes vos lignes", color: colors.violet },
            ].map((kpi, i) => (
              <KPICard key={i} kpi={kpi} />
            ))}
          </div>
        </div>
      </section>

      {/* ── FONCTIONNALITÉS ── */}
      <section id="fonctionnalites" style={{ background: colors.surface, padding: "100px 0" }}>
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <SectionHeader
            badge="Fonctionnalités"
            title="Tout ce dont vous avez besoin pour maîtriser votre flotte"
            subtitle="Une plateforme complète pour gérer, analyser et optimiser l'ensemble de vos lignes téléphoniques d'entreprise."
          />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-16">
            {[
              { icon: <Smartphone className="w-6 h-6" />, title: "Gestion des lignes téléphoniques", desc: "Centralisez l'ensemble de vos lignes professionnelles. Visualisez statuts, titulaires, opérateurs et historiques en un seul endroit.", color: colors.primary },
              { icon: <BarChart3 className="w-6 h-6" />, title: "Suivi des forfaits et consommations", desc: "Suivez vos forfaits en temps réel. Comparez les consommations, détectez les dépassements et optimisez vos abonnements.", color: colors.success },
              { icon: <AlertTriangle className="w-6 h-6" />, title: "Détection des anomalies roaming", desc: "Identifiez automatiquement les surcoûts liés au roaming international avant qu'ils n'impactent votre budget.", color: colors.warning },
              { icon: <Lightbulb className="w-6 h-6" />, title: "Recommandations IA d'optimisation", desc: "Notre IA analyse vos usages et propose des optimisations personnalisées pour réduire vos dépenses télécom.", color: colors.violet },
              { icon: <Monitor className="w-6 h-6" />, title: "Analyse des équipements télécom", desc: "Inventoriez et suivez l'état de vos équipements. Anticipez les renouvellements et gérez les attributions.", color: colors.danger },
              { icon: <FileText className="w-6 h-6" />, title: "Rapports et tableaux de bord", desc: "Générez des rapports détaillés (CSV, Excel, PDF) et visualisez vos données via des tableaux de bord interactifs.", color: colors.cyan },
            ].map((feat, i) => (
              <FeatureCard key={i} feat={feat} index={i} />
            ))}
          </div>
        </div>
      </section>

      {/* ── COMMENT ÇA MARCHE ── */}
      <section id="comment" style={{ background: "#fff", padding: "100px 0" }}>
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <SectionHeader
            badge="Comment ça marche"
            title="Opérationnel en 3 étapes simples"
            subtitle="Démarrez votre optimisation télécom en quelques minutes, sans installation complexe."
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-16 relative">
            {/* Connector line (desktop) */}
            <div className="hidden md:block absolute top-16 left-1/6 right-1/6 h-px" style={{ background: "linear-gradient(90deg, rgba(37,99,235,0) 0%, rgba(37,99,235,0.3) 50%, rgba(37,99,235,0) 100%)" }} />
            {[
              { num: "01", icon: <Upload className="w-8 h-8" />, title: "Importez vos données", desc: "Importez vos fichiers de facturation (CSV, Excel) ou connectez-vous directement à votre opérateur. FleetConnect IA structure et analyse automatiquement vos données.", color: colors.primary },
              { num: "02", icon: <Bot className="w-8 h-8" />, title: "L'IA analyse la flotte", desc: "Nos algorithmes d'intelligence artificielle analysent chaque ligne, détectent les anomalies, calculent les surcoûts et identifient les opportunités d'économies.", color: colors.success },
              { num: "03", icon: <CheckCircle className="w-8 h-8" />, title: "Optimisez vos lignes et forfaits", desc: "Appliquez les recommandations personnalisées, ajustez vos forfaits, résiliez les lignes inutilisées et mesurez les économies réalisées en temps réel.", color: colors.violet },
            ].map((step, i) => (
              <StepCard key={i} step={step} index={i} />
            ))}
          </div>
        </div>
      </section>

      {/* ── MODULES IA ── */}
      <section id="modules" style={{ background: `linear-gradient(160deg, ${colors.dark} 0%, ${colors.darkAlt} 100%)`, padding: "100px 0", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle at 20% 50%, rgba(37,99,235,0.15) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(124,58,237,0.1) 0%, transparent 50%)", pointerEvents: "none" }} />
        <div className="max-w-7xl mx-auto px-6 lg:px-8" style={{ position: "relative", zIndex: 1 }}>
          <SectionHeader
            badge="Modules IA"
            title="L'intelligence artificielle au service de votre télécom"
            subtitle="Des modules avancés pour automatiser l'analyse et maximiser vos économies."
            dark
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-16">
            {[
              { icon: <Upload className="w-6 h-6" />, title: "Analyse CSV", desc: "Import et parsing intelligent de vos fichiers de facturation. Normalisation automatique des données multi-opérateurs.", color: colors.primary },
              { icon: <Bot className="w-6 h-6" />, title: "Chatbot IA métier", desc: "Posez vos questions en langage naturel. L'assistant IA répond avec des analyses précises de votre flotte.", color: colors.success },
              { icon: <MapPin className="w-6 h-6" />, title: "Cartographie roaming", desc: "Visualisez l'utilisation internationale de vos lignes et identifiez les zones de surcoût roaming.", color: colors.warning },
              { icon: <Zap className="w-6 h-6" />, title: "Détection d'anomalies", desc: "Algorithmes ML pour détecter automatiquement les comportements suspects, dépassements et fraudes.", color: colors.violet },
              { icon: <Camera className="w-6 h-6" />, title: "Photos d'équipements", desc: "Inventaire photographique de vos équipements télécom. Suivi des états et attributions par utilisateur.", color: colors.danger },
              { icon: <Star className="w-6 h-6" />, title: "Recommandations automatiques", desc: "Moteur de recommandations personnalisé qui propose les meilleures actions pour réduire vos coûts télécom.", color: colors.cyan },
            ].map((mod, i) => (
              <AIModuleCard key={i} mod={mod} index={i} />
            ))}
          </div>
        </div>
      </section>

      {/* ── POUR QUI ── */}
      <section id="pourqui" style={{ background: colors.surface, padding: "100px 0" }}>
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <SectionHeader
            badge="Pour qui ?"
            title="Conçu pour les équipes qui gèrent la télécom"
            subtitle="Que vous soyez responsable télécom, DSI ou contrôleur de gestion, FleetConnect IA s'adapte à votre rôle."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mt-16">
            {[
              { icon: <Wifi className="w-8 h-8" />, title: "Responsables télécom", desc: "Pilotez votre flotte complète, gérez les demandes, suivez les contrats et optimisez en continu.", color: colors.primary },
              { icon: <Shield className="w-8 h-8" />, title: "Managers IT", desc: "Centralisez la gestion des équipements, sécurisez les accès et supervisez l'infrastructure télécom.", color: colors.success },
              { icon: <Building2 className="w-8 h-8" />, title: "Entreprises multi-sites", desc: "Gérez plusieurs sites depuis une plateforme unique. Benchmarkez et harmonisez les forfaits par site.", color: colors.violet },
              { icon: <Calculator className="w-8 h-8" />, title: "Finance & contrôle de gestion", desc: "Obtenez des rapports précis pour la comptabilité analytique, le budget et le suivi des économies.", color: colors.warning },
            ].map((persona, i) => (
              <PersonaCard key={i} persona={persona} index={i} />
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA FINAL ── */}
      <section style={{ background: "#fff", padding: "100px 0" }}>
        <div className="max-w-4xl mx-auto px-6 lg:px-8 text-center">
          <CTASection onNavigate={() => navigate("/choose-profile")} onScrollLogin={() => navigate("/login")} />
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ background: colors.dark, padding: "60px 0 32px" }}>
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-10 pb-10 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
            <div className="md:col-span-2">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primaryDark} 100%)` }}>
                  <Wifi className="w-5 h-5 text-white" />
                </div>
                <span style={{ fontSize: 20, fontWeight: 700, color: "#fff", letterSpacing: "-0.02em" }}>
                  FleetConnect <span style={{ color: colors.primary }}>IA</span>
                </span>
              </div>
              <p style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", lineHeight: 1.7, maxWidth: 320 }}>
                La plateforme intelligente pour optimiser votre flotte téléphonique d'entreprise grâce à l'intelligence artificielle.
              </p>
            </div>
            {[
              { title: "Plateforme", items: ["Fonctionnalités", "Modules IA", "Sécurité", "Intégrations"] },
              { title: "Entreprise", items: ["À propos", "Contact", "Blog", "Support"] },
            ].map((col) => (
              <div key={col.title}>
                <h4 style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.4)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 16 }}>{col.title}</h4>
                <ul className="flex flex-col gap-3">
                  {col.items.map((item) => (
                    <li key={item}><a href="#" style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", textDecoration: "none" }} onMouseEnter={e => (e.currentTarget.style.color = "#fff")} onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.6)")}>{item}</a></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-between pt-6 gap-4">
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)" }}>© 2026 FleetConnect IA · Tous droits réservés</p>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)" }}>Propulsé par <span style={{ color: colors.primary }}>BC SKILLS</span></p>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ── Sub-components ──

function SectionHeader({ badge, title, subtitle, dark = false }: { badge: string; title: string; subtitle: string; dark?: boolean }) {
  const { ref, inView } = useInView();
  return (
    <div
      ref={ref}
      className="text-center"
      style={{ transition: "all 0.7s ease", opacity: inView ? 1 : 0, transform: inView ? "translateY(0)" : "translateY(30px)" }}
    >
      <div className="inline-flex items-center gap-2 mb-5" style={{
        background: dark ? "rgba(37,99,235,0.15)" : "rgba(37,99,235,0.08)",
        borderRadius: 100, padding: "7px 18px",
        border: `1px solid ${dark ? "rgba(37,99,235,0.3)" : "rgba(37,99,235,0.15)"}`
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: colors.primary, letterSpacing: "0.02em" }}>{badge}</span>
      </div>
      <h2 style={{ fontSize: "clamp(28px, 4vw, 48px)", fontWeight: 800, color: dark ? "#fff" : colors.ink, letterSpacing: "-0.025em", lineHeight: 1.15, marginBottom: 16 }}>
        {title}
      </h2>
      <p style={{ fontSize: "clamp(15px, 1.8vw, 18px)", color: dark ? "rgba(255,255,255,0.6)" : colors.muted, maxWidth: 600, margin: "0 auto", lineHeight: 1.65 }}>
        {subtitle}
      </p>
    </div>
  );
}

function KPICard({ kpi }: { kpi: any }) {
  const { ref, inView } = useInView();
  return (
    <div
      ref={ref}
      style={{
        transition: "all 0.6s ease",
        opacity: inView ? 1 : 0,
        transform: inView ? "translateY(0)" : "translateY(24px)",
        background: "#fff",
        borderRadius: 20,
        padding: "28px 24px",
        border: `1px solid ${colors.border}`,
        boxShadow: "0 4px 20px rgba(37,99,235,0.06)",
        cursor: "default",
        textAlign: "center",
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 12px 40px rgba(37,99,235,0.14)"; (e.currentTarget as HTMLElement).style.transform = "translateY(-4px)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 20px rgba(37,99,235,0.06)"; (e.currentTarget as HTMLElement).style.transform = "translateY(0)"; }}
    >
      <div className="flex justify-center mb-3" style={{ color: kpi.color }}>{kpi.icon}</div>
      <div style={{ fontSize: 36, fontWeight: 800, color: kpi.color, letterSpacing: "-0.03em", lineHeight: 1 }}>
        {kpi.rawValue ? kpi.rawValue : (inView ? <AnimatedCounter target={kpi.value} suffix={kpi.suffix} /> : `0${kpi.suffix}`)}
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: colors.ink, marginTop: 8 }}>{kpi.label}</div>
      <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>{kpi.sub}</div>
    </div>
  );
}

function FeatureCard({ feat, index }: { feat: any; index: number }) {
  const { ref, inView } = useInView();
  return (
    <div
      ref={ref}
      style={{
        transition: `all 0.6s ease ${index * 80}ms`,
        opacity: inView ? 1 : 0,
        transform: inView ? "translateY(0)" : "translateY(32px)",
        background: "#fff",
        borderRadius: 20,
        padding: "32px 28px",
        border: `1px solid ${colors.border}`,
        boxShadow: "0 2px 16px rgba(37,99,235,0.04)",
        cursor: "default",
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.boxShadow = "0 16px 48px rgba(37,99,235,0.12)";
        el.style.transform = "translateY(-6px)";
        el.style.borderColor = `${feat.color}30`;
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.boxShadow = "0 2px 16px rgba(37,99,235,0.04)";
        el.style.transform = "translateY(0)";
        el.style.borderColor = colors.border;
      }}
    >
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-5" style={{ background: `${feat.color}15`, color: feat.color }}>
        {feat.icon}
      </div>
      <h3 style={{ fontSize: 17, fontWeight: 700, color: colors.ink, marginBottom: 10, lineHeight: 1.3 }}>{feat.title}</h3>
      <p style={{ fontSize: 14, color: colors.muted, lineHeight: 1.65 }}>{feat.desc}</p>
    </div>
  );
}

function StepCard({ step, index }: { step: any; index: number }) {
  const { ref, inView } = useInView();
  return (
    <div
      ref={ref}
      style={{
        transition: `all 0.7s ease ${index * 120}ms`,
        opacity: inView ? 1 : 0,
        transform: inView ? "translateY(0)" : "translateY(32px)",
        textAlign: "center",
        position: "relative",
      }}
    >
      <div className="relative inline-flex">
        <div className="w-20 h-20 rounded-3xl flex items-center justify-center mb-6 mx-auto" style={{
          background: `linear-gradient(135deg, ${step.color}15, ${step.color}25)`,
          color: step.color,
          border: `2px solid ${step.color}20`,
          boxShadow: `0 8px 32px ${step.color}20`,
        }}>
          {step.icon}
        </div>
        <div className="absolute -top-3 -right-3 w-8 h-8 rounded-full flex items-center justify-center" style={{ background: step.color, fontSize: 11, fontWeight: 800, color: "#fff" }}>
          {step.num.replace("0", "")}
        </div>
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, color: step.color, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>{step.num}</div>
      <h3 style={{ fontSize: 20, fontWeight: 700, color: colors.ink, marginBottom: 12, lineHeight: 1.3 }}>{step.title}</h3>
      <p style={{ fontSize: 14, color: colors.muted, lineHeight: 1.7, maxWidth: 300, margin: "0 auto" }}>{step.desc}</p>
    </div>
  );
}

function AIModuleCard({ mod, index }: { mod: any; index: number }) {
  const { ref, inView } = useInView();
  return (
    <div
      ref={ref}
      style={{
        transition: `all 0.6s ease ${index * 80}ms`,
        opacity: inView ? 1 : 0,
        transform: inView ? "translateY(0)" : "translateY(32px)",
        background: "rgba(255,255,255,0.05)",
        backdropFilter: "blur(20px)",
        borderRadius: 20,
        padding: "28px 24px",
        border: "1px solid rgba(255,255,255,0.1)",
        cursor: "default",
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.background = "rgba(255,255,255,0.08)";
        el.style.borderColor = `${mod.color}40`;
        el.style.transform = "translateY(-4px)";
        el.style.boxShadow = `0 16px 48px ${mod.color}15`;
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.background = "rgba(255,255,255,0.05)";
        el.style.borderColor = "rgba(255,255,255,0.1)";
        el.style.transform = "translateY(0)";
        el.style.boxShadow = "none";
      }}
    >
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4" style={{ background: `${mod.color}20`, color: mod.color, border: `1px solid ${mod.color}30` }}>
        {mod.icon}
      </div>
      <h3 style={{ fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 8 }}>{mod.title}</h3>
      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", lineHeight: 1.65 }}>{mod.desc}</p>
    </div>
  );
}

function PersonaCard({ persona, index }: { persona: any; index: number }) {
  const { ref, inView } = useInView();
  return (
    <div
      ref={ref}
      style={{
        transition: `all 0.6s ease ${index * 100}ms`,
        opacity: inView ? 1 : 0,
        transform: inView ? "translateY(0)" : "translateY(32px)",
        background: "#fff",
        borderRadius: 20,
        padding: "32px 24px",
        border: `1px solid ${colors.border}`,
        boxShadow: "0 2px 16px rgba(37,99,235,0.04)",
        textAlign: "center",
        cursor: "default",
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.boxShadow = `0 16px 48px ${persona.color}15`;
        el.style.transform = "translateY(-6px)";
        el.style.borderColor = `${persona.color}25`;
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.boxShadow = "0 2px 16px rgba(37,99,235,0.04)";
        el.style.transform = "translateY(0)";
        el.style.borderColor = colors.border;
      }}
    >
      <div className="w-16 h-16 rounded-3xl flex items-center justify-center mb-5 mx-auto" style={{ background: `${persona.color}12`, color: persona.color, border: `2px solid ${persona.color}20` }}>
        {persona.icon}
      </div>
      <h3 style={{ fontSize: 16, fontWeight: 700, color: colors.ink, marginBottom: 10 }}>{persona.title}</h3>
      <p style={{ fontSize: 13, color: colors.muted, lineHeight: 1.65 }}>{persona.desc}</p>
    </div>
  );
}

function CTASection({ onNavigate, onScrollLogin }: { onNavigate: () => void; onScrollLogin: () => void }) {
  const { ref, inView } = useInView();
  return (
    <div
      ref={ref}
      style={{
        transition: "all 0.8s ease",
        opacity: inView ? 1 : 0,
        transform: inView ? "translateY(0)" : "translateY(40px)",
      }}
    >
      <div style={{
        background: `linear-gradient(135deg, ${colors.dark} 0%, ${colors.darkAlt} 60%, ${colors.primary} 100%)`,
        borderRadius: 32, padding: "72px 48px",
        position: "relative", overflow: "hidden",
        boxShadow: "0 32px 80px rgba(37,99,235,0.3)"
      }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle at 80% 20%, rgba(124,58,237,0.15) 0%, transparent 50%)", pointerEvents: "none" }} />
        <div style={{ position: "relative", zIndex: 1 }}>
          <div className="inline-flex items-center gap-2 mb-6" style={{ background: "rgba(37,99,235,0.3)", borderRadius: 100, padding: "7px 18px", border: "1px solid rgba(37,99,235,0.4)" }}>
            <Zap className="w-4 h-4 text-blue-300" />
            <span style={{ fontSize: 13, fontWeight: 600, color: "#93c5fd", letterSpacing: "0.02em" }}>Prêt à démarrer ?</span>
          </div>
          <h2 style={{ fontSize: "clamp(28px, 4vw, 48px)", fontWeight: 800, color: "#fff", letterSpacing: "-0.025em", lineHeight: 1.15, marginBottom: 20 }}>
            Prêt à optimiser votre flotte téléphonique ?
          </h2>
          <p style={{ fontSize: 18, color: "rgba(255,255,255,0.7)", lineHeight: 1.65, marginBottom: 40, maxWidth: 520, margin: "0 auto 40px" }}>
            Centralisez vos lignes, réduisez les coûts et prenez de meilleures décisions grâce à FleetConnect IA.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={onNavigate}
              className="transition-all duration-200 hover:opacity-90 hover:scale-[1.03] active:scale-[0.98]"
              style={{
                fontSize: 17, fontWeight: 700, color: colors.dark, cursor: "pointer",
                padding: "16px 36px", borderRadius: 14, border: "none",
                background: "#fff",
                boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
                display: "flex", alignItems: "center", gap: 8,
              }}
            >
              Commencer <ArrowRight className="w-5 h-5" />
            </button>
            <button
              onClick={onScrollLogin}
              className="transition-all duration-200 hover:bg-white/10"
              style={{
                fontSize: 17, fontWeight: 600, color: "#fff", cursor: "pointer",
                padding: "16px 36px", borderRadius: 14,
                background: "rgba(255,255,255,0.1)", border: "2px solid rgba(255,255,255,0.2)",
              }}
            >
              Se connecter
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

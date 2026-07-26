import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  Activity,
  ArrowLeft,
  Eye,
  EyeOff,
  Lock,
  Mail,
  MonitorSmartphone,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";

import { useAuth } from "../context/AuthContext";
import { useOAuthProviders } from "../hooks/useOAuthProviders";
import { ApiError, oauthApi } from "../lib/api";
import { resolvePostLoginPath } from "../lib/roles";
import logoImage from "../../assets/2285601bb4e4d491e253f51df33e674aefdb2011.png";

const platformHighlights = [
  "Analytics predictif",
  "Detection d'anomalies",
  "Recommandations intelligentes",
  "Tableaux de bord temps reel",
];

const platformKpis = [
  { label: "Lignes actives", value: "342", accent: "Suivi multi-operateurs" },
  { label: "Economies realisees", value: "30 %", accent: "Optimisation telecom" },
  { label: "Surveillance IA", value: "24/7", accent: "Alertes continues" },
  { label: "Precision IA", value: "98 %", accent: "Scores decisionnels" },
];

function GoogleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#F25022" d="M2 2h9.5v9.5H2z" />
      <path fill="#00A4EF" d="M12.5 2H22v9.5h-9.5z" />
      <path fill="#7FBA00" d="M2 12.5h9.5V22H2z" />
      <path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z" />
    </svg>
  );
}

function LoginField({
  label,
  icon,
  type = "text",
  value,
  onChange,
  placeholder,
  rightAction,
}: {
  label: string;
  icon: typeof Mail;
  type?: "email" | "password" | "text";
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  rightAction?: ReactNode;
}) {
  const Icon = icon;

  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-[#0F172A]">{label}</span>
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 transition-all focus-within:border-[#2563EB] focus-within:ring-4 focus-within:ring-blue-100">
        <Icon className="h-5 w-5 text-[#64748B]" />
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="w-full bg-transparent text-sm text-[#0F172A] outline-none placeholder:text-[#94A3B8]"
          required
        />
        {rightAction}
      </div>
    </label>
  );
}

export default function AdminLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const { loginAdmin } = useAuth();
  const { isLoading, isGoogleConfigured, isMicrosoftConfigured } = useOAuthProviders();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleRedirecting, setIsGoogleRedirecting] = useState(false);
  const [isMicrosoftRedirecting, setIsMicrosoftRedirecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [infoMessage, setInfoMessage] = useState("");

  const nextPath =
    (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ??
    "/admin/dashboard";

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const oauthError = searchParams.get("oauth_error");
    setErrorMessage(oauthError ?? "");
    setInfoMessage(
      searchParams.get("reset") === "success"
        ? "Votre mot de passe a ete reinitialise. Utilisez vos nouveaux identifiants Super Admin."
        : "",
    );
  }, [location.search]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    setInfoMessage("");
    setIsSubmitting(true);

    try {
      const authenticatedUser = await loginAdmin({ email: email.trim(), password, remember });
      navigate(resolvePostLoginPath(authenticatedUser, nextPath), { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage("Connexion Super Admin impossible.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleProviderRedirect = (provider: "google" | "microsoft") => {
    if (provider === "google") {
      if (isGoogleRedirecting || !isGoogleConfigured) {
        return;
      }

      setErrorMessage("");
      setInfoMessage("");
      setIsGoogleRedirecting(true);
      window.location.href = oauthApi.googleLoginUrl();
      return;
    }

    if (isMicrosoftRedirecting || !isMicrosoftConfigured) {
      return;
    }

    setErrorMessage("");
    setInfoMessage("");
    setIsMicrosoftRedirecting(true);
    window.location.href = oauthApi.microsoftLoginUrl();
  };

  return (
    <div className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(29,78,216,0.20),transparent_26%),radial-gradient(circle_at_bottom_right,rgba(124,58,237,0.20),transparent_22%),linear-gradient(180deg,#F8FAFC_0%,#FFFFFF_48%,#EEF2FF_100%)] px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-full border border-white/90 bg-white/90 px-4 py-2 text-sm font-medium text-[#1D4ED8] shadow-[0_14px_30px_-24px_rgba(15,23,42,0.45)] backdrop-blur transition-colors hover:border-[#BFDBFE] hover:text-[#1E40AF]"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Retour a la landing</span>
          </Link>

          <Link
            to="/login"
            className="inline-flex items-center gap-2 rounded-full border border-[#DBEAFE] bg-[#EFF6FF]/90 px-4 py-2 text-sm font-semibold text-[#1D4ED8] shadow-[0_12px_28px_-22px_rgba(37,99,235,0.34)] backdrop-blur transition-all hover:-translate-y-0.5 hover:text-[#1E40AF]"
          >
            <span>Login collaborateur</span>
          </Link>
        </div>

        <div className="grid items-center gap-6 lg:grid-cols-[minmax(420px,480px)_minmax(0,1fr)] xl:gap-8">
          <section className="order-1 rounded-[32px] border border-white/85 bg-white/95 p-6 shadow-[0_30px_90px_-46px_rgba(15,23,42,0.28)] backdrop-blur-xl sm:p-8">
            <div className="flex flex-col items-center text-center">
              <div className="rounded-[26px] border border-slate-200/80 bg-white p-3 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.22)]">
                <img src={logoImage} alt="BC SKILLS" className="h-14 w-14 rounded-[18px] object-cover" />
              </div>
              <p className="mt-4 text-xs font-semibold uppercase tracking-[0.34em] text-[#64748B]">
                BC SKILLS
              </p>
              <h1 className="mt-4 text-[2rem] font-semibold tracking-tight text-[#0F172A]">
                Connexion a la plateforme
              </h1>
              <p className="mt-3 max-w-sm text-sm leading-6 text-[#64748B]">
                Pilotage intelligent de la flotte telephonique
              </p>
              <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-[#DBEAFE] bg-[linear-gradient(135deg,#EFF6FF_0%,#EEF2FF_100%)] px-4 py-2 text-xs font-semibold text-[#1D4ED8]">
                <ShieldCheck className="h-4 w-4" />
                <span>Interface reservee au Super Administrateur</span>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              <div className="grid gap-4">
                <LoginField
                  label="Email administrateur"
                  icon={Mail}
                  type="email"
                  value={email}
                  onChange={setEmail}
                  placeholder="super.admin@fleetconnect.ai"
                />

                <LoginField
                  label="Mot de passe"
                  icon={Lock}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={setPassword}
                  placeholder="Saisissez votre mot de passe"
                  rightAction={
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      className="text-[#64748B] transition-colors hover:text-[#0F172A]"
                      aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  }
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <label className="inline-flex items-center gap-2 text-[#475569]">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(event) => setRemember(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB]"
                  />
                  <span>Se souvenir de moi</span>
                </label>

                <Link to="/forgot-password" className="font-medium text-[#1D4ED8] hover:text-[#1E40AF]">
                  Mot de passe oublie ?
                </Link>
              </div>

              {errorMessage ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-[#B91C1C]">
                  {errorMessage}
                </div>
              ) : null}

              {infoMessage ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-[#047857]">
                  {infoMessage}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex w-full items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#1D4ED8_0%,#0EA5E9_55%,#7C3AED_100%)] px-5 py-3.5 text-sm font-semibold text-white shadow-[0_22px_42px_-22px_rgba(37,99,235,0.58)] transition-all hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? "Connexion en cours..." : "Se connecter en tant que Super Admin"}
              </button>

              <div className="space-y-4 rounded-[26px] border border-slate-200 bg-slate-50/85 p-4">
                <div className="flex items-center gap-4">
                  <div className="h-px flex-1 bg-slate-200" />
                  <span className="text-xs font-semibold uppercase tracking-[0.22em] text-[#94A3B8]">
                    Ou continuer avec
                  </span>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => handleProviderRedirect("google")}
                    disabled={isGoogleRedirecting || (!isLoading && !isGoogleConfigured)}
                    className="inline-flex items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-[#0F172A] transition-all hover:-translate-y-0.5 hover:border-[#BFDBFE] hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    title={!isLoading && !isGoogleConfigured ? "Provider Google non configure pour le moment." : undefined}
                  >
                    <GoogleIcon />
                    <span>{isGoogleRedirecting ? "Redirection..." : "Google"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleProviderRedirect("microsoft")}
                    disabled={isMicrosoftRedirecting || (!isLoading && !isMicrosoftConfigured)}
                    className="inline-flex items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-[#0F172A] transition-all hover:-translate-y-0.5 hover:border-[#DDD6FE] hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    title={!isLoading && !isMicrosoftConfigured ? "Provider Microsoft non configure pour le moment." : undefined}
                  >
                    <MicrosoftIcon />
                    <span>{isMicrosoftRedirecting ? "Redirection..." : "Microsoft"}</span>
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs text-[#64748B]">
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
                    {!isLoading && !isGoogleConfigured ? "Google en attente" : "Google disponible"}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-white px-3 py-1">
                    {!isLoading && !isMicrosoftConfigured ? "Microsoft en attente" : "Microsoft disponible"}
                  </span>
                </div>
              </div>

            </form>
          </section>

          <aside className="order-2 overflow-hidden rounded-[34px] border border-white/10 bg-[linear-gradient(145deg,#0F172A_0%,#1D4ED8_42%,#2563EB_65%,#7C3AED_100%)] p-6 text-white shadow-[0_34px_100px_-48px_rgba(15,23,42,0.9)] sm:p-8 lg:min-h-[720px]">
            <div className="flex h-full flex-col">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white/92 backdrop-blur">
                <Sparkles className="h-4 w-4" />
                <span>Plateforme IA active</span>
              </div>

              <div className="mt-7 max-w-xl">
                <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                  Plateforme intelligente de gestion de flotte mobile
                </h2>
                <p className="mt-4 text-base leading-7 text-white/78">
                  Optimisez vos couts telecom avec l'intelligence artificielle
                </p>
              </div>

              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {platformHighlights.map((item) => (
                  <div
                    key={item}
                    className="flex items-center gap-3 rounded-[24px] border border-white/12 bg-white/10 px-4 py-4 backdrop-blur"
                  >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/14">
                      {item === "Analytics predictif" ? (
                        <TrendingUp className="h-5 w-5" />
                      ) : item === "Detection d'anomalies" ? (
                        <Activity className="h-5 w-5" />
                      ) : item === "Recommandations intelligentes" ? (
                        <Sparkles className="h-5 w-5" />
                      ) : (
                        <MonitorSmartphone className="h-5 w-5" />
                      )}
                    </div>
                    <p className="text-sm font-medium text-white/90">{item}</p>
                  </div>
                ))}
              </div>

              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {platformKpis.map((kpi) => (
                  <div
                    key={kpi.label}
                    className="rounded-[24px] border border-white/12 bg-white/10 px-4 py-4 backdrop-blur"
                  >
                    <p className="text-[11px] uppercase tracking-[0.22em] text-white/58">{kpi.label}</p>
                    <p className="mt-3 text-3xl font-semibold">{kpi.value}</p>
                    <p className="mt-2 text-sm text-white/72">{kpi.accent}</p>
                  </div>
                ))}
              </div>

              <div className="mt-8 rounded-[28px] border border-white/12 bg-[linear-gradient(180deg,rgba(255,255,255,0.16)_0%,rgba(255,255,255,0.08)_100%)] p-5 backdrop-blur">
                <div className="flex items-start gap-4">
                  <div className="rounded-2xl bg-white/14 p-3">
                    <ShieldCheck className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold">Validation centralisee et securisee</p>
                    <p className="mt-2 text-sm leading-7 text-white/76">
                      Le Super Admin pilote les demandes d'inscription, active les entreprises
                      valides et controle les acces critiques depuis un espace dedie.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-auto pt-8">
                <div className="grid gap-3 rounded-[28px] border border-white/12 bg-white/8 p-5 backdrop-blur sm:grid-cols-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.2em] text-white/58">Portail</p>
                    <p className="mt-2 text-lg font-semibold">/admin/login</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.2em] text-white/58">Acces</p>
                    <p className="mt-2 text-lg font-semibold">SUPER_ADMIN</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.2em] text-white/58">Mission</p>
                    <p className="mt-2 text-lg font-semibold">Validation entreprise</p>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

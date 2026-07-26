import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";

import PublicAuthShell from "../components/auth/PublicAuthShell";
import { useAuth } from "../context/AuthContext";
import { useOAuthProviders } from "../hooks/useOAuthProviders";
import { ApiError, oauthApi } from "../lib/api";
import { resolvePostLoginPath } from "../lib/roles";

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

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const { isLoading, isGoogleConfigured } = useOAuthProviders();
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleRedirecting, setIsGoogleRedirecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [infoMessage, setInfoMessage] = useState("");

  const nextPath =
    (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? null;

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const oauthError = searchParams.get("oauth_error");
    const resetStatus = searchParams.get("reset");

    setErrorMessage(oauthError ?? "");
    setInfoMessage(
      resetStatus === "success"
        ? "Votre mot de passe a ete reinitialise. Connectez-vous avec le nouveau."
        : "",
    );
  }, [location.search]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    setInfoMessage("");
    setIsSubmitting(true);

    try {
      const authenticatedUser = await login({ email: email.trim(), password, remember });
      navigate(resolvePostLoginPath(authenticatedUser, nextPath), { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage("Connexion impossible au backend.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleLogin = () => {
    if (isGoogleRedirecting) {
      return;
    }

    setErrorMessage("");
    setInfoMessage("");
    setIsGoogleRedirecting(true);
    window.location.href = oauthApi.googleLoginUrl();
  };

  return (
    <PublicAuthShell
      backHref="/"
      backLabel="Retour a la landing"
      topAction={
        <div className="flex flex-wrap items-center gap-2">
          <span>Pas encore de compte ?</span>
          <Link to="/register" className="font-semibold text-[#1D4ED8] hover:text-[#1E40AF]">
            Creer un compte
          </Link>
        </div>
      }
      asideBadge="Connexion securisee"
      asideTitle="Chaque role entre par la meme porte."
      asideDescription="Administrateur, manager, analyste ou employe: connectez-vous ici puis rejoignez directement votre dashboard apres authentification JWT."
      asidePoints={[
        "Une session unifiee pour tous les profils entreprise.",
        "Gestion des acces, reprise de session et redirection immediate vers l'espace de travail.",
        "Compatible avec le parcours de validation des collaborateurs et les admins entreprise.",
      ]}
      asideStats={[
        { label: "Roles", value: "4" },
        { label: "Redirection", value: "Dashboard" },
        { label: "SSO", value: "Google", hint: "Disponible si configure" },
      ]}
      contentBadge="Connexion"
      contentTitle="Accedez a votre workspace FleetConnect IA."
      contentDescription="Utilisez votre email professionnel et votre mot de passe pour ouvrir votre session. Si votre compte collaborateur est encore en attente, un message explicite sera affiche."
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid gap-5">
          <LoginField
            label="Email professionnel"
            icon={Mail}
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="prenom.nom@entreprise.ma"
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
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            }
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-[#475569]">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-[#2563EB] focus:ring-[#2563EB]"
            />
            <span>Se souvenir de moi</span>
          </label>

          <Link to="/forgot-password" className="text-sm font-medium text-[#1D4ED8] hover:text-[#1E40AF]">
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
          className="inline-flex w-full items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#2563EB_0%,#7C3AED_100%)] px-5 py-3.5 text-sm font-semibold text-white shadow-[0_20px_36px_-18px_rgba(99,102,241,0.52)] transition-all hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Connexion en cours..." : "Se connecter"}
        </button>
      </form>

      <div className="mt-6 rounded-[28px] border border-slate-200 bg-slate-50/80 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#0F172A]">Connexion federée</p>
            <p className="mt-1 text-sm leading-6 text-[#64748B]">
              Continuez avec Google si votre entreprise utilise deja ce mode d'authentification.
            </p>
          </div>

          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={isGoogleRedirecting}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-[#0F172A] transition-all hover:-translate-y-0.5 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            title={
              !isLoading && !isGoogleConfigured
                ? "Google OAuth n'est pas detecte automatiquement. Le clic lance quand meme la verification backend."
                : undefined
            }
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            <span>{isGoogleRedirecting ? "Redirection..." : "Continuer avec Google"}</span>
          </button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-[28px] border border-[#DBEAFE] bg-[linear-gradient(135deg,#EFF6FF_0%,#EEF2FF_100%)] p-5">
        <div>
          <p className="text-sm font-semibold text-[#0F172A]">Vous n'avez pas encore d'acces ?</p>
          <p className="mt-1 text-sm leading-6 text-[#475569]">
            Creez votre compte collaborateur ou inscrivez votre entreprise depuis le bon parcours.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            to="/register"
            className="rounded-2xl border border-[#BFDBFE] bg-white px-4 py-3 text-sm font-semibold text-[#1D4ED8] transition-all hover:-translate-y-0.5"
          >
            Creer un compte
          </Link>
          <Link
            to="/register-company"
            className="rounded-2xl bg-[#1D4ED8] px-4 py-3 text-sm font-semibold text-white transition-all hover:-translate-y-0.5"
          >
            Creer une entreprise
          </Link>
        </div>
      </div>
    </PublicAuthShell>
  );
}

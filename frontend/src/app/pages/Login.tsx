import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";

import { useAuth } from "../context/AuthContext";
import { ApiError, oauthApi } from "../lib/api";
import logoImage from "../../assets/2285601bb4e4d491e253f51df33e674aefdb2011.png";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [infoMessage, setInfoMessage] = useState("");

  const nextPath =
    (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? "/dashboard";

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

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMessage("");
    setInfoMessage("");
    setIsSubmitting(true);

    try {
      await login({ email, password, remember });
      const destination = nextPath === "/admin" ? "/dashboard" : nextPath;
      navigate(destination, { replace: true });
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
    window.location.href = oauthApi.googleLoginUrl();
  };

  const handleMicrosoftLogin = () => {
    window.location.href = oauthApi.microsoftLoginUrl();
  };

  const handleAdminLogin = async () => {
    setErrorMessage("");
    setInfoMessage("");
    setIsSubmitting(true);

    try {
      await login({
        email: "admin@bcskills.ma",
        password: "Admin123!",
        remember: true,
      });
      navigate("/dashboard", { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage("Connexion administrateur impossible.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F8FAFC] via-white to-[#F1F5F9] flex items-center justify-center p-4">
      <div className="w-full max-w-6xl grid lg:grid-cols-2 gap-8 items-center">
        <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 p-8 lg:p-12">
          <div className="mb-8">
            <div className="flex items-center justify-center mb-8">
              <img src={logoImage} alt="BC SKILLS" className="h-24 w-auto" />
            </div>

            <h2 className="text-3xl font-bold text-[#0F172A] mb-2 text-center">
              Connexion a la plateforme
            </h2>
            <p className="text-[#64748B] text-center">
              Pilotage intelligent de la flotte telephonique
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-[#0F172A] mb-2">
                Email professionnel
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-[#64748B]" />
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="admin@bcskills.ma"
                  className="w-full pl-11 pr-4 py-3 bg-[#F8FAFC] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6CDF] focus:border-transparent"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#0F172A] mb-2">
                Mot de passe
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-[#64748B]" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="********"
                  className="w-full pl-11 pr-11 py-3 bg-[#F8FAFC] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6CDF] focus:border-transparent"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-[#64748B] hover:text-[#0F172A]"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                  className="w-4 h-4 text-[#2D6CDF] border-gray-300 rounded focus:ring-[#2D6CDF]"
                />
                <span className="text-sm text-[#64748B]">Se souvenir de moi</span>
              </label>
              <Link
                to="/forgot-password"
                className="text-sm text-[#2D6CDF] hover:text-[#1d4ed8] font-medium"
              >
                Mot de passe oublie ?
              </Link>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-gradient-to-r from-[#2D6CDF] to-[#06B6D4] text-white py-3 rounded-lg font-semibold hover:opacity-90 transition-opacity shadow-lg shadow-blue-500/30 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSubmitting ? "Connexion..." : "Se connecter"}
            </button>
          </form>

          {errorMessage ? (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              {errorMessage}
            </div>
          ) : null}

          {infoMessage ? (
            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
              {infoMessage}
            </div>
          ) : null}

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-[#64748B]">Ou continuer avec</span>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={handleGoogleLogin}
                className="flex items-center justify-center gap-2 px-4 py-3 bg-white border border-gray-200 rounded-lg text-sm font-medium text-[#0F172A] hover:bg-[#F8FAFC] transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                <span>Google</span>
              </button>

              <button
                type="button"
                onClick={handleMicrosoftLogin}
                className="flex items-center justify-center gap-2 px-4 py-3 bg-white border border-gray-200 rounded-lg text-sm font-medium text-[#0F172A] hover:bg-[#F8FAFC] transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#f25022" d="M1 1h10v10H1z" />
                  <path fill="#00a4ef" d="M13 1h10v10H13z" />
                  <path fill="#7fba00" d="M1 13h10v10H1z" />
                  <path fill="#ffb900" d="M13 13h10v10H13z" />
                </svg>
                <span>Microsoft</span>
              </button>
            </div>
          </div>

          <div className="mt-6">
            <button
              type="button"
              onClick={handleAdminLogin}
              disabled={isSubmitting}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-[#7C3AED] to-[#EC4899] text-white rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Lock className="w-5 h-5" />
              <span>Acces Administrateur</span>
            </button>
          </div>

          <div className="mt-6 text-center">
            <p className="text-sm text-[#64748B]">
              Vous n'avez pas de compte ?{" "}
              <Link to="/register" className="text-[#2D6CDF] hover:text-[#1d4ed8] font-medium">
                Creer un compte
              </Link>
            </p>
          </div>
        </div>

        <div className="hidden lg:block">
          <div className="bg-gradient-to-br from-[#2D6CDF] to-[#7C3AED] rounded-2xl p-8 text-white shadow-2xl">
            <div className="mb-6">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-white/20 backdrop-blur-sm rounded-full text-sm font-medium mb-4">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                Plateforme IA active
              </div>
              <h3 className="text-3xl font-bold mb-4">
                Plateforme intelligente de gestion de flotte mobile
              </h3>
              <p className="text-white/90 text-lg">
                Optimisez vos couts telecoms avec l'intelligence artificielle
              </p>
            </div>

            <div className="space-y-4 mb-8">
              <FeatureCard
                title="Analytics predictif"
                description="Anticipez vos couts avec l'intelligence artificielle"
              />
              <FeatureCard
                title="Detection d'anomalies"
                description="Identifiez automatiquement les consommations inhabituelles"
              />
              <FeatureCard
                title="Recommandations intelligentes"
                description="Optimisez vos forfaits et reduisez vos couts"
              />
              <FeatureCard
                title="Tableaux de bord temps reel"
                description="Visualisez vos KPI et prenez les bonnes decisions"
              />
            </div>

            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20">
              <div className="grid grid-cols-2 gap-4 text-center">
                <MetricCard value="342" label="Lignes actives" />
                <MetricCard value="30%" label="Economies realisees" />
                <MetricCard value="24/7" label="Surveillance IA" />
                <MetricCard value="98%" label="Precision IA" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FeatureCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center flex-shrink-0">
        <span>+</span>
      </div>
      <div>
        <h4 className="font-semibold mb-1">{title}</h4>
        <p className="text-sm text-white/80">{description}</p>
      </div>
    </div>
  );
}

function MetricCard({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-3xl font-bold">{value}</p>
      <p className="text-sm text-white/80">{label}</p>
    </div>
  );
}

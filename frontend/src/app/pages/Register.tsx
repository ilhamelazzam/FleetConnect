import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Building2, Eye, EyeOff, Lock, Mail, MapPin, User } from "lucide-react";

import { useAuth } from "../context/AuthContext";
import { ApiError, oauthApi } from "../lib/api";
import logoImage from "../../assets/2285601bb4e4d491e253f51df33e674aefdb2011.png";

export default function Register() {
  const navigate = useNavigate();
  const { register } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    company: "",
    country: "Maroc",
    role: "manager",
    password: "",
    confirmPassword: "",
  });

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMessage("");

    if (formData.password !== formData.confirmPassword) {
      setErrorMessage("Les mots de passe ne correspondent pas.");
      return;
    }

    setIsSubmitting(true);

    try {
      await register({
        fullName: formData.fullName,
        email: formData.email,
        password: formData.password,
        role: formData.role,
        remember: true,
      });
      navigate("/dashboard", { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage("Inscription impossible pour le moment.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignup = () => {
    window.location.href = oauthApi.googleLoginUrl();
  };

  const handleMicrosoftSignup = () => {
    window.location.href = oauthApi.microsoftLoginUrl();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F8FAFC] via-white to-[#F1F5F9] flex items-center justify-center p-4">
      <div className="w-full max-w-6xl grid lg:grid-cols-2 gap-8 items-center">
        <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 p-8 lg:p-12">
          <div className="mb-8">
            <div className="flex items-center justify-center mb-8">
              <img src={logoImage} alt="BC SKILLS" className="h-24 w-auto" />
            </div>

            <h2 className="text-3xl font-bold text-[#0F172A] mb-2 text-center">Créer un compte</h2>
            <p className="text-[#64748B] text-center">
              Commencez à optimiser votre flotte mobile
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-[#0F172A] mb-2">
                Nom complet
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-[#64748B]" />
                <input
                  type="text"
                  value={formData.fullName}
                  onChange={(event) =>
                    setFormData((current) => ({ ...current, fullName: event.target.value }))
                  }
                  placeholder="Votre nom complet"
                  className="w-full pl-11 pr-4 py-3 bg-[#F8FAFC] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6CDF] focus:border-transparent"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#0F172A] mb-2">
                Email professionnel
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-[#64748B]" />
                <input
                  type="email"
                  value={formData.email}
                  onChange={(event) =>
                    setFormData((current) => ({ ...current, email: event.target.value }))
                  }
                  placeholder="votre.email@entreprise.ma"
                  className="w-full pl-11 pr-4 py-3 bg-[#F8FAFC] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6CDF] focus:border-transparent"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#0F172A] mb-2">
                Entreprise
              </label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-[#64748B]" />
                <input
                  type="text"
                  value={formData.company}
                  onChange={(event) =>
                    setFormData((current) => ({ ...current, company: event.target.value }))
                  }
                  placeholder="Nom de votre entreprise"
                  className="w-full pl-11 pr-4 py-3 bg-[#F8FAFC] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6CDF] focus:border-transparent"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#0F172A] mb-2">Pays</label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-[#64748B]" />
                <select
                  value={formData.country}
                  onChange={(event) =>
                    setFormData((current) => ({ ...current, country: event.target.value }))
                  }
                  className="w-full pl-11 pr-4 py-3 bg-[#F8FAFC] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6CDF] focus:border-transparent"
                >
                  <option value="Maroc">Maroc</option>
                  <option value="France">France</option>
                  <option value="Tunisie">Tunisie</option>
                  <option value="Algerie">Algerie</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#0F172A] mb-2">Rôle demandé</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-[#64748B]" />
                <select
                  value={formData.role}
                  onChange={(event) =>
                    setFormData((current) => ({ ...current, role: event.target.value }))
                  }
                  className="w-full pl-11 pr-4 py-3 bg-[#F8FAFC] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6CDF] focus:border-transparent"
                >
                  <option value="manager">Manager</option>
                  <option value="analyst">Analyste</option>
                  <option value="admin">Administrateur</option>
                </select>
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
                  value={formData.password}
                  onChange={(event) =>
                    setFormData((current) => ({ ...current, password: event.target.value }))
                  }
                  placeholder="********"
                  className="w-full pl-11 pr-11 py-3 bg-[#F8FAFC] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6CDF] focus:border-transparent"
                  required
                  minLength={8}
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

            <div>
              <label className="block text-sm font-medium text-[#0F172A] mb-2">
                Confirmer le mot de passe
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-[#64748B]" />
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  value={formData.confirmPassword}
                  onChange={(event) =>
                    setFormData((current) => ({
                      ...current,
                      confirmPassword: event.target.value,
                    }))
                  }
                  placeholder="********"
                  className="w-full pl-11 pr-11 py-3 bg-[#F8FAFC] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6CDF] focus:border-transparent"
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((value) => !value)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-[#64748B] hover:text-[#0F172A]"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>

            <p className="text-xs text-[#64748B]">
              Le compte est créé comme utilisateur standard. Les informations entreprise/pays
              restent côté interface pour l'instant.
            </p>

            {errorMessage ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                {errorMessage}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-gradient-to-r from-[#2D6CDF] to-[#06B6D4] text-white py-3 rounded-lg font-semibold hover:opacity-90 transition-opacity shadow-lg shadow-blue-500/30 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSubmitting ? "Creation..." : "Créer un compte"}
            </button>
          </form>

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
                onClick={handleGoogleSignup}
                className="flex items-center justify-center gap-2 px-4 py-3 bg-white border border-gray-200 rounded-lg text-sm font-medium text-[#0F172A] hover:bg-[#F8FAFC] transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
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
                <span>Google</span>
              </button>
              <button
                type="button"
                onClick={handleMicrosoftSignup}
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

          <div className="mt-8 text-center">
            <p className="text-sm text-[#64748B]">
              Vous avez déjà un compte ?{" "}
              <Link to="/login" className="text-[#2D6CDF] hover:text-[#1d4ed8] font-medium">
                Se connecter
              </Link>
            </p>
          </div>
        </div>

        <div className="hidden lg:block">
          <div className="bg-gradient-to-br from-[#2D6CDF] to-[#7C3AED] rounded-2xl p-8 text-white shadow-2xl">
            <h3 className="text-2xl font-bold mb-6">Rejoignez BC SKILLS FleetConnect</h3>
            <div className="space-y-4 mb-8">
              <BenefitCard
                title="Gestion centralisée"
                description="Gérez toutes vos lignes mobiles depuis une seule plateforme"
              />
              <BenefitCard
                title="Intelligence artificielle"
                description="Bénéficiez de recommandations personnalisées et prédictions"
              />
              <BenefitCard
                title="Économies garanties"
                description="Réduisez vos coûts télécoms jusqu'à 30% en moyenne"
              />
              <BenefitCard
                title="Support dédié"
                description="Accompagnement personnalisé pour votre entreprise"
              />
            </div>

            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20">
              <p className="text-sm text-white/80 mb-4">
                Rejoignez plus de 200 entreprises marocaines qui nous font confiance
              </p>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-[#16A34A] rounded-full animate-pulse" />
                <span className="text-sm">Support 24/7 disponible</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BenefitCard({ title, description }: { title: string; description: string }) {
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

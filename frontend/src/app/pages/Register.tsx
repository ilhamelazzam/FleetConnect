import { useState, type ChangeEvent } from "react";
import { Link, useNavigate } from "react-router";
import {
  Building2,
  Eye,
  EyeOff,
  ImagePlus,
  Lock,
  Mail,
  MapPin,
  Trash2,
  User,
} from "lucide-react";

import { useAuth } from "../context/AuthContext";
import { useOAuthProviders } from "../hooks/useOAuthProviders";
import { ApiError, getUserAvatarUrl, oauthApi } from "../lib/api";
import logoImage from "../../assets/2285601bb4e4d491e253f51df33e674aefdb2011.png";

const MAX_USER_PHOTO_SIZE_BYTES = 512 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Impossible de lire l'image selectionnee."));
    };

    reader.onerror = () => reject(new Error("Impossible de lire l'image selectionnee."));
    reader.readAsDataURL(file);
  });
}

export default function Register() {
  const navigate = useNavigate();
  const { register } = useAuth();
  const { isLoading, isGoogleConfigured } = useOAuthProviders();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [photoInputKey, setPhotoInputKey] = useState(0);
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    department: "",
    country: "Maroc",
    role: "user",
    password: "",
    confirmPassword: "",
    photoUrl: null as string | null,
  });

  const avatarPreviewUrl = getUserAvatarUrl(formData.fullName || "Utilisateur", formData.photoUrl);

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
        photoUrl: formData.photoUrl,
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
    if (isLoading || !isGoogleConfigured) {
      return;
    }
    window.location.href = oauthApi.googleLoginUrl();
  };

  const oauthButtonClassName =
    "flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-[#94A3B8]";

  const handlePhotoChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setErrorMessage("Selectionnez une image valide pour la photo utilisateur.");
      setPhotoInputKey((previousValue) => previousValue + 1);
      return;
    }

    if (file.size > MAX_USER_PHOTO_SIZE_BYTES) {
      setErrorMessage("La photo doit faire 500 Ko maximum.");
      setPhotoInputKey((previousValue) => previousValue + 1);
      return;
    }

    try {
      const photoUrl = await readFileAsDataUrl(file);
      setFormData((current) => ({ ...current, photoUrl }));
      setErrorMessage("");
    } catch (error) {
      if (error instanceof Error) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage("Impossible de charger la photo.");
      }
      setPhotoInputKey((previousValue) => previousValue + 1);
    }
  };

  const handleRemovePhoto = () => {
    setFormData((current) => ({ ...current, photoUrl: null }));
    setPhotoInputKey((previousValue) => previousValue + 1);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#F8FAFC] via-white to-[#F1F5F9] p-4">
      <div className="grid w-full max-w-6xl items-center gap-8 lg:grid-cols-2">
        <div className="rounded-2xl border border-gray-100 bg-white p-8 shadow-2xl lg:p-12">
          <div className="mb-8">
            <div className="mb-8 flex items-center justify-center">
              <img src={logoImage} alt="BC SKILLS" className="h-24 w-auto" />
            </div>

            <h2 className="mb-2 text-center text-3xl font-bold text-[#0F172A]">Créer un compte</h2>
            <p className="text-center text-[#64748B]">Commencez à optimiser votre flotte mobile</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="mb-2 block text-sm font-medium text-[#0F172A]">Photo utilisateur</label>
              <div className="flex items-center gap-4 rounded-2xl border border-gray-200 bg-[#F8FAFC] p-4">
                <img
                  src={avatarPreviewUrl}
                  alt="Apercu utilisateur"
                  className="h-20 w-20 rounded-2xl border border-gray-200 object-cover shadow-sm"
                />

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[#0F172A]">Ajouter une image de profil</p>
                  <p className="mt-1 text-xs text-[#64748B]">
                    PNG, JPG, WEBP ou GIF. Taille maximale: 500 Ko.
                  </p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-[#2D6CDF] transition-colors hover:bg-blue-100">
                      <ImagePlus className="h-4 w-4" />
                      <span>{formData.photoUrl ? "Changer l'image" : "Choisir une image"}</span>
                      <input
                        key={photoInputKey}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        onChange={(event) => void handlePhotoChange(event)}
                        className="hidden"
                      />
                    </label>

                    {formData.photoUrl ? (
                      <button
                        type="button"
                        onClick={handleRemovePhoto}
                        className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-[#DC2626] transition-colors hover:bg-red-100"
                      >
                        <Trash2 className="h-4 w-4" />
                        <span>Supprimer</span>
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#0F172A]">Nom complet</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#64748B]" />
                <input
                  type="text"
                  value={formData.fullName}
                  onChange={(event) =>
                    setFormData((current) => ({ ...current, fullName: event.target.value }))
                  }
                  placeholder="Votre nom complet"
                  className="w-full rounded-lg border border-gray-200 bg-[#F8FAFC] py-3 pl-11 pr-4 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"
                  required
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#0F172A]">Email professionnel</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#64748B]" />
                <input
                  type="email"
                  value={formData.email}
                  onChange={(event) =>
                    setFormData((current) => ({ ...current, email: event.target.value }))
                  }
                  placeholder="votre.email@entreprise.ma"
                  className="w-full rounded-lg border border-gray-200 bg-[#F8FAFC] py-3 pl-11 pr-4 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"
                  required
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#0F172A]">Departement</label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#64748B]" />
                <input
                  type="text"
                  value={formData.department}
                  onChange={(event) =>
                    setFormData((current) => ({ ...current, department: event.target.value }))
                  }
                  placeholder="Nom de votre departement"
                  className="w-full rounded-lg border border-gray-200 bg-[#F8FAFC] py-3 pl-11 pr-4 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"
                  required
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#0F172A]">Pays</label>
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#64748B]" />
                <select
                  value={formData.country}
                  onChange={(event) =>
                    setFormData((current) => ({ ...current, country: event.target.value }))
                  }
                  className="w-full rounded-lg border border-gray-200 bg-[#F8FAFC] py-3 pl-11 pr-4 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"
                >
                  <option value="Maroc">Maroc</option>
                  <option value="France">France</option>
                  <option value="Tunisie">Tunisie</option>
                  <option value="Algerie">Algerie</option>
                </select>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#0F172A]">Rôle demandé</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#64748B]" />
                <select
                  value={formData.role}
                  onChange={(event) =>
                    setFormData((current) => ({ ...current, role: event.target.value }))
                  }
                  className="w-full rounded-lg border border-gray-200 bg-[#F8FAFC] py-3 pl-11 pr-4 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"
                >
                  <option value="user">Utilisateur</option>
                  <option value="manager">Manager</option>
                  <option value="analyst">Analyste</option>
                </select>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#0F172A]">Mot de passe</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#64748B]" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={formData.password}
                  onChange={(event) =>
                    setFormData((current) => ({ ...current, password: event.target.value }))
                  }
                  placeholder="********"
                  className="w-full rounded-lg border border-gray-200 bg-[#F8FAFC] py-3 pl-11 pr-11 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#0F172A]"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#0F172A]">
                Confirmer le mot de passe
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#64748B]" />
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
                  className="w-full rounded-lg border border-gray-200 bg-[#F8FAFC] py-3 pl-11 pr-11 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#2D6CDF]"
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((value) => !value)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#0F172A]"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-5 w-5" />
                  ) : (
                    <Eye className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>

            <p className="text-xs text-[#64748B]">
              Le compte est créé comme utilisateur standard. Les informations entreprise/pays
              restent côté interface pour l&apos;instant.
            </p>

            {errorMessage ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                {errorMessage}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-lg bg-gradient-to-r from-[#2D6CDF] to-[#06B6D4] py-3 font-semibold text-white shadow-lg shadow-blue-500/30 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
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
                <span className="bg-white px-2 text-[#64748B]">Ou continuer avec</span>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-3">
              <button
                type="button"
                onClick={handleGoogleSignup}
                disabled={isLoading || !isGoogleConfigured}
                className={`${oauthButtonClassName} border-gray-200 bg-white text-[#0F172A] hover:bg-[#F8FAFC]`}
                title={
                  !isLoading && !isGoogleConfigured
                    ? "Configurez Google OAuth dans backend/.env pour activer ce bouton."
                    : undefined
                }
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24">
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
            </div>
          </div>

          <div className="mt-8 text-center">
            <p className="text-sm text-[#64748B]">
              Vous avez déjà un compte ?{" "}
              <Link to="/login" className="font-medium text-[#2D6CDF] hover:text-[#1d4ed8]">
                Se connecter
              </Link>
            </p>
          </div>
        </div>

        <div className="hidden lg:block">
          <div className="rounded-2xl bg-gradient-to-br from-[#2D6CDF] to-[#7C3AED] p-8 text-white shadow-2xl">
            <h3 className="mb-6 text-2xl font-bold">Rejoignez BC SKILLS FleetConnect</h3>
            <div className="mb-8 space-y-4">
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

            <div className="rounded-xl border border-white/20 bg-white/10 p-6 backdrop-blur-sm">
              <p className="mb-4 text-sm text-white/80">
                Rejoignez plus de 200 entreprises marocaines qui nous font confiance
              </p>
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 animate-pulse rounded-full bg-[#16A34A]" />
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
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/20">
        <span>+</span>
      </div>
      <div>
        <h4 className="mb-1 font-semibold">{title}</h4>
        <p className="text-sm text-white/80">{description}</p>
      </div>
    </div>
  );
}

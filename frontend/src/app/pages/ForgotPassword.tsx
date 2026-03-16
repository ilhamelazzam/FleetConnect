import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowLeft, Mail } from "lucide-react";

import { ApiError, authApi } from "../lib/api";
import { writePasswordResetSession } from "../lib/password-reset-session";
import logoImage from "../../assets/2285601bb4e4d491e253f51df33e674aefdb2011.png";

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleEmailSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);

    try {
      const response = await authApi.requestPasswordReset({ email });
      writePasswordResetSession({
        email,
        resetToken: response.reset_token,
        expiresAt: Date.now() + response.expires_in_seconds * 1000,
      });
      navigate("/reset-password", { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage("Envoi du code impossible pour le moment.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F8FAFC] via-white to-[#F1F5F9] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 p-8 lg:p-12">
          <div className="mb-8">
            <div className="flex items-center justify-center mb-8">
              <img src={logoImage} alt="BC SKILLS" className="h-20 w-auto" />
            </div>

            <Link
              to="/login"
              className="inline-flex items-center gap-2 text-sm text-[#64748B] hover:text-[#0F172A] mb-4"
            >
              <ArrowLeft className="w-4 h-4" />
              Retour a la connexion
            </Link>

            <h2 className="text-3xl font-bold text-[#0F172A] mb-2">Mot de passe oublie</h2>
            <p className="text-[#64748B]">
              Entrez votre email pour recevoir un code de verification.
            </p>
          </div>

          <form onSubmit={handleEmailSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-[#0F172A] mb-2">Adresse email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-[#64748B]" />
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="votre.email@bcskills.ma"
                  className="w-full pl-11 pr-4 py-3 bg-[#F8FAFC] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6CDF] focus:border-transparent"
                  required
                />
              </div>
            </div>

            <div className="bg-[#F8FAFC] rounded-lg p-4 border border-gray-200">
              <p className="text-sm text-[#64748B]">
                Un code de verification a 6 chiffres sera envoye a cette adresse email.
              </p>
            </div>

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
              {isSubmitting ? "Envoi en cours..." : "Envoyer le code"}
            </button>
          </form>
        </div>

        <div className="mt-6 text-center">
          <p className="text-sm text-[#64748B]">
            Besoin d'aide ?{" "}
            <a href="#" className="text-[#2D6CDF] hover:text-[#1d4ed8] font-medium">
              Contactez le support
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

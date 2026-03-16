import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Eye, EyeOff, Lock, Shield } from "lucide-react";

import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "../components/ui/input-otp";
import { ApiError, authApi } from "../lib/api";
import {
  clearPasswordResetSession,
  readPasswordResetSession,
  writePasswordResetSession,
  type PasswordResetSession,
} from "../lib/password-reset-session";
import logoImage from "../../assets/2285601bb4e4d491e253f51df33e674aefdb2011.png";

function maskEmail(email: string): string {
  const [localPart = "", domain = ""] = email.split("@");
  if (!localPart || !domain) {
    return email;
  }

  if (localPart.length <= 2) {
    return `${localPart[0] ?? "*"}*@${domain}`;
  }

  return `${localPart.slice(0, 2)}***@${domain}`;
}

export default function ResetPassword() {
  const navigate = useNavigate();
  const [resetSession, setResetSession] = useState<PasswordResetSession | null>(null);
  const [otp, setOtp] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otpVerified, setOtpVerified] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    const storedSession = readPasswordResetSession();
    if (!storedSession) {
      return;
    }

    if (storedSession.expiresAt <= Date.now()) {
      clearPasswordResetSession();
      return;
    }

    setResetSession(storedSession);
  }, []);

  const emailLabel = useMemo(() => {
    if (!resetSession) {
      return "";
    }

    return maskEmail(resetSession.email);
  }, [resetSession]);

  const handleVerifyOTP = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!resetSession || otp.length !== 6) {
      return;
    }

    setErrorMessage("");
    setSuccessMessage("");
    setIsVerifying(true);

    try {
      const response = await authApi.verifyResetCode({
        reset_token: resetSession.resetToken,
        code: otp,
      });
      setOtpVerified(true);
      setSuccessMessage(response.message);
    } catch (error) {
      if (error instanceof ApiError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage("Vérification du code impossible.");
      }
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResetPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!resetSession || otp.length !== 6) {
      return;
    }

    setErrorMessage("");
    setSuccessMessage("");
    setIsResetting(true);

    try {
      await authApi.resetPassword({
        reset_token: resetSession.resetToken,
        code: otp,
        new_password: newPassword,
      });
      clearPasswordResetSession();
      navigate("/login?reset=success", { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage("Réinitialisation du mot de passe impossible.");
      }
    } finally {
      setIsResetting(false);
    }
  };

  const handleResendCode = async () => {
    if (!resetSession) {
      return;
    }

    setErrorMessage("");
    setSuccessMessage("");
    setIsResending(true);

    try {
      const response = await authApi.requestPasswordReset({ email: resetSession.email });
      const updatedSession = {
        email: resetSession.email,
        resetToken: response.reset_token,
        expiresAt: Date.now() + response.expires_in_seconds * 1000,
      };
      writePasswordResetSession(updatedSession);
      setResetSession(updatedSession);
      setOtp("");
      setOtpVerified(false);
      setSuccessMessage("Un nouveau code a été envoyé par email.");
    } catch (error) {
      if (error instanceof ApiError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage("Renvoi du code impossible.");
      }
    } finally {
      setIsResending(false);
    }
  };

  if (!resetSession) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#F8FAFC] via-white to-[#F1F5F9] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-gray-100 p-8 text-center">
          <div className="flex items-center justify-center mb-6">
            <img src={logoImage} alt="BC SKILLS" className="h-20 w-auto" />
          </div>
          <h2 className="text-2xl font-bold text-[#0F172A] mb-3">Session de réinitialisation invalide</h2>
          <p className="text-[#64748B] mb-6">
            Demandez un nouveau code avant de choisir un nouveau mot de passe.
          </p>
          <Link
            to="/forgot-password"
            className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-[#2D6CDF] to-[#06B6D4] px-5 py-3 font-semibold text-white"
          >
            Recommencer
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F8FAFC] via-white to-[#F1F5F9] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 p-8">
          <div className="mb-8">
            <div className="flex items-center justify-center mb-6">
              <img src={logoImage} alt="BC SKILLS" className="h-20 w-auto" />
            </div>

            <div className="flex items-center justify-center mb-4">
              <div className="w-16 h-16 bg-gradient-to-br from-[#2D6CDF] to-[#06B6D4] rounded-2xl flex items-center justify-center">
                <Shield className="w-8 h-8 text-white" />
              </div>
            </div>

            <h2 className="text-2xl font-bold text-[#0F172A] mb-2 text-center">
              Réinitialisation du mot de passe
            </h2>
            <p className="text-[#64748B] text-center text-sm">
              {!otpVerified
                ? `Entrez le code envoyé à ${emailLabel}`
                : "Choisissez maintenant votre nouveau mot de passe"}
            </p>
          </div>

          {!otpVerified ? (
            <form onSubmit={handleVerifyOTP} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-[#0F172A] mb-4 text-center">
                  Code de vérification à 6 chiffres
                </label>
                <div className="flex justify-center">
                  <InputOTP maxLength={6} value={otp} onChange={(value) => setOtp(value)}>
                    <InputOTPGroup>
                      <InputOTPSlot index={0} />
                      <InputOTPSlot index={1} />
                      <InputOTPSlot index={2} />
                      <InputOTPSlot index={3} />
                      <InputOTPSlot index={4} />
                      <InputOTPSlot index={5} />
                    </InputOTPGroup>
                  </InputOTP>
                </div>
                <p className="text-xs text-[#64748B] mt-3 text-center">
                  Vérifiez votre boîte de réception et vos spams.
                </p>
              </div>

              <div className="bg-[#F8FAFC] rounded-lg p-4 border border-gray-200">
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 bg-[#2D6CDF] rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-white text-xs">i</span>
                  </div>
                  <div>
                    <p className="text-sm text-[#0F172A] font-medium mb-1">Code de sécurité envoyé</p>
                    <p className="text-xs text-[#64748B]">
                      Le code expire au bout de 15 minutes et doit être validé avant la
                      réinitialisation.
                    </p>
                  </div>
                </div>
              </div>

              {errorMessage ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                  {errorMessage}
                </div>
              ) : null}

              {successMessage ? (
                <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                  {successMessage}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={otp.length !== 6 || isVerifying}
                className="w-full bg-gradient-to-r from-[#2D6CDF] to-[#06B6D4] text-white py-3 rounded-lg font-semibold hover:opacity-90 transition-opacity shadow-lg shadow-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isVerifying ? "Vérification..." : "Vérifier le code"}
              </button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={handleResendCode}
                  disabled={isResending}
                  className="text-sm text-[#2D6CDF] hover:text-[#1d4ed8] font-medium disabled:opacity-60"
                >
                  {isResending ? "Renvoi..." : "Renvoyer le code"}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleResetPassword} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-[#0F172A] mb-2">
                  Nouveau mot de passe
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-[#64748B]" />
                  <input
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    placeholder="Minimum 8 caracteres"
                    className="w-full pl-11 pr-11 py-3 bg-[#F8FAFC] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2D6CDF] focus:border-transparent"
                    required
                    minLength={8}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword((value) => !value)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-[#64748B] hover:text-[#0F172A]"
                  >
                    {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
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
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="Confirmez votre mot de passe"
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

              {confirmPassword && newPassword !== confirmPassword ? (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-sm text-red-600">Les mots de passe ne correspondent pas.</p>
                </div>
              ) : null}

              {errorMessage ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                  {errorMessage}
                </div>
              ) : null}

              <div className="bg-[#F8FAFC] rounded-lg p-4 border border-gray-200">
                <p className="text-xs font-medium text-[#0F172A] mb-2">Critères du mot de passe :</p>
                <ul className="space-y-1 text-xs text-[#64748B]">
                  <li className={newPassword.length >= 8 ? "text-green-600" : ""}>- Au moins 8 caractères</li>
                  <li className={/[A-Z]/.test(newPassword) ? "text-green-600" : ""}>
                    - Au moins une lettre majuscule
                  </li>
                  <li className={/[0-9]/.test(newPassword) ? "text-green-600" : ""}>
                    - Au moins un chiffre
                  </li>
                  <li className={/[^A-Za-z0-9]/.test(newPassword) ? "text-green-600" : ""}>
                    - Au moins un caractère spécial
                  </li>
                </ul>
              </div>

              <button
                type="submit"
                disabled={newPassword !== confirmPassword || newPassword.length < 8 || isResetting}
                className="w-full bg-gradient-to-r from-[#2D6CDF] to-[#06B6D4] text-white py-3 rounded-lg font-semibold hover:opacity-90 transition-opacity shadow-lg shadow-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isResetting ? "Réinitialisation..." : "Réinitialiser le mot de passe"}
              </button>
            </form>
          )}

          <div className="mt-6 text-center">
            <Link
              to="/login"
              className="text-sm text-[#64748B] hover:text-[#0F172A] font-medium"
            >
              Retour à la connexion
            </Link>
          </div>

          <div className="mt-6 pt-6 border-t border-gray-200">
            <div className="flex items-center gap-2 text-xs text-[#64748B] justify-center">
              <Lock className="w-4 h-4" />
              <span>Connexion sécurisée - Données chiffrées</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

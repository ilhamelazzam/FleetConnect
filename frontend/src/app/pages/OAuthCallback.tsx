import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { writeStoredSession, type StoredSession } from "../lib/auth-session";

function decodeSessionPayload(rawPayload: string): StoredSession {
  const normalizedPayload = rawPayload.replace(/-/g, "+").replace(/_/g, "/");
  const paddedPayload = normalizedPayload.padEnd(
    Math.ceil(normalizedPayload.length / 4) * 4,
    "=",
  );
  const binaryPayload = window.atob(paddedPayload);
  const bytes = Uint8Array.from(binaryPayload, (character) => character.charCodeAt(0));
  const decodedPayload = new TextDecoder().decode(bytes);

  return JSON.parse(decodedPayload) as StoredSession;
}

export default function OAuthCallback() {
  const navigate = useNavigate();
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    try {
      const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;
      const params = new URLSearchParams(hash);
      const payload = params.get("payload");

      if (!payload) {
        throw new Error("Retour OAuth invalide.");
      }

      const session = decodeSessionPayload(payload);
      writeStoredSession(session, true);
      navigate("/dashboard", { replace: true });
    } catch {
      setErrorMessage("Connexion OAuth invalide. Reessayez depuis la page de connexion.");
      navigate("/login?oauth_error=Connexion OAuth invalide. Reessayez.", {
        replace: true,
      });
    }
  }, [navigate]);

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center px-4">
      <div className="rounded-2xl border border-gray-200 bg-white px-8 py-10 shadow-xl text-center max-w-md">
        <h1 className="text-xl font-bold text-[#0F172A]">Connexion OAuth</h1>
        <p className="mt-3 text-sm text-[#64748B]">
          {errorMessage || "Finalisation de la connexion en cours..."}
        </p>
      </div>
    </div>
  );
}

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Locale } from "date-fns";
import { ar, enUS, fr } from "date-fns/locale";

export type AppLanguage = "fr" | "en" | "ar";
export type AppDirection = "ltr" | "rtl";

interface LanguageOption {
  value: AppLanguage;
  label: string;
}

interface LanguageContextValue {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
  direction: AppDirection;
  isRtl: boolean;
  dateLocale: Locale;
  localeCode: string;
  languageOptions: LanguageOption[];
}

const LANGUAGE_STORAGE_KEY = "fleetconnect.app-language";

const LANGUAGE_OPTIONS: LanguageOption[] = [
  { value: "fr", label: "Francais" },
  { value: "en", label: "English" },
  { value: "ar", label: "العربية" },
];

const DATE_LOCALE_MAP: Record<AppLanguage, Locale> = {
  fr,
  en: enUS,
  ar,
};

const INTL_LOCALE_MAP: Record<AppLanguage, string> = {
  fr: "fr-FR",
  en: "en-US",
  ar: "ar-MA",
};

function normalizeLanguage(value: unknown): AppLanguage {
  if (typeof value !== "string") {
    return "fr";
  }

  const normalizedValue = value.trim().toLowerCase();

  if (normalizedValue === "fr" || normalizedValue === "francais" || normalizedValue === "français") {
    return "fr";
  }

  if (normalizedValue === "en" || normalizedValue === "english" || normalizedValue === "anglais") {
    return "en";
  }

  if (
    normalizedValue === "ar" ||
    normalizedValue === "arabic" ||
    normalizedValue === "arabe" ||
    normalizedValue === "العربية" ||
    normalizedValue === "es" ||
    normalizedValue === "espanol" ||
    normalizedValue === "español" ||
    normalizedValue === "spanish"
  ) {
    return "ar";
  }

  return "fr";
}

function getStoredLanguage(): AppLanguage {
  if (typeof window === "undefined") {
    return "fr";
  }

  return normalizeLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY));
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(() => getStoredLanguage());

  useEffect(() => {
    const direction: AppDirection = language === "ar" ? "rtl" : "ltr";

    if (typeof document !== "undefined") {
      document.documentElement.lang = language;
      document.documentElement.dir = direction;
      document.body.dir = direction;
    }

    if (typeof window !== "undefined") {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    }
  }, [language]);

  const value = useMemo<LanguageContextValue>(() => {
    const direction: AppDirection = language === "ar" ? "rtl" : "ltr";

    return {
      language,
      setLanguage: setLanguageState,
      direction,
      isRtl: direction === "rtl",
      dateLocale: DATE_LOCALE_MAP[language],
      localeCode: INTL_LOCALE_MAP[language],
      languageOptions: LANGUAGE_OPTIONS,
    };
  }, [language]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);

  if (!context) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }

  return context;
}

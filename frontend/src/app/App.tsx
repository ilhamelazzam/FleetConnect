import { useEffect } from "react";
import { RouterProvider } from "react-router";

import { useInfrastructureHealth } from "./hooks/useInfrastructureHealth";
import { LanguageProvider, useLanguage } from "./context/LanguageContext";
import { initializeTheme } from "./lib/theme";
import { router } from "./routes";

function AppRouter() {
  const { language } = useLanguage();
  const loadingLabel =
    language === "ar" ? "جارٍ التحميل..." : language === "en" ? "Loading..." : "Chargement...";

  return <RouterProvider router={router} fallbackElement={<div>{loadingLabel}</div>} />;
}

function App() {
  useEffect(() => {
    initializeTheme();
  }, []);
  useInfrastructureHealth();

  return (
    <LanguageProvider>
      <AppRouter />
    </LanguageProvider>
  );
}

export default App;

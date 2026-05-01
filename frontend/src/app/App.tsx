import { useEffect } from "react";
import { RouterProvider } from "react-router";

import { initializeTheme } from "./lib/theme";
import { router } from "./routes";

function App() {
  useEffect(() => {
    initializeTheme();
  }, []);

  return <RouterProvider router={router} fallbackElement={<div>Chargement...</div>} />;
}

export default App;

import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import { silenceConsoleInProduction } from "./app/lib/console";
import "./styles/index.css";

silenceConsoleInProduction();

createRoot(document.getElementById("root")!).render(<App />);
  

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// `npm run dev:web`: la interfaz en un navegador con un backend simulado. Vite
// sustituye MODE en tiempo de compilación, así que esto no llega al build de la app.
if (import.meta.env.MODE === "demo") {
  const { installMocks } = await import("./demo/mock");
  installMocks();
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

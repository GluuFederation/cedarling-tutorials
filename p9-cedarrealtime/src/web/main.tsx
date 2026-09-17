import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("P9 web root is missing");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

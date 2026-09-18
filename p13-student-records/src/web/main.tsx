import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

const element = document.getElementById("root");
if (!element) throw new Error("CedarSchool root is missing");
createRoot(element).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

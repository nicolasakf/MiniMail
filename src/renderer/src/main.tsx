import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles/globals.css";

import { App } from "./App";
import { applyAppearance } from "./lib/appearance";

applyAppearance();

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

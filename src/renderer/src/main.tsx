import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles/globals.css";

import { App } from "./App";
import { ErrorBoundary } from "./components/error-boundary";
import { api } from "./lib/api";
import { applyAppearance } from "./lib/appearance";
import { installEventReporting } from "./lib/events";
import { migrateSavedTheme } from "./lib/saved-theme";

migrateSavedTheme(() => localStorage);
applyAppearance();
// Before anything renders, so even a crash on the first paint reaches the log.
installEventReporting(api.events);

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

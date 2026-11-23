import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles/globals.css";

import { App } from "./App";
import { ErrorBoundary } from "./components/error-boundary";
import { api } from "./lib/api";
import { applyAppearance } from "./lib/appearance";
import { installEventReporting } from "./lib/events";
import { loadSavedPrefs } from "./lib/saved-prefs";
import { migrateSavedTheme } from "./lib/saved-theme";

// Before anything renders, so even a crash on the first paint reaches the log.
installEventReporting(api.events);

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

async function start(container: HTMLElement): Promise<void> {
  migrateSavedTheme(() => localStorage);
  // The saved choices come first: the lists, the text size and the color mode are all read from them.
  await loadSavedPrefs();
  applyAppearance();
  createRoot(container).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}

void start(root);

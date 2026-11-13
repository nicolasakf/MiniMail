import { useSyncExternalStore } from "react";

import { hexToHslTriple, normalizeHexColor, readableTextOn } from "./color";

/**
 * Display choices that belong to this computer and need no round trip to the main process: how
 * large the text is and whether lists show a preview of each message. Kept in the page's own
 * storage and applied before the first paint, so the app never flashes at the wrong size.
 */

export const TEXT_SIZES = ["small", "default", "large", "larger"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

/** The root font size as a percentage of the browser's 16px; every rem-based size follows. */
export const TEXT_SIZE_PERCENT: Record<TextSize, number> = {
  small: 87.5,
  default: 100,
  large: 112.5,
  larger: 125,
};

/** How the Smart view lays out its categories: one row each, or a grid of cards listing their senders. */
export const CATEGORY_LAYOUTS = ["horizontal", "vertical"] as const;
export type CategoryLayout = (typeof CATEGORY_LAYOUTS)[number];

export interface Appearance {
  textSize: TextSize;
  /** Show the first words of each message after its subject in lists. */
  showPreviews: boolean;
  categoryLayout: CategoryLayout;
  /** Show the selected conversation beside the list instead of replacing it. */
  splitView: boolean;
  /** Width in px of the list beside the reading pane (split view). */
  splitListWidth: number;
  /** Highlight color as `#RRGGBB`, or null for the built-in blue. */
  accentColor: string | null;
}

/** The built-in highlight blue, as the picker shows it (the light theme's selection blue). */
export const DEFAULT_ACCENT_COLOR = "#2563EB";

export const DEFAULT_APPEARANCE: Appearance = {
  textSize: "default",
  showPreviews: true,
  categoryLayout: "horizontal",
  splitView: false,
  splitListWidth: 400,
  accentColor: null,
};

/** The layout lists actually use: the split view has no room for a grid of cards, so it is always horizontal. */
export function effectiveCategoryLayout(appearance: Appearance): CategoryLayout {
  return appearance.splitView ? "horizontal" : appearance.categoryLayout;
}

const STORAGE_KEY = "minimail:appearance";

function read(): Appearance {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<Appearance>;
    return {
      textSize: TEXT_SIZES.includes(saved.textSize as TextSize) ? (saved.textSize as TextSize) : DEFAULT_APPEARANCE.textSize,
      showPreviews: typeof saved.showPreviews === "boolean" ? saved.showPreviews : DEFAULT_APPEARANCE.showPreviews,
      categoryLayout: CATEGORY_LAYOUTS.includes(saved.categoryLayout as CategoryLayout)
        ? (saved.categoryLayout as CategoryLayout)
        : DEFAULT_APPEARANCE.categoryLayout,
      splitView: typeof saved.splitView === "boolean" ? saved.splitView : DEFAULT_APPEARANCE.splitView,
      splitListWidth:
        typeof saved.splitListWidth === "number" && saved.splitListWidth >= 200 && saved.splitListWidth <= 2000
          ? Math.round(saved.splitListWidth)
          : DEFAULT_APPEARANCE.splitListWidth,
      accentColor: typeof saved.accentColor === "string" ? normalizeHexColor(saved.accentColor) : DEFAULT_APPEARANCE.accentColor,
    };
  } catch {
    return { ...DEFAULT_APPEARANCE }; // Storage can be blocked; the defaults are fine.
  }
}

let current: Appearance = read();
const listeners = new Set<() => void>();

/** The CSS variables the highlight color drives: selection, unread dots and counts, links, focus rings. */
const ACCENT_VARIABLES = ["--sidebar-primary", "--sidebar-primary-foreground", "--sidebar-ring", "--unread"] as const;

function applyAccent(accentColor: string | null): void {
  const style = document.documentElement.style;
  const triple = accentColor ? hexToHslTriple(accentColor) : null;
  if (!accentColor || !triple) {
    // Back to the theme's own blue, which differs between light and dark.
    for (const name of ACCENT_VARIABLES) style.removeProperty(name);
    return;
  }
  style.setProperty("--sidebar-primary", triple);
  style.setProperty("--sidebar-ring", triple);
  style.setProperty("--unread", triple);
  style.setProperty("--sidebar-primary-foreground", readableTextOn(accentColor) === "dark" ? "0 0% 9%" : "0 0% 100%");
}

function applyToPage(appearance: Appearance): void {
  document.documentElement.style.fontSize = `${TEXT_SIZE_PERCENT[appearance.textSize]}%`;
  applyAccent(appearance.accentColor);
}

/** Applies the saved text size and highlight color; called once before the app renders. */
export function applyAppearance(): void {
  applyToPage(current);
}

export function setAppearance(patch: Partial<Appearance>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // The choice still holds until the window closes.
  }
  applyToPage(current);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, () => current);
}

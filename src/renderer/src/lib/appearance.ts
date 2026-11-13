import { useSyncExternalStore } from "react";

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
}

export const DEFAULT_APPEARANCE: Appearance = { textSize: "default", showPreviews: true, categoryLayout: "horizontal" };

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
    };
  } catch {
    return { ...DEFAULT_APPEARANCE }; // Storage can be blocked; the defaults are fine.
  }
}

let current: Appearance = read();
const listeners = new Set<() => void>();

function applyToPage(appearance: Appearance): void {
  document.documentElement.style.fontSize = `${TEXT_SIZE_PERCENT[appearance.textSize]}%`;
}

/** Applies the saved text size; called once before the app renders. */
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

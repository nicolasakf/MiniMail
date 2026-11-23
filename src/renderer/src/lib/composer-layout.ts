import { useCallback, useState } from "react";

import { reportError } from "@/lib/events";

/** Where the floating composer sits on screen and how big it is; kept on this computer. */
export type ComposerSide = "left" | "right";

export interface ComposerLayout {
  side: ComposerSide;
  width: number;
  height: number;
}

export const MIN_COMPOSER_WIDTH = 380;
export const MIN_COMPOSER_HEIGHT = 320;
export const DEFAULT_COMPOSER_LAYOUT: ComposerLayout = { side: "right", width: 660, height: 640 };
const STORAGE_KEY = "minimail.composerLayout";
/** Far beyond any screen, so a damaged value cannot ask for something absurd. */
const MAX_STORED = 10_000;

function dimension(value: unknown, min: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(Math.min(Math.max(value, min), MAX_STORED)) : fallback;
}

/** Reads what was stored, filling in anything missing or damaged with the defaults. */
export function parseComposerLayout(raw: string | null): ComposerLayout {
  if (!raw) return DEFAULT_COMPOSER_LAYOUT;
  const value: unknown = JSON.parse(raw);
  if (typeof value !== "object" || value === null) return DEFAULT_COMPOSER_LAYOUT;
  const stored = value as Record<string, unknown>;
  return {
    side: stored.side === "left" ? "left" : "right",
    width: dimension(stored.width, MIN_COMPOSER_WIDTH, DEFAULT_COMPOSER_LAYOUT.width),
    height: dimension(stored.height, MIN_COMPOSER_HEIGHT, DEFAULT_COMPOSER_LAYOUT.height),
  };
}

function load(): ComposerLayout {
  try {
    return parseComposerLayout(localStorage.getItem(STORAGE_KEY));
  } catch (error) {
    reportError("storage", "Could not read the composer's size", error);
    return DEFAULT_COMPOSER_LAYOUT;
  }
}

function save(layout: ComposerLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch (error) {
    reportError("storage", "Could not remember the composer's size", error);
    // Storage can be unavailable; the layout holds until the app closes.
  }
}

/**
 * The floating composer's side and size. `commit` keeps a change for the next composer and the next launch
 * (a drag in progress is shown by the composer itself, without going through state).
 */
export function useComposerLayout() {
  const [layout, setLayout] = useState<ComposerLayout>(load);
  const commit = useCallback((next: Partial<ComposerLayout> = {}) => {
    setLayout((previous) => {
      const merged = { ...previous, ...next };
      save(merged);
      return merged;
    });
  }, []);
  return { layout, commit };
}

/** The floating panel's CSS size: what was chosen, but never bigger than the window leaves room for. */
export function panelSize(layout: ComposerLayout, trayBusy: boolean): { width: string; height: string } {
  return {
    width: `min(${layout.width}px, calc(100vw - 32px))`,
    height: `min(${layout.height}px, calc(100dvh - ${trayBusy ? 92 : 32}px))`,
  };
}

import type { LegacyPrefs } from "@shared/prefs";

import { reportError } from "@/lib/events";

/**
 * Where the page kept its choices before they moved to `settings.json`. The page's storage is
 * separate for every address the page is loaded from (the development server, a built copy, the
 * installed app), so each of them holds its own old copy, and each is taken over the first time
 * it is opened.
 */
export const LEGACY_KEYS = {
  appearance: "minimail:appearance",
  blocklist: "minimail.blocklist",
  priority: "minimail.priority",
  unsubscribed: "minimail.unsubscribed",
  pinnedDomains: "minimail.pinnedDomains",
  minimizedCategories: "minimail.minimizedCategories",
} as const;

/** `next-themes` keeps the color mode under this key as plain text, and the page keeps it as its own copy of the saved one. */
export const THEME_KEY = "theme";

type Reader = Pick<Storage, "getItem" | "removeItem">;

export interface FoundLegacyPrefs {
  prefs: LegacyPrefs;
  /** The keys to remove once the main process has saved `prefs`. */
  keys: string[];
}

/**
 * What the page's storage still holds of the old choices. A value that is not valid JSON cannot be
 * taken over: it is reported and removed. The color mode stays where it is (it is only read).
 */
export function findLegacyPrefs(storage: Reader): FoundLegacyPrefs {
  const prefs: Record<string, unknown> = {};
  const keys: string[] = [];
  for (const [name, key] of Object.entries(LEGACY_KEYS)) {
    const raw = storage.getItem(key);
    if (raw === null) continue;
    try {
      prefs[name] = JSON.parse(raw);
      keys.push(key);
    } catch (error) {
      reportError("storage", `Could not read the old saved ${name}; it was dropped`, error);
      storage.removeItem(key);
    }
  }
  const theme = storage.getItem(THEME_KEY);
  if (theme !== null) prefs.theme = theme;
  return { prefs, keys };
}

/** Removes the old values once they are safely in the settings file. */
export function forgetLegacyPrefs(storage: Reader, keys: readonly string[]): void {
  for (const key of keys) storage.removeItem(key);
}

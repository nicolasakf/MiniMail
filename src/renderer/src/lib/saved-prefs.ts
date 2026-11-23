import { defaultUiPrefs } from "@shared/prefs";
import type { UiPrefs } from "@shared/types";

import { api } from "./api";
import { findLegacyPrefs, forgetLegacyPrefs, THEME_KEY } from "./legacy-prefs";
import { reportError } from "@/lib/events";

/**
 * The choices that belong to the person, not to this window: what Settings, Block, Priority, Pin
 * and Unsubscribe remember. They are kept in `settings.json` by the main process and mirrored here
 * so every part of the window reads them without waiting. Never put such a choice in the page's own
 * storage (`localStorage`): that is separate for each address the page is loaded from, so starting the
 * app another way would not find it. The page's storage is for the state of the screen only (sizes,
 * what is folded open), which nobody would mind losing.
 */
let prefs: UiPrefs = defaultUiPrefs();
const listeners = new Map<keyof UiPrefs, Set<() => void>>();

/** The saved value of one choice. It is the same object until the choice changes. */
export function savedPref<K extends keyof UiPrefs>(key: K): UiPrefs[K] {
  return prefs[key];
}

export function subscribePref(key: keyof UiPrefs, listener: () => void): () => void {
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(listener);
  return () => void set.delete(listener);
}

/** Takes a copy from the main process, telling only the parts whose choice actually changed. */
function adopt(next: UiPrefs): void {
  const changed = (Object.keys(next) as (keyof UiPrefs)[]).filter((key) => JSON.stringify(next[key]) !== JSON.stringify(prefs[key]));
  prefs = { ...prefs, ...Object.fromEntries(changed.map((key) => [key, next[key]])) };
  for (const key of changed) listeners.get(key)?.forEach((listener) => listener());
}

/**
 * Remembers a choice: the screen follows at once, and the main process writes it to `settings.json`.
 * When that fails the main process has recorded it, and the choice holds until the app closes.
 */
export function savePref<K extends keyof UiPrefs>(key: K, value: UiPrefs[K]): void {
  prefs = { ...prefs, [key]: value };
  listeners.get(key)?.forEach((listener) => listener());
  api.prefs.set({ [key]: value }).catch(() => undefined); // expected: recorded by the main process; the choice only holds until the app closes.
}

/**
 * Reads the saved choices (once, before the first screen), takes over whatever the page's own
 * storage still holds from before they moved to `settings.json`, and then follows changes made in
 * other windows. Never throws: a failure is recorded and the defaults are used.
 */
export async function loadSavedPrefs(): Promise<void> {
  try {
    let saved = await api.prefs.get();
    // The demo in a plain browser has no settings file, and its page shares an address with the real app in development.
    if (!api.system.demo) saved = await takeOverLegacy(saved);
    adopt(saved);
    // The color mode library reads its own copy, so the saved one is put there before the first paint.
    if (saved.theme !== null) mirrorTheme(saved.theme);
  } catch (error) {
    reportError("storage", "Could not read the saved choices; using the defaults", error);
  }
  api.prefs.onChanged(adopt);
}

async function takeOverLegacy(saved: UiPrefs): Promise<UiPrefs> {
  const { prefs: found, keys } = findLegacyPrefs(window.localStorage);
  // The color mode stays in the page's storage as its library's own copy, so it is only taken over while none is saved.
  if (saved.theme !== null) delete found.theme;
  if (Object.keys(found).length === 0) return saved;
  try {
    const merged = await api.prefs.importLegacy(found);
    forgetLegacyPrefs(window.localStorage, keys);
    return merged;
  } catch (error) {
    // Left where it was and tried again next launch; nothing is lost.
    reportError("storage", "Could not move the old saved choices to the settings file", error);
    return saved;
  }
}

function mirrorTheme(mode: string): void {
  try {
    window.localStorage.setItem(THEME_KEY, mode);
  } catch (error) {
    reportError("storage", "Could not apply the saved color mode", error);
  }
}

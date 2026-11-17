import { useSyncExternalStore } from "react";

import {
  parseUnsubscribedLists,
  withUnsubscribed,
  type UnsubscribedLists,
} from "@shared/unsubscribe";
import { reportError } from "@/lib/events";

const STORAGE_KEY = "minimail.unsubscribed";

function read(): UnsubscribedLists {
  try {
    return parseUnsubscribedLists(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null"));
  } catch (error) {
    reportError("storage", "Could not read the unsubscribed lists", error);
    return {};
  }
}

/**
 * The lists the user unsubscribed from (and when), kept on this computer and shared by every part
 * of the window, so the buttons grey out everywhere at once. When storage is unavailable they hold
 * until the app closes.
 */
let current: UnsubscribedLists = read();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUnsubscribed(): UnsubscribedLists {
  return useSyncExternalStore(subscribe, () => current);
}

/** Remembers that these lists (`listKey`) were unsubscribed from now. */
export function recordUnsubscribed(keys: readonly string[]): void {
  if (keys.length === 0) return;
  current = withUnsubscribed(current, keys, Date.now());
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch (error) {
    reportError("storage", "Could not remember the unsubscribed lists", error);
    // Storage can be unavailable; the memory holds until the app closes.
  }
  listeners.forEach((listener) => listener());
}

// Another window (a detached composer shares the origin) can change the record.
window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEY) return;
  current = read();
  listeners.forEach((listener) => listener());
});

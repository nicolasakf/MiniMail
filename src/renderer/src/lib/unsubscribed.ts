import { useSyncExternalStore } from "react";

import { withUnsubscribed, type UnsubscribedLists } from "@shared/unsubscribe";

import { savedPref, savePref, subscribePref } from "./saved-prefs";

/**
 * The lists the user unsubscribed from (and when), saved in `settings.json` and shared by every
 * part of the window, so the buttons grey out everywhere at once.
 */
function subscribe(listener: () => void): () => void {
  return subscribePref("unsubscribed", listener);
}

export function useUnsubscribed(): UnsubscribedLists {
  return useSyncExternalStore(subscribe, () => savedPref("unsubscribed"));
}

/** Remembers that these lists (`listKey`) were unsubscribed from now. */
export function recordUnsubscribed(keys: readonly string[]): void {
  if (keys.length === 0) return;
  savePref("unsubscribed", withUnsubscribed(savedPref("unsubscribed"), keys, Date.now()));
}

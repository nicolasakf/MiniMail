import { useSyncExternalStore } from "react";

import { api } from "./api";

/**
 * The drafts the user pinned. A pin is kept on this computer only (in the app's saved choices): it
 * is never sent to the mail server, so it shows nowhere but here. It names a draft by message id,
 * which also covers drafts written here (their ids start with `local-draft:`).
 */
let pins: ReadonlySet<string> = new Set();
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: ReadonlySet<string>): void {
  pins = next;
  listeners.forEach((listener) => listener());
}

function ready(): Promise<void> {
  loading ??= api.prefs.get().then(
    (prefs) => {
      // A pin made while this was loading is kept.
      publish(new Set([...prefs.pinnedDrafts, ...pins]));
    },
    () => {
      loading = null; // try again next time something asks
    },
  );
  return loading;
}

/** Pins (or unpins) these drafts at once on screen, then remembers the choice. */
export function setDraftsPinned(ids: readonly string[], pinned: boolean): void {
  const next = new Set(pins);
  for (const id of ids) {
    if (pinned) next.add(id);
    else next.delete(id);
  }
  if (next.size === pins.size && [...next].every((id) => pins.has(id))) return;
  publish(next);
  // Only the memory of the pin is lost if this fails.
  void ready().then(() => api.prefs.set({ pinnedDrafts: [...pins] })).catch(() => undefined); // expected: recorded by the main process
}

/** The ids of the pinned drafts; re-renders when one is pinned or unpinned. */
export function usePinnedDrafts(): ReadonlySet<string> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      void ready();
      return () => listeners.delete(listener);
    },
    () => pins,
  );
}

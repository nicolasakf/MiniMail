import { useCallback, useEffect, useSyncExternalStore } from "react";

import type { CliSettings, CliState } from "@shared/cli";

import { api } from "@/lib/api";
import { toast } from "@/lib/toast";

/**
 * The CLI's state, shared by the CLI page in Settings and the last step of the setup guide, so a
 * choice made in one shows in the other. A change shows at once and is saved in the background; if
 * saving fails the earlier state comes back and a toast says why.
 */
let current: CliState | null = null;
let loading = false;
const listeners = new Set<() => void>();

function publish(next: CliState | null): void {
  current = next;
  listeners.forEach((listener) => listener());
}

function load(): void {
  if (current || loading) return;
  loading = true;
  api.cli
    .get()
    .then((loaded) => {
      if (!current) publish(loaded);
    })
    .catch(() => undefined) // expected: recorded by the main process
    .finally(() => {
      loading = false;
    });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Changes run one after another, each from what the one before left. */
let queue: Promise<void> = Promise.resolve();

function update(change: (settings: CliSettings) => CliSettings): Promise<void> {
  queue = queue.then(async () => {
    const before = current;
    if (!before) return;
    const next = change(before.settings);
    publish({ ...before, settings: next });
    try {
      publish(await api.cli.set(next));
    } catch (error) {
      publish(before);
      toast.error(error instanceof Error ? error.message : String(error));
    }
  });
  return queue;
}

export function useCli() {
  const state = useSyncExternalStore(subscribe, () => current);
  useEffect(load, []);
  const change = useCallback(update, []);
  return { state, update: change };
}

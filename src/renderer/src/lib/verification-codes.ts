import { useEffect, useSyncExternalStore } from "react";

import { api } from "@/lib/api";

/**
 * Codes found so far, by message id. A code is a secret that expires in minutes, so this lives
 * in memory only. Rows ask for their code as they appear; asks made in the same moment travel
 * to the main process as one batch.
 */
const results = new Map<string, string | null>();
const requested = new Set<string>();
const queue = new Set<string>();
const listeners = new Set<() => void>();
const BATCH = 30;
let version = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function emit(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function schedule(): void {
  if (timer === undefined) timer = setTimeout(flush, 30);
}

function flush(): void {
  timer = undefined;
  const ids = [...queue].slice(0, BATCH);
  for (const id of ids) queue.delete(id);
  if (queue.size > 0) schedule();
  if (ids.length === 0) return;
  api.mail
    .verificationCodes(ids)
    .then((found) => {
      for (const id of ids) {
        if (id in found) results.set(id, found[id]);
        else requested.delete(id); // the lookup failed; the row asks again next time it shows
      }
      emit();
    })
    .catch(() => {
      for (const id of ids) requested.delete(id);
    });
}

/** Forgets "no code" answers so they are looked up again, e.g. after the model setting changed. */
export function retryMissingCodes(): void {
  for (const [id, code] of results) if (code === null) results.delete(id);
  requested.clear();
  emit();
}

/** The code of a verification message, or null while unknown or when there is none. */
export function useVerificationCode(messageId: string, enabled: boolean): string | null {
  const code = useSyncExternalStore(subscribe, () => results.get(messageId) ?? null);
  const current = useSyncExternalStore(subscribe, () => version);
  useEffect(() => {
    if (!enabled || requested.has(messageId)) return;
    requested.add(messageId);
    queue.add(messageId);
    schedule();
  }, [messageId, enabled, current]);
  return enabled ? code : null;
}

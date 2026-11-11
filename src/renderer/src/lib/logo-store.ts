import { useEffect, useSyncExternalStore } from "react";

import { logoKey, type LogoRequest } from "@shared/logos";

import { api } from "@/lib/api";

/**
 * Logos the page has asked for, shared by every avatar. Requests are collected for a moment and
 * sent in small batches so a list of fifty rows makes a handful of calls, and each sender is
 * asked about once per session.
 */

const BATCH_SIZE = 8;
const BATCH_DELAY_MS = 40;

const entries = new Map<string, string | null>();
const asked = new Set<string>();
const listeners = new Set<() => void>();
let queue: LogoRequest[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let version = 0;
/** Bumped by `resetLogos` so answers to requests made before it are ignored. */
let generation = 0;

function emit(): void {
  version += 1;
  listeners.forEach((listener) => listener());
}

function flush(): void {
  timer = null;
  const batch = queue.splice(0, BATCH_SIZE);
  if (queue.length > 0) timer = setTimeout(flush, BATCH_DELAY_MS);
  if (batch.length === 0) return;

  const started = generation;
  const settle = (result: Record<string, string | null>) => {
    if (started !== generation) return;
    for (const request of batch) {
      const key = logoKey(request);
      entries.set(key, result[key] ?? null);
    }
    emit();
  };
  api.logos.get(batch).then(settle, () => settle({}));
}

export function requestLogo(request: LogoRequest): void {
  const key = logoKey(request);
  if (asked.has(key)) return;
  asked.add(key);
  queue.push(request);
  timer ??= setTimeout(flush, BATCH_DELAY_MS);
}

/** Forgets every answer and asks again; used when the logo settings change. */
export function resetLogos(): void {
  generation += 1;
  entries.clear();
  asked.clear();
  queue = [];
  if (timer) clearTimeout(timer);
  timer = null;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The `data:` URL for a request, once known; null while loading, when there is none, or for no request. */
export function useLogo(request: LogoRequest | null | undefined): string | null {
  const key = request ? logoKey(request) : null;
  const current = useSyncExternalStore(subscribe, () => version);
  useEffect(() => {
    if (request) requestLogo(request);
    // The key identifies the request; `current` re-asks after a reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, current]);
  return key ? (entries.get(key) ?? null) : null;
}

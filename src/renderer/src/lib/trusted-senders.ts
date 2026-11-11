import { useSyncExternalStore } from "react";

import { toast } from "sonner";

import { trustKey } from "@shared/trust";

import { api } from "./api";

/**
 * The senders whose remote images load without asking, shared by every open message so
 * trusting someone in one conversation applies to the rest at once. `null` until the first
 * answer, so a message does not flash its "blocked" bar before the list is known.
 */
let current: ReadonlySet<string> | null = null;
let started = false;
const listeners = new Set<() => void>();

function publish(list: readonly string[]): void {
  current = new Set(list.map(trustKey));
  listeners.forEach((listener) => listener());
}

function start(): void {
  if (started) return;
  started = true;
  api.senders.trusted().then(publish).catch(() => publish([]));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  start();
  return () => listeners.delete(listener);
}

export function useTrustedSenders(): ReadonlySet<string> | null {
  return useSyncExternalStore(subscribe, () => current);
}

const fail = (error: unknown) => toast.error(error instanceof Error ? error.message : String(error));

export function trustSender(email: string): void {
  api.senders.trust(email).then(publish).catch(fail);
}

export function untrustSender(email: string): void {
  api.senders.untrust(email).then(publish).catch(fail);
}

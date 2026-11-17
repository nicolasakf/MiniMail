import { useCallback, useEffect, useSyncExternalStore } from "react";

import { toast } from "@/lib/toast";

import type { NotificationSettings } from "@shared/notifications";

import { api } from "@/lib/api";

/**
 * The notification settings, shared by every part of the window (the Notifications page and the
 * Mute commands in the mail list), so a sender muted from a menu shows on the page at once. Saved
 * the moment a choice changes; if saving fails the stored value comes back and a toast says why.
 */
let current: NotificationSettings | null = null;
let loading = false;
const listeners = new Set<() => void>();

function publish(next: NotificationSettings | null): void {
  current = next;
  listeners.forEach((listener) => listener());
}

function load(): void {
  if (current || loading) return;
  loading = true;
  api.notifications
    .settings()
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

async function update(change: (current: NotificationSettings) => NotificationSettings): Promise<void> {
  const before = current;
  if (!before) return;
  const next = change(before);
  publish(next);
  try {
    const saved = await api.notifications.setSettings(next);
    if (current === next) publish(saved);
  } catch (error) {
    if (current === next) publish(before);
    toast.error(error instanceof Error ? error.message : String(error));
  }
}

export function useNotificationSettings() {
  const settings = useSyncExternalStore(subscribe, () => current);
  useEffect(load, []);
  const change = useCallback(update, []);
  return { settings, update: change };
}

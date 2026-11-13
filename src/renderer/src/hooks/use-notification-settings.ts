import { useCallback, useEffect, useRef, useState } from "react";

import { toast } from "sonner";

import type { NotificationSettings } from "@shared/notifications";

import { api } from "@/lib/api";

/**
 * The notification settings, saved the moment a choice changes. The page shows the new value at
 * once; if saving fails the stored value comes back and a toast says why.
 */
export function useNotificationSettings() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  /** The latest value, so two quick changes build on each other instead of the older state. */
  const latest = useRef<NotificationSettings | null>(null);

  useEffect(() => {
    api.notifications
      .settings()
      .then((loaded) => {
        latest.current = loaded;
        setSettings(loaded);
      })
      .catch(() => undefined);
  }, []);

  const update = useCallback(async (change: (current: NotificationSettings) => NotificationSettings) => {
    const before = latest.current;
    if (!before) return;
    const next = change(before);
    latest.current = next;
    setSettings(next);
    try {
      const saved = await api.notifications.setSettings(next);
      if (latest.current === next) {
        latest.current = saved;
        setSettings(saved);
      }
    } catch (error) {
      latest.current = before;
      setSettings(before);
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, []);

  return { settings, update };
}

import { existsSync, readFileSync } from "node:fs";

import { DEFAULT_NOTIFICATION_SETTINGS, type NotificationSettings } from "@shared/notifications";
import { notificationSettingsSchema } from "@shared/schemas";

import { writePrivateFile } from "./category-store";

function defaults(): NotificationSettings {
  return structuredClone(DEFAULT_NOTIFICATION_SETTINGS);
}

/**
 * The Notifications page's choices, kept in a small plain file (they hold no mail data). A file
 * from an older version that lacks newer choices keeps the ones it has and gets defaults for the rest.
 */
export class NotificationSettingsStore {
  private value: NotificationSettings = defaults();

  constructor(private readonly filePath: string) {
    if (!existsSync(filePath)) return;
    try {
      const saved = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
      const merged = notificationSettingsSchema.safeParse({ ...defaults(), ...saved });
      if (merged.success) this.value = merged.data;
      else console.error("[notification-settings] using defaults:", merged.error.message);
    } catch (error) {
      console.error("[notification-settings] using defaults:", error);
    }
  }

  get(): NotificationSettings {
    return structuredClone(this.value);
  }

  set(next: NotificationSettings): NotificationSettings {
    this.value = structuredClone(next);
    writePrivateFile(this.filePath, JSON.stringify(this.value));
    return this.get();
  }
}

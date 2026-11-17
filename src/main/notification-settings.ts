import { existsSync, readFileSync } from "node:fs";

import { DEFAULT_NOTIFICATION_SETTINGS, type NotificationSettings } from "@shared/notifications";
import { notificationSettingsSchema } from "@shared/schemas";

import { writePrivateFile } from "./category-store";
import { reportError } from "./events";

function defaults(): NotificationSettings {
  return structuredClone(DEFAULT_NOTIFICATION_SETTINGS);
}

/** Older files silenced accounts with a list; that is now an `enabled: false` choice on the account. */
function migrateMutedAccounts(saved: Record<string, unknown>): void {
  const muted = saved.mutedAccountIds;
  delete saved.mutedAccountIds;
  if (!Array.isArray(muted)) return;
  const accounts: Record<string, unknown> = {};
  const existing = saved.accounts;
  if (existing && typeof existing === "object") Object.assign(accounts, existing);
  for (const id of muted) {
    if (typeof id === "string" && id !== "") accounts[id] = { ...(accounts[id] as object | undefined), enabled: false };
  }
  saved.accounts = accounts;
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
      migrateMutedAccounts(saved);
      const merged = notificationSettingsSchema.safeParse({ ...defaults(), ...saved });
      if (merged.success) this.value = merged.data;
      else reportError("storage", "The notification settings were invalid; using defaults", merged.error.message);
    } catch (error) {
      reportError("storage", "Could not read the notification settings; using defaults", error);
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

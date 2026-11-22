import { DEFAULT_NOTIFICATION_SETTINGS, type NotificationSettings } from "@shared/notifications";
import { notificationSettingsSchema } from "@shared/schemas";

import { reportError } from "./events";
import type { SettingsSection } from "./settings-file";

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
 * The Notifications page's choices, kept in a section of `settings.json` (they hold no mail data). A file
 * from an older version that lacks newer choices keeps the ones it has and gets defaults for the rest.
 */
export class NotificationSettingsStore {
  private value: NotificationSettings = defaults();

  constructor(private readonly section: SettingsSection) {
    const raw = section.read();
    if (raw === undefined) return;
    try {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("The saved notification settings are not an object");
      const saved = structuredClone(raw) as Record<string, unknown>;
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
    this.section.write(this.value);
    return this.get();
  }
}

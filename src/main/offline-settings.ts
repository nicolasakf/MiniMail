import { DEFAULT_OFFLINE_SETTINGS, type OfflineSettings } from "@shared/offline";
import { offlineSettingsSchema } from "@shared/schemas";

import { reportError } from "./events";
import { migrate } from "./migrate";
import type { SettingsSection } from "./settings-file";

/** The version of the `offline` section of `settings.json`. */
const OFFLINE_SETTINGS_VERSION = 2;

/**
 * Version 1 (no `version` in the file) had the switch and the look-back only, and only the Inbox was
 * downloaded. Version 2 adds the folders and what bounds the saved text; an older section keeps what it had:
 * the Inbox, limited in days, as before.
 */
const STEPS = {
  1: (payload: unknown): unknown => ({
    folders: [...DEFAULT_OFFLINE_SETTINGS.folders],
    limit: "days",
    maxMegabytes: DEFAULT_OFFLINE_SETTINGS.maxMegabytes,
    ...(payload as Record<string, unknown>),
  }),
} as const;

/**
 * The Advanced page's choices about downloading mail ahead of time, kept in the `offline` section of
 * `settings.json` (they hold no mail data). A missing section means the defaults. An older section is upgraded
 * step by step when it is read, and a choice it lacks gets its default; a value out of range is reported and the
 * defaults are used. A section saved by a newer version of the app is left as it is: the defaults are used, and
 * changes are refused instead of overwriting it.
 */
export class OfflineSettingsStore {
  private value: OfflineSettings = structuredClone(DEFAULT_OFFLINE_SETTINGS);
  private newer = false;

  constructor(private readonly section: SettingsSection) {
    const raw = section.read();
    if (raw === undefined) return;
    try {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("The saved offline settings are not an object");
      const found = (raw as { version?: unknown }).version;
      const version = found === undefined ? 1 : found;
      if (typeof version !== "number" || !Number.isInteger(version) || version < 1) throw new Error(`The saved offline settings have an invalid version (${String(found)})`);
      if (version > OFFLINE_SETTINGS_VERSION) {
        this.newer = true;
        reportError("storage", "The offline settings were saved by a newer version of MiniMail; they are left untouched and the defaults are used");
        return;
      }
      const { version: _version, ...saved } = migrate(raw, version, OFFLINE_SETTINGS_VERSION, STEPS) as Record<string, unknown>;
      const merged = offlineSettingsSchema.safeParse({ ...DEFAULT_OFFLINE_SETTINGS, ...saved });
      if (merged.success) this.value = merged.data;
      else reportError("storage", "The offline settings were invalid; using defaults", merged.error.message);
    } catch (error) {
      reportError("storage", "Could not read the offline settings; using defaults", error);
    }
  }

  get(): OfflineSettings {
    return structuredClone(this.value);
  }

  set(next: OfflineSettings): OfflineSettings {
    if (this.newer) throw new Error("The offline settings were saved by a newer version of MiniMail, so this change was not saved");
    const stored = structuredClone(next);
    this.section.write({ version: OFFLINE_SETTINGS_VERSION, ...stored });
    this.value = stored;
    return this.get();
  }
}

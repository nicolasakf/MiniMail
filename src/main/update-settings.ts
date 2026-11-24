import { z } from "zod";

import { DEFAULT_UPDATE_SETTINGS, type UpdateSettings } from "@shared/updates";

import { reportError } from "./events";
import { migrate } from "./migrate";
import type { SettingsSection } from "./settings-file";

/** The version of the `updates` section of `settings.json`. */
const UPDATE_SETTINGS_VERSION = 1;

const savedSchema = z.object({
  check: z.boolean().default(DEFAULT_UPDATE_SETTINGS.check),
  dismissed: z.string().max(64).optional(),
});

/**
 * The Advanced page's choice about looking for a new version, kept in the `updates` section of
 * `settings.json`, plus the version whose notice the person closed (so it is not shown again). A
 * missing section means the defaults; a value that cannot be read is reported and the defaults are used.
 * A section saved by a newer version of the app is left as it is: the defaults are used, and
 * changes are refused instead of overwriting it.
 */
export class UpdateSettingsStore {
  private value: UpdateSettings = { ...DEFAULT_UPDATE_SETTINGS };
  private dismissedVersion: string | undefined;
  private newer = false;

  constructor(private readonly section: SettingsSection) {
    const raw = section.read();
    if (raw === undefined) return;
    try {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("The saved update settings are not an object");
      const found = (raw as { version?: unknown }).version;
      const version = found === undefined ? 1 : found;
      if (typeof version !== "number" || !Number.isInteger(version) || version < 1) throw new Error(`The saved update settings have an invalid version (${String(found)})`);
      if (version > UPDATE_SETTINGS_VERSION) {
        this.newer = true;
        reportError("storage", "The update settings were saved by a newer version of MiniMail; they are left untouched and the defaults are used");
        return;
      }
      const { version: _version, ...saved } = migrate(raw, version, UPDATE_SETTINGS_VERSION, {}) as Record<string, unknown>;
      const parsed = savedSchema.safeParse(saved);
      if (parsed.success) {
        this.value = { check: parsed.data.check };
        this.dismissedVersion = parsed.data.dismissed;
      } else {
        reportError("storage", "The update settings were invalid; using defaults", parsed.error.message);
      }
    } catch (error) {
      reportError("storage", "Could not read the update settings; using defaults", error);
    }
  }

  get(): UpdateSettings {
    return { ...this.value };
  }

  /** The version whose notice the person closed, if any. */
  dismissed(): string | undefined {
    return this.dismissedVersion;
  }

  set(next: UpdateSettings): UpdateSettings {
    this.save({ check: next.check }, this.dismissedVersion);
    return this.get();
  }

  dismiss(version: string): void {
    this.save(this.value, version);
  }

  private save(value: UpdateSettings, dismissed: string | undefined): void {
    if (this.newer) throw new Error("The update settings were saved by a newer version of MiniMail, so this change was not saved");
    this.section.write({ version: UPDATE_SETTINGS_VERSION, ...value, ...(dismissed ? { dismissed } : {}) });
    this.value = { ...value };
    this.dismissedVersion = dismissed;
  }
}

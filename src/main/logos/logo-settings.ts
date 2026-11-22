import { DEFAULT_LOGO_SETTINGS, type LogoSettings } from "@shared/logos";
import { logoSettingsSchema } from "@shared/schemas";

import { reportError } from "../events";
import type { SettingsSection } from "../settings-file";

/** The two logo switches, kept in a section of `settings.json` (they hold no mail data). */
export class LogoSettingsStore {
  private value: LogoSettings = { ...DEFAULT_LOGO_SETTINGS };

  constructor(private readonly section: SettingsSection) {
    const raw = section.read();
    if (raw === undefined) return;
    try {
      this.value = logoSettingsSchema.parse(raw);
    } catch (error) {
      reportError("storage", "Could not read the logo settings; using defaults", error);
    }
  }

  get(): LogoSettings {
    return { ...this.value };
  }

  set(next: LogoSettings): LogoSettings {
    this.value = { ...next };
    this.section.write(this.value);
    return this.get();
  }
}

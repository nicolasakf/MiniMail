import { existsSync, readFileSync } from "node:fs";

import { DEFAULT_LOGO_SETTINGS, type LogoSettings } from "@shared/logos";
import { logoSettingsSchema } from "@shared/schemas";

import { writePrivateFile } from "../category-store";

/** The two logo switches, kept in a small plain file (they hold no mail data). */
export class LogoSettingsStore {
  private value: LogoSettings = { ...DEFAULT_LOGO_SETTINGS };

  constructor(private readonly filePath: string) {
    if (!existsSync(filePath)) return;
    try {
      this.value = logoSettingsSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
    } catch (error) {
      console.error("[logo-settings] using defaults:", error);
    }
  }

  get(): LogoSettings {
    return { ...this.value };
  }

  set(next: LogoSettings): LogoSettings {
    this.value = { ...next };
    writePrivateFile(this.filePath, JSON.stringify(this.value));
    return this.get();
  }
}

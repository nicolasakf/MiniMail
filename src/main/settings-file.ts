import { existsSync, readFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";

import { z } from "zod";

import { writePrivateFile } from "./category-store";
import { reportError } from "./events";
import { migrate, NewerFileError } from "./migrate";

/** The version of the container. Each section keeps its own `version`, upgraded by the store that owns it. */
const SETTINGS_VERSION = 1;

/** The kinds of choices kept in `settings.json`. */
export type SettingsSectionName = "ui" | "notifications" | "ai" | "logos" | "cli";

/**
 * Until `settings.json` existed, each section was a file of its own. Their content is taken over
 * exactly as it was (old formats included: the store that owns a section upgrades it when it reads it).
 */
const LEGACY_FILES: Readonly<Partial<Record<SettingsSectionName, string>>> = {
  ui: "ui-prefs.json",
  notifications: "notification-settings.json",
  ai: "ai-settings.json",
  logos: "logo-settings.json",
  // `cli` is newer than the one-file-per-section days: it never had a file of its own.
};

const containerSchema = z.object({ version: z.number().int().min(1) }).passthrough();

/** What a store sees of the file: its own section, read once at start and rewritten whole on every change. */
export interface SettingsSection {
  /** The saved value, or `undefined` when nothing was saved yet. */
  read(): unknown;
  write(value: unknown): void;
}

/**
 * The choices the person made, in one small plain file (`settings.json`, no mail data and no
 * secrets: keys live in `AiKeyStore`). It is `{ version, ui, notifications, ai, logos, cli }`; a section that is
 * missing (`cli` in a file written before it existed) simply has its defaults.
 *
 * - First start after the change: the four old files are read into it, then renamed to
 *   `<name>.migrated` so nothing is lost. A file that cannot be read is set aside as `.corrupt` and reported.
 * - A file written by a newer version of the app is left alone: it is reported, and changes are
 *   refused instead of overwriting it.
 * - A `settings.json` that is corrupt is set aside as `.corrupt` and reported, and the app starts from defaults.
 */
export class SettingsFile {
  private sections: Record<string, unknown> = {};
  private newer: NewerFileError | null = null;

  constructor(private readonly filePath: string) {
    if (existsSync(filePath) && this.load()) return;
    this.importLegacyFiles();
  }

  section(name: SettingsSectionName): SettingsSection {
    return { read: () => this.sections[name], write: (value) => this.write(name, value) };
  }

  /** Returns false when the file had to be set aside, so the old files are still looked for. */
  private load(): boolean {
    try {
      const { version, ...sections } = containerSchema.parse(JSON.parse(readFileSync(this.filePath, "utf8")));
      migrate(sections, version, SETTINGS_VERSION, {});
      this.sections = sections;
      return true;
    } catch (error) {
      if (error instanceof NewerFileError) {
        this.newer = error;
        reportError("storage", "The settings were saved by a newer version of MiniMail; they are left untouched", error);
        return true;
      }
      this.setAside(this.filePath, "settings.json");
      reportError("storage", "Could not read settings.json; it was set aside and the defaults are used", error);
      return false;
    }
  }

  private importLegacyFiles(): void {
    const imported: string[] = [];
    for (const [name, file] of Object.entries(LEGACY_FILES)) {
      const path = join(dirname(this.filePath), file);
      if (!existsSync(path)) continue;
      try {
        this.sections[name] = JSON.parse(readFileSync(path, "utf8"));
        imported.push(path);
      } catch (error) {
        this.setAside(path, file);
        reportError("storage", `Could not read ${file}; it was set aside and the defaults are used`, error);
      }
    }
    if (imported.length === 0) return;
    try {
      this.persist();
    } catch (error) {
      // The old files stay where they are, so the next start imports them again.
      reportError("storage", "Could not save settings.json; the old settings files are kept", error);
      return;
    }
    for (const path of imported) this.setAside(path, path, ".migrated");
  }

  private write(name: SettingsSectionName, value: unknown): void {
    if (this.newer) throw new Error("The settings were saved by a newer version of MiniMail, so this change was not saved", { cause: this.newer });
    this.sections[name] = value;
    this.persist();
  }

  private persist(): void {
    writePrivateFile(this.filePath, JSON.stringify({ version: SETTINGS_VERSION, ...this.sections }));
  }

  private setAside(path: string, label: string, suffix = ".corrupt"): void {
    try {
      renameSync(path, `${path}${suffix}`);
    } catch (error) {
      reportError("storage", `Could not rename ${label}`, error);
    }
  }
}

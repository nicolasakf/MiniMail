import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { SettingsFile, type SettingsSection, type SettingsSectionName } from "./settings-file";

/** Test helpers: a section of the `settings.json` at `file`, as a store opens it at start. */
export function sectionAt(file: string, name: SettingsSectionName): SettingsSection {
  return new SettingsFile(file).section(name);
}

/** Puts `raw` in a section of `file` the way an older version of the app would have saved it. */
export function seedSection(file: string, name: SettingsSectionName, raw: unknown): void {
  const saved = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : { version: 1 };
  writeFileSync(file, JSON.stringify({ ...saved, [name]: raw }));
}

/** What a section holds on disk right now. */
export function savedSection(file: string, name: SettingsSectionName): Record<string, unknown> {
  return (JSON.parse(readFileSync(file, "utf8")) as Record<string, Record<string, unknown>>)[name];
}

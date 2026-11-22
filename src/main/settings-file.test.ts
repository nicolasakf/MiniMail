import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_LOGO_SETTINGS } from "@shared/logos";
import { DEFAULT_NOTIFICATION_SETTINGS } from "@shared/notifications";

import { AiSettingsStore } from "./ai-settings";
import { LogoSettingsStore } from "./logos/logo-settings";
import { NotificationSettingsStore } from "./notification-settings";
import { SettingsFile } from "./settings-file";
import { UiPrefsStore } from "./ui-prefs";

let dir: string;
const path = (name: string) => join(dir, name);
const write = (name: string, contents: unknown) => writeFileSync(path(name), typeof contents === "string" ? contents : JSON.stringify(contents));
const saved = () => JSON.parse(readFileSync(path("settings.json"), "utf8")) as Record<string, unknown>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "minimail-settings-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("SettingsFile", () => {
  it("takes over the four old files exactly as they were, upgrades each in its own store, and keeps the old files as .migrated", () => {
    write("ui-prefs.json", { version: 1, view: "sender", unreadOnly: true, shownFolders: ["inbox", "spam"], pinnedDrafts: ["local-draft:d1"] });
    write("notification-settings.json", { sound: false, mutedAccountIds: ["a1"] });
    write("ai-settings.json", { version: 1, codeModel: "mine/own", sortFolders: ["inbox", "spam"] });
    write("logo-settings.json", { ...DEFAULT_LOGO_SETTINGS });

    const file = new SettingsFile(path("settings.json"));

    expect(new UiPrefsStore(file.section("ui")).get()).toEqual({
      view: "sender",
      unreadOnly: true,
      shownFolders: ["inbox", "spam"],
      pinnedDrafts: ["local-draft:d1"],
      onboarded: true,
    });
    const notifications = new NotificationSettingsStore(file.section("notifications")).get();
    expect(notifications.sound).toBe(false);
    expect(notifications.accounts).toEqual({ a1: { enabled: false } });
    const ai = new AiSettingsStore(file.section("ai"));
    expect(ai.codeModel()).toBe("mine/own");
    expect(ai.sortFolders()).toEqual(["inbox", "spam"]);
    expect(new LogoSettingsStore(file.section("logos")).get()).toEqual(DEFAULT_LOGO_SETTINGS);

    // Written once, with the old content untouched, and the old files are renamed, not deleted.
    expect(saved()).toMatchObject({ version: 1, ui: { version: 1 }, ai: { version: 1 }, notifications: { sound: false } });
    for (const name of ["ui-prefs", "notification-settings", "ai-settings", "logo-settings"]) {
      expect(existsSync(path(`${name}.json`))).toBe(false);
      expect(existsSync(path(`${name}.json.migrated`))).toBe(true);
    }
  });

  it("opens the same on the next start and does not look at the old files again", () => {
    write("ai-settings.json", { version: 2, codeModel: "mine/own", sortModel: "x/y", sortFolders: ["spam"] });
    new SettingsFile(path("settings.json"));
    write("ai-settings.json", { version: 3, codeModel: "ignored", sortFolders: [] });
    const again = new AiSettingsStore(new SettingsFile(path("settings.json")).section("ai"));
    expect(again.codeModel()).toBe("mine/own");
    expect(again.sortFolders()).toEqual(["spam"]);
  });

  it("imports only the files that exist, and the others start from defaults", () => {
    write("ui-prefs.json", { version: 2, view: "list", onboarded: false });
    const file = new SettingsFile(path("settings.json"));
    expect(new UiPrefsStore(file.section("ui")).get().view).toBe("list");
    expect(new NotificationSettingsStore(file.section("notifications")).get()).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    expect(saved()).not.toHaveProperty("notifications");
  });

  it("writes nothing on a fresh install until something is chosen", () => {
    const file = new SettingsFile(path("settings.json"));
    expect(existsSync(path("settings.json"))).toBe(false);
    new UiPrefsStore(file.section("ui")).set({ view: "list" });
    expect(saved()).toMatchObject({ version: 1, ui: { version: 2, view: "list" } });
  });

  it("writes one section without touching the others", () => {
    const file = new SettingsFile(path("settings.json"));
    new UiPrefsStore(file.section("ui")).set({ view: "list" });
    new AiSettingsStore(file.section("ai")).setCodeModel("a/b");
    new UiPrefsStore(file.section("ui")).set({ unreadOnly: true });
    expect(saved()).toMatchObject({ ui: { view: "list", unreadOnly: true }, ai: { codeModel: "a/b" } });
  });

  it("sets an old file that cannot be read aside, keeps the others, and uses defaults for it", () => {
    write("ui-prefs.json", "{broken");
    write("ai-settings.json", { version: 3, codeModel: "mine/own" });
    const file = new SettingsFile(path("settings.json"));
    expect(new UiPrefsStore(file.section("ui")).get().view).toBe("category");
    expect(new AiSettingsStore(file.section("ai")).codeModel()).toBe("mine/own");
    expect(readFileSync(path("ui-prefs.json.corrupt"), "utf8")).toBe("{broken");
    expect(existsSync(path("ai-settings.json.migrated"))).toBe(true);
  });

  it("sets a corrupt settings.json aside instead of deleting it", () => {
    write("settings.json", "{broken");
    const file = new SettingsFile(path("settings.json"));
    expect(new UiPrefsStore(file.section("ui")).get().view).toBe("category");
    expect(readFileSync(path("settings.json.corrupt"), "utf8")).toBe("{broken");
    new UiPrefsStore(file.section("ui")).set({ view: "list" });
    expect(saved()).toMatchObject({ ui: { view: "list" } });
  });

  it("leaves a file from a newer version untouched and refuses changes instead of overwriting it", () => {
    const newer = { version: 2, ui: { version: 9, view: "list" }, somethingNew: { a: 1 } };
    write("settings.json", newer);
    const prefs = new UiPrefsStore(new SettingsFile(path("settings.json")).section("ui"));
    expect(prefs.get().view).toBe("category");
    expect(() => prefs.set({ view: "sender" })).toThrow(/newer version/);
    expect(saved()).toEqual(newer);
  });

  it("keeps the old files when settings.json cannot be written, so the next start imports them", () => {
    write("ui-prefs.json", { version: 2, view: "list" });
    mkdirSync(path("settings.json.tmp")); // the write goes through this name, so it fails
    expect(new UiPrefsStore(new SettingsFile(path("settings.json")).section("ui")).get().view).toBe("list");
    expect(existsSync(path("ui-prefs.json"))).toBe(true);
    expect(existsSync(path("ui-prefs.json.migrated"))).toBe(false);

    rmSync(path("settings.json.tmp"), { recursive: true });
    new SettingsFile(path("settings.json"));
    expect(existsSync(path("ui-prefs.json.migrated"))).toBe(true);
  });
});

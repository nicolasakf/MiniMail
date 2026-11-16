import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_NOTIFICATION_SETTINGS } from "@shared/notifications";

import { NotificationSettingsStore } from "./notification-settings";

function fileWith(contents: unknown): string {
  const path = join(mkdtempSync(join(tmpdir(), "minimail-notify-")), "notification-settings.json");
  writeFileSync(path, JSON.stringify(contents));
  return path;
}

describe("NotificationSettingsStore", () => {
  it("turns an old muted-accounts list into per-account overrides", () => {
    const store = new NotificationSettingsStore(
      fileWith({ ...DEFAULT_NOTIFICATION_SETTINGS, accounts: undefined, mutedAccountIds: ["a1", "a2"], sound: false }),
    );
    expect(store.get().accounts).toEqual({ a1: { enabled: false }, a2: { enabled: false } });
    expect(store.get().sound).toBe(false);
    expect(store.get()).not.toHaveProperty("mutedAccountIds");
  });

  it("keeps saved overrides and fills in defaults for a file without them", () => {
    const store = new NotificationSettingsStore(fileWith({ content: "hidden" }));
    expect(store.get().content).toBe("hidden");
    expect(store.get().accounts).toEqual({});
  });

  it("drops the removed quiet hours from an older file and keeps the rest", () => {
    const quiet = { enabled: true, start: "22:00", end: "07:00" };
    const store = new NotificationSettingsStore(
      fileWith({ sound: false, quietHours: quiet, accounts: { a1: { content: "hidden", quietHours: quiet } } }),
    );
    expect(store.get().sound).toBe(false);
    expect(store.get().accounts).toEqual({ a1: { content: "hidden" } });
    expect(store.get()).not.toHaveProperty("quietHours");
  });
});

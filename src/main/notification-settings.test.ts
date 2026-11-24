import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_NOTIFICATION_SETTINGS } from "@shared/notifications";

import { NotificationSettingsStore } from "./notification-settings";
import type { SettingsSection } from "./settings-file";
import { sectionAt, seedSection } from "./test-settings";

function fileWith(contents: unknown): SettingsSection {
  const path = join(mkdtempSync(join(tmpdir(), "minimail-notify-")), "settings.json");
  seedSection(path, "notifications", contents);
  return sectionAt(path, "notifications");
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

  it("turns the old stay-quiet switch into the while-open choice, for the defaults and for accounts", () => {
    const on = new NotificationSettingsStore(fileWith({ muteWhenFocused: true, sound: false }));
    expect(on.get().whenOpen).toBe("quiet");
    expect(on.get().sound).toBe(false);
    expect(on.get()).not.toHaveProperty("muteWhenFocused");

    const off = new NotificationSettingsStore(
      fileWith({ muteWhenFocused: false, accounts: { a1: { muteWhenFocused: true, content: "hidden" }, a2: { muteWhenFocused: false } } }),
    );
    expect(off.get().whenOpen).toBe("notification");
    expect(off.get().accounts).toEqual({ a1: { whenOpen: "quiet", content: "hidden" }, a2: { whenOpen: "notification" } });
  });

  it("keeps a while-open choice that is already saved and defaults to quiet without one", () => {
    expect(new NotificationSettingsStore(fileWith({ whenOpen: "toast", muteWhenFocused: false })).get().whenOpen).toBe("toast");
    expect(new NotificationSettingsStore(fileWith({ sound: true })).get().whenOpen).toBe("quiet");
  });
});

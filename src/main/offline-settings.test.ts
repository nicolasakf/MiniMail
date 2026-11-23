import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reported = vi.hoisted(() => [] as string[]);
vi.mock("./events", () => ({
  reportError: (_area: string, title: string) => void reported.push(title),
  recordInfo: () => undefined,
  recordAction: () => undefined,
}));

import { DEFAULT_OFFLINE_SETTINGS, DAYS_LIMIT_CEILING_BYTES, prefetchSince, storeLimitBytes, type OfflineSettings } from "@shared/offline";
import { offlineSettingsSchema } from "@shared/schemas";

import { OfflineSettingsStore } from "./offline-settings";
import { savedSection, sectionAt, seedSection } from "./test-settings";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "minimail-offline-"));
  file = join(dir, "settings.json");
  reported.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const open = () => new OfflineSettingsStore(sectionAt(file, "offline"));
const custom: OfflineSettings = { prefetch: false, folders: ["inbox", "archive"], limit: "size", lookbackDays: 90, maxMegabytes: 2048 };

describe("OfflineSettingsStore", () => {
  it("starts with the Inbox downloaded ahead of time for the last 30 days", () => {
    expect(open().get()).toEqual({ prefetch: true, folders: ["inbox"], limit: "days", lookbackDays: 30, maxMegabytes: 512 });
  });

  it("saves a change in its own section, with its version, and reads it back after a restart", () => {
    open().set(custom);
    expect(savedSection(file, "offline")).toEqual({ version: 2, ...custom });
    expect(open().get()).toEqual(custom);
  });

  it("upgrades a version 1 section, which had only the switch and the look-back, keeping what it had", () => {
    seedSection(file, "offline", { prefetch: false, lookbackDays: 90 });
    expect(open().get()).toEqual({ prefetch: false, folders: ["inbox"], limit: "days", lookbackDays: 90, maxMegabytes: 512 });
    expect(reported).toEqual([]);
  });

  it("upgrades a version 1 section that names its version too", () => {
    seedSection(file, "offline", { version: 1, prefetch: true, lookbackDays: 7 });
    expect(open().get()).toMatchObject({ prefetch: true, folders: ["inbox"], limit: "days", lookbackDays: 7 });
  });

  it("writes the upgraded section the next time something is saved, never before", () => {
    seedSection(file, "offline", { prefetch: true, lookbackDays: 7 });
    const store = open();
    expect(savedSection(file, "offline")).toEqual({ prefetch: true, lookbackDays: 7 });
    store.set({ ...store.get(), folders: ["inbox", "spam"] });
    expect(savedSection(file, "offline")).toMatchObject({ version: 2, lookbackDays: 7, folders: ["inbox", "spam"] });
  });

  it("keeps the choices a section has and fills in the rest", () => {
    seedSection(file, "offline", { version: 2, lookbackDays: 7 });
    expect(open().get()).toEqual({ ...DEFAULT_OFFLINE_SETTINGS, lookbackDays: 7 });
  });

  it("uses the defaults, and says so, when what is saved is out of range", () => {
    seedSection(file, "offline", { prefetch: true, lookbackDays: 100000 });
    expect(open().get()).toEqual(DEFAULT_OFFLINE_SETTINGS);
    expect(reported).toEqual(["The offline settings were invalid; using defaults"]);
  });

  it("leaves a section from a newer version alone: defaults, and a change is refused", () => {
    const newer = { version: 3, prefetch: false, folders: ["inbox"], limit: "days", lookbackDays: 5, maxMegabytes: 512, somethingNew: true };
    seedSection(file, "offline", newer);
    const store = open();
    expect(store.get()).toEqual(DEFAULT_OFFLINE_SETTINGS);
    expect(reported).toEqual(["The offline settings were saved by a newer version of MiniMail; they are left untouched and the defaults are used"]);
    expect(() => store.set(custom)).toThrow(/newer version/);
    expect(savedSection(file, "offline")).toEqual(newer);
  });

  it("uses the defaults, and says so, when the section is not readable", () => {
    seedSection(file, "offline", "garbage");
    expect(open().get()).toEqual(DEFAULT_OFFLINE_SETTINGS);
    expect(reported).toEqual(["Could not read the offline settings; using defaults"]);
  });
});

describe("offlineSettingsSchema", () => {
  it("refuses a look-back that is not a whole number of days in range", () => {
    for (const lookbackDays of [0, -3, 1.5, 366, Number.NaN]) {
      expect(offlineSettingsSchema.safeParse({ ...DEFAULT_OFFLINE_SETTINGS, lookbackDays }).success).toBe(false);
    }
    for (const lookbackDays of [1, 365]) expect(offlineSettingsSchema.safeParse({ ...DEFAULT_OFFLINE_SETTINGS, lookbackDays }).success).toBe(true);
  });

  it("refuses a size that is not a whole number of megabytes in range", () => {
    for (const maxMegabytes of [0, 49, 1.5, 51_201, Number.NaN]) {
      expect(offlineSettingsSchema.safeParse({ ...DEFAULT_OFFLINE_SETTINGS, maxMegabytes }).success).toBe(false);
    }
    for (const maxMegabytes of [50, 51_200]) expect(offlineSettingsSchema.safeParse({ ...DEFAULT_OFFLINE_SETTINGS, maxMegabytes }).success).toBe(true);
  });

  it("needs at least one folder, each at most once, and only folders that can be kept", () => {
    for (const folders of [[], ["inbox", "inbox"], ["drafts"], ["sent"], ["pinned"]]) {
      expect(offlineSettingsSchema.safeParse({ ...DEFAULT_OFFLINE_SETTINGS, folders }).success).toBe(false);
    }
    expect(offlineSettingsSchema.safeParse({ ...DEFAULT_OFFLINE_SETTINGS, folders: ["inbox", "archive", "trash", "spam"] }).success).toBe(true);
  });

  it("knows three limits", () => {
    for (const limit of ["days", "size", "unlimited"]) expect(offlineSettingsSchema.safeParse({ ...DEFAULT_OFFLINE_SETTINGS, limit }).success).toBe(true);
    expect(offlineSettingsSchema.safeParse({ ...DEFAULT_OFFLINE_SETTINGS, limit: "forever" }).success).toBe(false);
  });
});

describe("what a limit means", () => {
  const now = Date.parse("2026-11-22T12:00:00Z");

  it("in days: a window back from today, and a ceiling on the file", () => {
    const settings = { ...DEFAULT_OFFLINE_SETTINGS, limit: "days", lookbackDays: 2 } as const;
    expect(prefetchSince(settings, now)).toBe(now - 2 * 24 * 60 * 60 * 1000);
    expect(storeLimitBytes(settings)).toBe(DAYS_LIMIT_CEILING_BYTES);
  });

  it("in size: no window, and the size chosen", () => {
    const settings = { ...DEFAULT_OFFLINE_SETTINGS, limit: "size", maxMegabytes: 100 } as const;
    expect(prefetchSince(settings, now)).toBeNull();
    expect(storeLimitBytes(settings)).toBe(100 * 1024 * 1024);
  });

  it("unlimited: no window and no size", () => {
    const settings = { ...DEFAULT_OFFLINE_SETTINGS, limit: "unlimited" } as const;
    expect(prefetchSince(settings, now)).toBeNull();
    expect(storeLimitBytes(settings)).toBeNull();
  });
});

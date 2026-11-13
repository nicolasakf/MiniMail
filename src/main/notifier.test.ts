import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_NOTIFICATION_SETTINGS, type NotificationSettings, type NotifyFolder } from "@shared/notifications";
import type { ListResult, MessageSummary } from "@shared/types";

import { NotificationSettingsStore } from "./notification-settings";
import { Notifier, type ShownNotification } from "./notifier";

/** Noon local time, so quiet-hour windows mean the same thing in every time zone. */
const NOW = new Date(2026, 10, 12, 12, 0, 0);

function message(id: string, patch: Partial<MessageSummary> = {}): MessageSummary {
  return {
    id: `a1|inbox|${id}`,
    accountId: "a1",
    folder: "inbox",
    threadId: `t${id}`,
    from: { name: `Sender ${id}`, email: `s${id}@acme.com` },
    to: [],
    subject: `Subject ${id}`,
    snippet: `Preview ${id}`,
    date: new Date(NOW.getTime() - 60_000).toISOString(),
    unread: true,
    pinned: false,
    answered: false,
    hasAttachments: false,
    signal: "person",
    categoryId: null,
    ...patch,
  };
}

function setup(initial: Partial<NotificationSettings> = {}) {
  let settings: NotificationSettings = { ...structuredClone(DEFAULT_NOTIFICATION_SETTINGS), muteWhenFocused: false, ...initial };
  const folders: Record<NotifyFolder, MessageSummary[]> = { inbox: [], archive: [], spam: [], trash: [] };
  const shown: ShownNotification[] = [];
  const badge: number[] = [];
  let clock = NOW.getTime();
  let focused = false;
  let busy = false;
  const notifier = new Notifier({
    settings: () => settings,
    list: async (folder): Promise<ListResult> => ({ messages: [...folders[folder]], errors: [] }),
    accountIds: () => ["a1"],
    focused: () => focused,
    show: (notification) => shown.push(notification),
    setBadge: (count) => badge.push(count),
    sortingBusy: () => busy,
    now: () => new Date(clock),
  });
  return {
    notifier,
    folders,
    shown,
    badge,
    set: (patch: Partial<NotificationSettings>) => (settings = { ...settings, ...patch }),
    focus: (value: boolean) => (focused = value),
    sorting: (value: boolean) => (busy = value),
    /** Moves the clock forward and checks. */
    check: async (ms = 10_000) => {
      clock += ms;
      await notifier.check();
    },
  };
}

describe("Notifier", () => {
  it("learns what is already there without notifying, then notifies only for new mail", async () => {
    const t = setup();
    t.folders.inbox = [message("1")];
    await t.check();
    expect(t.shown).toHaveLength(0);

    t.folders.inbox = [message("2"), message("1")];
    await t.check();
    expect(t.shown).toEqual([{ title: "Sender 2", body: "Subject 2\nPreview 2", silent: false }]);

    await t.check();
    expect(t.shown).toHaveLength(1); // The same message never notifies twice.
  });

  it("does not notify for Spam or Trash by default", async () => {
    const t = setup();
    await t.check();
    t.folders.spam = [message("3", { id: "a1|spam|3", folder: "spam" })];
    t.folders.trash = [message("4", { id: "a1|trash|4", folder: "trash" })];
    await t.check();
    expect(t.shown).toHaveLength(0);
  });

  it("notifies for Spam once the user opts in, and names the folder", async () => {
    const t = setup({ folders: ["inbox", "spam"] });
    await t.check();
    t.folders.spam = [message("3", { id: "a1|spam|3", folder: "spam" })];
    await t.check();
    expect(t.shown.map((item) => item.title)).toEqual(["Spam · Sender 3"]);
  });

  it("does not announce mail the user moved into another folder", async () => {
    const t = setup({ folders: ["inbox", "archive"] });
    await t.check();
    t.folders.archive = [message("5", { id: "a1|archive|5", folder: "archive" })];
    t.notifier.userMoved();
    await t.check();
    expect(t.shown).toHaveLength(0);
  });

  it("ignores old messages that merely appear in a watched folder", async () => {
    const t = setup();
    await t.check();
    t.folders.inbox = [message("6", { date: new Date(NOW.getTime() - 3 * 3600_000).toISOString() })];
    await t.check();
    expect(t.shown).toHaveLength(0);
  });

  it("applies category, account and sender filters", async () => {
    const t = setup({
      categories: { mode: "only", ids: ["work"] },
      mutedSenders: ["@acme.com"],
    });
    await t.check();
    t.folders.inbox = [message("7", { categoryId: "work" }), message("8", { categoryId: "work", from: { name: "Bo", email: "bo@ok.com" } })];
    await t.check();
    expect(t.shown.map((item) => item.title)).toEqual(["Bo"]);
  });

  it("waits for the AI sorter before judging a category", async () => {
    const t = setup({ categories: { mode: "only", ids: ["work"] } });
    await t.check();
    t.sorting(true);
    t.folders.inbox = [message("9")]; // Rule-based category for now: none.
    await t.check();
    expect(t.shown).toHaveLength(0);

    t.sorting(false);
    t.folders.inbox = [message("9", { categoryId: "work" })]; // The sorter answered.
    await t.check();
    expect(t.shown).toHaveLength(1);
  });

  it("stops waiting for the sorter after a grace period and uses the category it has", async () => {
    const t = setup({ categories: { mode: "except", ids: ["promo"] } });
    await t.check();
    t.sorting(true);
    t.folders.inbox = [message("14")];
    await t.check(5_000);
    expect(t.shown).toHaveLength(0);
    await t.check(31_000); // Still busy, but the wait is over: judged by the category it has (none).
    expect(t.shown.map((item) => item.title)).toEqual(["Sender 14"]);
  });

  it("stays quiet during quiet hours and while focused", async () => {
    const t = setup({ quietHours: { enabled: true, start: "11:00", end: "13:00" } });
    await t.check();
    t.folders.inbox = [message("10")];
    await t.check();
    expect(t.shown).toHaveLength(0);

    const u = setup({ muteWhenFocused: true });
    await u.check();
    u.focus(true);
    u.folders.inbox = [message("11")];
    await u.check();
    expect(u.shown).toHaveLength(0);
  });

  it("combines a burst into one notification, or keeps them apart when asked", async () => {
    const burst = ["1", "2", "3", "4", "5"].map((id) => message(id));
    const grouped = setup();
    await grouped.check();
    grouped.folders.inbox = burst;
    await grouped.check();
    expect(grouped.shown).toHaveLength(1);
    expect(grouped.shown[0].title).toBe("5 new messages");
    expect(grouped.shown[0].body).toMatch(/^From Sender \d, Sender \d and 3 others$/);

    const apart = setup({ groupBursts: false });
    await apart.check();
    apart.folders.inbox = burst;
    await apart.check();
    expect(apart.shown).toHaveLength(5);
  });

  it("hides details and the sound when asked", async () => {
    const t = setup({ content: "hidden", sound: false });
    await t.check();
    t.folders.inbox = [message("12")];
    await t.check();
    expect(t.shown).toEqual([{ title: "New mail", body: "", silent: true }]);

    const s = setup({ content: "sender" });
    await s.check();
    s.folders.inbox = [message("13")];
    await s.check();
    expect(s.shown).toEqual([{ title: "Sender 13", body: "New message", silent: false }]);
  });

  it("keeps the Dock badge at the unread Inbox count, excluding silenced accounts", async () => {
    const t = setup();
    t.folders.inbox = [message("1"), message("2"), message("3", { unread: false })];
    await t.check();
    expect(t.badge.at(-1)).toBe(2);

    t.set({ mutedAccountIds: ["a1"] });
    await t.check();
    expect(t.badge.at(-1)).toBe(0);

    t.set({ mutedAccountIds: [], dockBadge: false });
    await t.check();
    expect(t.badge.at(-1)).toBe(0);
  });

  it("clears everything and learns silently when switched off and on again", async () => {
    const t = setup();
    t.folders.inbox = [message("1")];
    await t.check();
    t.set({ enabled: false });
    await t.check();
    expect(t.badge.at(-1)).toBe(0);

    t.folders.inbox = [message("2"), message("1")];
    t.set({ enabled: true });
    await t.check();
    expect(t.shown).toHaveLength(0);
  });

  it("sends a sample notification", () => {
    const t = setup({ sound: false });
    t.notifier.test();
    expect(t.shown).toEqual([{ title: "MiniMail", body: "This is how a notification will look.", silent: true }]);
  });
});

describe("NotificationSettingsStore", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "minimail-notify-"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it("starts from the defaults and remembers a change", () => {
    const path = join(dir, "n.json");
    const store = new NotificationSettingsStore(path);
    expect(store.get()).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    store.set({ ...store.get(), sound: false, folders: ["inbox", "archive"] });
    expect(new NotificationSettingsStore(path).get()).toMatchObject({ sound: false, folders: ["inbox", "archive"] });
  });

  it("keeps saved choices and fills in newer ones from an older file", () => {
    const path = join(dir, "n.json");
    writeFileSync(path, JSON.stringify({ sound: false }));
    expect(new NotificationSettingsStore(path).get()).toEqual({ ...DEFAULT_NOTIFICATION_SETTINGS, sound: false });
  });

  it("falls back to the defaults when the file is damaged", () => {
    const path = join(dir, "n.json");
    writeFileSync(path, JSON.stringify({ folders: ["bogus"] }));
    expect(new NotificationSettingsStore(path).get()).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
  });
});

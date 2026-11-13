import { describe, expect, it } from "vitest";

import {
  categoryAllowed,
  DEFAULT_NOTIFICATION_SETTINGS,
  inQuietHours,
  isSenderMuted,
  messageNotifies,
  normalizeMutedSender,
  NO_CATEGORY,
  parseClock,
  type NotificationSettings,
} from "./notifications";
import { notificationSettingsSchema } from "./schemas";
import type { MessageSummary } from "./types";

function settings(patch: Partial<NotificationSettings> = {}): NotificationSettings {
  return { ...structuredClone(DEFAULT_NOTIFICATION_SETTINGS), ...patch };
}

function message(patch: Partial<MessageSummary> = {}): MessageSummary {
  return {
    id: "a1|inbox|1",
    accountId: "a1",
    folder: "inbox",
    threadId: "t1",
    from: { name: "Ana", email: "ana@acme.com" },
    to: [],
    subject: "Hello",
    snippet: "",
    date: "2026-11-12T10:00:00Z",
    unread: true,
    pinned: false,
    answered: false,
    hasAttachments: false,
    signal: "person",
    categoryId: null,
    ...patch,
  };
}

describe("default notification settings", () => {
  it("notify for the Inbox only, so Spam and Trash stay silent", () => {
    expect(DEFAULT_NOTIFICATION_SETTINGS.folders).toEqual(["inbox"]);
    expect(messageNotifies(message(), settings())).toBe(true);
    expect(messageNotifies(message({ folder: "spam" }), settings())).toBe(false);
    expect(messageNotifies(message({ folder: "trash" }), settings())).toBe(false);
    expect(messageNotifies(message({ folder: "archive" }), settings())).toBe(false);
  });

  it("pass the schema", () => {
    expect(notificationSettingsSchema.safeParse(DEFAULT_NOTIFICATION_SETTINGS).success).toBe(true);
  });
});

describe("messageNotifies", () => {
  it("lets the user opt in to Spam or Trash", () => {
    const on = settings({ folders: ["inbox", "spam"] });
    expect(messageNotifies(message({ folder: "spam" }), on)).toBe(true);
    expect(messageNotifies(message({ folder: "trash" }), on)).toBe(false);
  });

  it("ignores mail that is already read, and everything when switched off", () => {
    expect(messageNotifies(message({ unread: false }), settings())).toBe(false);
    expect(messageNotifies(message(), settings({ enabled: false }))).toBe(false);
  });

  it("skips silenced accounts and muted senders", () => {
    expect(messageNotifies(message(), settings({ mutedAccountIds: ["a1"] }))).toBe(false);
    expect(messageNotifies(message(), settings({ mutedSenders: ["ana@acme.com"] }))).toBe(false);
    expect(messageNotifies(message(), settings({ mutedSenders: ["@acme.com"] }))).toBe(false);
    expect(messageNotifies(message(), settings({ mutedSenders: ["@other.com"] }))).toBe(true);
  });

  it("applies the category filter", () => {
    const only = settings({ categories: { mode: "only", ids: ["work"] } });
    expect(messageNotifies(message({ categoryId: "work" }), only)).toBe(true);
    expect(messageNotifies(message({ categoryId: "promo" }), only)).toBe(false);
    expect(messageNotifies(message({ categoryId: null }), only)).toBe(false);
  });
});

describe("categoryAllowed", () => {
  it("treats no category as its own choice", () => {
    expect(categoryAllowed({ mode: "only", ids: [NO_CATEGORY] }, null)).toBe(true);
    expect(categoryAllowed({ mode: "except", ids: [NO_CATEGORY] }, null)).toBe(false);
    expect(categoryAllowed({ mode: "except", ids: ["promo"] }, null)).toBe(true);
    expect(categoryAllowed({ mode: "except", ids: ["promo"] }, "promo")).toBe(false);
    expect(categoryAllowed({ mode: "all", ids: ["promo"] }, "promo")).toBe(true);
  });
});

describe("muted senders", () => {
  it("normalizes addresses and domains and rejects the rest", () => {
    expect(normalizeMutedSender("  News@Example.COM ")).toBe("news@example.com");
    expect(normalizeMutedSender("@Example.com")).toBe("@example.com");
    expect(normalizeMutedSender("example.com")).toBeNull();
    expect(normalizeMutedSender("not an address")).toBeNull();
    expect(normalizeMutedSender("@")).toBeNull();
  });

  it("matches case-insensitively", () => {
    expect(isSenderMuted("ANA@Acme.com", ["ana@acme.com"])).toBe(true);
    expect(isSenderMuted("bob@sub.acme.com", ["@acme.com"])).toBe(false);
  });
});

describe("quiet hours", () => {
  const at = (hours: number, minutes = 0) => new Date(2026, 10, 12, hours, minutes);
  const overnight = { enabled: true, start: "22:00", end: "07:00" };

  it("spans midnight", () => {
    expect(inQuietHours(overnight, at(23))).toBe(true);
    expect(inQuietHours(overnight, at(3))).toBe(true);
    expect(inQuietHours(overnight, at(7))).toBe(false);
    expect(inQuietHours(overnight, at(12))).toBe(false);
  });

  it("handles a same-day window and being off", () => {
    const lunch = { enabled: true, start: "12:00", end: "13:30" };
    expect(inQuietHours(lunch, at(13, 29))).toBe(true);
    expect(inQuietHours(lunch, at(13, 30))).toBe(false);
    expect(inQuietHours({ ...overnight, enabled: false }, at(23))).toBe(false);
  });

  it("ignores a window that is empty or malformed", () => {
    expect(inQuietHours({ enabled: true, start: "08:00", end: "08:00" }, at(8))).toBe(false);
    expect(parseClock("25:00")).toBeNull();
    expect(parseClock("7:00")).toBeNull();
    expect(parseClock("07:05")).toBe(425);
  });
});

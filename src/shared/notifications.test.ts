import { describe, expect, it } from "vitest";

import {
  categoryAllowed,
  DEFAULT_NOTIFICATION_SETTINGS,
  isMutedForAccounts,
  isSenderMuted,
  mutedKey,
  messageNotifies,
  normalizeMutedSender,
  NO_CATEGORY,
  settingsForAccount,
  withMutedSenders,
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
    expect(messageNotifies(message(), settings({ accounts: { a1: { enabled: false } } }))).toBe(false);
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
  });

  it("lets a company domain cover its subdomains, and a subdomain only itself", () => {
    expect(isSenderMuted("bob@sub.acme.com", ["@acme.com"])).toBe(true);
    expect(isSenderMuted("bob@sub.acme.com", ["@sub.acme.com"])).toBe(true);
    expect(isSenderMuted("bob@acme.com", ["@sub.acme.com"])).toBe(false);
    expect(isSenderMuted("bob@other.com", ["@acme.com"])).toBe(false);
  });
});

describe("per-account settings", () => {
  it("follow the defaults until an account overrides a choice", () => {
    const base = settings({ content: "sender" });
    expect(settingsForAccount(base, "a1").content).toBe("sender");
    const own = settings({ content: "sender", accounts: { a1: { content: "hidden", sound: false } } });
    expect(settingsForAccount(own, "a1")).toMatchObject({ content: "hidden", sound: false, enabled: true });
    expect(settingsForAccount(own, "a2").content).toBe("sender");
  });

  it("let one account notify for more folders than the rest", () => {
    const own = settings({ accounts: { a1: { folders: ["inbox", "spam"] } } });
    expect(messageNotifies(message({ folder: "spam" }), own)).toBe(true);
    expect(messageNotifies(message({ folder: "spam", accountId: "a2" }), own)).toBe(false);
  });

  it("let one account notify while the master switch is off", () => {
    const own = settings({ enabled: false, accounts: { a1: { enabled: true } } });
    expect(messageNotifies(message(), own)).toBe(true);
    expect(messageNotifies(message({ accountId: "a2" }), own)).toBe(false);
  });

  it("read a name like constructor as an account without overrides", () => {
    expect(settingsForAccount(settings(), "constructor").enabled).toBe(true);
  });

  it("pass the schema", () => {
    const own = settings({ accounts: { a1: { sound: false, mutedSenders: ["@acme.com"] } } });
    expect(notificationSettingsSchema.safeParse(own).success).toBe(true);
    expect(notificationSettingsSchema.safeParse(settings({ accounts: { a1: { content: "loud" as never } } })).success).toBe(false);
  });
});

describe("muting from a conversation", () => {
  it("names a domain the way the muted list stores it", () => {
    expect(mutedKey("senders", " Ana@Acme.com ")).toBe("ana@acme.com");
    expect(mutedKey("domains", "Acme.com")).toBe("@acme.com");
    expect(mutedKey("domains", "@acme.com")).toBe("@acme.com");
  });

  it("changes the shared list for accounts that follow it, and unmutes again", () => {
    const muted = withMutedSenders(settings(), ["a1", "a2"], ["ana@acme.com"], true);
    expect(muted.mutedSenders).toEqual(["ana@acme.com"]);
    expect(isMutedForAccounts(muted, ["a1", "a2"], "ana@acme.com")).toBe(true);
    expect(withMutedSenders(muted, ["a1"], ["ana@acme.com", "ana@acme.com"], true).mutedSenders).toEqual(["ana@acme.com"]);
    expect(withMutedSenders(muted, ["a1"], ["ana@acme.com"], false).mutedSenders).toEqual([]);
  });

  it("changes an account's own list instead of the shared one when it has one", () => {
    const base = settings({ accounts: { a1: { mutedSenders: ["bob@acme.com"] } } });
    const muted = withMutedSenders(base, ["a1"], ["@acme.com"], true);
    expect(muted.accounts.a1?.mutedSenders).toEqual(["bob@acme.com", "@acme.com"]);
    expect(muted.mutedSenders).toEqual([]);
    expect(isMutedForAccounts(muted, ["a1"], "@acme.com")).toBe(true);
    expect(isMutedForAccounts(muted, ["a1", "a2"], "@acme.com")).toBe(false);
    expect(isMutedForAccounts(muted, [], "@acme.com")).toBe(false);
  });
});

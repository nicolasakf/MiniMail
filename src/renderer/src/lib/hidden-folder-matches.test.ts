import { describe, expect, it } from "vitest";

import type { MailFolder, MessageSummary } from "@shared/types";

import { hiddenFolderMatches } from "./hidden-folder-matches";

let counter = 0;
const message = (folder: MailFolder, overrides: Partial<MessageSummary> = {}): MessageSummary => {
  counter += 1;
  return {
    id: `a|${folder}|${counter}`,
    accountId: "a",
    folder,
    threadId: `t${counter}`,
    from: { name: "Alice", email: "alice@example.com" },
    to: [],
    subject: "Invoice",
    snippet: "",
    date: "2026-01-01T00:00:00Z",
    unread: false,
    pinned: false,
    answered: false,
    hasAttachments: false,
    signal: "none",
    categoryId: null,
    ...overrides,
  } as MessageSummary;
};

describe("hiddenFolderMatches", () => {
  it("counts matching conversations in the folders that are off", () => {
    const rows = [
      message("inbox"),
      message("archive"),
      message("archive"),
      message("archive", { subject: "Holiday" }),
      message("trash"),
      message("spam", { subject: "Holiday" }),
    ];
    expect(hiddenFolderMatches(rows, ["inbox"], "invoice", {}, false)).toEqual({ archive: 2, trash: 1 });
  });

  it("leaves out the folders that are on, and folders with no match", () => {
    const rows = [message("archive"), message("trash")];
    expect(hiddenFolderMatches(rows, ["inbox", "archive"], "invoice", {}, false)).toEqual({ trash: 1 });
    expect(hiddenFolderMatches(rows, ["inbox"], "nothing", {}, false)).toEqual({});
  });

  it("counts a conversation once, however many messages match", () => {
    const rows = [message("archive", { threadId: "same" }), message("archive", { threadId: "same" })];
    expect(hiddenFolderMatches(rows, ["inbox"], "invoice", {}, false)).toEqual({ archive: 1 });
  });

  it("counts nothing for an empty search", () => {
    expect(hiddenFolderMatches([message("archive")], ["inbox"], "  ", {}, false)).toEqual({});
  });

  it("follows the unread-only filter", () => {
    const rows = [message("archive", { unread: true }), message("archive")];
    expect(hiddenFolderMatches(rows, ["inbox"], "invoice", {}, true)).toEqual({ archive: 1 });
  });

  it("does not count mail the Inbox also holds (Gmail's All Mail)", () => {
    const inbox = message("inbox", { threadId: "same" });
    const copy = message("archive", { threadId: "same" });
    expect(hiddenFolderMatches([inbox, copy], ["inbox"], "invoice", {}, false)).toEqual({});
  });
});

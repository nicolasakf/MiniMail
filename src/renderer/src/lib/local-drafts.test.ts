import { describe, expect, it } from "vitest";

import type { SavedDraft } from "@shared/types";

import { draftIdOf, draftMessage, draftThreads, isLocalDraftId, isLocalDraftThread, localDraftMessageId } from "./local-drafts";

const saved = (patch: Partial<SavedDraft> = {}): SavedDraft => ({
  id: "d1",
  savedAt: "2026-11-10T10:00:00.000Z",
  mode: "new",
  accountId: "acc",
  to: [{ name: "Ana", email: "ana@example.com" }],
  cc: [{ name: "", email: "bo@example.com" }],
  bcc: [],
  pendingText: { to: "", cc: "", bcc: "" },
  subject: "Lunch?",
  body: "Are you\n free   Friday?",
  ...patch,
});

describe("local drafts as list rows", () => {
  it("names a draft's message so it can be told apart from server mail", () => {
    const id = localDraftMessageId("d1");
    expect(isLocalDraftId(id)).toBe(true);
    expect(isLocalDraftId("acc|drafts|7")).toBe(false);
    expect(draftIdOf(id)).toBe("d1");
    expect(draftIdOf("acc|drafts|7")).toBeNull();
  });

  it("lists recipients, the subject and a one-line preview like any other draft row", () => {
    const message = draftMessage(saved(), { name: "", email: "me@example.com" });
    expect(message.folder).toBe("drafts");
    expect(message.to.map((c) => c.email)).toEqual(["ana@example.com", "bo@example.com"]);
    expect(message.subject).toBe("Lunch?");
    expect(message.snippet).toBe("Are you free Friday?");
    expect(message.unread).toBe(false);
    expect(draftMessage(saved({ subject: "  " }), message.from).subject).toBe("(no subject)");
    expect(draftMessage(saved({ attachments: [{ filename: "a", contentType: "x/y", contentBase64: "" }] }), message.from).hasAttachments).toBe(true);
  });

  it("makes one conversation per draft, newest first", () => {
    const owner = { name: "", email: "me@example.com" };
    const threads = draftThreads([
      draftMessage(saved({ id: "old", savedAt: "2026-11-01T10:00:00.000Z" }), owner),
      draftMessage(saved({ id: "new", savedAt: "2026-11-12T10:00:00.000Z" }), owner),
    ]);
    expect(threads.map((thread) => draftIdOf(thread.latest.id))).toEqual(["new", "old"]);
    expect(threads.every(isLocalDraftThread)).toBe(true);
  });
});

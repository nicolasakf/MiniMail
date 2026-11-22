import { describe, expect, it } from "vitest";

import type { SavedDraft } from "@shared/types";

import { draftIdOf, draftMessage, draftsForThread, draftThreads, isLocalDraftId, isLocalDraftThread, localDraftMessageId } from "./local-drafts";

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

describe("drafts at the end of a conversation", () => {
  const reply = (id: string, nativeId: string, savedAt: string): SavedDraft =>
    saved({ id, savedAt, mode: "reply", inReplyTo: { messageId: `<${nativeId}>`, nativeId, references: [], mode: "reply" } });
  const owner = { name: "", email: "me@example.com" };
  const thread = draftThreads([
    { ...draftMessage(saved(), owner), id: "acc|inbox|1", threadId: "t" },
    { ...draftMessage(saved(), owner), id: "acc|inbox|2", threadId: "t" },
  ])[0];

  it("finds the drafts that answer a message of the conversation, oldest first", () => {
    const found = draftsForThread(
      [reply("late", "acc|inbox|2", "2026-11-12T10:00:00.000Z"), reply("other", "acc|inbox|9", "2026-11-11T10:00:00.000Z"), reply("early", "acc|inbox|1", "2026-11-11T10:00:00.000Z"), saved()],
      thread,
    );
    expect(found.map((draft) => draft.id)).toEqual(["early", "late"]);
  });
});

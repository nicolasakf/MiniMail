import { beforeEach, describe, expect, it, vi } from "vitest";

import { savedDraftSchema } from "@shared/schemas";
import type { MessageDetail } from "@shared/types";

const act = vi.fn();
vi.mock("./api", () => ({ api: { mail: { act: (...args: unknown[]) => act(...args) }, system: { demo: false } } }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }) }));

import { toast } from "sonner";

import { removeServerDraft, seedFromDraft, seedFromServerDraft } from "./drafts";
import { toSavedDraft, type ComposerFields } from "./composer-state";

const message = (patch: Partial<MessageDetail> = {}): MessageDetail => ({
  id: "acc|drafts|7",
  accountId: "acc",
  folder: "drafts",
  threadId: "t1",
  from: { name: "Me", email: "me@example.com" },
  to: [{ name: "Ana", email: "ana@example.com" }],
  cc: [{ name: "", email: "bo@example.com" }],
  subject: "Lunch?",
  snippet: "",
  date: "2026-11-10T10:00:00.000Z",
  unread: false,
  pinned: false,
  answered: false,
  hasAttachments: false,
  signal: "none" as MessageDetail["signal"],
  categoryId: null,
  replyTo: null,
  messageId: "<m1@example.com>",
  references: [],
  html: null,
  text: "Are you free on Friday?",
  attachments: [],
  ...patch,
});

const fields = (): ComposerFields => ({
  accountId: "acc", to: [], cc: [], bcc: [], toText: "", ccText: "", bccText: "", subject: "", quoted: "",
  sendAt: undefined, bodyHtml: undefined, attachments: [],
});

describe("seedFromServerDraft", () => {
  it("opens the server draft's recipients, subject, text and files in the composer", () => {
    const file = { filename: "a.txt", contentType: "text/plain", contentBase64: "aGk=" };
    const seed = seedFromServerDraft(message(), [file]);
    expect(seed).toMatchObject({
      accountId: "acc",
      to: [{ email: "ana@example.com" }],
      cc: [{ email: "bo@example.com" }],
      subject: "Lunch?",
      body: "Are you free on Friday?",
      attachments: [file],
      serverMessageId: "acc|drafts|7",
    });
    expect(seed.draftId).toBeUndefined();
  });

  it("does not turn the placeholder subject into text the user would send", () => {
    expect(seedFromServerDraft(message({ subject: "(no subject)" }), []).subject).toBe("");
  });

  it("takes the text from the HTML when the draft has no plain part", () => {
    const seed = seedFromServerDraft(message({ text: null, html: "<p>Hello <b>there</b></p>" }), []);
    expect(seed.body).toContain("Hello");
    expect(seed.body).not.toContain("<b>");
  });
});

describe("a server draft kept as a local one", () => {
  it("remembers which server message it came from, and gives it back when reopened", () => {
    const saved = toSavedDraft(fields(), { id: "d1", mode: "new", bodyText: "x", inReplyTo: undefined, serverMessageId: "acc|drafts|7" });
    expect(saved.serverMessageId).toBe("acc|drafts|7");
    expect(savedDraftSchema.parse(saved).serverMessageId).toBe("acc|drafts|7");
    expect(seedFromDraft(saved).serverMessageId).toBe("acc|drafts|7");
  });
});

describe("removeServerDraft", () => {
  beforeEach(() => {
    act.mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it("does nothing for a draft that never came from the server", async () => {
    await removeServerDraft(undefined, "sent");
    expect(act).not.toHaveBeenCalled();
  });

  it("deletes the server copy for good after sending, but only trashes it when discarded", async () => {
    act.mockResolvedValue([{ id: "x", status: "applied" }]);
    await removeServerDraft("acc|drafts|7", "sent");
    expect(act).toHaveBeenLastCalledWith("deleteForever", ["acc|drafts|7"]);
    await removeServerDraft("acc|drafts|7", "discarded");
    expect(act).toHaveBeenLastCalledWith("trash", ["acc|drafts|7"]);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("tells the user, without throwing, when the server copy could not be removed", async () => {
    act.mockResolvedValue([{ id: "x", status: "failed", error: "offline" }]);
    await expect(removeServerDraft("acc|drafts|7", "sent")).resolves.toBeUndefined();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("offline"));
  });
});

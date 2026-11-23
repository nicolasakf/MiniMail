import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_NOTIFICATION_SETTINGS, type NotificationSettings } from "@shared/notifications";
import type { Account, MailAction, MessageDetail, MessageSummary, SavedDraft } from "@shared/types";

// The lists are saved through the main process; this stands in for it and keeps what was saved.
const saved = new Map<string, unknown>();
vi.stubGlobal("window", {
  addEventListener: () => undefined,
  minimail: { prefs: { set: async (patch: Record<string, unknown>) => void Object.entries(patch).forEach(([key, value]) => saved.set(key, value)) } },
});

function mail(id: string, email = "anna@example.com"): MessageSummary {
  return {
    id: `a|inbox|${id}`,
    accountId: "a",
    folder: "inbox",
    threadId: `t${id}`,
    from: { name: "", email },
    to: [],
    subject: `Subject ${id}`,
    snippet: "",
    date: "2026-11-20T10:00:00.000Z",
    unread: true,
    pinned: false,
    answered: false,
    hasAttachments: false,
    signal: "person",
    categoryId: null,
  };
}

type ListRequest = Extract<import("@shared/cli-page").PageRequest, { kind: "list" }>;
const listRequest = (list: ListRequest["list"], over: Partial<ListRequest> = {}): ListRequest => ({
  kind: "list",
  list,
  entry: "senders",
  values: ["anna@example.com"],
  on: true,
  accountIds: ["a"],
  trash: [],
  ...over,
});

let page: typeof import("./cli-page");
let undo: typeof import("./undo-stack");
let events: typeof import("./events");
let blocklist: typeof import("./blocklist");
let priority: typeof import("./priority");
let recorded: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  page = await import("./cli-page");
  undo = await import("./undo-stack");
  events = await import("./events");
  blocklist = await import("./blocklist");
  priority = await import("./priority");
});

let notify: NotificationSettings | null;
let stored: SavedDraft[] = [];
let draftSerial = 0;
let decision: "reject" | "once" | "always" = "once";
let unsubscribed: (count: number) => import("@shared/cli-page").UnsubscribeOutcome = (count) => ({ done: count, manual: [], failed: [], skipped: 0, alreadyDone: 0 });
const performed: { action: MailAction; ids: string[] }[] = [];
let batchSerial = 0;
let count = 1;
let settle: "applied" | "failed" | "undone" | "timeout" = "applied";

function deps(): import("./cli-page").PageDeps {
  return {
    perform: (action, ids) => {
      performed.push({ action, ids });
      // Like the real thing, a move pushes its own undo entry (inside a group it is folded into the group's).
      const ref = `undo-mail-test-${++batchSerial}`;
      undo.undoStack.push({ ref, label: `move (${ids.length})`, logged: true, run: () => undefined });
      return { batch: batchSerial, count, ref: count > 0 ? ref : undefined };
    },
    settle: async () => settle,
    assignCategory: async (keys, categoryId) => (keys.length > 0 && categoryId !== "fail" ? "undo-category-test" : undefined),
    notifySettings: () => notify,
    updateNotify: async (change) => {
      notify = change(notify!);
    },
    ask: async () => decision,
    unsubscribe: async (rows) => unsubscribed(rows.length),
    accounts: () => [{ id: "a", provider: "imap", email: "me@example.com", displayName: "Me" } as unknown as Account],
    drafts: {
      list: () => stored,
      save: async (draft) => {
        stored = [draft, ...stored.filter((candidate) => candidate.id !== draft.id)];
      },
      remove: async (id) => {
        stored = stored.filter((candidate) => candidate.id !== id);
      },
      newId: () => `draft-${++draftSerial}`,
    },
  };
}

beforeEach(() => {
  undo.undoStack.clear();
  performed.length = 0;
  count = 1;
  settle = "applied";
  notify = structuredClone(DEFAULT_NOTIFICATION_SETTINGS);
  stored = [];
  draftSerial = 0;
  decision = "once";
  unsubscribed = (count) => ({ done: count, manual: [], failed: [], skipped: 0, alreadyDone: 0 });
  saved.clear();
  recorded?.mockRestore();
  recorded = vi.spyOn(events, "recordAction").mockImplementation(() => undefined);
  blocklist.setBlocked("senders", ["anna@example.com", "bob@example.com"], false);
  blocklist.setBlocked("domains", ["spam.test"], false);
});

describe("mail commands", () => {
  it("run the move through the page's own function, as the CLI, and report how it ended", async () => {
    const rows = [mail("1"), mail("2")];
    const result = await page.handlePageRequest({ kind: "mail", action: "archive", rows }, deps());
    expect(performed).toEqual([{ action: "archive", ids: ["a|inbox|1", "a|inbox|2"] }]);
    expect(result).toMatchObject({ outcome: "applied", count: 1, ref: expect.stringContaining("undo-mail") });
  });

  it("say nothing changed when every message was already there", async () => {
    count = 0;
    expect(await page.handlePageRequest({ kind: "mail", action: "archive", rows: [mail("1")] }, deps())).toEqual({ outcome: "nothing", count: 0 });
  });

  it("pass on a server that refused", async () => {
    settle = "failed";
    expect(await page.handlePageRequest({ kind: "mail", action: "trash", rows: [mail("1")] }, deps())).toMatchObject({ outcome: "failed" });
  });
});

describe("categories", () => {
  it("file conversations under a category and give the Undo", async () => {
    const result = await page.handlePageRequest(
      { kind: "category", categoryId: "receipts", threads: [{ key: "a:t1", before: null }, { key: "a:t2", before: "news" }] },
      deps(),
    );
    expect(result).toEqual({ outcome: "applied", count: 2, ref: "undo-category-test" });
  });

  it("do nothing for conversations that are already there", async () => {
    const result = await page.handlePageRequest({ kind: "category", categoryId: "news", threads: [{ key: "a:t2", before: "news" }] }, deps());
    expect(result).toEqual({ outcome: "nothing", count: 0 });
  });

  it("report a category the server would not take", async () => {
    const result = await page.handlePageRequest({ kind: "category", categoryId: "fail", threads: [{ key: "a:t1", before: null }] }, deps());
    expect(result.outcome).toBe("failed");
  });
});

describe("block", () => {
  const request = (over: Partial<ListRequest> = {}) => listRequest("block", over);

  it("blocks, says so in the Log as the CLI, and can be undone", async () => {
    const result = await page.handlePageRequest(request(), deps());
    expect(blocklist.getBlockList().senders).toContain("anna@example.com");
    expect(recorded).toHaveBeenCalledWith("mail", "Blocked a sender via CLI", "", expect.objectContaining({ context: "anna@example.com", ref: result.ref }));
    expect(undo.undoStack.has(result.ref!)).toBe(true);
    undo.undoStack.undo(result.ref!);
    expect(blocklist.getBlockList().senders).not.toContain("anna@example.com");
  });

  it("moves the mail already here to the Trash as one action with the block, taken back together", async () => {
    const rows = [mail("1"), mail("2")];
    const result = await page.handlePageRequest(request({ trash: rows }), deps());
    expect(performed).toEqual([{ action: "trash", ids: ["a|inbox|1", "a|inbox|2"] }]);
    // One entry on the stack: the block, with the move folded into it.
    expect(undo.undoStack.entries()).toHaveLength(1);
    expect(undo.undoStack.entries()[0]!.ref).toBe(result.ref);
  });

  it("leaves out what is already blocked, and says nothing changed when that is all of it", async () => {
    blocklist.setBlocked("senders", ["anna@example.com"], true);
    expect(await page.handlePageRequest(request(), deps())).toEqual({ outcome: "nothing", count: 0 });
    const both = await page.handlePageRequest(request({ values: ["anna@example.com", "bob@example.com"] }), deps());
    expect(both.count).toBe(1);
  });

  it("unblocks with --remove and does not move any mail", async () => {
    blocklist.setBlocked("domains", ["spam.test"], true);
    const result = await page.handlePageRequest(request({ entry: "domains", values: ["spam.test"], on: false, trash: [mail("1")] }), deps());
    expect(blocklist.getBlockList().domains).not.toContain("spam.test");
    expect(performed).toEqual([]);
    expect(recorded).toHaveBeenCalledWith("mail", "Unblocked a domain via CLI", "", expect.anything());
    expect(result.outcome).toBe("applied");
  });
});

describe("priority", () => {
  it("marks senders as priority through the page's own function, as the CLI", async () => {
    const request = listRequest("priority");
    const result = await page.handlePageRequest(request, deps());
    expect(result).toMatchObject({ outcome: "applied", count: 1, ref: expect.stringContaining("undo-priority") });
    expect(recorded).toHaveBeenCalledWith("mail", "Marked a sender as priority via CLI", "", expect.anything());
    expect(await page.handlePageRequest(request, deps())).toEqual({ outcome: "nothing", count: 0 });
    undo.undoStack.undo(result.ref!);
    expect(priority.setPriority("senders", ["anna@example.com"], true).applied).toBe(1);
  });
});

describe("mute", () => {
  const request = (over: Partial<ListRequest> = {}) => listRequest("mute", over);

  it("mutes for the accounts named, records it as the CLI and can be undone", async () => {
    const result = await page.handlePageRequest(request(), deps());
    expect(result).toMatchObject({ outcome: "applied", count: 1 });
    expect(JSON.stringify(notify)).toContain("anna@example.com");
    expect(recorded).toHaveBeenCalledWith("notifications", "Muted a sender via CLI", "", expect.objectContaining({ ref: result.ref }));
    undo.undoStack.undo(result.ref!);
    expect(JSON.stringify(notify)).not.toContain("anna@example.com");
  });

  it("mutes a conversation by its id", async () => {
    await page.handlePageRequest(request({ entry: "threads", values: ["a:t1"] }), deps());
    expect(notify!.mutedThreads).toContain("a:t1");
  });

  it("does nothing for what is already muted, and waits for settings that have not loaded", async () => {
    await page.handlePageRequest(request(), deps());
    expect(await page.handlePageRequest(request(), deps())).toEqual({ outcome: "nothing", count: 0 });
    notify = null;
    await expect(page.handlePageRequest(request(), deps())).rejects.toThrow("have not loaded");
  });
});

describe("undo", () => {
  it("takes back one of the actions on the stack", async () => {
    const ran = vi.fn();
    undo.undoStack.push({ ref: "undo-x-1", label: "x", run: ran });
    expect(await page.handlePageRequest({ kind: "undo", ref: "undo-x-1" }, deps())).toEqual({ outcome: "applied", count: 1 });
    expect(ran).toHaveBeenCalledTimes(1);
  });

  it("says so when there is nothing left to take back", async () => {
    expect(await page.handlePageRequest({ kind: "undo", ref: "gone" }, deps())).toEqual({ outcome: "nothing", count: 0 });
  });
});

function original(overrides: Partial<MessageDetail> = {}): MessageDetail {
  return {
    ...mail("9", "anna@example.com"),
    from: { name: "Anna", email: "anna@example.com" },
    to: [{ name: "Me", email: "me@example.com" }, { name: "Bob", email: "bob@example.com" }],
    cc: [{ name: "Cy", email: "cy@example.com" }],
    replyTo: null,
    messageId: "<orig@example.com>",
    references: [],
    html: null,
    text: "Lunch on Friday?",
    attachments: [],
    subject: "Lunch",
    ...overrides,
  };
}

const file = { filename: "plan.pdf", contentType: "application/pdf", contentBase64: "AAAA" };

describe("drafts", () => {
  it("writes a new draft on this computer, tells the Log it was the CLI, and gives the Undo", async () => {
    const result = await page.handlePageRequest(
      {
        kind: "draft",
        op: "create",
        compose: { mode: "new", accountId: "a", to: [{ name: "", email: "anna@example.com" }], subject: "Hello", body: "Hi Anna", attachments: [file] },
      },
      deps(),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: "draft-1", mode: "new", accountId: "a", subject: "Hello", body: "Hi Anna", bcc: [], attachments: [file] });
    expect(result).toMatchObject({ outcome: "applied", ref: expect.stringContaining("undo-draft"), draft: { id: "draft-1", to: ["anna@example.com"], files: ["plan.pdf"], subject: "Hello" } });
    expect(JSON.stringify(result)).not.toContain("Hi Anna");
    expect(recorded).toHaveBeenCalledWith("drafts", "Wrote a draft via CLI", "", expect.objectContaining({ context: "Hello", ref: result.ref }));
    undo.undoStack.undo(result.ref!);
    await Promise.resolve();
    expect(stored).toEqual([]);
  });

  it("builds a reply the way the composer does: to the sender, Re:, the original quoted apart, threaded", async () => {
    await page.handlePageRequest({ kind: "draft", op: "create", compose: { mode: "reply", accountId: "a", original: original(), body: "Friday works." } }, deps());
    expect(stored[0]).toMatchObject({
      mode: "reply",
      subject: "Re: Lunch",
      body: "Friday works.",
      to: [{ name: "Anna", email: "anna@example.com" }],
      cc: [],
      inReplyTo: { messageId: "<orig@example.com>", mode: "reply" },
    });
    expect(stored[0]!.quoted).toContain("wrote:");
    expect(stored[0]!.quoted).toContain("> Lunch on Friday?");
  });

  it("answers everyone on a reply-all, without the person's own address, and adds the cc that was given", async () => {
    await page.handlePageRequest(
      { kind: "draft", op: "create", compose: { mode: "replyAll", accountId: "a", original: original(), body: "ok", cc: [{ name: "", email: "dee@example.com" }] } },
      deps(),
    );
    expect(stored[0]!.to.map((contact) => contact.email)).toEqual(["anna@example.com", "bob@example.com"]);
    expect(stored[0]!.cc.map((contact) => contact.email)).toEqual(["cy@example.com", "dee@example.com"]);
  });

  it("builds a forward with what was written above the forwarded message, to the people named", async () => {
    await page.handlePageRequest(
      { kind: "draft", op: "create", compose: { mode: "forward", accountId: "a", original: original(), to: [{ name: "", email: "dee@example.com" }], body: "FYI" } },
      deps(),
    );
    expect(stored[0]).toMatchObject({ mode: "forward", subject: "Fwd: Lunch", to: [{ name: "", email: "dee@example.com" }] });
    expect(stored[0]!.body.startsWith("FYI")).toBe(true);
    expect(stored[0]!.body).toContain("---------- Forwarded message ----------");
    expect(stored[0]!.body).toContain("Lunch on Friday?");
  });

  it("changes a draft: recipients, subject and text are replaced, files are added, and Undo puts it back", async () => {
    const made = await page.handlePageRequest(
      { kind: "draft", op: "create", compose: { mode: "new", accountId: "a", to: [{ name: "", email: "anna@example.com" }], subject: "Old", body: "old text", attachments: [file] } },
      deps(),
    );
    const edited = await page.handlePageRequest(
      {
        kind: "draft",
        op: "edit",
        id: made.draft!.id,
        changes: { to: [{ name: "", email: "bob@example.com" }], subject: "New", body: "new text", attachments: [{ ...file, filename: "more.pdf" }] },
      },
      deps(),
    );
    expect(stored[0]).toMatchObject({ subject: "New", body: "new text", to: [{ name: "", email: "bob@example.com" }] });
    expect(stored[0]!.attachments!.map((item) => item.filename)).toEqual(["plan.pdf", "more.pdf"]);
    expect(recorded).toHaveBeenCalledWith("drafts", "Changed a draft via CLI", "", expect.anything());
    undo.undoStack.undo(edited.ref!);
    await Promise.resolve();
    expect(stored[0]).toMatchObject({ subject: "Old", body: "old text", to: [{ name: "", email: "anna@example.com" }] });
  });

  it("leaves what a change does not mention alone", async () => {
    const made = await page.handlePageRequest(
      { kind: "draft", op: "create", compose: { mode: "new", accountId: "a", to: [{ name: "", email: "anna@example.com" }], subject: "Keep", body: "keep" } },
      deps(),
    );
    await page.handlePageRequest({ kind: "draft", op: "edit", id: made.draft!.id, changes: { body: "changed" } }, deps());
    expect(stored[0]).toMatchObject({ subject: "Keep", body: "changed", to: [{ name: "", email: "anna@example.com" }] });
  });

  it("deletes a draft and can bring it back", async () => {
    const made = await page.handlePageRequest({ kind: "draft", op: "create", compose: { mode: "new", accountId: "a", subject: "Bye" } }, deps());
    const deleted = await page.handlePageRequest({ kind: "draft", op: "delete", id: made.draft!.id }, deps());
    expect(stored).toEqual([]);
    expect(recorded).toHaveBeenCalledWith("drafts", "Deleted a draft via CLI", "", expect.objectContaining({ context: "Bye" }));
    undo.undoStack.undo(deleted.ref!);
    await Promise.resolve();
    expect(stored.map((draft) => draft.subject)).toEqual(["Bye"]);
  });

  it("says so when the draft is gone", async () => {
    await expect(page.handlePageRequest({ kind: "draft", op: "edit", id: "nope", changes: { body: "x" } }, deps())).rejects.toThrow("gone");
    await expect(page.handlePageRequest({ kind: "draft", op: "delete", id: "nope" }, deps())).rejects.toThrow("gone");
  });
});

describe("cards", () => {
  const card = { action: "invitation", answer: "accept", title: "Standup", when: null, organizer: "anna@example.com", location: null } as const;

  it.each(["reject", "once", "always"] as const)("passes on what the person answered: %s", async (answer) => {
    decision = answer;
    expect(await page.handlePageRequest({ kind: "confirm", card }, deps())).toEqual({ outcome: "applied", count: 0, decision: answer });
  });
});

describe("unsubscribe", () => {
  it("unsubscribes through the page's own flow and says so in the Log as the CLI, without the full address", async () => {
    const info = vi.spyOn(events, "recordInfo").mockImplementation(() => undefined);
    try {
      const result = await page.handlePageRequest({ kind: "unsubscribe", rows: [mail("1", "deals@shop.test"), mail("2", "news@paper.test")] }, deps());
      expect(result).toMatchObject({ outcome: "applied", count: 2, unsubscribe: { done: 2 } });
      expect(info).toHaveBeenCalledWith("unsubscribe", "Unsubscribed from 2 lists via CLI", "", expect.objectContaining({ context: "deals@shop.test, news@paper.test" }));
    } finally {
      info.mockRestore();
    }
  });

  it("says nothing changed when no list accepted, and passes on the pages the person has to finish", async () => {
    unsubscribed = () => ({ done: 0, manual: [{ sender: "Deals", host: "shop.test" }], failed: [], skipped: 0, alreadyDone: 0 });
    const result = await page.handlePageRequest({ kind: "unsubscribe", rows: [mail("1")] }, deps());
    expect(result).toMatchObject({ outcome: "nothing", count: 0, unsubscribe: { manual: [{ host: "shop.test" }] } });
  });
});

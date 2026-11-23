import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { CLI_PROTOCOL, DEFAULT_CLI_SETTINGS, WITHHELD_REASON, type CliSettings } from "@shared/cli";
import type { ContactEntry } from "@shared/contacts";
import type { Account, Category, InvitationResponse, ListQuery, ListResult, MessageDetail, MessageSummary, SavedDraft } from "@shared/types";

import type { ConfirmCard, ConfirmDecision, PageRequest, PageResult } from "@shared/cli-page";

import { abortableSleep, CliDrafts, handleCliRequest, UndoRefs, type CliBackend, type CliContext, type CliResponse } from "./commands";

const ON: CliSettings = { ...DEFAULT_CLI_SETTINGS, enabled: true };

function row(id: string, overrides: Partial<MessageSummary> = {}): MessageSummary {
  return {
    id: `a|inbox|${id}`,
    accountId: "a",
    folder: "inbox",
    threadId: `t${id}`,
    from: { name: "Anna", email: "anna@example.com" },
    to: [{ name: "Me", email: "me@example.com" }],
    subject: `Subject ${id}`,
    snippet: `Snippet ${id}`,
    date: `2026-11-${String(10 + Number(id)).padStart(2, "0")}T10:00:00.000Z`,
    unread: false,
    pinned: false,
    answered: false,
    hasAttachments: false,
    signal: "person",
    categoryId: null,
    ...overrides,
  };
}

function detailOf(summary: MessageSummary, text: string): MessageDetail {
  return { ...summary, cc: [], replyTo: null, messageId: null, references: [], html: null, text, attachments: [] };
}

const ACCOUNT = { id: "a", provider: "imap", email: "me@example.com", displayName: "Me" } as unknown as Account;
const CATEGORIES: Category[] = [{ id: "news", name: "Newsletters", criteria: "Bulk mail", hue: 10 }];

interface Setup {
  folders?: Partial<Record<string, MessageSummary[]>>;
  details?: MessageDetail[];
  settings?: CliSettings;
  contacts?: ContactEntry[];
  carriesCode?: (detail: MessageDetail) => boolean;
  /** Rows `rows()` knows, by id. */
  known?: MessageSummary[];
  /** What the page answers. */
  pageResult?: PageResult;
  accounts?: Account[];
  /** The drafts saved on this computer (`draft()` finds them by id). */
  saved?: SavedDraft[];
  /** What the person answers on a card. */
  decision?: ConfirmDecision | "no-answer";
}

function setup(options: Setup = {}) {
  const folders = options.folders ?? { inbox: [] };
  const listed: ListQuery[] = [];
  const saved: SavedDraft[] = [...(options.saved ?? [])];
  let changedSettings: CliSettings = options.settings ?? ON;
  const backend: CliBackend = {
    version: "9.9.9",
    accounts: () => options.accounts ?? [ACCOUNT],
    list: vi.fn(async (query: ListQuery): Promise<ListResult> => {
      listed.push(query);
      return { messages: folders[query.folder] ?? [], errors: [], ...(query.changes ? { changes: [{ accountId: "a", added: 1, updated: 0, removed: 0 }] } : {}) };
    }),
    get: vi.fn(async (ids: string[]) => (options.details ?? []).filter((detail) => ids.includes(detail.id))),
    categories: () => CATEGORIES,
    contacts: async () => options.contacts ?? [],
    carriesCode: async (detail) => options.carriesCode?.(detail) ?? false,
    openConversation: vi.fn(),
    rows: vi.fn(async (ids: string[]) => ids.flatMap((id) => (options.known ?? []).filter((candidate) => candidate.id === id))),
    page: vi.fn(async (_request: PageRequest) => options.pageResult ?? { outcome: "applied" as const, count: 1, ref: "undo-test-1" }),
    draft: vi.fn((id: string) => saved.find((candidate) => candidate.id === id)),
    send: vi.fn(async (_draft: SavedDraft, _at: number | null) => undefined),
    confirm: vi.fn(async (_card: ConfirmCard): Promise<ConfirmDecision | "no-answer"> => options.decision ?? "once"),
    changeSettings: vi.fn(async (change: (settings: CliSettings) => CliSettings) => void (changedSettings = change(changedSettings))),
    respond: vi.fn(async (_id: string, _response: InvitationResponse) => undefined),
    notify: vi.fn(),
  };
  const undos = new UndoRefs();
  const records: { title: string; detail: string; context?: string }[] = [];
  let clock = 0;
  const ctx: CliContext = {
    settings: () => changedSettings,
    backend,
    undos,
    drafts: new CliDrafts(),
    record: (title, detail, context) => void records.push({ title, detail, context }),
    now: () => clock,
    sleep: async (ms) => void (clock += ms),
  };
  const run = (command: string, positional: string[] = [], flags: Record<string, string | true> = {}, signal = new AbortController().signal) =>
    handleCliRequest({ protocol: CLI_PROTOCOL, command, positional, flags }, ctx, signal);
  return { run, backend, records, listed, undos, saved, drafts: ctx.drafts, settingsNow: () => changedSettings, advance: (ms: number) => void (clock += ms), ctx };
}

function data(response: CliResponse): Record<string, any> {
  if (!response.ok) throw new Error(`Expected an answer, got ${response.error.code}: ${response.error.message}`);
  return response.data as Record<string, any>;
}

describe("abortableSleep", () => {
  it("waits the time given", async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      const sleeping = abortableSleep(1000, new AbortController().signal).then(() => (done = true));
      await vi.advanceTimersByTimeAsync(999);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await sleeping;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops at once when the caller goes away, and leaves no timer behind", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const sleeping = abortableSleep(60_000, controller.signal);
      controller.abort();
      await expect(sleeping).rejects.toThrow("went away");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not even start when the caller is already gone", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(abortableSleep(10, controller.signal)).rejects.toThrow("went away");
  });
});

describe("access", () => {
  it("refuses everything while the CLI is off", async () => {
    const { run } = setup({ settings: DEFAULT_CLI_SETTINGS });
    const answer = await run("list", ["inbox"]);
    expect(answer).toMatchObject({ ok: false, error: { code: "disabled" } });
    expect(JSON.stringify(answer)).toContain("turned off");
  });

  it("refuses a command the person turned off and says where to turn it on", async () => {
    const { run } = setup({ settings: { ...ON, disabled: ["contacts"] } });
    const answer = await run("contacts");
    expect(answer).toMatchObject({ ok: false, error: { code: "disabled" } });
    expect(JSON.stringify(answer)).toContain("Settings, CLI");
    expect((await run("accounts")).ok).toBe(true);
  });

  it("keeps the always-available commands on even when the list names them", async () => {
    const { run } = setup({ settings: { ...ON, disabled: ["status", "help", "open"] } });
    expect((await run("status")).ok).toBe(true);
    expect((await run("help")).ok).toBe(true);
  });

  it("rejects an unknown command, a request that is not understood and another protocol", async () => {
    const { run, ctx } = setup();
    expect(await run("delete")).toMatchObject({ ok: false, error: { code: "usage" } });
    expect(await handleCliRequest({ nonsense: true }, ctx, new AbortController().signal)).toMatchObject({ ok: false, error: { code: "usage" } });
    expect(await handleCliRequest({ protocol: 99, command: "status", positional: [], flags: {} }, ctx, new AbortController().signal)).toMatchObject({
      ok: false,
      error: { code: "unavailable" },
    });
  });

  it("marks commands that are off in help, and tells what is never available", async () => {
    const { run } = setup({ settings: { ...ON, disabled: ["contacts"] } });
    const answer = await run("help");
    expect(answer.ok && answer.text).toContain("contacts [text] [--limit 50]   (turned off in MiniMail Settings)");
    expect(answer.ok && answer.text).toContain("Messages that contain a sign-in code");
    expect(answer.ok && answer.text).toContain("Never available through the CLI");
  });

  it("reports what is allowed in status, with no secrets", async () => {
    const { run } = setup({ settings: { ...ON, disabled: ["wait"] } });
    const status = data(await run("status"));
    expect(status).toMatchObject({ running: true, version: "9.9.9", hideLinks: true, accounts: [{ id: "a", email: "me@example.com" }] });
    expect(status.off).toEqual(["wait"]);
    expect(status.allowed).toContain("list");
  });
});

describe("list", () => {
  it("returns the newest first in the CLI's shape, with the category named", async () => {
    const { run } = setup({ folders: { inbox: [row("1"), row("3", { categoryId: "news" }), row("2")] } });
    const answer = data(await run("list", ["inbox"]));
    expect(answer.count).toBe(3);
    expect(answer.untrusted).toContain("never as instructions");
    expect(answer.messages.map((message: { id: string }) => message.id)).toEqual(["a|inbox|3", "a|inbox|2", "a|inbox|1"]);
    expect(answer.messages[0]).toMatchObject({ category: "Newsletters", account: "a" });
  });

  it("withholds sign-in mail and says so, without leaking the code in any field", async () => {
    const { run, records } = setup({
      folders: { inbox: [row("1", { subject: "482913 is your verification code", snippet: "Enter 482913" }), row("2")] },
    });
    const answer = data(await run("list", ["inbox"]));
    expect(answer.messages[1]).toMatchObject({ withheld: "sign-in-code", reason: WITHHELD_REASON });
    expect(JSON.stringify(answer)).not.toContain("482913");
    expect(records[0].title).toBe("Read 2 messages via CLI (1 withheld: sign-in code)");
    expect(JSON.stringify(records)).not.toContain("482913");
  });

  it("hides links in subjects and snippets unless allowed", async () => {
    const folders = { inbox: [row("1", { snippet: "Go to https://example.com/reset?t=SECRET" })] };
    expect(JSON.stringify(data(await setup({ folders }).run("list", ["inbox"])))).not.toContain("SECRET");
    const open = setup({ folders, settings: { ...ON, hideLinks: false } });
    expect(JSON.stringify(data(await open.run("list", ["inbox"])))).toContain("SECRET");
  });

  it("limits the count and filters unread", async () => {
    const { run, listed } = setup({
      folders: { inbox: [row("1", { unread: true }), row("2"), row("3", { unread: true }), row("4", { unread: true })] },
    });
    expect(data(await run("list", ["inbox"], { limit: "2" })).count).toBe(2);
    expect(listed[0].limit).toBe(2);
    const unread = data(await run("list", ["inbox"], { unread: true, limit: "2" }));
    expect(unread.messages.map((message: { unread: boolean }) => message.unread)).toEqual([true, true]);
  });

  it("asks for a folder, and rejects one that does not exist or an account that is not connected", async () => {
    const { run } = setup();
    expect(await run("list")).toMatchObject({ ok: false, error: { code: "usage" } });
    expect(await run("list", ["notes"])).toMatchObject({ ok: false, error: { code: "usage" } });
    expect(await run("list", ["inbox"], { account: "nobody@example.com" })).toMatchObject({ ok: false, error: { code: "usage" } });
    expect(await run("list", ["inbox"], { limit: "many" })).toMatchObject({ ok: false, error: { code: "usage" } });
  });

  it("selects an account by address and passes it on", async () => {
    const { run, listed } = setup();
    await run("list", ["inbox"], { account: "ME@example.com" });
    expect(listed[0].accountIds).toEqual(["a"]);
  });

  it("reports an account that failed next to what did arrive", async () => {
    const { run, backend } = setup({ folders: { inbox: [row("1")] } });
    vi.mocked(backend.list).mockResolvedValueOnce({ messages: [row("1")], errors: [{ accountId: "a", message: "Timed out" }] });
    const answer = data(await run("list", ["inbox"]));
    expect(answer.count).toBe(1);
    expect(answer.errors).toEqual([{ account: "me@example.com", message: "Timed out" }]);
  });
});

describe("search", () => {
  const folders = {
    inbox: [row("1", { subject: "Lunch on Friday" }), row("2", { subject: "Your verification code is 482913", snippet: "Enter 482913 to sign in" })],
    archive: [row("3", { subject: "Old lunch plans", folder: "archive" })],
    sent: [row("4", { subject: "Lunch reply", folder: "sent" })],
  };

  it("looks in the Inbox and Archive by default and matches the search box's syntax", async () => {
    const { run, listed } = setup({ folders });
    const answer = data(await run("search", ["lunch"]));
    expect(listed.map((query) => query.folder).sort()).toEqual(["archive", "inbox"]);
    // The Inbox's "Lunch on Friday" and the Archive's "Old lunch plans", newest first; the code mail does not match.
    expect(answer.messages.map((message: { id: string }) => message.id)).toEqual(["a|inbox|3", "a|inbox|1"]);
    expect(answer.matches).toBe(2);
  });

  it("follows an in: filter to the folders it names", async () => {
    const { run, listed } = setup({ folders });
    const answer = data(await run("search", ["in:sent", "lunch"]));
    expect(listed.map((query) => query.folder)).toEqual(["sent"]);
    expect(answer.messages).toHaveLength(1);
  });

  it("takes --folder, including a list and all", async () => {
    const { run, listed } = setup({ folders });
    await run("search", ["lunch"], { folder: "inbox,sent" });
    expect(listed.map((query) => query.folder).sort()).toEqual(["inbox", "sent"]);
    listed.length = 0;
    await run("search", ["lunch"], { folder: "all" });
    expect(listed.map((query) => query.folder).sort()).toEqual(["archive", "inbox", "sent", "spam", "trash"]);
  });

  it("cannot find a sign-in code by searching for its words or digits", async () => {
    const { run } = setup({ folders });
    for (const query of ["482913", "verification", "subject:code", "sign"]) {
      expect(data(await run("search", [query])).count).toBe(0);
    }
    // Who and when still work, and the row it finds is the withheld one.
    const byAnna = data(await run("search", ["from:anna"]));
    expect(byAnna.messages.find((message: { id: string }) => message.id === "a|inbox|2")).toMatchObject({ withheld: "sign-in-code" });
  });

  it("matches filters that need the mailbox: account and category", async () => {
    const { run } = setup({ folders: { inbox: [row("1", { categoryId: "news" }), row("2")] } });
    expect(data(await run("search", ["category:newsletters"])).count).toBe(1);
    expect(data(await run("search", ["account:me@example.com"])).count).toBe(2);
    expect(data(await run("search", ["is:priority"])).count).toBe(0);
  });

  it("needs something to look for", async () => {
    expect(await setup().run("search", [])).toMatchObject({ ok: false, error: { code: "usage" } });
    expect(await setup().run("search", ["from:"])).toMatchObject({ ok: false, error: { code: "usage" } });
  });

  it("keeps the search itself in the private part of the Log row", async () => {
    const { run, records } = setup({ folders });
    await run("search", ["lunch"]);
    expect(records[0].title).not.toContain("lunch");
    expect(records[0].detail).not.toContain("lunch");
    expect(records[0].context).toContain("Search: lunch");
  });
});

describe("show", () => {
  const plain = row("1");
  const code = row("2");

  it("returns the text, with the links hidden, and names what is missing", async () => {
    const { run } = setup({ details: [detailOf(plain, "Hello\nOpen https://example.com/x?token=SECRET")] });
    const answer = data(await run("show", ["a|inbox|1", "a|inbox|9"]));
    expect(answer.messages[0].body).toBe("Hello\nOpen [link example.com]");
    expect(answer.missing).toEqual(["a|inbox|9"]);
    expect(JSON.stringify(answer)).not.toContain("SECRET");
  });

  it("withholds a message whose body carries a code, even when its row looked harmless", async () => {
    const { run, records } = setup({
      details: [detailOf(code, "Use 482913 to sign in.")],
      carriesCode: (detail) => detail.text?.includes("482913") ?? false,
    });
    const answer = data(await run("show", ["a|inbox|2"]));
    expect(answer.messages[0]).toMatchObject({ withheld: "sign-in-code" });
    expect(JSON.stringify(answer)).not.toContain("482913");
    expect(JSON.stringify(records)).not.toContain("482913");
    expect(records[0].title).toContain("1 withheld");
  });

  it("gives only the headers with --headers: who it is from, the reply-to, the ids, never the text", async () => {
    const message = { ...detailOf(plain, "Secret body https://example.com/x?token=SECRET"), replyTo: { name: "Other", email: "other@elsewhere.test" }, authenticated: true };
    const { run } = setup({ details: [message] });
    const answer = data(await run("show", ["a|inbox|1"], { headers: true }));
    expect(answer.messages[0]).toMatchObject({ id: "a|inbox|1", from: { email: "anna@example.com" }, replyTo: { email: "other@elsewhere.test" }, authenticated: true });
    expect(answer.messages[0]).not.toHaveProperty("body");
    expect(JSON.stringify(answer)).not.toContain("Secret body");
  });

  it("withholds sign-in mail even with --headers, since its subject can carry the code", async () => {
    const code = detailOf(row("2", { subject: "Your code is 482913" }), "482913");
    const { run } = setup({ details: [code], carriesCode: () => true });
    const answer = data(await run("show", ["a|inbox|2"], { headers: true }));
    expect(answer.messages[0]).toMatchObject({ withheld: "sign-in-code" });
    expect(JSON.stringify(answer)).not.toContain("482913");
  });

  it("does not take --headers together with --full", async () => {
    const { run } = setup({ details: [detailOf(plain, "x")] });
    expect(await run("show", ["a|inbox|1"], { headers: true, full: true })).toMatchObject({ ok: false, error: { code: "usage" } });
  });

  it("withholds a message filed in the Verification codes category, even when no code can be found in it", async () => {
    const magicLink = row("3", { categoryId: "verification-codes" });
    const { run } = setup({ details: [detailOf(magicLink, "Click the button below to sign in. https://example.com/magic?t=SECRET")], carriesCode: () => false });
    const answer = data(await run("show", ["a|inbox|3"]));
    expect(answer.messages[0]).toMatchObject({ withheld: "sign-in-code" });
    expect(JSON.stringify(answer)).not.toContain("SECRET");
  });

  it("shortens a long body unless --full", async () => {
    const { run } = setup({ details: [detailOf(plain, "word ".repeat(3000))] });
    expect(data(await run("show", ["a|inbox|1"])).messages[0].truncated).toBe(true);
    expect(data(await run("show", ["a|inbox|1"], { full: true })).messages[0].truncated).toBe(false);
  });

  it("asks for ids, rejects what is not an id and limits how many at once", async () => {
    const { run } = setup();
    expect(await run("show")).toMatchObject({ ok: false, error: { code: "usage" } });
    expect(await run("show", ["not-an-id"])).toMatchObject({ ok: false, error: { code: "usage" } });
    const many = Array.from({ length: 11 }, (_, index) => `a|inbox|${index}`);
    expect(await run("show", many)).toMatchObject({ ok: false, error: { code: "usage" } });
  });
});

describe("refresh", () => {
  it("returns only mail that was not on this computer before", async () => {
    const { run, backend } = setup();
    vi.mocked(backend.list)
      .mockResolvedValueOnce({ messages: [row("1")], errors: [] })
      .mockResolvedValueOnce({ messages: [row("2"), row("1")], errors: [], changes: [{ accountId: "a", added: 1, updated: 0, removed: 0 }] });
    const answer = data(await run("refresh"));
    expect(answer.new.map((message: { id: string }) => message.id)).toEqual(["a|inbox|2"]);
    expect(answer.changes).toEqual([{ account: "me@example.com", added: 1, updated: 0, removed: 0 }]);
    expect(vi.mocked(backend.list).mock.calls[0][0]).toMatchObject({ cacheOnly: true });
  });

  it("does not call everything new when there was no earlier copy", async () => {
    const { run, backend } = setup();
    vi.mocked(backend.list)
      .mockResolvedValueOnce({ messages: [], errors: [] })
      .mockResolvedValueOnce({ messages: [row("1")], errors: [] });
    const answer = data(await run("refresh"));
    expect(answer.new).toEqual([]);
    expect(answer.note).toContain("no earlier copy");
  });
});

describe("wait", () => {
  it("returns as soon as new mail matches, not mail that was already there", async () => {
    const { run, backend } = setup();
    vi.mocked(backend.list)
      .mockResolvedValueOnce({ messages: [row("1", { subject: "Receipt old" })], errors: [] })
      .mockResolvedValueOnce({ messages: [row("1", { subject: "Receipt old" })], errors: [] })
      .mockResolvedValueOnce({ messages: [row("2", { subject: "Receipt new" }), row("1", { subject: "Receipt old" })], errors: [] });
    const answer = data(await run("wait", ["receipt"], { timeout: "2m" }));
    expect(answer.timedOut).toBe(false);
    expect(answer.messages.map((message: { id: string }) => message.id)).toEqual(["a|inbox|2"]);
    expect(answer.waitedMs).toBe(30_000);
  });

  it("gives up at the timeout and says so", async () => {
    const { run } = setup({ folders: { inbox: [row("1")] } });
    const answer = data(await run("wait", ["subject:nothing"], { timeout: "40s" }));
    expect(answer).toMatchObject({ timedOut: true, messages: [], waitedMs: 40_000 });
  });

  it("does not wake up for a sign-in code it cannot match on", async () => {
    const { run, backend } = setup();
    const quiet = { messages: [], errors: [] };
    const code = row("2", { subject: "Your verification code is 482913", snippet: "Enter 482913" });
    vi.mocked(backend.list).mockResolvedValueOnce(quiet).mockResolvedValueOnce({ messages: [code], errors: [] });
    const answer = data(await run("wait", ["482913"], { timeout: "20s" }));
    expect(answer.timedOut).toBe(true);
  });

  it("stops when the caller goes away", async () => {
    const { ctx, run } = setup({ folders: { inbox: [] } });
    const controller = new AbortController();
    ctx.sleep = async (_ms, signal) => {
      controller.abort();
      if (signal.aborted) throw new Error("aborted");
    };
    await expect(run("wait", ["x"], { timeout: "5m" }, controller.signal)).rejects.toThrow("aborted");
  });

  it("needs a search and a timeout it can read", async () => {
    const { run } = setup();
    expect(await run("wait")).toMatchObject({ ok: false, error: { code: "usage" } });
    expect(await run("wait", ["x"], { timeout: "soon" })).toMatchObject({ ok: false, error: { code: "usage" } });
  });
});

describe("open", () => {
  it("brings the conversation to the window without returning its text", async () => {
    const { run, backend } = setup({ details: [detailOf(row("1"), "secret body")] });
    const answer = data(await run("open", ["a|inbox|1"]));
    expect(answer).toEqual({ opened: true, id: "a|inbox|1" });
    expect(backend.openConversation).toHaveBeenCalledWith({ accountId: "a", threadId: "t1", folder: "inbox" });
  });

  it("is allowed for a message with a sign-in code: the person reads it, not the agent", async () => {
    const { run, backend } = setup({ details: [detailOf(row("1", { subject: "Your code is 482913" }), "482913")], carriesCode: () => true });
    expect(data(await run("open", ["a|inbox|1"])).opened).toBe(true);
    expect(backend.openConversation).toHaveBeenCalled();
  });

  it("explains when the message is gone or is in a folder it cannot show", async () => {
    const { run } = setup({ details: [detailOf(row("1", { folder: "sent", id: "a|sent|1" }), "x")] });
    expect(await run("open", ["a|inbox|7"])).toMatchObject({ ok: false, error: { code: "not-found" } });
    expect(await run("open", ["a|sent|1"])).toMatchObject({ ok: false, error: { code: "usage" } });
    expect(await run("open")).toMatchObject({ ok: false, error: { code: "usage" } });
  });
});

describe("accounts, categories and contacts", () => {
  it("lists accounts without anything secret", async () => {
    const { run } = setup();
    expect(data(await run("accounts")).accounts).toEqual([{ id: "a", email: "me@example.com", alias: null, provider: "imap" }]);
  });

  it("lists the categories with their descriptions", async () => {
    expect(data(await setup().run("categories")).categories).toEqual([{ id: "news", name: "Newsletters", description: "Bulk mail" }]);
  });

  it("ranks contacts by who you write to, filters by text and keeps the search out of the title", async () => {
    const entry = (email: string, name: string, sentTo: number): ContactEntry => ({ email, name, sentTo, receivedFrom: 1, lastSeen: 1_700_000_000_000, signal: "person" });
    const { run, records } = setup({ contacts: [entry("bob@x.test", "Bob", 1), entry("anna@x.test", "Anna", 5), entry("ann.lee@y.test", "Ann Lee", 0)] });
    expect(data(await run("contacts")).contacts.map((item: { email: string }) => item.email)).toEqual(["anna@x.test", "bob@x.test", "ann.lee@y.test"]);
    expect(data(await run("contacts", ["ann"])).contacts.map((item: { email: string }) => item.email)).toEqual(["anna@x.test", "ann.lee@y.test"]);
    expect(records.at(-1)?.title).toBe("Read 2 contacts via CLI");
    expect(records.at(-1)?.title).not.toContain("ann");
  });
});

describe("organize: mail commands", () => {
  const known = [row("1"), row("2", { categoryId: "news" })];

  it.each([
    ["pin", "pin"],
    ["unpin", "unpin"],
    ["mark-read", "markRead"],
    ["mark-unread", "markUnread"],
    ["inbox", "unarchive"],
    ["archive", "archive"],
    ["trash", "trash"],
    ["spam", "spam"],
  ])("%s asks the page for %s on the rows named, and gives the Undo", async (command, action) => {
    const { run, backend } = setup({ known });
    const answer = data(await run(command, ["a|inbox|1", "a|inbox|2"]));
    expect(backend.page).toHaveBeenCalledWith({ kind: "mail", action, rows: known });
    expect(answer).toMatchObject({ done: command, outcome: "applied", ref: "undo-test-1", undo: "minimail undo undo-test-1" });
  });

  it("names the ids that are gone, and refuses when none of them are there", async () => {
    const { run } = setup({ known });
    expect(data(await run("archive", ["a|inbox|1", "a|inbox|9"])).missing).toEqual(["a|inbox|9"]);
    expect(await run("archive", ["a|inbox|9"])).toMatchObject({ ok: false, error: { code: "not-found" } });
  });

  it("needs ids, and takes only real ones, a limited number", async () => {
    const { run } = setup({ known });
    expect(await run("archive")).toMatchObject({ ok: false, error: { code: "usage" } });
    expect(await run("archive", ["nope"])).toMatchObject({ ok: false, error: { code: "usage" } });
    expect(await run("archive", Array.from({ length: 101 }, (_, index) => `a|inbox|${index}`))).toMatchObject({ ok: false, error: { code: "usage" } });
    expect(await run("archive", ["a|inbox|1"], { now: true })).toMatchObject({ ok: false, error: { code: "usage" } });
  });

  it("cannot move or mark a draft, but can pin one", async () => {
    const draft = row("3", { folder: "drafts", id: "a|drafts|3" });
    const { run } = setup({ known: [draft] });
    expect(await run("archive", ["a|drafts|3"])).toMatchObject({ ok: false, error: { code: "usage" } });
    expect(await run("mark-read", ["a|drafts|3"])).toMatchObject({ ok: false, error: { code: "usage" } });
    expect((await run("pin", ["a|drafts|3"])).ok).toBe(true);
  });

  it("says when nothing changed, with no Undo", async () => {
    const { run } = setup({ known, pageResult: { outcome: "nothing", count: 0 } });
    const answer = data(await run("archive", ["a|inbox|1"]));
    expect(answer).toMatchObject({ outcome: "nothing", count: 0 });
    expect(answer.note).toContain("already");
    expect(answer).not.toHaveProperty("ref");
  });

  it("reports a server that refused, and one that has not answered, as failures", async () => {
    const refused = await setup({ known, pageResult: { outcome: "failed", count: 0 } }).run("trash", ["a|inbox|1"]);
    expect(refused).toMatchObject({ ok: false, error: { code: "failed" } });
    expect(JSON.stringify(refused)).toContain("Log");
    const waiting = await setup({ known, pageResult: { outcome: "timeout", count: 1 } }).run("trash", ["a|inbox|1"]);
    expect(waiting).toMatchObject({ ok: false, error: { code: "failed" } });
    expect(JSON.stringify(waiting)).toContain("may still go through");
  });

  it("is refused while the Organize commands are turned off, and the Read ones still work", async () => {
    const { run } = setup({ known, settings: { ...ON, disabled: ["archive"] } });
    expect(await run("archive", ["a|inbox|1"])).toMatchObject({ ok: false, error: { code: "disabled" } });
    expect((await run("trash", ["a|inbox|1"])).ok).toBe(true);
  });

  it("does not put an Info row in the Log: the page records the change itself, as via CLI", async () => {
    const { run, records } = setup({ known });
    await run("archive", ["a|inbox|1"]);
    expect(records).toEqual([]);
  });
});

describe("organize: category", () => {
  const known = [row("1"), row("2", { categoryId: "news" }), row("3", { threadId: "t1", id: "a|inbox|3" })];

  it("files conversations under a category by name, once per conversation, with where each is now", async () => {
    const { run, backend } = setup({ known });
    const answer = data(await run("category", ["newsletters", "a|inbox|1", "a|inbox|2", "a|inbox|3"]));
    expect(backend.page).toHaveBeenCalledWith({
      kind: "category",
      categoryId: "news",
      threads: [
        { key: "a:t1", before: null },
        { key: "a:t2", before: "news" },
      ],
    });
    expect(answer).toMatchObject({ done: "category", category: "Newsletters", ref: "undo-test-1" });
  });

  it("takes none, and any case", async () => {
    const { run, backend } = setup({ known });
    await run("category", ["NONE", "a|inbox|2"]);
    expect(vi.mocked(backend.page).mock.calls[0]![0]).toMatchObject({ categoryId: null });
    await run("category", ["NEWSLETTERS", "a|inbox|1"]);
    expect(vi.mocked(backend.page).mock.calls[1]![0]).toMatchObject({ categoryId: "news" });
  });

  it("says which categories exist when the name is wrong, and needs both parts", async () => {
    const { run } = setup({ known });
    const unknown = await run("category", ["receipts", "a|inbox|1"]);
    expect(unknown).toMatchObject({ ok: false, error: { code: "usage" } });
    expect(JSON.stringify(unknown)).toContain("Newsletters");
    expect(await run("category")).toMatchObject({ ok: false, error: { code: "usage" } });
    expect(await run("category", ["news"])).toMatchObject({ ok: false, error: { code: "usage" } });
  });
});

describe("organize: block, priority and mute", () => {
  it("block names senders and domains one by one and sends the mail already here to the Trash", async () => {
    const inbox = [row("1", { from: { name: "Anna", email: "Anna@Example.com" } }), row("2", { from: { name: "Bob", email: "bob@other.test" } })];
    const { run, backend } = setup({ folders: { inbox } });
    const answer = data(await run("block", ["anna@example.com"]));
    const request = vi.mocked(backend.page).mock.calls[0]![0] as Extract<PageRequest, { kind: "list" }>;
    expect(request).toMatchObject({ kind: "list", list: "block", entry: "senders", values: ["anna@example.com"], on: true });
    expect(request.trash.map((item) => item.id)).toEqual(["a|inbox|1"]);
    expect(answer.changes[0]).toMatchObject({ entry: "senders", values: ["anna@example.com"], ref: "undo-test-1" });
  });

  it("makes a request per kind when senders and domains are mixed, and takes @domain", async () => {
    const { run, backend } = setup();
    const answer = data(await run("block", ["anna@example.com", "@spam.test"]));
    const requests = vi.mocked(backend.page).mock.calls.map((call) => call[0] as Extract<PageRequest, { kind: "list" }>);
    expect(requests.map((request) => [request.entry, request.values])).toEqual([["senders", ["anna@example.com"]], ["domains", ["spam.test"]]]);
    expect(answer.changes).toHaveLength(2);
  });

  it("unblocks with --remove and then moves no mail", async () => {
    const { run, backend } = setup({ folders: { inbox: [row("1", { from: { name: "", email: "anna@example.com" } })] } });
    await run("block", ["anna@example.com"], { remove: true });
    expect(vi.mocked(backend.page).mock.calls[0]![0]).toMatchObject({ on: false, trash: [] });
  });

  it("refuses your own address and domain, names that are not addresses or domains, and a block by conversation", async () => {
    const { run } = setup();
    expect(await run("block", ["me@example.com"])).toMatchObject({ ok: false, error: { code: "usage" } });
    expect(await run("block", ["@example.com"])).toMatchObject({ ok: false, error: { code: "usage" } });
    expect(await run("block", ["everyone"])).toMatchObject({ ok: false, error: { code: "usage" } });
    expect(await run("block", ["@nodot"])).toMatchObject({ ok: false, error: { code: "usage" } });
    expect(await run("block", [])).toMatchObject({ ok: false, error: { code: "usage" } });
    expect(await run("block", ["a|inbox|1"], { thread: true })).toMatchObject({ ok: false, error: { code: "usage" } });
    expect(await run("block", Array.from({ length: 51 }, (_, index) => `u${index}@x.test`))).toMatchObject({ ok: false, error: { code: "usage" } });
  });

  it("mutes for every account, or the one named", async () => {
    const { run, backend } = setup();
    await run("mute", ["anna@example.com"]);
    expect(vi.mocked(backend.page).mock.calls[0]![0]).toMatchObject({ list: "mute", accountIds: ["a"] });
    await run("mute", ["anna@example.com"], { account: "me@example.com" });
    expect(vi.mocked(backend.page).mock.calls[1]![0]).toMatchObject({ accountIds: ["a"] });
    expect(await run("mute", ["anna@example.com"], { account: "nobody@x.test" })).toMatchObject({ ok: false, error: { code: "usage" } });
  });

  it("mutes and marks as priority by conversation, from message ids", async () => {
    const { run, backend } = setup({ known: [row("1"), row("2", { threadId: "t1", id: "a|inbox|2" })] });
    await run("mute", ["a|inbox|1", "a|inbox|2"], { thread: true });
    expect(vi.mocked(backend.page).mock.calls[0]![0]).toMatchObject({ list: "mute", entry: "threads", values: ["a:t1"], accountIds: ["a"] });
    await run("priority", ["a|inbox|1"], { thread: true, remove: true });
    expect(vi.mocked(backend.page).mock.calls[1]![0]).toMatchObject({ list: "priority", entry: "threads", on: false });
  });

  it("marks senders as priority", async () => {
    const { run, backend } = setup();
    await run("priority", ["anna@example.com"]);
    expect(vi.mocked(backend.page).mock.calls[0]![0]).toMatchObject({ list: "priority", entry: "senders", values: ["anna@example.com"], on: true });
  });
});

describe("undo", () => {
  const known = [row("1")];

  it("takes back a change the CLI made, by its ref, and forgets the ref", async () => {
    const { run, backend } = setup({ known });
    await run("archive", ["a|inbox|1"]);
    vi.mocked(backend.page).mockResolvedValueOnce({ outcome: "applied", count: 1 });
    expect(data(await run("undo", ["undo-test-1"]))).toMatchObject({ done: "undo", undone: true, ref: "undo-test-1" });
    expect(vi.mocked(backend.page).mock.calls.at(-1)![0]).toEqual({ kind: "undo", ref: "undo-test-1" });
    expect(await run("undo", ["undo-test-1"])).toMatchObject({ ok: false, error: { code: "not-found" } });
  });

  it("takes back the latest without a ref", async () => {
    const { run, backend } = setup({ known });
    await run("archive", ["a|inbox|1"]);
    vi.mocked(backend.page).mockResolvedValueOnce({ outcome: "applied", count: 1 });
    await run("undo");
    expect(vi.mocked(backend.page).mock.calls.at(-1)![0]).toEqual({ kind: "undo", ref: "undo-test-1" });
  });

  it("refuses what the person did themselves, and says there is nothing when nothing was done", async () => {
    const { run, backend } = setup({ known });
    expect(await run("undo")).toMatchObject({ ok: false, error: { code: "not-found" } });
    expect(await run("undo", ["undo-mail-by-the-person-7"])).toMatchObject({ ok: false, error: { code: "not-found" } });
    expect(backend.page).not.toHaveBeenCalled();
  });

  it("says so when it can no longer be taken back", async () => {
    const { run, backend } = setup({ known });
    await run("archive", ["a|inbox|1"]);
    vi.mocked(backend.page).mockResolvedValueOnce({ outcome: "nothing", count: 0 });
    const answer = data(await run("undo"));
    expect(answer.undone).toBe(false);
    expect(answer.note).toContain("already");
  });

  it("works even when every Organize command is turned off", async () => {
    const { run, undos } = setup({ known, settings: { ...ON, disabled: ["archive", "trash"] } });
    undos.add("undo-test-1");
    expect((await run("undo", ["undo-test-1"])).ok).toBe(true);
  });
});

describe("help", () => {
  it("lists the Organize group and each command in it", async () => {
    const answer = await setup().run("help");
    const text = answer.ok ? answer.text ?? "" : "";
    expect(text).toContain("Organize");
    for (const usage of ["archive <message-id>...", "category <name|none> <message-id>...", "block <address|@domain>... [--remove]", "undo [ref]"]) {
      expect(text).toContain(usage);
    }
  });
});

describe("drafts", () => {
  const info = (id = "draft-1", over: Partial<import("@shared/cli-page").DraftInfo> = {}): import("@shared/cli-page").DraftInfo => ({
    id,
    accountId: "a",
    to: ["anna@example.com"],
    cc: [],
    bcc: [],
    subject: "Hello",
    files: [],
    ...over,
  });
  const made = (over = {}): PageResult => ({ outcome: "applied", count: 1, ref: "undo-draft-1", draft: info("draft-1", over) });
  const request = (backend: CliBackend, index = 0) => vi.mocked(backend.page).mock.calls[index]![0] as Extract<PageRequest, { kind: "draft" }>;
  const create = (backend: CliBackend, index = 0) => request(backend, index) as Extract<PageRequest, { kind: "draft"; op: "create" }>;

  it("writes a new draft from the only account, with recipients, subject and text, and says nothing was sent", async () => {
    const { run, backend } = setup({ pageResult: made() });
    const answer = data(await run("draft new", [], { to: "anna@example.com, Bob <bob@example.com>", subject: "Hello", body: "Hi\nthere" }));
    expect(request(backend)).toEqual({
      kind: "draft",
      op: "create",
      compose: {
        mode: "new",
        accountId: "a",
        to: [{ name: "", email: "anna@example.com" }, { name: "Bob", email: "bob@example.com" }],
        subject: "Hello",
        body: "Hi\nthere",
      },
    });
    expect(answer).toMatchObject({ done: "draft new", draft: { id: "draft-1" }, ref: "undo-draft-1" });
    expect(answer.note).toContain("Nothing has been sent");
    expect(JSON.stringify(answer)).not.toContain("there");
  });

  it("asks which account when there are several, and takes the one named", async () => {
    const second = { ...ACCOUNT, id: "b", email: "work@example.com" } as Account;
    const { run, backend } = setup({ accounts: [ACCOUNT, second], pageResult: made() });
    const several = await run("draft new", [], { subject: "x" });
    expect(several).toMatchObject({ ok: false, error: { code: "usage" } });
    expect(JSON.stringify(several)).toContain("work@example.com");
    await run("draft new", [], { account: "work@example.com" });
    expect(create(backend).compose).toMatchObject({ accountId: "b" });
  });

  it("refuses an address that is not one, naming it", async () => {
    const answer = await setup().run("draft new", [], { to: "anna@example.com, nobody" });
    expect(answer).toMatchObject({ ok: false, error: { code: "usage" } });
    expect(JSON.stringify(answer)).toContain("nobody");
  });

  it("attaches the files named, and refuses one that is not there before anything is written", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-cmd-"));
    writeFileSync(join(dir, "plan.pdf"), "pdf");
    const { run, backend } = setup({ pageResult: made({ files: ["plan.pdf"] }) });
    await run("draft new", [], { attach: join(dir, "plan.pdf") });
    expect(create(backend).compose.attachments?.map((file) => [file.filename, file.contentType])).toEqual([["plan.pdf", "application/pdf"]]);
    const missing = await run("draft new", [], { attach: join(dir, "gone.pdf") });
    expect(missing).toMatchObject({ ok: false, error: { code: "usage" } });
    expect(backend.page).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["draft reply", "reply"],
    ["draft reply-all", "replyAll"],
  ])("%s builds on the message, from its account", async (command, mode) => {
    const original = detailOf(row("1", { accountId: "a" }), "Lunch?");
    const { run, backend } = setup({ details: [original], pageResult: made() });
    await run(command, ["a|inbox|1"], { body: "Yes" });
    expect(create(backend).compose).toMatchObject({ mode, accountId: "a", body: "Yes", original: { id: "a|inbox|1" } });
  });

  it("builds a forward only when told who gets it", async () => {
    const { run, backend } = setup({ details: [detailOf(row("1"), "x")], pageResult: made() });
    expect(await run("draft forward", ["a|inbox|1"])).toMatchObject({ ok: false, error: { code: "usage" } });
    await run("draft forward", ["a|inbox|1"], { to: "dee@example.com" });
    expect(create(backend).compose).toMatchObject({ mode: "forward", to: [{ name: "", email: "dee@example.com" }] });
  });

  it("will not reply to or forward a message with a sign-in code, even one the rules cannot read", async () => {
    const code = detailOf(row("2", { subject: "Your verification code is 482913" }), "Use 482913");
    const magic = detailOf(row("3", { categoryId: "verification-codes" }), "Click to sign in");
    const { run, backend } = setup({ details: [code, magic], carriesCode: (detail) => detail.text?.includes("482913") ?? false });
    for (const id of ["a|inbox|2", "a|inbox|3"]) {
      expect(await run("draft reply", [id])).toMatchObject({ ok: false, error: { code: "usage" } });
      expect(await run("draft forward", [id], { to: "x@y.test" })).toMatchObject({ ok: false, error: { code: "usage" } });
    }
    expect(backend.page).not.toHaveBeenCalled();
  });

  it("says when the message is gone and when no message was named", async () => {
    const { run } = setup();
    expect(await run("draft reply", ["a|inbox|9"])).toMatchObject({ ok: false, error: { code: "not-found" } });
    expect(await run("draft reply")).toMatchObject({ ok: false, error: { code: "usage" } });
  });

  it("changes only drafts it wrote, and needs something to change", async () => {
    const { run, backend } = setup({ pageResult: made() });
    expect(await run("draft edit", ["draft-1"], { subject: "x" })).toMatchObject({ ok: false, error: { code: "not-found" } });
    await run("draft new", [], { subject: "Hello" });
    expect(await run("draft edit", ["draft-1"])).toMatchObject({ ok: false, error: { code: "usage" } });
    await run("draft edit", ["draft-1"], { subject: "Better", to: "" });
    expect(request(backend, 1)).toEqual({ kind: "draft", op: "edit", id: "draft-1", changes: { subject: "Better", to: [] } });
  });

  it("counts the files already on a draft against the limit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mm-cmd-"));
    writeFileSync(join(dir, "a.txt"), "a");
    const files = Array.from({ length: 25 }, (_, index) => `f${index}.txt`);
    const { run } = setup({ pageResult: made({ files }) });
    await run("draft new", [], { subject: "x" });
    expect(await run("draft edit", ["draft-1"], { attach: join(dir, "a.txt") })).toMatchObject({ ok: false, error: { code: "usage" } });
  });

  it("deletes only its own drafts, and stops listing them", async () => {
    const { run, backend } = setup({ pageResult: made() });
    expect(await run("draft delete", ["draft-1"])).toMatchObject({ ok: false, error: { code: "not-found" } });
    await run("draft new", [], { subject: "Hello" });
    expect(data(await run("draft list")).drafts.map((draft: { id: string }) => draft.id)).toEqual(["draft-1"]);
    await run("draft delete", ["draft-1"]);
    expect(request(backend, 1)).toEqual({ kind: "draft", op: "delete", id: "draft-1" });
    expect(data(await run("draft list")).drafts).toEqual([]);
  });

  it("takes options it knows for each command and no others", async () => {
    const { run } = setup();
    expect(await run("draft reply", ["a|inbox|1"], { to: "x@y.test" })).toMatchObject({ ok: false, error: { code: "usage" } });
    expect(await run("draft delete", ["draft-1"], { subject: "x" })).toMatchObject({ ok: false, error: { code: "usage" } });
  });

  it("is refused while the Drafts commands are turned off, and the others still work", async () => {
    const { run } = setup({ settings: { ...ON, disabled: ["draft new"] } });
    expect(await run("draft new", [], { subject: "x" })).toMatchObject({ ok: false, error: { code: "disabled" } });
    expect((await run("draft list")).ok).toBe(true);
  });

  it("carries a long text, which is far over what a search needs", async () => {
    const { run, backend } = setup({ pageResult: made() });
    const long = "word ".repeat(30_000);
    expect((await run("draft new", [], { body: long })).ok).toBe(true);
    expect(create(backend).compose.body).toBe(long);
  });
});

function savedDraft(overrides: Partial<SavedDraft> = {}): SavedDraft {
  return {
    id: "draft-1",
    savedAt: "2026-11-20T10:00:00.000Z",
    mode: "new",
    accountId: "a",
    to: [{ name: "Anna", email: "anna@example.com" }],
    cc: [],
    bcc: [],
    pendingText: { to: "", cc: "", bcc: "" },
    subject: "Hello",
    body: "Hi Anna",
    ...overrides,
  };
}

/** A setup where the CLI has written draft-1, as `draft new` would have. */
function withDraft(options: Setup = {}, draft: SavedDraft = savedDraft(), files: DraftAttachmentLike[] = []) {
  const made = setup({ ...options, saved: [draft] });
  made.drafts.record(
    { id: draft.id, accountId: draft.accountId, to: draft.to.map((c) => c.email), cc: draft.cc.map((c) => c.email), bcc: draft.bcc.map((c) => c.email), subject: draft.subject, files: files.map((f) => f.filename) },
    files as never,
  );
  return made;
}
type DraftAttachmentLike = { filename: string; contentType: string; contentBase64: string };
const askMode = (send: "off" | "ask" | "always", rest: Partial<CliSettings> = {}): CliSettings => ({ ...ON, ask: { ...ON.ask, send }, ...rest });
const cardOf = (backend: CliBackend, index = 0) => vi.mocked(backend.confirm).mock.calls[index]![0] as Extract<ConfirmCard, { action: "send" }>;

describe("send", () => {
  it("sends without asking when every recipient, the hidden ones too, is on the allowed list, and tells the person", async () => {
    const draft = savedDraft({ cc: [{ name: "", email: "cy@example.com" }], bcc: [{ name: "", email: "dee@work.test" }] });
    const { run, backend, records, drafts } = withDraft({ settings: askMode("ask", { allowedRecipients: ["anna@example.com", "cy@example.com", "@work.test"] }) }, draft);
    const answer = data(await run("send", ["draft-1"]));
    expect(backend.confirm).not.toHaveBeenCalled();
    expect(backend.send).toHaveBeenCalledWith(draft, null);
    expect(answer).toMatchObject({ done: "send", sent: true, asked: false, subject: "Hello" });
    expect(answer.to.sort()).toEqual(["anna@example.com", "cy@example.com", "dee@work.test"]);
    expect(backend.notify).toHaveBeenCalledWith("Sent via CLI", "To anna@example.com: Hello");
    expect(records[0]).toMatchObject({ title: "Sent a message via CLI" });
    expect(records[0]!.title).not.toContain("Hello");
    expect(drafts.list()).toEqual([]);
  });

  it("asks when one recipient is not allowed, even a hidden copy, and shows the card everything", async () => {
    const draft = savedDraft({ bcc: [{ name: "", email: "hidden@evil.test" }], body: "The numbers", quoted: "> earlier" });
    const { run, backend } = withDraft({ settings: askMode("ask", { allowedRecipients: ["anna@example.com"] }) }, draft);
    await run("send", ["draft-1"]);
    expect(cardOf(backend)).toMatchObject({
      action: "send",
      from: "me@example.com",
      to: ["anna@example.com"],
      bcc: ["hidden@evil.test"],
      subject: "Hello",
      newRecipients: ["hidden@evil.test"],
      canAlways: true,
      filesFromCli: false,
      sendAt: null,
    });
    expect(cardOf(backend).preview).toContain("The numbers");
    expect(backend.send).toHaveBeenCalledTimes(1);
    expect(backend.notify).not.toHaveBeenCalled();
  });

  it("does not add anyone to the allowed list when the person allows it just once", async () => {
    const { run, settingsNow } = withDraft({ settings: askMode("ask"), decision: "once" });
    await run("send", ["draft-1"]);
    expect(settingsNow().allowedRecipients).toEqual([]);
  });

  it("adds everyone on the draft to the allowed list on 'always allow', so the next send to them does not ask", async () => {
    const draft = savedDraft({ cc: [{ name: "", email: "cy@example.com" }] });
    const { run, backend, settingsNow, drafts, saved } = withDraft({ settings: askMode("ask"), decision: "always" }, draft);
    await run("send", ["draft-1"]);
    expect(settingsNow().allowedRecipients.sort()).toEqual(["anna@example.com", "cy@example.com"]);
    // A new draft to the same people goes straight out.
    saved.push(savedDraft({ id: "draft-2" }));
    drafts.record({ id: "draft-2", accountId: "a", to: ["anna@example.com"], cc: [], bcc: [], subject: "Hello", files: [] });
    await run("send", ["draft-2"]);
    expect(backend.confirm).toHaveBeenCalledTimes(1);
    expect(backend.send).toHaveBeenCalledTimes(2);
  });

  it("does not send when the person says no, and says not to try again", async () => {
    const { run, backend, drafts } = withDraft({ settings: askMode("ask"), decision: "reject" });
    const answer = await run("send", ["draft-1"]);
    expect(answer).toMatchObject({ ok: false, error: { code: "rejected" } });
    expect(JSON.stringify(answer)).toContain("Do not try again");
    expect(backend.send).not.toHaveBeenCalled();
    expect(drafts.list()).toHaveLength(1);
  });

  it("does not send when the person opens the draft in the composer, and the card names that draft", async () => {
    const { run, backend, drafts } = withDraft({ settings: askMode("ask"), decision: "review" });
    const answer = await run("send", ["draft-1"]);
    expect(answer).toMatchObject({ ok: false, error: { code: "rejected" } });
    expect(JSON.stringify(answer)).toContain("composer");
    expect(cardOf(backend)).toMatchObject({ draftId: "draft-1" });
    expect(backend.send).not.toHaveBeenCalled();
    expect(drafts.list()).toHaveLength(1);
  });

  it("does not send when nobody answers in time", async () => {
    const { run, backend } = withDraft({ settings: askMode("ask"), decision: "no-answer" });
    const answer = await run("send", ["draft-1"]);
    expect(answer).toMatchObject({ ok: false, error: { code: "failed" } });
    expect(JSON.stringify(answer)).toContain("Nobody answered");
    expect(backend.send).not.toHaveBeenCalled();
  });

  it("always asks about files the agent attached, with no 'always allow', even for an allowed person or for anyone", async () => {
    const file = { filename: "keys.txt", contentType: "text/plain", contentBase64: "c2VjcmV0" };
    const draft = savedDraft({ attachments: [file] });
    for (const settings of [askMode("ask", { allowedRecipients: ["anna@example.com"] }), askMode("always")]) {
      const { run, backend } = withDraft({ settings }, draft, [file]);
      await run("send", ["draft-1"]);
      expect(backend.confirm).toHaveBeenCalledTimes(1);
      expect(cardOf(backend)).toMatchObject({ filesFromCli: true, canAlways: false, newRecipients: [], files: [{ filename: "keys.txt", size: 6 }] });
    }
  });

  it("sends to anyone without asking when that is allowed, still telling the person", async () => {
    const { run, backend } = withDraft({ settings: askMode("always") });
    expect((await run("send", ["draft-1"])).ok).toBe(true);
    expect(backend.confirm).not.toHaveBeenCalled();
    expect(backend.notify).toHaveBeenCalled();
  });

  it("is refused while sending is turned off", async () => {
    const { run, backend } = withDraft({ settings: askMode("off") });
    expect(await run("send", ["draft-1"])).toMatchObject({ ok: false, error: { code: "disabled" } });
    expect(backend.send).not.toHaveBeenCalled();
  });

  it("does not send a draft that changed while the question was open", async () => {
    const { run, backend, saved } = withDraft({ settings: askMode("ask") });
    vi.mocked(backend.confirm).mockImplementationOnce(async () => {
      saved[0] = { ...saved[0]!, bcc: [{ name: "", email: "evil@evil.test" }] };
      return "once";
    });
    const answer = await run("send", ["draft-1"]);
    expect(answer).toMatchObject({ ok: false, error: { code: "failed" } });
    expect(JSON.stringify(answer)).toContain("changed while MiniMail was asking");
    expect(backend.send).not.toHaveBeenCalled();
  });

  it("does not send a draft that was deleted while the question was open", async () => {
    const { run, backend, saved } = withDraft({ settings: askMode("ask") });
    vi.mocked(backend.confirm).mockImplementationOnce(async () => {
      saved.length = 0;
      return "once";
    });
    expect(await run("send", ["draft-1"])).toMatchObject({ ok: false, error: { code: "failed" } });
    expect(backend.send).not.toHaveBeenCalled();
  });

  it("schedules with --at, showing the time on the card, and says so", async () => {
    const { run, backend } = withDraft({ settings: askMode("ask") });
    const answer = data(await run("send", ["draft-1"], { at: "2h" }));
    expect(backend.send).toHaveBeenCalledWith(expect.objectContaining({ id: "draft-1" }), 2 * 3_600_000);
    expect(cardOf(backend).sendAt).toBe(2 * 3_600_000);
    expect(answer).toMatchObject({ sent: false, scheduledFor: new Date(2 * 3_600_000).toISOString() });
  });

  it("refuses a time that is not one before asking anyone", async () => {
    const { run, backend } = withDraft({ settings: askMode("ask") });
    expect(await run("send", ["draft-1"], { at: "tomorrow" })).toMatchObject({ ok: false, error: { code: "usage" } });
    expect(backend.confirm).not.toHaveBeenCalled();
  });

  it("only sends drafts the CLI wrote", async () => {
    const { run, backend } = setup({ settings: askMode("always"), saved: [savedDraft({ id: "mine" })] });
    expect(await run("send", ["mine"])).toMatchObject({ ok: false, error: { code: "not-found" } });
    expect(await run("send")).toMatchObject({ ok: false, error: { code: "usage" } });
    expect(backend.send).not.toHaveBeenCalled();
  });

  it("will not send what cannot go out: no one to send to, a bad address, rich text, a gone account or a gone draft", async () => {
    for (const bad of [savedDraft({ to: [] }), savedDraft({ to: [{ name: "", email: "nobody" }] }), savedDraft({ bodyHtml: "<p>x</p>" }), savedDraft({ accountId: "zzz" })]) {
      const { run, backend } = withDraft({ settings: askMode("always") }, bad);
      expect(await run("send", ["draft-1"])).toMatchObject({ ok: false, error: { code: "usage" } });
      expect(backend.send).not.toHaveBeenCalled();
    }
    const gone = setup({ settings: askMode("always") });
    gone.drafts.record({ id: "draft-1", accountId: "a", to: [], cc: [], bcc: [], subject: "", files: [] });
    expect(await gone.run("send", ["draft-1"])).toMatchObject({ ok: false, error: { code: "not-found" } });
  });

  it("reports a server that refused and keeps the draft", async () => {
    const { run, backend, drafts } = withDraft({ settings: askMode("always") });
    vi.mocked(backend.send).mockRejectedValueOnce(new Error("The server refused it"));
    await expect(run("send", ["draft-1"])).rejects.toThrow("refused");
    expect(drafts.list()).toHaveLength(1);
  });
});

describe("unsubscribe", () => {
  const list = (id: string, email: string, listId: string | null = null) =>
    row(id, { from: { name: email.split("@")[0]!, email }, unsubscribe: { url: "https://shop.test/u?token=SECRET", oneClick: true, listId } });
  const done = { outcome: "applied" as const, count: 2, unsubscribe: { done: 2, manual: [], failed: [], skipped: 0, alreadyDone: 0 } };
  const unsubSettings = (mode: "off" | "ask" | "always"): CliSettings => ({ ...ON, ask: { ...ON.ask, unsubscribe: mode } });

  it("asks first, naming each list once, and unsubscribes through the page when allowed", async () => {
    const known = [list("1", "deals@shop.test"), list("2", "deals@shop.test"), list("3", "news@paper.test")];
    const { run, backend } = setup({ known, pageResult: done });
    const answer = data(await run("unsubscribe", ["a|inbox|1", "a|inbox|2", "a|inbox|3"]));
    expect(backend.confirm).toHaveBeenCalledWith({
      action: "unsubscribe",
      lists: [{ sender: "deals", email: "deals@shop.test", messages: 2 }, { sender: "news", email: "news@paper.test", messages: 1 }],
      skipped: 0,
    });
    expect(vi.mocked(backend.page).mock.calls[0]![0]).toMatchObject({ kind: "unsubscribe" });
    expect(answer).toMatchObject({ done: "unsubscribe", unsubscribed: 2 });
  });

  it("does nothing when the person says no", async () => {
    const { run, backend } = setup({ known: [list("1", "deals@shop.test")], decision: "reject" });
    expect(await run("unsubscribe", ["a|inbox|1"])).toMatchObject({ ok: false, error: { code: "rejected" } });
    expect(backend.page).not.toHaveBeenCalled();
  });

  it("stops asking after 'always allow'", async () => {
    const { run, backend, settingsNow } = setup({ known: [list("1", "deals@shop.test"), list("2", "news@paper.test")], decision: "always", pageResult: done });
    await run("unsubscribe", ["a|inbox|1"]);
    expect(settingsNow().ask.unsubscribe).toBe("always");
    await run("unsubscribe", ["a|inbox|2"]);
    expect(backend.confirm).toHaveBeenCalledTimes(1);
  });

  it("goes ahead without asking when allowed, and is refused when off", async () => {
    const known = [list("1", "deals@shop.test")];
    const allowed = setup({ known, settings: unsubSettings("always"), pageResult: done });
    expect((await allowed.run("unsubscribe", ["a|inbox|1"])).ok).toBe(true);
    expect(allowed.backend.confirm).not.toHaveBeenCalled();
    expect(await setup({ known, settings: unsubSettings("off") }).run("unsubscribe", ["a|inbox|1"])).toMatchObject({ ok: false, error: { code: "disabled" } });
  });

  it("leaves out messages that offer no way out, and says when none do", async () => {
    const known = [list("1", "deals@shop.test"), row("2")];
    const { run, backend } = setup({ known, pageResult: done });
    const answer = data(await run("unsubscribe", ["a|inbox|1", "a|inbox|2"]));
    expect(vi.mocked(backend.confirm).mock.calls[0]![0]).toMatchObject({ skipped: 1 });
    expect((vi.mocked(backend.page).mock.calls[0]![0] as Extract<PageRequest, { kind: "unsubscribe" }>).rows.map((item) => item.id)).toEqual(["a|inbox|1"]);
    expect(answer.skipped).toBe(1);
    expect(await setup({ known: [row("2")] }).run("unsubscribe", ["a|inbox|2"])).toMatchObject({ ok: false, error: { code: "usage" } });
  });

  it("tells the agent a sender needs the person, without handing it the address with the token", async () => {
    const manual = { outcome: "nothing" as const, count: 0, unsubscribe: { done: 0, manual: [{ sender: "Deals", host: "shop.test" }], failed: [], skipped: 0, alreadyDone: 0 } };
    const { run } = setup({ known: [list("1", "deals@shop.test")], pageResult: manual });
    const answer = data(await run("unsubscribe", ["a|inbox|1"]));
    expect(answer.needsThePerson).toEqual([{ sender: "Deals", host: "shop.test" }]);
    expect(JSON.stringify(answer)).not.toContain("SECRET");
    expect(answer.note).toContain("web page");
  });
});

describe("invitation", () => {
  const invite = (over = {}) => ({
    uid: "u1",
    method: "REQUEST" as const,
    title: "Design review",
    start: "2026-11-22T10:00:00.000Z",
    end: "2026-11-22T11:00:00.000Z",
    allDay: false,
    location: "Room 4",
    organizer: { name: "Dana", email: "dana@acme.test" },
    response: null,
    ...over,
  });
  const withInvite = (over = {}, options: Setup = {}) => setup({ details: [{ ...detailOf(row("1"), "You are invited"), invitation: invite(over) }], ...options });

  it.each([
    ["accept", "accepted"],
    ["maybe", "tentative"],
    ["decline", "declined"],
  ])("asks first and answers %s as %s", async (word, response) => {
    const { run, backend, records } = withInvite();
    const answer = data(await run("invitation", ["a|inbox|1", word]));
    expect(vi.mocked(backend.confirm).mock.calls[0]![0]).toMatchObject({ action: "invitation", answer: word, title: "Design review", organizer: "Dana <dana@acme.test>", location: "Room 4" });
    expect(backend.respond).toHaveBeenCalledWith("a|inbox|1", response);
    expect(answer).toMatchObject({ done: "invitation", answer: word });
    expect(records[0]!.title).toBe("Answered an invitation via CLI");
  });

  it("does not answer when the person says no", async () => {
    const { run, backend } = withInvite({}, { decision: "reject" });
    expect(await run("invitation", ["a|inbox|1", "accept"])).toMatchObject({ ok: false, error: { code: "rejected" } });
    expect(backend.respond).not.toHaveBeenCalled();
  });

  it("stops asking after 'always allow'", async () => {
    const { run, backend, settingsNow } = withInvite({}, { decision: "always" });
    await run("invitation", ["a|inbox|1", "accept"]);
    expect(settingsNow().ask.invitation).toBe("always");
    await run("invitation", ["a|inbox|1", "accept"]);
    expect(backend.confirm).toHaveBeenCalledTimes(1);
  });

  it("needs an invitation to answer, and a message and an answer it understands", async () => {
    const { run } = withInvite();
    expect(await run("invitation", ["a|inbox|1", "perhaps"])).toMatchObject({ ok: false, error: { code: "usage" } });
    expect(await run("invitation", ["a|inbox|1"])).toMatchObject({ ok: false, error: { code: "usage" } });
    expect(await run("invitation", ["a|inbox|9", "accept"])).toMatchObject({ ok: false, error: { code: "not-found" } });
    expect(await withInvite({ method: "CANCEL" }).run("invitation", ["a|inbox|1", "accept"])).toMatchObject({ ok: false, error: { code: "usage" } });
    expect(await setup({ details: [detailOf(row("1"), "plain")] }).run("invitation", ["a|inbox|1", "accept"])).toMatchObject({ ok: false, error: { code: "usage" } });
  });

  it("is refused while turned off", async () => {
    const { run } = withInvite({}, { settings: { ...ON, ask: { ...ON.ask, invitation: "off" } } });
    expect(await run("invitation", ["a|inbox|1", "accept"])).toMatchObject({ ok: false, error: { code: "disabled" } });
  });
});

describe("ask first in help and status", () => {
  it("says which commands ask the person first or are allowed without asking", async () => {
    const { run } = setup({ settings: { ...ON, ask: { send: "ask", unsubscribe: "always", invitation: "off" } } });
    const text = (await run("help")) as { ok: true; text: string };
    expect(text.text).toContain("send <draft-id> [--at <time>]   (asks the person first)");
    expect(text.text).toContain("(allowed without asking)");
    expect(text.text).toContain("invitation <message-id> accept|maybe|decline   (turned off in MiniMail Settings)");
    expect(text.text).toContain("If they say no, do not try again");
  });

  it("reports how each is set, and how many people are allowed, never who", async () => {
    const { run } = setup({ settings: { ...ON, allowedRecipients: ["anna@example.com", "@work.test"] } });
    const status = data(await run("status"));
    expect(status.askFirst).toEqual({ send: "ask", unsubscribe: "ask", invitation: "ask" });
    expect(status.allowedRecipients).toBe(2);
    expect(JSON.stringify(status)).not.toContain("anna@example.com");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAIL_WINDOW } from "@shared/mail-window";
import type { Account, MailFolder } from "@shared/types";

import { GraphProvider } from "./graph";
import type { CachedFolder, SummaryStore } from "./summary-cache";

const GRAPH = "https://graph.microsoft.com/v1.0";
const FEED_PAGE = 50;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

interface Mail {
  id: string;
  at: number;
  read: boolean;
  flagged: boolean;
}

type Kind = "list" | "feed" | "detail";

const fullMessage = (mail: Mail) => ({
  id: mail.id,
  conversationId: `c-${mail.id}`,
  subject: `Subject ${mail.id}`,
  from: { emailAddress: { name: "Ann", address: "ann@example.com" } },
  toRecipients: [{ emailAddress: { name: "Me", address: "me@example.com" } }],
  receivedDateTime: new Date(mail.at).toISOString(),
  bodyPreview: "hello",
  isRead: mail.read,
  hasAttachments: false,
  flag: { flagStatus: mail.flagged ? "flagged" : "notFlagged" },
});

/**
 * Just enough of one Graph inbox: pages of messages newest first, a change feed that pages and
 * ends in a delta link, and messages by id. Every request is recorded by kind.
 */
class FakeInbox {
  mail: Mail[] = [];
  readonly calls: Kind[] = [];
  /** The `$filter` of each first feed request. */
  readonly feedFilters: Array<string | null> = [];
  private version = 0;
  private readonly log: Array<{ version: number; id: string; gone: boolean }> = [];
  /** The next feed request that carries a delta token is answered with this error, once. */
  expireNextFeed = false;
  /** Every feed request is refused with this status. */
  refuseFeedWith: number | null = null;
  private held: { arrived: () => void; released: Promise<void> } | null = null;

  constructor(count: number) {
    for (let index = 1; index <= count; index += 1) {
      this.mail.push({ id: `m${index}`, at: Date.UTC(2026, 10, 1) + (10_000 - index) * 60_000, read: false, flagged: false });
    }
  }

  count(kind: Kind): number {
    return this.calls.filter((call) => call === kind).length;
  }

  /** A message arrives, newer than everything. */
  arrive(id: string): void {
    const newest = Math.max(...this.mail.map((mail) => mail.at));
    this.mail.unshift({ id, at: newest + 60_000, read: false, flagged: false });
    this.record(id, false);
  }

  /** Read in another app. */
  markRead(id: string): void {
    this.mail.find((mail) => mail.id === id)!.read = true;
    this.record(id, false);
  }

  /** Deleted or moved away in another app. */
  remove(id: string): void {
    this.mail = this.mail.filter((mail) => mail.id !== id);
    this.record(id, true);
  }

  /** Holds the next feed request until `release`; `arrived` settles when it has been received. */
  holdNextFeed(): { arrived: Promise<void>; release: () => void } {
    let release!: () => void;
    let arrived!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const arrival = new Promise<void>((resolve) => (arrived = resolve));
    this.held = { arrived, released };
    return { arrived: arrival, release };
  }

  private record(id: string, gone: boolean): void {
    this.version += 1;
    this.log.push({ version: this.version, id, gone });
  }

  async handle(url: string, method: string): Promise<Response> {
    if (method !== "GET") return new Response(null, { status: 200 });
    const parsed = new URL(url);
    const params = parsed.searchParams;

    if (parsed.pathname.includes("/messages/delta")) {
      this.calls.push("feed");
      return this.feed(params);
    }
    if (/\/me\/messages\/[^/]+$/.test(parsed.pathname)) {
      this.calls.push("detail");
      const id = decodeURIComponent(parsed.pathname.split("/").pop()!);
      const mail = this.mail.find((candidate) => candidate.id === id);
      return mail ? json(fullMessage(mail)) : json({ error: { code: "ErrorItemNotFound" } }, 404);
    }
    this.calls.push("list");
    const top = Number(params.get("$top"));
    const skip = Number(params.get("$skip") ?? 0);
    const page = this.mail.slice(skip, skip + top).map(fullMessage);
    const more = skip + top < this.mail.length;
    return json({
      value: page,
      "@odata.nextLink": more ? `${GRAPH}/me/mailFolders/inbox/messages?$top=${top}&$skip=${skip + top}` : undefined,
    });
  }

  private async feed(params: URLSearchParams): Promise<Response> {
    if (this.held) {
      const { arrived, released } = this.held;
      this.held = null;
      arrived();
      await released;
    }
    if (this.refuseFeedWith) {
      return json({ error: { code: "ErrorInvalidRequest", message: "Not supported." } }, this.refuseFeedWith);
    }
    const token = params.get("$deltatoken");
    if (token !== null && this.expireNextFeed) {
      this.expireNextFeed = false;
      return json({ error: { code: "SyncStateNotFound", message: "The sync state is gone." } }, 410);
    }

    const link = `${GRAPH}/me/mailFolders/inbox/messages/delta?$deltatoken=${this.version}`;
    if (token !== null) {
      const latest = new Map<string, boolean>();
      for (const entry of this.log) if (entry.version > Number(token)) latest.set(entry.id, entry.gone);
      const value = [...latest].map(([id, gone]) => {
        const mail = this.mail.find((candidate) => candidate.id === id);
        return gone || !mail
          ? { id, "@removed": { reason: "deleted" } }
          : { id, isRead: mail.read, flag: { flagStatus: mail.flagged ? "flagged" : "notFlagged" } };
      });
      return json({ value, "@odata.deltaLink": link });
    }

    // The first round: everything the filter covers, in pages.
    const filter = params.get("$filter");
    if (params.get("$skiptoken") === null) this.feedFilters.push(filter);
    const since = filter ? Date.parse(filter.replace("receivedDateTime ge ", "")) : -Infinity;
    const covered = this.mail.filter((mail) => mail.at >= since);
    const offset = Number(params.get("$skiptoken") ?? 0);
    const value = covered.slice(offset, offset + FEED_PAGE).map((mail) => ({
      id: mail.id,
      isRead: mail.read,
      flag: { flagStatus: mail.flagged ? "flagged" : "notFlagged" },
    }));
    if (offset + FEED_PAGE < covered.length) {
      const next = `${GRAPH}/me/mailFolders/inbox/messages/delta?$skiptoken=${offset + FEED_PAGE}${
        filter ? `&$filter=${encodeURIComponent(filter)}` : ""
      }`;
      return json({ value, "@odata.nextLink": next });
    }
    return json({ value, "@odata.deltaLink": link });
  }
}

function memoryStore(): SummaryStore & { folders: Map<MailFolder, CachedFolder> } {
  const folders = new Map<MailFolder, CachedFolder>();
  return {
    folders,
    load: (folder) => folders.get(folder),
    save: (folder, value) => void folders.set(folder, value),
  };
}

const account: Account = {
  id: "acc",
  provider: "outlook",
  email: "me@example.com",
  displayName: "Me",
  auth: "oauth",
  hue: 10,
  outlookKind: "personal",
};

const natives = (rows: Array<{ id: string }>) => rows.map((row) => row.id.split("|")[2]);

describe("Outlook change feed", () => {
  let inbox: FakeInbox;
  let store: ReturnType<typeof memoryStore>;

  const launch = (shared: SummaryStore = store) =>
    new GraphProvider(account, async () => "tok", shared, async () => undefined);

  const stub = () =>
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) =>
      inbox.handle(String(input), init?.method ?? "GET"),
    );

  beforeEach(() => {
    inbox = new FakeInbox(650);
    store = memoryStore();
    stub();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** A provider that has listed the window once, with the calls of that first list forgotten. */
  const primed = async () => {
    const provider = launch();
    await provider.list("inbox", MAIL_WINDOW);
    inbox.calls.length = 0;
    return provider;
  };

  it("downloads the window once, then asks only what changed", async () => {
    const provider = launch();
    const first = await provider.list("inbox", MAIL_WINDOW);
    expect(first).toHaveLength(MAIL_WINDOW);
    expect(natives(first)[0]).toBe("m1");
    // 600 rows are tracked (the window and room to spare), six pages of 100.
    expect(inbox.count("list")).toBe(6);
    // The feed covers the same stretch of the folder, not all of it.
    expect(inbox.feedFilters).toHaveLength(1);
    expect(inbox.feedFilters[0]).toMatch(/^receivedDateTime ge 2026-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);

    inbox.calls.length = 0;
    const again = await provider.list("inbox", MAIL_WINDOW);
    expect(again).toEqual(first);
    expect(inbox.calls).toEqual(["feed"]);
  });

  it("shows a new message after reading it by id", async () => {
    const provider = await primed();
    inbox.arrive("fresh");
    const rows = await provider.list("inbox", MAIL_WINDOW);
    expect(natives(rows)[0]).toBe("fresh");
    expect(rows).toHaveLength(MAIL_WINDOW);
    expect(inbox.calls).toEqual(["feed", "detail"]);
  });

  it("copies a read mark made elsewhere without downloading the message again", async () => {
    const provider = await primed();
    inbox.markRead("m3");
    const rows = await provider.list("inbox", MAIL_WINDOW);
    expect(rows.find((row) => row.id.endsWith("|m3"))?.unread).toBe(false);
    expect(rows.find((row) => row.id.endsWith("|m4"))?.unread).toBe(true);
    expect(inbox.calls).toEqual(["feed"]);
  });

  it("drops a message that was deleted or moved elsewhere", async () => {
    const provider = await primed();
    inbox.remove("m2");
    const rows = await provider.list("inbox", MAIL_WINDOW);
    expect(natives(rows)).not.toContain("m2");
    expect(rows).toHaveLength(MAIL_WINDOW);
    expect(inbox.calls).toEqual(["feed"]);
  });

  it("serves a smaller list from the same feed", async () => {
    const provider = await primed();
    const rows = await provider.list("inbox", 40);
    expect(rows).toHaveLength(40);
    expect(natives(rows)[0]).toBe("m1");
    expect(inbox.calls).toEqual(["feed"]);
  });

  it("does not start a feed for a small first peek", async () => {
    const provider = launch();
    await provider.list("inbox", 40);
    expect(inbox.calls).toEqual(["list"]);
    expect(store.folders.get("inbox")?.delta).toBeUndefined();
  });

  it("resumes from the saved position after a restart, without downloading the window", async () => {
    const before = await launch().list("inbox", MAIL_WINDOW);
    inbox.calls.length = 0;
    inbox.arrive("while-closed");

    const after = await launch().list("inbox", MAIL_WINDOW);
    expect(natives(after)[0]).toBe("while-closed");
    expect(natives(after).slice(1)).toEqual(natives(before).slice(0, MAIL_WINDOW - 1));
    expect(inbox.calls).toEqual(["feed", "detail"]);
  });

  it("saves the rows the feed tracks together with its position", async () => {
    await launch().list("inbox", MAIL_WINDOW);
    const saved = store.folders.get("inbox");
    expect(saved?.messages).toHaveLength(MAIL_WINDOW + 100);
    expect(saved?.delta?.link).toContain("/messages/delta?$deltatoken=");
    expect(saved?.delta?.since).toMatch(/Z$/);
  });

  it("downloads a folder that has no feed position yet, as a version 2 copy is", async () => {
    // What an older launch saved: rows, and no change feed.
    const earlier = launch();
    await earlier.list("inbox", 40);
    store.folders.set("inbox", { uidValidity: "graph", messages: store.folders.get("inbox")!.messages });
    inbox.calls.length = 0;

    const provider = launch();
    expect(provider.cached("inbox")).toHaveLength(40);
    const rows = await provider.list("inbox", MAIL_WINDOW);
    expect(rows).toHaveLength(MAIL_WINDOW);
    expect(inbox.count("list")).toBe(6);
    expect(store.folders.get("inbox")?.delta).toBeDefined();
  });

  it("downloads in full again when the feed link has expired", async () => {
    const provider = await primed();
    inbox.arrive("fresh");
    inbox.expireNextFeed = true;
    const rows = await provider.list("inbox", MAIL_WINDOW);
    expect(natives(rows)[0]).toBe("fresh");
    expect(rows).toHaveLength(MAIL_WINDOW);
    expect(inbox.count("list")).toBe(6);

    // And it carries on from the new link afterwards.
    inbox.calls.length = 0;
    await provider.list("inbox", MAIL_WINDOW);
    expect(inbox.calls).toEqual(["feed"]);
  });

  it("goes back to full downloads for a folder whose feed Graph refuses", async () => {
    inbox.refuseFeedWith = 400;
    const provider = launch();
    const first = await provider.list("inbox", MAIL_WINDOW);
    expect(first).toHaveLength(MAIL_WINDOW);
    expect(inbox.count("feed")).toBe(1);

    inbox.calls.length = 0;
    const second = await provider.list("inbox", MAIL_WINDOW);
    expect(second).toHaveLength(MAIL_WINDOW);
    // No second attempt at the feed: each list is the six pages of before.
    expect(inbox.count("feed")).toBe(0);
    expect(inbox.count("list")).toBe(5);
  });

  it("keeps the downloaded list when the feed fails for a moment, and tries the feed again next time", async () => {
    let failing = true;
    const real = inbox.handle.bind(inbox);
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      if (failing && String(input).includes("/messages/delta")) return json({ error: { code: "ServiceUnavailable" } }, 503);
      return real(String(input), init?.method ?? "GET");
    });
    const provider = launch();
    await expect(provider.list("inbox", MAIL_WINDOW)).resolves.toHaveLength(MAIL_WINDOW);

    failing = false;
    inbox.calls.length = 0;
    await expect(provider.list("inbox", MAIL_WINDOW)).resolves.toHaveLength(MAIL_WINDOW);
    // The rows were kept: only the feed's first round is read, not the window again.
    expect(inbox.count("list")).toBe(0);
    expect(inbox.count("feed")).toBeGreaterThan(0);
  });

  it("downloads the window again when much more arrived than can be read one by one", async () => {
    const provider = await primed();
    for (let index = 0; index < 25; index += 1) inbox.arrive(`burst${index}`);
    const rows = await provider.list("inbox", MAIL_WINDOW);
    expect(natives(rows)[0]).toBe("burst24");
    expect(inbox.count("detail")).toBe(0);
    expect(inbox.count("list")).toBe(6);
  });

  it("refills the window when so much was removed that less than a window is left", async () => {
    const provider = await primed();
    for (let index = 1; index <= 101; index += 1) inbox.remove(`m${index}`);
    const rows = await provider.list("inbox", MAIL_WINDOW);
    // 650 - 101 messages remain: the window is full again, from older mail.
    expect(rows).toHaveLength(MAIL_WINDOW);
    expect(natives(rows)[0]).toBe("m102");
    expect(inbox.count("list")).toBe(6);
  });

  it("does not refill a folder that is entirely held already", async () => {
    inbox = new FakeInbox(30);
    stub();
    const provider = launch();
    expect(await provider.list("inbox", MAIL_WINDOW)).toHaveLength(30);
    expect(inbox.feedFilters).toEqual([null]);

    inbox.calls.length = 0;
    for (let index = 1; index <= 5; index += 1) inbox.remove(`m${index}`);
    expect(await provider.list("inbox", MAIL_WINDOW)).toHaveLength(25);
    expect(inbox.calls).toEqual(["feed"]);
  });

  it("downloads in full again after a day, to catch what the feed does not carry", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const provider = await primed();
    vi.setSystemTime(Date.now() + 25 * 60 * 60_000);
    await provider.list("inbox", MAIL_WINDOW);
    expect(inbox.count("list")).toBe(6);
  });

  it("shows an action at once and keeps it through the next feed read", async () => {
    const provider = await primed();
    await provider.act("markRead", "inbox", ["m1"]);
    inbox.calls.length = 0;
    const rows = await provider.list("inbox", MAIL_WINDOW);
    expect(rows.find((row) => row.id.endsWith("|m1"))?.unread).toBe(false);
    expect(inbox.calls).toEqual(["feed"]);
  });

  it("reads the feed again when a write finished while it was being read", async () => {
    const provider = await primed();
    const hold = inbox.holdNextFeed();
    const listing = provider.list("inbox", MAIL_WINDOW);
    await hold.arrived;
    await provider.act("markRead", "inbox", ["m1"]);
    hold.release();
    await listing;
    expect(inbox.count("feed")).toBe(2);
  });

  it("gives Pinned its own full list: it is a filter over the inbox, not a folder", async () => {
    const provider = launch();
    await provider.list("pinned", 10);
    await provider.list("pinned", 10);
    expect(inbox.count("feed")).toBe(0);
    expect(inbox.count("list")).toBe(2);
  });

  it("answers lists asked for together with one feed read", async () => {
    const provider = await primed();
    inbox.arrive("fresh");
    const [a, b] = await Promise.all([provider.list("inbox", MAIL_WINDOW), provider.list("inbox", 40)]);
    expect(natives(a)[0]).toBe("fresh");
    expect(natives(b)[0]).toBe("fresh");
    // The second list waited for the first and found nothing new: two feed reads, one message download.
    expect(inbox.count("detail")).toBe(1);
  });
});

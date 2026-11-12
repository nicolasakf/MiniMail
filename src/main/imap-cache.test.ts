import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Account, MailFolder } from "@shared/types";

// A tiny IMAP server: enough of imapflow's surface for list/act, with call recording.
const server = vi.hoisted(() => ({
  uidValidity: 1n,
  messages: [] as {
    uid: number;
    flags: Set<string>;
    subject: string;
    date: Date;
    auth?: string;
    /** Gmail labels (X-GM-LABELS), sent only when a fetch asks for them. */
    labels?: string[];
  }[],
  /** Serve Gmail's folders: no \Archive, "All Mail" (\All) instead. */
  gmailFolders: false,
  /** The uids asked for in every preview download (partial body), in order. */
  previewRequests: [] as number[][],
  /** The uids asked for in every full-message download. */
  fullFetches: [] as number[][],
  /** What reached the server, in order, to check who waited for whom. */
  events: [] as string[],
  /** Called as a preview download starts; lets a test act "while it runs". */
  onPreviewFetch: undefined as (() => void) | undefined,
  /** The mailbox lock: one holder at a time, first come first served. */
  lockTail: Promise.resolve(),
  connects: 0,
}));

vi.mock("imapflow", () => {
  class FakeImapFlow {
    usable = true;
    mailbox: unknown = false;
    constructor() {
      server.connects += 1;
    }
    on() {
      return this;
    }
    async connect() {}
    async logout() {}
    async list() {
      return server.gmailFolders
        ? [{ path: "INBOX" }, { path: "[Gmail]/All Mail", specialUse: "\\All" }]
        : [{ path: "INBOX" }, { path: "Archive", specialUse: "\\Archive" }];
    }
    async getMailboxLock() {
      const previous = server.lockTail;
      let release!: () => void;
      server.lockTail = new Promise<void>((resolve) => (release = resolve));
      await previous;
      this.mailbox = { exists: server.messages.length, uidValidity: server.uidValidity };
      return { release };
    }
    async search() {
      return [];
    }
    async *fetch(range: string | number[], query: { source?: unknown; headers?: unknown; labels?: boolean }) {
      // A number array is uids; "n:*" and "n:m" are sequence ranges (1-based, inclusive).
      const [from, to] = Array.isArray(range) ? [0, 0] : range.split(":");
      const rows = Array.isArray(range)
        ? server.messages.filter((message) => range.includes(message.uid))
        : server.messages.slice(Math.max(0, Number(from) - 1), to === "*" ? undefined : Number(to));
      const asked = Array.isArray(range) ? [...range] : [];
      if (query.source === true) {
        server.fullFetches.push(asked);
        server.events.push(`get:${asked.join(",")}`);
      } else if (query.source) {
        server.previewRequests.push(asked);
        server.events.push(`previews:${asked.join(",")}`);
        server.onPreviewFetch?.();
      }
      if (query.headers) {
        server.events.push(`headers:${rows.map((message) => message.uid).join(",")}`);
        for (const message of rows) {
          const header = message.auth ? `Authentication-Results: ${message.auth}\r\n` : "";
          yield { uid: message.uid, headers: Buffer.from(`${header}\r\n`) };
        }
        return;
      }
      for (const message of rows) {
        if (!query.source) {
          yield {
            uid: message.uid,
            flags: message.flags,
            ...(query.labels && message.labels ? { labels: new Set(message.labels) } : {}),
          };
          continue;
        }
        yield {
          uid: message.uid,
          flags: message.flags,
          envelope: {
            from: [{ name: "Ann", address: "ann@example.com" }],
            to: [],
            subject: message.subject,
            messageId: `<${message.uid}@example.com>`,
          },
          internalDate: message.date,
          bodyStructure: { type: "text/plain" },
          source: Buffer.from(
            `Subject: ${message.subject}\r\n${message.auth ? `Authentication-Results: ${message.auth}\r\n` : ""}\r\nHello ${message.uid}`,
          ),
        };
      }
    }
    async messageMove(range: string) {
      server.events.push(`move:${range}`);
      const gone = range.split(",").map(Number);
      server.messages = server.messages.filter((message) => !gone.includes(message.uid));
    }
    async messageFlagsAdd(range: string, flags: string[]) {
      server.events.push(`flags:${range}`);
      for (const message of server.messages) {
        if (range.split(",").map(Number).includes(message.uid)) flags.forEach((f) => message.flags.add(f));
      }
    }
    async messageFlagsRemove(range: string, flags: string[]) {
      for (const message of server.messages) {
        if (range.split(",").map(Number).includes(message.uid)) flags.forEach((f) => message.flags.delete(f));
      }
    }
  }
  return { ImapFlow: FakeImapFlow };
});

import { ImapProvider, isArchivedInGmail, nextBatchSize } from "./providers/imap";
import { nativeIdOf, patchSummaries, type CachedFolder, type SummaryStore } from "./providers/summary-cache";

const account: Account = {
  id: "acc1",
  provider: "gmail",
  email: "me@example.com",
  displayName: "Me",
  auth: "password",
  hue: 210,
};

/** An in-memory stand-in for the saved copy. */
function memoryStore(): SummaryStore & { folders: Map<MailFolder, CachedFolder> } {
  const folders = new Map<MailFolder, CachedFolder>();
  return {
    folders,
    load: (folder) => folders.get(folder),
    save: (folder, value) => void folders.set(folder, value),
  };
}

const launch = (store?: SummaryStore) => new ImapProvider(account, async () => ({ pass: "x" }), store);
const uidsOf = (rows: { id: string }[]) => rows.map((row) => nativeIdOf(row as never));

beforeEach(() => {
  server.uidValidity = 1n;
  server.gmailFolders = false;
  server.connects = 0;
  server.previewRequests = [];
  server.fullFetches = [];
  server.events = [];
  server.onPreviewFetch = undefined;
  server.lockTail = Promise.resolve();
  server.messages = [1, 2, 3].map((uid) => ({
    uid,
    flags: new Set<string>(),
    subject: `Message ${uid}`,
    date: new Date(Date.UTC(2026, 10, uid)),
  }));
});

describe("ImapProvider saved copy", () => {
  it("downloads each preview once and saves the list", async () => {
    const store = memoryStore();
    const provider = launch(store);

    expect(await provider.list("inbox", 100)).toHaveLength(3);
    expect(server.previewRequests).toEqual([[3, 2, 1]]);
    expect(store.folders.get("inbox")?.uidValidity).toBe("1");
    expect(store.folders.get("inbox")?.messages).toHaveLength(3);

    await provider.list("inbox", 100);
    expect(server.previewRequests).toHaveLength(1);
  });

  it("keeps older mail when a smaller list runs, so the full list downloads nothing again", async () => {
    server.messages = Array.from({ length: 8 }, (_, index) => ({
      uid: index + 1,
      flags: new Set<string>(),
      subject: `Message ${index + 1}`,
      date: new Date(Date.UTC(2026, 10, index + 1)),
    }));
    const store = memoryStore();
    const provider = launch(store);
    expect(await provider.list("inbox", 8)).toHaveLength(8);
    expect(server.previewRequests.flat()).toHaveLength(8);

    // A first page: only the newest three come back, but the other five stay cached and saved.
    expect(uidsOf(await provider.list("inbox", 3))).toEqual(["8", "7", "6"]);
    expect(store.folders.get("inbox")?.messages).toHaveLength(8);
    expect(provider.cached("inbox")).toHaveLength(8);

    server.previewRequests = [];
    expect(await provider.list("inbox", 8)).toHaveLength(8);
    expect(server.previewRequests).toEqual([]);
  });

  it("drops a cached message inside the window that the server no longer has", async () => {
    const provider = launch(memoryStore());
    await provider.list("inbox", 100);
    server.messages = server.messages.filter((message) => message.uid !== 2);
    expect(uidsOf(await provider.list("inbox", 100))).toEqual(["3", "1"]);
    expect(uidsOf(provider.cached("inbox"))).toEqual(["3", "1"]);
  });

  it("paints a new launch from the copy without any connection, then fetches only what is new", async () => {
    const store = memoryStore();
    await launch(store).list("inbox", 100);
    server.connects = 0;
    server.previewRequests = [];

    const relaunched = launch(store);
    expect(uidsOf(relaunched.cached("inbox"))).toEqual(["3", "2", "1"]); // newest first
    expect(server.connects).toBe(0);

    server.messages.push({ uid: 4, flags: new Set(), subject: "Message 4", date: new Date(Date.UTC(2026, 10, 4)) });
    const rows = await relaunched.list("inbox", 100);
    expect(server.previewRequests).toEqual([[4]]);
    expect(uidsOf(rows)).toEqual(["4", "3", "2", "1"]);
  });

  it("refreshes read and pinned state from the server on a new launch", async () => {
    const store = memoryStore();
    await launch(store).list("inbox", 100);
    server.messages[0].flags.add("\\Seen");
    server.messages[1].flags.add("\\Flagged");

    const rows = await launch(store).list("inbox", 100);
    const byUid = new Map(rows.map((row) => [nativeIdOf(row), row]));
    expect(byUid.get("1")?.unread).toBe(false);
    expect(byUid.get("2")?.pinned).toBe(true);
    expect(server.previewRequests).toHaveLength(1);
  });

  it("discards the copy when the server renumbered its messages", async () => {
    const store = memoryStore();
    await launch(store).list("inbox", 100);
    server.previewRequests = [];
    server.uidValidity = 2n;

    const relaunched = launch(store);
    expect(relaunched.cached("inbox")).toHaveLength(3); // still fine to show while loading
    await relaunched.list("inbox", 100);
    expect(server.previewRequests).toEqual([[3, 2, 1]]);
    expect(store.folders.get("inbox")?.uidValidity).toBe("2");
  });

  it("works without a saved copy", async () => {
    const provider = launch();
    expect(provider.cached("inbox")).toEqual([]);
    expect(await provider.list("inbox", 100)).toHaveLength(3);
  });

  it("keeps the saved copy in step with actions instead of re-downloading everything", async () => {
    const store = memoryStore();
    const provider = launch(store);
    await provider.list("inbox", 100);
    server.previewRequests = [];

    await provider.act("archive", "inbox", ["2"]);
    expect(uidsOf(store.folders.get("inbox")!.messages)).toEqual(expect.not.arrayContaining(["2"]));
    expect(store.folders.get("inbox")?.messages).toHaveLength(2);

    await provider.act("markRead", "inbox", ["1"]);
    const rows = await provider.list("inbox", 100);
    expect(server.previewRequests).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => nativeIdOf(row) === "1")?.unread).toBe(false);
  });

  it("does not bring an archived message back on the next launch", async () => {
    const store = memoryStore();
    await launch(store).list("inbox", 100);
    // Archived in a launch that quit before it listed again: only act() saw it.
    await launch(store).act("archive", "inbox", ["3"]);

    expect(uidsOf(launch(store).cached("inbox"))).toEqual(["2", "1"]);
  });
});

describe("ImapProvider while a refresh runs", () => {
  const many = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      uid: index + 1,
      flags: new Set<string>(),
      subject: `Message ${index + 1}`,
      date: new Date(Date.UTC(2026, 9, 1) + index * 3_600_000),
    }));

  it("downloads previews newest first in batches, once each", async () => {
    server.messages = many(40);
    await launch(memoryStore()).list("inbox", 100);

    // A fast server quickly earns bigger batches; the first is small so a slow one is noticed early.
    expect(server.previewRequests[0]).toEqual([40, 39, 38, 37, 36]);
    expect(server.previewRequests.length).toBeGreaterThan(1);
    expect(Math.max(...server.previewRequests.map((batch) => batch.length))).toBeLessThanOrEqual(25);
    const all = server.previewRequests.flat();
    expect(all).toHaveLength(40);
    expect(new Set(all).size).toBe(40);
  });

  it("lets opening a message in between batches instead of making it wait for the whole refresh", async () => {
    server.messages = many(40);
    const provider = launch(memoryStore());
    let opened: Promise<unknown> | undefined;
    server.onPreviewFetch = () => {
      // The reader clicks a message while the first batch is downloading.
      opened ??= provider.get("inbox", ["1"]);
    };

    await provider.list("inbox", 100);
    await opened;

    const events = server.events.map((event) => event.split(":")[0]);
    expect(events.indexOf("get")).toBeGreaterThan(events.indexOf("previews"));
    expect(events.indexOf("get")).toBeLessThan(events.lastIndexOf("previews"));
  });

  it("makes an action wait for the refresh so a half-finished snapshot cannot undo it", async () => {
    server.messages = many(40);
    const provider = launch(memoryStore());
    server.onPreviewFetch = () => {
      server.onPreviewFetch = undefined;
      void provider.act("markRead", "inbox", ["40"]);
    };

    await provider.list("inbox", 100);
    // Let the action finish too.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const events = server.events.map((event) => event.split(":")[0]);
    expect(events.indexOf("flags")).toBeGreaterThan(events.lastIndexOf("previews"));
  });

  it("does not download the same previews twice when two refreshes overlap", async () => {
    server.messages = many(20);
    const provider = launch(memoryStore());
    await Promise.all([provider.list("inbox", 100), provider.list("inbox", 100)]);

    const downloaded = server.previewRequests.flat();
    expect(new Set(downloaded).size).toBe(downloaded.length);
    expect(downloaded).toHaveLength(20);
  });

  it("keeps what a cut-short refresh already downloaded", async () => {
    server.messages = many(40);
    const store = memoryStore();
    const provider = launch(store);
    let batches = 0;
    server.onPreviewFetch = () => {
      if (++batches === 2) throw new Error("connection dropped");
    };

    await expect(provider.list("inbox", 100)).rejects.toThrow();
    expect(store.folders.get("inbox")?.messages).toHaveLength(5);

    // The next launch resumes: only the 35 not yet downloaded are fetched.
    server.onPreviewFetch = undefined;
    server.previewRequests = [];
    await launch(store).list("inbox", 100);
    expect(server.previewRequests.flat()).toHaveLength(35);
  });
});

describe("ImapProvider sender authentication", () => {
  it("records whether the receiving server verified each sender", async () => {
    server.messages[0].auth = "mx.example; dmarc=pass header.from=example.com";
    server.messages[1].auth = "mx.example; dmarc=fail header.from=example.com";
    // messages[2] has no Authentication-Results at all.
    const rows = await launch().list("inbox", 100);

    const byUid = new Map(rows.map((row) => [nativeIdOf(row), row.authenticated]));
    expect(byUid.get("1")).toBe(true);
    expect(byUid.get("2")).toBe(false);
    expect(byUid.get("3")).toBe(false);
  });

  it("ignores an Authentication-Results line planted in the message body", async () => {
    server.messages[0].auth = undefined;
    server.messages[0].subject = "x";
    const rows = await launch().list("inbox", 100);
    expect(rows.find((row) => nativeIdOf(row) === "1")?.authenticated).toBe(false);
  });

  it("fills it in for rows saved before it was recorded, from headers alone", async () => {
    server.messages[0].auth = "mx; dmarc=pass header.from=example.com";
    server.messages[1].auth = "mx; dmarc=fail";
    const store = memoryStore();
    await launch(store).list("inbox", 100);
    // Simulate a copy from an older version: no `authenticated` on any row.
    const saved = store.folders.get("inbox")!;
    store.folders.set("inbox", {
      ...saved,
      messages: saved.messages.map(({ authenticated: _drop, ...rest }) => rest),
    });
    server.previewRequests = [];
    server.events = [];

    const rows = await launch(store).list("inbox", 100);
    const byUid = new Map(rows.map((row) => [nativeIdOf(row), row.authenticated]));
    expect(byUid.get("1")).toBe(true);
    expect(byUid.get("2")).toBe(false);
    expect(byUid.get("3")).toBe(false);
    expect(server.previewRequests).toEqual([]); // no previews downloaded again
    expect(server.events.filter((event) => event.startsWith("headers"))).toEqual(["headers:1,2,3"]);
    expect(store.folders.get("inbox")?.messages.every((row) => row.authenticated !== undefined)).toBe(true);

    // And only once.
    server.events = [];
    await launch(store).list("inbox", 100);
    expect(server.events.some((event) => event.startsWith("headers"))).toBe(false);
  });
});

describe("nextBatchSize", () => {
  it("aims for batches that take a couple of seconds, whatever the server speed", () => {
    expect(nextBatchSize(50)).toBe(25); // fast: capped
    expect(nextBatchSize(400)).toBe(6);
    expect(nextBatchSize(4000)).toBe(3); // very slow: floor
  });

  it("copes with a zero or negative measurement", () => {
    expect(nextBatchSize(0)).toBe(25);
    expect(nextBatchSize(-5)).toBe(25);
  });
});

describe("ImapProvider opening messages", () => {
  it("downloads a whole conversation in one command", async () => {
    const provider = launch();
    await provider.list("inbox", 100);

    const opened = await provider.get("inbox", ["1", "2", "3"]);
    expect(server.fullFetches).toEqual([[1, 2, 3]]);
    expect(opened.map((message) => message.subject)).toEqual(["Message 1", "Message 2", "Message 3"]);
    expect(opened[0].text).toContain("Hello 1");
  });

  it("returns messages in the order asked for", async () => {
    const provider = launch();
    const opened = await provider.get("inbox", ["3", "1"]);
    expect(opened.map((message) => nativeIdOf(message))).toEqual(["3", "1"]);
  });

  it("serves a recently opened message from memory", async () => {
    const provider = launch();
    await provider.get("inbox", ["1", "2"]);
    await provider.get("inbox", ["2", "3"]);

    expect(server.fullFetches).toEqual([[1, 2], [3]]);
  });

  it("keeps opened messages in step with actions", async () => {
    const provider = launch();
    await provider.list("inbox", 100);
    expect((await provider.get("inbox", ["1"]))[0].unread).toBe(true);

    await provider.act("markRead", "inbox", ["1"]);
    expect((await provider.get("inbox", ["1"]))[0].unread).toBe(false);
    expect(server.fullFetches).toHaveLength(1);

    await provider.act("archive", "inbox", ["1"]);
    expect(await provider.get("inbox", ["1"])).toEqual([]);
  });

  it("skips ids the server no longer has", async () => {
    const provider = launch();
    const opened = await provider.get("inbox", ["2", "999"]);
    expect(opened.map((message) => nativeIdOf(message))).toEqual(["2"]);
  });
});

describe("patchSummaries", () => {
  const rows = [1, 2].map((uid) => ({
    id: `acc1|inbox|${uid}`,
    accountId: "acc1",
    folder: "inbox" as const,
    threadId: `t${uid}`,
    from: { name: "", email: "a@b.co" },
    to: [],
    subject: "s",
    snippet: "",
    date: "2026-11-01T00:00:00.000Z",
    unread: true,
    pinned: true,
    answered: false,
    hasAttachments: false,
    categoryId: null,
    signal: "person" as const,
  }));

  it("updates flags on the targeted messages only", () => {
    const read = patchSummaries(rows, "markRead", "inbox", new Set(["1"]));
    expect(read.map((row) => row.unread)).toEqual([false, true]);
    const pinned = patchSummaries(rows, "unpin", "inbox", new Set(["2"]));
    expect(pinned.map((row) => row.pinned)).toEqual([true, false]);
  });

  it("removes moved and deleted messages, and unpinned ones from the pinned view", () => {
    for (const action of ["archive", "trash", "spam", "deleteForever"] as const) {
      expect(patchSummaries(rows, action, "inbox", new Set(["1"])).map(nativeIdOf)).toEqual(["2"]);
    }
    expect(patchSummaries(rows, "unpin", "pinned", new Set(["1"])).map(nativeIdOf)).toEqual(["2"]);
  });

  it("does not mutate its input", () => {
    patchSummaries(rows, "archive", "inbox", new Set(["1", "2"]));
    expect(rows).toHaveLength(2);
    expect(rows[0].unread).toBe(true);
  });
});

describe("Gmail Archive (All Mail)", () => {
  const mail = (uid: number, labels: string[]) => ({
    uid,
    flags: new Set<string>(),
    subject: `Message ${uid}`,
    date: new Date(Date.UTC(2026, 10, 1, uid)),
    labels,
  });

  it("counts only mail out of the Inbox, not sent by the user and not a draft", () => {
    expect(isArchivedInGmail(new Set(["\\Important", "Receipts"]))).toBe(true);
    expect(isArchivedInGmail(new Set(["\\Inbox"]))).toBe(false);
    expect(isArchivedInGmail(new Set(["\\Sent"]))).toBe(false);
    expect(isArchivedInGmail(new Set(["\\Draft"]))).toBe(false);
    expect(isArchivedInGmail(new Set(["\\INBOX"]))).toBe(false);
    // A server without Gmail labels is not filtered.
    expect(isArchivedInGmail(undefined)).toBe(true);
  });

  it("lists only archived mail, reading further back to fill the window", async () => {
    server.gmailFolders = true;
    server.messages = [
      mail(1, ["\\Important"]),
      mail(2, []),
      mail(3, ["\\Sent"]),
      mail(4, ["Receipts"]),
      mail(5, ["\\Inbox"]),
      mail(6, ["\\Draft"]),
      mail(7, ["\\Inbox", "\\Important"]),
    ];
    // The newest three in All Mail are not archived; the window of three reaches back past them.
    expect(uidsOf(await launch(memoryStore()).list("archive", 3))).toEqual(["4", "2", "1"]);
  });

  it("leaves accounts with a real Archive folder unfiltered", async () => {
    server.messages = [mail(1, ["\\Inbox"]), mail(2, [])];
    expect(uidsOf(await launch().list("archive", 10))).toEqual(["2", "1"]);
  });
});

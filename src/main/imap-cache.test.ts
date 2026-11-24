import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    /** The MIME structure the server reports; a single plain-text part by default. */
    structure?: unknown;
    /** The raw content of each part by number ("text" for a message with one part). */
    parts?: Record<string, string>;
  }[],
  /** Serve Gmail's folders: no \Archive, "All Mail" (\All) instead. */
  gmailFolders: false,
  /** The uids asked for in every preview download (partial body), in order. */
  previewRequests: [] as number[][],
  /** The uids asked for by each command that opens messages (their structure, envelope and flags). */
  openFetches: [] as number[][],
  /** Each download of part contents: the uid and the part numbers asked for. */
  partFetches: [] as { uid: number; keys: string[] }[],
  /** Each download of one part by itself (an attachment): the uid and the part number. */
  partDownloads: [] as { uid: number; part: string }[],
  /** Downloads of the whole raw message: nothing but sending and replying should ever need one. */
  wholeMessages: [] as number[][],
  /** What reached the server, in order, to check who waited for whom. */
  events: [] as string[],
  /** Called as a preview download starts; lets a test act "while it runs". */
  onPreviewFetch: undefined as (() => void) | undefined,
  /** The mailbox lock: one holder at a time, first come first served. */
  lockTail: Promise.resolve(),
  connects: 0,
  /** The next this many mailbox locks fail as if the connection had just been lost. */
  dropLocks: 0,
  /** Connections closed by the app after they failed. */
  closed: 0,
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
    close() {
      this.usable = false;
      server.closed += 1;
    }
    async list() {
      return server.gmailFolders
        ? [{ path: "INBOX" }, { path: "[Gmail]/All Mail", specialUse: "\\All" }]
        : [{ path: "INBOX" }, { path: "Archive", specialUse: "\\Archive" }];
    }
    async getMailboxLock() {
      if (server.dropLocks > 0) {
        server.dropLocks -= 1;
        this.usable = false;
        throw Object.assign(new Error("Connection not available"), { code: "NoConnection", reason: "Server closed connection" });
      }
      const previous = server.lockTail;
      let release!: () => void;
      server.lockTail = new Promise<void>((resolve) => (release = resolve));
      await previous;
      this.mailbox = { exists: server.messages.length, uidValidity: server.uidValidity };
      return { release };
    }
    async search(query?: { flagged?: boolean }) {
      return query?.flagged ? server.messages.filter((message) => message.flags.has("\\Flagged")).map((message) => message.uid) : [];
    }
    async fetchOne(uid: string, query: { bodyParts?: (string | { key: string })[]; source?: unknown }) {
      const message = server.messages.find((candidate) => candidate.uid === Number(uid));
      if (!message) return false;
      if (query.source === true) {
        server.wholeMessages.push([message.uid]);
        return { uid: message.uid, source: Buffer.from("raw") };
      }
      const keys = (query.bodyParts ?? []).map((part) => (typeof part === "string" ? part : part.key));
      server.partFetches.push({ uid: message.uid, keys });
      server.events.push(`parts:${message.uid}`);
      const content = message.parts ?? { text: `Hello ${message.uid}` };
      return { uid: message.uid, bodyParts: new Map(keys.flatMap((key) => (key in content ? [[key, Buffer.from(content[key])] as const] : []))) };
    }
    async download(uid: string, part: string) {
      server.partDownloads.push({ uid: Number(uid), part });
      const message = server.messages.find((candidate) => candidate.uid === Number(uid));
      const content = message?.parts?.[part];
      if (content === undefined) return {};
      const { Readable } = await import("node:stream");
      return { meta: { filename: "report.pdf", contentType: "application/pdf" }, content: Readable.from([Buffer.from(content)]) };
    }
    async *fetch(range: string | number[], query: { source?: unknown; headers?: unknown; labels?: boolean }) {
      // A number array is uids; "n:*" and "n:m" are sequence ranges (1-based, inclusive).
      const [from, to] = Array.isArray(range) ? [0, 0] : range.split(":");
      const rows = Array.isArray(range)
        ? server.messages.filter((message) => range.includes(message.uid))
        : server.messages.slice(Math.max(0, Number(from) - 1), to === "*" ? undefined : Number(to));
      const asked = Array.isArray(range) ? [...range] : [];
      const opening = Array.isArray(query.headers) && query.headers.includes("references");
      if (query.source === true) {
        server.wholeMessages.push(asked);
      } else if (opening) {
        server.openFetches.push(asked);
        server.events.push(`get:${asked.join(",")}`);
      } else if (query.source) {
        server.previewRequests.push(asked);
        server.events.push(`previews:${asked.join(",")}`);
        server.onPreviewFetch?.();
      }
      if (query.headers && !opening) {
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
          bodyStructure: message.structure ?? { type: "text/plain" },
          ...(opening ? { headers: Buffer.from("References: <0@example.com> <1@example.com>\r\n\r\n") } : {}),
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

import { BodyStore } from "./body-store";
import type { Cipher } from "./category-store";
import { ImapProvider, isArchivedInGmail, nextBatchSize } from "./providers/imap";
import { describeError } from "./providers/types";
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
  server.dropLocks = 0;
  server.closed = 0;
  server.previewRequests = [];
  server.openFetches = [];
  server.partFetches = [];
  server.partDownloads = [];
  server.wholeMessages = [];
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

describe("ImapProvider when the connection drops", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Runs a list while the clock is advanced past every pause between attempts. */
  const listThroughPauses = async (provider: ReturnType<typeof launch>) => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const listing = provider.list("inbox", 100);
    // Observed here so a failure is not reported as unhandled while the clock runs.
    const settled = listing.then(
      (rows) => ({ rows }),
      (error: unknown) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(10_000);
    return settled;
  };

  it("connects again, and again, when the connection is lost twice in a row", async () => {
    server.dropLocks = 2;
    const outcome = await listThroughPauses(launch());
    expect(outcome).toHaveProperty("rows");
    expect((outcome as { rows: unknown[] }).rows).toHaveLength(3);
    expect(server.connects).toBe(3);
    // Each lost connection was closed, so none lingers on the server's side.
    expect(server.closed).toBe(2);
  });

  it("gives up after the first try and three retries, and says what the server said", async () => {
    server.dropLocks = 4;
    const outcome = await listThroughPauses(launch());
    expect(outcome).toHaveProperty("error");
    expect(describeError((outcome as { error: unknown }).error)).toBe(
      "Connection not available (the server said: Server closed connection)",
    );
    expect(server.connects).toBe(4);
  });
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
  it("asks for a whole conversation's structure in one command, then each message's text", async () => {
    const provider = launch();
    await provider.list("inbox", 100);

    const opened = await provider.get("inbox", ["1", "2", "3"]);
    expect(server.openFetches).toEqual([[1, 2, 3]]);
    expect(server.partFetches.map((fetch) => fetch.uid)).toEqual([1, 2, 3]);
    expect(server.wholeMessages).toEqual([]);
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

    expect(server.openFetches).toEqual([[1, 2], [3]]);
  });

  it("keeps opened messages in step with actions", async () => {
    const provider = launch();
    await provider.list("inbox", 100);
    expect((await provider.get("inbox", ["1"]))[0].unread).toBe(true);

    await provider.act("markRead", "inbox", ["1"]);
    expect((await provider.get("inbox", ["1"]))[0].unread).toBe(false);
    expect(server.openFetches).toHaveLength(1);

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

describe("ImapProvider with saved messages", () => {
  /** A message with a file and a text part, as a mail reader would receive a report. */
  const withReport = {
    structure: {
      type: "multipart/mixed",
      childNodes: [
        { part: "1", type: "text/plain", encoding: "7bit", size: 8, parameters: { charset: "utf-8" } },
        {
          part: "2",
          type: "application/pdf",
          encoding: "base64",
          size: 12,
          disposition: "attachment",
          dispositionParameters: { filename: "report.pdf" },
        },
      ],
    },
    parts: { "1": "Body one", "2": "PDFDATA" },
  };
  /** A message whose HTML shows a logo that travels inside the message. */
  const withLogo = {
    structure: {
      type: "multipart/related",
      childNodes: [
        { part: "1", type: "text/html", encoding: "7bit", size: 40, parameters: { charset: "utf-8" } },
        { part: "2", type: "image/png", encoding: "base64", size: 8, id: "<logo>", disposition: "inline" },
      ],
    },
    parts: { "1": '<p>Hi</p><img src="cid:logo">', "2": Buffer.from("PNG!").toString("base64") },
  };

  const cipher: Cipher = {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(`sealed:${plain}`, "utf8").reverse(),
    decryptString: (data) => Buffer.from(data).reverse().toString("utf8").slice("sealed:".length),
  };
  let dir: string;
  let saved: BodyStore;
  let rows: ReturnType<typeof memoryStore>;
  /** A launch of the app: the same saved lists and saved messages, a fresh provider with nothing in memory. */
  const relaunch = () => new ImapProvider(account, async () => ({ pass: "x" }), rows, saved.forAccount("acc1"));
  const network = () => ({ opened: server.openFetches.length, parts: server.partFetches.length });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "minimail-imap-bodies-"));
    saved = new BodyStore(join(dir, "text.sqlite"), cipher);
    rows = memoryStore();
    Object.assign(server.messages[0], withReport);
    Object.assign(server.messages[1], withLogo);
  });

  afterEach(() => {
    saved.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps a message when it is opened, and opens it later without the network", async () => {
    await relaunch().list("inbox", 100);
    const first = await relaunch().get("inbox", ["1"]);
    expect(first[0].text).toBe("Body one");
    expect(network()).toEqual({ opened: 1, parts: 1 });

    // The next launch has nothing in memory but the saved list and the saved text.
    const again = await relaunch().get("inbox", ["1"]);
    expect(again[0].text).toBe("Body one");
    expect(again[0].subject).toBe("Message 1");
    expect(network()).toEqual({ opened: 1, parts: 1 });
  });

  it("downloads the text of mail ahead of time and never a file", async () => {
    const provider = relaunch();
    await provider.list("inbox", 100);

    expect(await provider.prefetch("inbox", ["1", "2", "3"])).toBe(3);
    // Message 1 has a PDF as part 2: only part 1 was asked for. The whole raw message never was.
    expect(server.partFetches.find((fetch) => fetch.uid === 1)?.keys).toEqual(["1"]);
    expect(server.partFetches.flatMap((fetch) => fetch.keys)).not.toContain("2");
    expect(server.partDownloads).toEqual([]);
    expect(server.wholeMessages).toEqual([]);

    const before = network();
    const opened = await relaunch().get("inbox", ["1"]);
    expect(network()).toEqual(before);
    expect(opened[0].text).toBe("Body one");
    // The file is listed by name and size, ready to download when asked for.
    expect(opened[0].attachments).toEqual([{ id: "2", filename: "report.pdf", contentType: "application/pdf", size: 9 }]);
  });

  it("ranks mail downloaded ahead of time by its date, and mail that was opened as read just now", async () => {
    const provider = relaunch();
    await provider.list("inbox", 100);
    await provider.prefetch("inbox", ["1", "2"]);
    // Dated 1 and 2 November 2026: the file would drop these before anything opened lately.
    expect(saved.stats().oldest).toBe(Date.UTC(2026, 10, 1));

    await provider.get("inbox", ["3"]);
    expect(saved.stats().oldest).toBe(Date.UTC(2026, 10, 1));

    // Make room for one message only: the one that was opened stays, the ones dated November go.
    const { bytes, messages } = saved.stats();
    expect(messages).toBe(3);
    saved.setLimit(Math.round((bytes / 3) * 1.4));
    expect(saved.stats().messages).toBe(1);
    expect(saved.stats().oldest).toBeGreaterThan(Date.now() - 60_000);
  });

  it("keeps pinned mail downloaded ahead of time as if it was just read, and under the Inbox", async () => {
    server.messages[0].flags.add("\\Flagged");
    const provider = relaunch();
    expect((await provider.list("pinned", 100)).map((row) => row.id.split("|")[2])).toEqual(["1"]);
    expect(await provider.prefetch("pinned", ["1"])).toBe(1);

    // Dated 1 November 2026, yet ranked as read now: a full file drops this last.
    expect(saved.stats().oldest).toBeGreaterThan(Date.now() - 60_000);
    // The Inbox finds it without the network: Pinned is the Inbox seen through a filter.
    expect(saved.forAccount("acc1").get("inbox", "1", server.uidValidity.toString())).toBeDefined();
  });

  it("does not download again what is already kept", async () => {
    const provider = relaunch();
    await provider.list("inbox", 100);
    await provider.prefetch("inbox", ["1", "2", "3"]);
    const before = network();

    expect(await provider.prefetch("inbox", ["1", "2", "3"])).toBe(0);
    expect(network()).toEqual(before);
  });

  it("downloads only the one part a file is, when it is asked for", async () => {
    const provider = relaunch();
    await provider.list("inbox", 100);
    const opened = await provider.get("inbox", ["1"]);

    const file = await provider.attachment("inbox", "1", opened[0].attachments[0].id);
    expect(file.filename).toBe("report.pdf");
    expect(file.data.toString()).toBe("PDFDATA");
    expect(server.partDownloads).toEqual([{ uid: 1, part: "2" }]);
    expect(server.wholeMessages).toEqual([]);
  });

  it("leaves embedded images for the moment a message is opened, and keeps the text as it came", async () => {
    const provider = relaunch();
    await provider.list("inbox", 100);
    await provider.prefetch("inbox", ["2"]);
    expect(server.partFetches.flatMap((fetch) => fetch.keys)).not.toContain("2");

    const opened = await relaunch().get("inbox", ["2"]);
    const logo = `data:image/png;base64,${Buffer.from("PNG!").toString("base64")}`;
    expect(opened[0].html).toBe(`<p>Hi</p><img src="${logo}">`);
    // Only the image was downloaded now, and the saved text still points at it.
    expect(server.partFetches.at(-1)).toEqual({ uid: 2, keys: ["2"] });
    expect(saved.forAccount("acc1").get("inbox", "2", "1")?.html).toBe('<p>Hi</p><img src="cid:logo">');
  });

  it("shows the list's flags, not the ones the message had when it was saved", async () => {
    const provider = relaunch();
    await provider.list("inbox", 100);
    await provider.get("inbox", ["1"]);
    await provider.act("markRead", "inbox", ["1"]);

    expect((await relaunch().get("inbox", ["1"]))[0].unread).toBe(false);
  });

  it("forgets the text of a message that moved", async () => {
    const provider = relaunch();
    await provider.list("inbox", 100);
    await provider.get("inbox", ["1"]);
    expect(saved.forAccount("acc1").get("inbox", "1", "1")).toBeDefined();

    await provider.act("archive", "inbox", ["1"]);
    expect(saved.forAccount("acc1").get("inbox", "1", "1")).toBeUndefined();
  });

  it("keeps the text through a flag change", async () => {
    const provider = relaunch();
    await provider.list("inbox", 100);
    await provider.get("inbox", ["1"]);
    await provider.act("pin", "inbox", ["1"]);
    expect(saved.forAccount("acc1").get("inbox", "1", "1")).toBeDefined();
  });

  it("does not trust saved text once the server has renumbered the folder", async () => {
    const provider = relaunch();
    await provider.list("inbox", 100);
    await provider.get("inbox", ["1"]);

    server.uidValidity = 2n;
    const afterRenumbering = relaunch();
    await afterRenumbering.list("inbox", 100);
    expect(saved.forAccount("acc1").get("inbox", "1", "1")).toBeUndefined();

    const before = network();
    await afterRenumbering.get("inbox", ["1"]);
    expect(network().opened).toBe(before.opened + 1);
  });

  it("downloads a message not in the list's window, and keeps it", async () => {
    const provider = relaunch();
    const opened = await provider.get("inbox", ["3"]);
    expect(opened[0].text).toBe("Hello 3");
    // No list was read, so the folder's numbering was learned from the download itself.
    expect(saved.forAccount("acc1").get("inbox", "3", "1")?.text).toBe("Hello 3");
  });
});

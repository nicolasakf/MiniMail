import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A tiny IMAP client: connects, opens a mailbox, and lets a test play server events and drops.
const fake = vi.hoisted(() => ({
  clients: [] as {
    usable: boolean;
    handlers: Map<string, Array<() => void>>;
    opened: { path: string; options: unknown }[];
    ctor: Record<string, unknown>;
    loggedOut: boolean;
    emit(event: string): void;
  }[],
  /** Connecting fails while this is set. */
  failConnect: false,
}));

vi.mock("imapflow", () => {
  class FakeImapFlow {
    usable = false;
    handlers = new Map<string, Array<() => void>>();
    opened: { path: string; options: unknown }[] = [];
    loggedOut = false;
    constructor(public ctor: Record<string, unknown>) {
      fake.clients.push(this);
    }
    on(event: string, handler: () => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
      return this;
    }
    emit(event: string) {
      for (const handler of this.handlers.get(event) ?? []) handler();
    }
    async connect() {
      if (fake.failConnect) throw new Error("connection refused");
      this.usable = true;
    }
    async mailboxOpen(path: string, options: unknown) {
      this.opened.push({ path, options });
    }
    async logout() {
      this.loggedOut = true;
      this.usable = false;
    }
    async close() {
      this.usable = false;
    }
  }
  return { ImapFlow: FakeImapFlow };
});

import { ImapWatcher } from "./providers/imap";

const flush = () => vi.advanceTimersByTimeAsync(0);
const current = () => fake.clients[fake.clients.length - 1];

let changes: number;
let watcher: ImapWatcher;
const getAuth = vi.fn(async () => ({ pass: "secret" }));

beforeEach(() => {
  vi.useFakeTimers();
  fake.clients.length = 0;
  fake.failConnect = false;
  changes = 0;
  getAuth.mockClear();
  watcher = new ImapWatcher("imap.example.com", "me@example.com", getAuth, () => (changes += 1));
});

afterEach(async () => {
  await watcher.stop();
  vi.useRealTimers();
});

describe("ImapWatcher", () => {
  it("opens the inbox read-only and reports being connected", async () => {
    watcher.start();
    await flush();

    expect(watcher.connected).toBe(true);
    expect(current().opened).toEqual([{ path: "INBOX", options: { readOnly: true } }]);
    expect(current().ctor).toMatchObject({ host: "imap.example.com", auth: { user: "me@example.com", pass: "secret" } });
    expect(changes).toBe(0);
  });

  it("reports new, removed and re-flagged mail", async () => {
    watcher.start();
    await flush();

    for (const event of ["exists", "expunge", "flags"]) {
      current().emit(event);
      await vi.advanceTimersByTimeAsync(300);
    }

    expect(changes).toBe(3);
  });

  it("reports a burst of events once", async () => {
    watcher.start();
    await flush();

    current().emit("exists");
    current().emit("exists");
    current().emit("flags");
    await vi.advanceTimersByTimeAsync(300);

    expect(changes).toBe(1);
  });

  it("reconnects after a drop, with a fresh login, and reports a change since mail may have arrived", async () => {
    watcher.start();
    await flush();
    const first = current();

    first.usable = false;
    first.emit("close");
    expect(watcher.connected).toBe(false);
    await vi.advanceTimersByTimeAsync(2_100);

    expect(fake.clients).toHaveLength(2);
    expect(getAuth).toHaveBeenCalledTimes(2);
    expect(watcher.connected).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    expect(changes).toBe(1);
  });

  it("backs off while the server is unreachable, then recovers", async () => {
    fake.failConnect = true;
    watcher.start();
    await flush();
    expect(watcher.connected).toBe(false);
    expect(fake.clients).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(2_100);
    expect(fake.clients).toHaveLength(2);
    // The second wait is longer than the first.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fake.clients).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(fake.clients).toHaveLength(3);

    fake.failConnect = false;
    await vi.advanceTimersByTimeAsync(31_000);
    expect(watcher.connected).toBe(true);
  });

  it("does not schedule two reconnects when an error and a close both arrive", async () => {
    watcher.start();
    await flush();

    current().usable = false;
    current().emit("error");
    current().emit("close");
    current().emit("close");
    await vi.advanceTimersByTimeAsync(2_100);

    expect(fake.clients).toHaveLength(2);
  });

  it("stops listening, logs out and never reconnects once stopped", async () => {
    watcher.start();
    await flush();
    const first = current();

    await watcher.stop();
    first.emit("exists");
    first.emit("close");
    await vi.advanceTimersByTimeAsync(200_000);

    expect(first.loggedOut).toBe(true);
    expect(watcher.connected).toBe(false);
    expect(changes).toBe(0);
    expect(fake.clients).toHaveLength(1);
  });
});

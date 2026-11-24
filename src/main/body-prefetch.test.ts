import { beforeEach, describe, expect, it, vi } from "vitest";

const reported = vi.hoisted(() => [] as string[]);
vi.mock("./events", () => ({
  reportError: (_area: string, title: string) => void reported.push(title),
  recordInfo: () => undefined,
  recordAction: () => undefined,
}));

import { DEFAULT_OFFLINE_SETTINGS, type OfflineSettings } from "@shared/offline";
import type { MailFolder, MessageSummary } from "@shared/types";

import { BodyPrefetcher, PREFETCH_BATCH } from "./body-prefetch";
import type { MailProvider } from "./providers/types";

const NOW = Date.parse("2026-11-22T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const row = (uid: number, ageDays: number, folder: MailFolder = "inbox"): MessageSummary => ({
  id: `acc|${folder}|${uid}`,
  accountId: "acc",
  folder,
  threadId: `t${uid}`,
  from: { name: "", email: "a@b.co" },
  to: [],
  subject: "s",
  snippet: "",
  date: new Date(NOW - ageDays * DAY).toISOString(),
  unread: true,
  pinned: false,
  answered: false,
  hasAttachments: false,
  categoryId: null,
  signal: "person",
});

/** A provider that records each batch it is asked to download. */
function fakeProvider(fail: (batch: string[]) => boolean = () => false) {
  const batches: string[][] = [];
  const provider = {
    prefetch: vi.fn(async (_folder: MailFolder, ids: string[]) => {
      batches.push([...ids]);
      if (fail(ids)) throw new Error("server said no");
      return ids.length;
    }),
  } as unknown as MailProvider;
  return { provider, batches };
}

let settings: OfflineSettings;
let online: boolean;
let roomFor: (date: number) => boolean;
const launch = () => new BodyPrefetcher(() => settings, () => online, () => NOW, (date) => roomFor(date));

beforeEach(() => {
  settings = structuredClone(DEFAULT_OFFLINE_SETTINGS);
  online = true;
  roomFor = () => true;
  reported.length = 0;
});

describe("BodyPrefetcher", () => {
  it("downloads recent Inbox mail, newest first, a small batch at a time", async () => {
    const { provider, batches } = fakeProvider();
    const rows = Array.from({ length: 20 }, (_, index) => row(index + 1, index));
    await launch().schedule("acc", provider, "inbox", [...rows].reverse());

    expect(batches.flat()).toEqual(rows.map((message) => String(message.id.split("|")[2])));
    expect(batches.every((batch) => batch.length <= PREFETCH_BATCH)).toBe(true);
    expect(batches[0]).toHaveLength(PREFETCH_BATCH);
  });

  it("leaves out mail older than the look-back", async () => {
    settings = { ...DEFAULT_OFFLINE_SETTINGS, lookbackDays: 7 };
    const { provider, batches } = fakeProvider();
    await launch().schedule("acc", provider, "inbox", [row(1, 1), row(2, 6.5), row(3, 8), row(4, 40)]);
    expect(batches.flat()).toEqual(["1", "2"]);
  });

  it("downloads only the folder that was listed, and only if it was chosen", async () => {
    const { provider, batches } = fakeProvider();
    await launch().schedule("acc", provider, "inbox", [row(1, 1, "archive"), row(2, 1, "sent"), row(3, 1, "spam"), row(4, 1)]);
    expect(batches.flat()).toEqual(["4"]);

    batches.length = 0;
    await launch().schedule("acc", provider, "archive", [row(5, 1, "archive")]);
    expect(batches).toEqual([]);
  });

  it("downloads each folder the person chose, from that folder", async () => {
    settings = { ...DEFAULT_OFFLINE_SETTINGS, folders: ["inbox", "archive"] };
    const { provider } = fakeProvider();
    const prefetcher = launch();
    await prefetcher.schedule("acc", provider, "inbox", [row(1, 1)]);
    await prefetcher.schedule("acc", provider, "archive", [row(2, 1, "archive")]);
    await prefetcher.schedule("acc", provider, "spam", [row(3, 1, "spam")]);
    expect((provider.prefetch as ReturnType<typeof vi.fn>).mock.calls.map(([folder, ids]) => `${folder}:${ids}`)).toEqual(["inbox:1", "archive:2"]);
  });

  it("queues what each chosen folder already shows when the settings change", async () => {
    settings = { ...DEFAULT_OFFLINE_SETTINGS, folders: ["inbox", "trash"] };
    const { provider, batches } = fakeProvider();
    (provider as unknown as { cached: (folder: MailFolder) => MessageSummary[] }).cached = (folder) =>
      folder === "inbox" ? [row(1, 1)] : folder === "trash" ? [row(2, 1, "trash")] : [row(3, 1, "archive")];
    launch().scheduleCached("acc", provider);
    await vi.waitFor(() => expect(batches.flat().sort()).toEqual(["1", "2"]));
  });

  it("downloads mail of any age when the limit is a size or none", async () => {
    for (const limit of ["size", "unlimited"] as const) {
      settings = { ...DEFAULT_OFFLINE_SETTINGS, limit, lookbackDays: 1 };
      const { provider, batches } = fakeProvider();
      await launch().schedule("acc", provider, "inbox", [row(1, 0.5), row(2, 400)]);
      expect(batches.flat()).toEqual(["1", "2"]);
    }
  });

  it("stops once the saved text is full of newer mail", async () => {
    settings = { ...DEFAULT_OFFLINE_SETTINGS, limit: "size" };
    roomFor = (date) => date > NOW - 3.5 * DAY;
    const { provider, batches } = fakeProvider();
    await launch().schedule("acc", provider, "inbox", Array.from({ length: 20 }, (_, index) => row(index + 1, index)));
    // It is asked before each batch, newest first: the first batch is worth saving, the second is not.
    expect(batches).toHaveLength(1);
  });

  describe("pinned mail", () => {
    const pinnedRow = (uid: number, ageDays: number) => ({ ...row(uid, ageDays, "pinned"), pinned: true });

    it("is downloaded whatever its age, and whichever folders were chosen", async () => {
      settings = { ...DEFAULT_OFFLINE_SETTINGS, folders: ["spam"], lookbackDays: 7 };
      const { provider } = fakeProvider();
      await launch().schedule("acc", provider, "pinned", [pinnedRow(1, 1), pinnedRow(2, 400)]);
      expect((provider.prefetch as ReturnType<typeof vi.fn>).mock.calls).toEqual([["pinned", ["1", "2"]]]);
    });

    it("is downloaded even when the saved text is full of newer mail", async () => {
      settings = { ...DEFAULT_OFFLINE_SETTINGS, limit: "size" };
      roomFor = () => false;
      const { provider, batches } = fakeProvider();
      await launch().schedule("acc", provider, "pinned", [pinnedRow(1, 400)]);
      expect(batches.flat()).toEqual(["1"]);

      batches.length = 0;
      await launch().schedule("acc", provider, "inbox", [row(2, 1)]);
      expect(batches).toEqual([]);
    });

    it("does not replace what the Inbox is still downloading", async () => {
      const { provider, batches } = fakeProvider();
      const prefetcher = launch();
      const inbox = prefetcher.schedule("acc", provider, "inbox", Array.from({ length: 20 }, (_, index) => row(index + 1, index)));
      await prefetcher.schedule("acc", provider, "pinned", [pinnedRow(99, 300)]);
      await inbox;
      expect(batches.flat()).toContain("99");
      expect(batches.flat().filter((id) => id !== "99")).toHaveLength(20);
    });

    it("waits for the switch, and for the network", async () => {
      const { provider, batches } = fakeProvider();
      settings = { ...DEFAULT_OFFLINE_SETTINGS, prefetch: false };
      await launch().schedule("acc", provider, "pinned", [pinnedRow(1, 1)]);
      settings = { ...DEFAULT_OFFLINE_SETTINGS };
      online = false;
      await launch().schedule("acc", provider, "pinned", [pinnedRow(1, 1)]);
      expect(batches).toEqual([]);
    });

    it("is queued from what the Pinned view already shows when the settings change", async () => {
      settings = { ...DEFAULT_OFFLINE_SETTINGS, lookbackDays: 7 };
      const { provider, batches } = fakeProvider();
      (provider as unknown as { cached: (folder: MailFolder) => MessageSummary[] }).cached = (folder) =>
        folder === "pinned" ? [pinnedRow(7, 300)] : [];
      launch().scheduleCached("acc", provider);
      await vi.waitFor(() => expect(batches.flat()).toEqual(["7"]));
    });
  });

  it("does nothing when it is turned off", async () => {
    settings = { ...DEFAULT_OFFLINE_SETTINGS, prefetch: false };
    const { provider, batches } = fakeProvider();
    await launch().schedule("acc", provider, "inbox", [row(1, 1)]);
    expect(batches).toEqual([]);
  });

  it("stops at once when it is turned off while it runs", async () => {
    const { provider, batches } = fakeProvider();
    provider.prefetch = vi.fn(async (_folder, ids) => {
      batches.push([...ids]);
      settings = { ...settings, prefetch: false };
      return ids.length;
    });
    await launch().schedule("acc", provider, "inbox", Array.from({ length: 30 }, (_, index) => row(index + 1, 1)));
    expect(batches).toHaveLength(1);
  });

  it("does nothing while the computer is offline", async () => {
    online = false;
    const { provider, batches } = fakeProvider();
    await launch().schedule("acc", provider, "inbox", [row(1, 1)]);
    expect(batches).toEqual([]);
  });

  it("skips providers that keep nothing", async () => {
    const provider = {} as MailProvider;
    await expect(launch().schedule("acc", provider, "inbox", [row(1, 1)])).resolves.toBeUndefined();
  });

  it("reports the one message that cannot be read and goes on with the rest", async () => {
    const { provider, batches } = fakeProvider((ids) => ids.includes("2"));
    const prefetcher = launch();
    await prefetcher.schedule("acc", provider, "inbox", [row(1, 1), row(2, 2), row(3, 3)]);

    expect(batches.flat()).toEqual(expect.arrayContaining(["1", "2", "3"]));
    expect(reported).toEqual(["Could not download a message for offline use"]);

    // The next list does not try it again this session.
    batches.length = 0;
    await prefetcher.schedule("acc", provider, "inbox", [row(1, 1), row(2, 2), row(3, 3)]);
    expect(batches.flat()).not.toContain("2");
  });

  it("replaces what is queued with the newest list instead of downloading twice", async () => {
    const { provider, batches } = fakeProvider();
    const prefetcher = launch();
    const first = prefetcher.schedule("acc", provider, "inbox", Array.from({ length: 24 }, (_, index) => row(index + 1, 1)));
    const second = prefetcher.schedule("acc", provider, "inbox", [row(100, 0)]);
    await Promise.all([first, second]);
    expect(batches.flat()).toContain("100");
    expect(batches.flat().filter((id) => id === "100")).toHaveLength(1);
  });

  it("forgets a removed account", async () => {
    const { provider, batches } = fakeProvider();
    const prefetcher = launch();
    const running = prefetcher.schedule("acc", provider, "inbox", Array.from({ length: 30 }, (_, index) => row(index + 1, 1)));
    prefetcher.forget("acc");
    await running;
    expect(batches.flat().length).toBeLessThan(30);
  });
});

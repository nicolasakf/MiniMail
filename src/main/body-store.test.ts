import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reported = vi.hoisted(() => [] as string[]);
vi.mock("./events", () => ({
  reportError: (_area: string, title: string) => void reported.push(title),
  recordInfo: () => undefined,
  recordAction: () => undefined,
}));

import { BodyStore } from "./body-store";
import type { Cipher } from "./category-store";
import type { StoredBody } from "./providers/types";

/** A reversible stand-in for the keychain that shows what passed through it. */
function fakeCipher(available = true): Cipher & { available: boolean; broken: boolean } {
  const cipher = {
    available,
    broken: false,
    isEncryptionAvailable: () => cipher.available,
    encryptString: (plain: string) => Buffer.from(`sealed:${plain}`, "utf8").reverse(),
    decryptString(data: Buffer) {
      const text = Buffer.from(data).reverse().toString("utf8");
      if (cipher.broken || !text.startsWith("sealed:")) throw new Error("bad key");
      return text.slice("sealed:".length);
    },
  };
  return cipher;
}

const body = (html = "<p>Hello</p>", extra: Partial<StoredBody> = {}): StoredBody => ({
  cc: [],
  replyTo: null,
  messageId: "<a@example.com>",
  references: [],
  html,
  text: null,
  attachments: [{ id: "2", filename: "report.pdf", contentType: "application/pdf", size: 1234 }],
  invitation: null,
  inline: [],
  ...extra,
});

let dir: string;
let file: string;
const open: BodyStore[] = [];
const launch = (cipher: Cipher = fakeCipher(), max?: number | null): BodyStore => {
  const store = new BodyStore(file, cipher, max);
  open.push(store);
  return store;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "minimail-bodies-"));
  file = join(dir, "message-text.sqlite");
  reported.length = 0;
});

afterEach(() => {
  for (const store of open.splice(0)) store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("BodyStore", () => {
  it("gives back what was saved, after a restart too", () => {
    launch().forAccount("a").put("inbox", "7", "1", body());
    open.pop()!.close();

    const saved = launch().forAccount("a").get("inbox", "7", "1");
    expect(saved?.html).toBe("<p>Hello</p>");
    expect(saved?.attachments).toEqual([{ id: "2", filename: "report.pdf", contentType: "application/pdf", size: 1234 }]);
  });

  it("keeps the content encrypted on disk, and only ids and sizes in the clear", () => {
    launch().forAccount("a").put("inbox", "7", "1", body("<p>Secret salary</p>"));
    open.pop()!.close();

    const db = new DatabaseSync(file, { readOnly: true });
    const row = db.prepare("SELECT * FROM bodies").get() as Record<string, unknown>;
    db.close();
    expect(Buffer.from(row.data as Uint8Array).toString("latin1")).not.toContain("Secret salary");
    expect(Object.keys(row).sort()).toEqual(["account", "accessed", "data", "folder", "native", "saved", "scope", "size"].sort());
  });

  it("keeps messages of different accounts, folders and numberings apart", () => {
    const store = launch();
    store.forAccount("a").put("inbox", "7", "1", body("<p>a inbox</p>"));
    store.forAccount("b").put("inbox", "7", "1", body("<p>b inbox</p>"));
    store.forAccount("a").put("archive", "7", "1", body("<p>a archive</p>"));

    expect(store.forAccount("a").get("inbox", "7", "1")?.html).toBe("<p>a inbox</p>");
    expect(store.forAccount("b").get("inbox", "7", "1")?.html).toBe("<p>b inbox</p>");
    expect(store.forAccount("a").get("archive", "7", "1")?.html).toBe("<p>a archive</p>");
    // The same uid under another UIDVALIDITY is another message.
    expect(store.forAccount("a").get("inbox", "7", "2")).toBeUndefined();
  });

  it("treats the Pinned view as the Inbox", () => {
    const view = launch().forAccount("a");
    view.put("inbox", "7", "1", body());
    expect(view.get("pinned", "7", "1")).toBeDefined();
  });

  it("never keeps a draft, which servers may edit in place", () => {
    const view = launch().forAccount("a");
    view.put("drafts", "7", "1", body());
    expect(view.get("drafts", "7", "1")).toBeUndefined();
    expect(view.missing("drafts", ["7"], "1")).toEqual(["7"]);
  });

  it("says which messages have no saved text, in order, without reading any", () => {
    const view = launch().forAccount("a");
    view.put("inbox", "2", "1", body());
    view.put("inbox", "4", "1", body());
    expect(view.missing("inbox", ["1", "2", "3", "4", "5"], "1")).toEqual(["1", "3", "5"]);
  });

  it("forgets moved messages, a renumbered folder and a removed account", () => {
    const store = launch();
    const view = store.forAccount("a");
    view.put("inbox", "1", "1", body());
    view.put("inbox", "2", "1", body());
    view.put("inbox", "3", "2", body());
    view.remove("inbox", ["1"]);
    expect(view.get("inbox", "1", "1")).toBeUndefined();
    expect(view.get("inbox", "2", "1")).toBeDefined();

    view.retire("inbox", "2");
    expect(view.get("inbox", "2", "1")).toBeUndefined();
    expect(view.get("inbox", "3", "2")).toBeDefined();

    store.forAccount("b").put("inbox", "1", "1", body());
    store.dropAccount("a");
    expect(view.get("inbox", "3", "2")).toBeUndefined();
    expect(store.forAccount("b").get("inbox", "1", "1")).toBeDefined();
  });

  it("drops the least recently read text when the file grows past its cap", () => {
    const store = launch(fakeCipher(), 6_000);
    const view = store.forAccount("a");
    const big = "x".repeat(900);
    for (let uid = 1; uid <= 5; uid += 1) view.put("inbox", String(uid), "1", body(big));
    // Reading 1 makes it newer than 2.
    expect(view.get("inbox", "1", "1")).toBeDefined();
    store.close();
    open.pop();

    const small = launch(fakeCipher(), 3_000);
    const after = small.forAccount("a");
    expect(small.stats().bytes).toBeLessThanOrEqual(3_000);
    expect(after.get("inbox", "1", "1")).toBeDefined();
    expect(after.get("inbox", "2", "1")).toBeUndefined();
    expect(after.get("inbox", "5", "1")).toBeDefined();
  });

  it("drops text at once when the limit is lowered, and keeps everything when there is none", () => {
    const store = launch(fakeCipher(), null);
    const view = store.forAccount("a");
    const big = "x".repeat(900);
    for (let uid = 1; uid <= 10; uid += 1) view.put("inbox", String(uid), "1", body(big));
    const before = store.stats().bytes;
    expect(store.stats().messages).toBe(10);
    expect(store.limit()).toBeNull();

    store.setLimit(before / 2);
    expect(store.limit()).toBe(before / 2);
    expect(store.stats().bytes).toBeLessThanOrEqual(before / 2);
    expect(store.stats().messages).toBeLessThan(10);
    expect(view.get("inbox", "10", "1")).toBeDefined();
    expect(view.get("inbox", "1", "1")).toBeUndefined();

    store.setLimit(null);
    for (let uid = 20; uid < 40; uid += 1) view.put("inbox", String(uid), "1", body(big));
    expect(store.stats().messages).toBeGreaterThan(20);
  });

  it("ranks mail downloaded ahead of time by its date, so the oldest goes first", () => {
    const store = launch(fakeCipher(), 6_000);
    const view = store.forAccount("a");
    const big = "x".repeat(900);
    const day = 24 * 60 * 60 * 1000;
    // Saved newest last, but dated oldest first: the file keeps the newest mail, not the last downloaded.
    for (let uid = 1; uid <= 5; uid += 1) view.put("inbox", String(uid), "1", body(big), Date.now() - uid * day);
    // Opened just now: counts as read now whatever its date.
    view.put("inbox", "6", "1", body(big));
    store.setLimit(3_000);
    expect(view.get("inbox", "6", "1")).toBeDefined();
    expect(view.get("inbox", "1", "1")).toBeDefined();
    expect(view.get("inbox", "5", "1")).toBeUndefined();
  });

  it("says whether mail with a date is worth saving: always with room, and when full only if newer than the oldest", () => {
    const store = launch(fakeCipher(), 3_000);
    const view = store.forAccount("a");
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    expect(store.hasRoomFor(now - 400 * day)).toBe(true); // empty
    for (let uid = 1; uid <= 3; uid += 1) view.put("inbox", String(uid), "1", body("x".repeat(900)), now - (uid + 10) * day);
    expect(store.stats().bytes).toBeGreaterThan(3_000 * 0.9);
    expect(store.hasRoomFor(now - 5 * day)).toBe(true); // newer than all it holds
    expect(store.hasRoomFor(now - 400 * day)).toBe(false); // older than all it holds

    store.setLimit(null);
    expect(store.hasRoomFor(now - 400 * day)).toBe(true);
  });

  it("reports the age of the text read longest ago", () => {
    const store = launch();
    expect(store.stats().oldest).toBeNull();
    store.forAccount("a").put("inbox", "1", "1", body(), 1_000);
    expect(store.stats().oldest).toBe(1_000);
  });

  it("saves nothing when the keychain is not available", () => {
    const cipher = fakeCipher(false);
    const view = launch(cipher).forAccount("a");
    view.put("inbox", "7", "1", body());
    cipher.available = true;
    expect(view.get("inbox", "7", "1")).toBeUndefined();
  });

  it("downloads again a message it cannot read, and reports that once", () => {
    const cipher = fakeCipher();
    const view = launch(cipher).forAccount("a");
    view.put("inbox", "1", "1", body());
    view.put("inbox", "2", "1", body());
    cipher.broken = true;

    expect(view.get("inbox", "1", "1")).toBeUndefined();
    expect(view.get("inbox", "2", "1")).toBeUndefined();
    expect(reported).toEqual(["A saved message could not be read; it will be downloaded again"]);
    cipher.broken = false;
    expect(view.missing("inbox", ["1", "2"], "1")).toEqual(["1", "2"]);
  });

  it("downloads again an invitation saved before its call link and notes were read, once", () => {
    const view = launch().forAccount("a");
    const meeting = { uid: "u", method: "REQUEST" as const, title: "Sync", start: null, end: null, allDay: false, location: null, organizer: null, response: null };
    view.put("inbox", "1", "1", body("<p>x</p>", { invitation: meeting })); // the old format: no url, no notes
    view.put("inbox", "2", "1", body("<p>y</p>", { invitation: { ...meeting, url: null, notes: null } }));

    expect(view.get("inbox", "1", "1")).toBeUndefined();
    expect(view.missing("inbox", ["1", "2"], "1")).toEqual(["1"]);
    expect(view.get("inbox", "2", "1")?.invitation?.url).toBeNull();
    expect(reported).toEqual([]);
  });

  it("sets aside a file that is not a database, reports it and starts a new one", () => {
    writeFileSync(file, "this is not a database, not even close".repeat(40));
    const view = launch().forAccount("a");

    expect(reported).toContain("Could not read the saved messages; they will be downloaded again");
    expect(existsSync(`${file}.corrupt`)).toBe(true);
    view.put("inbox", "1", "1", body());
    expect(view.get("inbox", "1", "1")).toBeDefined();
  });

  it("leaves a file from a newer MiniMail alone", () => {
    launch();
    open.pop()!.close();
    const db = new DatabaseSync(file);
    db.prepare("UPDATE meta SET value = '99' WHERE key = 'version'").run();
    db.close();

    const view = launch().forAccount("a");
    view.put("inbox", "1", "1", body());
    expect(view.get("inbox", "1", "1")).toBeUndefined();
    expect(reported).toContain("The saved messages were written by a newer MiniMail; they are not used and not changed");
    expect(existsSync(`${file}.corrupt`)).toBe(false);
    open.pop()!.close();

    const check = new DatabaseSync(file, { readOnly: true });
    expect(check.prepare("SELECT value FROM meta WHERE key = 'version'").get()).toEqual({ value: "99" });
    expect((check.prepare("SELECT COUNT(*) AS n FROM bodies").get() as { n: number }).n).toBe(0);
    check.close();
  });
});

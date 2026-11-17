import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EVENT_RETENTION_MS, type AppEvent } from "@shared/events";

import type { Cipher } from "./category-store";
import { EventJournal } from "./event-journal";

/** "Encrypts" by reversing the text, enough to prove the file never holds the plain event. */
function fakeCipher(available = true): Cipher {
  const flip = (text: string) => text.split("").reverse().join("");
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(flip(plain)),
    decryptString: (data) => flip(data.toString()),
  };
}

describe("EventJournal", () => {
  let dir: string;
  let file: string;
  let clock: number;
  const now = () => clock;

  const open = (cipher = fakeCipher(), extra: ConstructorParameters<typeof EventJournal>[2] = {}) =>
    new EventJournal(file, cipher, { now, ...extra });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "minimail-events-"));
    file = join(dir, "events.jsonl");
    clock = Date.UTC(2026, 10, 16, 12);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it("records without touching the disk until later", async () => {
    const journal = open();
    journal.record({ level: "error", area: "sync", title: "Could not sync Outlook", detail: "timeout" });
    expect(existsSync(file)).toBe(false);
    await journal.settled();
    expect(existsSync(file)).toBe(true);
  });

  it("keeps the private context encrypted and out of the log lines", async () => {
    const lines: string[] = [];
    const journal = open(fakeCipher(), { writeLog: (_level, area, message) => lines.push(`${area}: ${message}`) });
    journal.record({
      level: "error",
      area: "sorting",
      title: "Could not sort an email",
      detail: "rate limited, mail from boss@example.com",
      context: "Tech Networking Event · events@startupvalley.example",
    });
    await journal.settled();
    const onDisk = readFileSync(file, "utf8");
    expect(onDisk).toMatch(/^e:/);
    expect(onDisk).not.toContain("Tech Networking");
    expect(lines.join("\n")).not.toContain("Tech Networking");
    expect(lines[0]).toContain("<email>");
    expect(journal.list()[0].context).toContain("Tech Networking");
  });

  it("stores no private context at all when encryption is unavailable", async () => {
    const journal = open(fakeCipher(false));
    journal.record({ level: "action", area: "mail", title: "Archived", context: "Secret subject" });
    await journal.settled();
    const onDisk = readFileSync(file, "utf8");
    expect(onDisk).toMatch(/^p:/);
    expect(onDisk).not.toContain("Secret subject");
  });

  it("loads what an earlier run wrote, and drops what is older than 30 days", async () => {
    const first = open();
    first.record({ level: "error", area: "send", title: "Could not send", detail: "refused", context: "Re: lunch" });
    clock -= 0;
    await first.settled();

    const old = open();
    clock += EVENT_RETENTION_MS + 1000;
    old.record({ level: "error", area: "sync", title: "Fresh", detail: "now" });
    await old.settled();

    const later = open();
    await later.load();
    const titles = later.list().map((event) => event.title);
    expect(titles).toEqual(["Fresh"]);
    // The file was tidied: the aged-out line is gone.
    await later.settled();
    expect(readFileSync(file, "utf8")).not.toContain("Could not send");
  });

  it("merges events recorded while the file was still loading", async () => {
    const first = open();
    first.record({ level: "error", area: "send", title: "Earlier", detail: "x" });
    await first.settled();
    clock += 1000;

    const second = open();
    second.record({ level: "error", area: "sync", title: "During load", detail: "y" });
    await second.load();
    expect(second.list().map((event) => event.title)).toEqual(["During load", "Earlier"]);
  });

  it("pushes the history to the page only if it asked for the list before loading finished", async () => {
    const first = open();
    first.record({ level: "error", area: "send", title: "From an earlier run", detail: "x" });
    await first.settled();
    clock += 1000;

    const quiet: AppEvent[][] = [];
    const late = open(fakeCipher(), { onChange: (batch) => quiet.push(batch) });
    await late.load();
    await late.settled();
    expect(quiet).toEqual([]); // nobody asked early: the page's own list request gets everything

    const eager: AppEvent[][] = [];
    const early = open(fakeCipher(), { onChange: (batch) => eager.push(batch) });
    const loading = early.load();
    expect(early.list()).toEqual([]); // asked before the history was in
    await loading;
    await early.settled();
    expect(eager.flat().map((event) => event.title)).toContain("From an earlier run");
  });

  it("counts the same error repeating instead of adding rows", async () => {
    const changes: AppEvent[][] = [];
    const journal = open(fakeCipher(), { onChange: (batch) => changes.push(batch) });
    for (let index = 0; index < 5; index++) {
      journal.record({ level: "error", area: "sync", title: "Could not sync Outlook", detail: "timeout" });
      clock += 15_000;
    }
    const [row] = journal.list();
    expect(journal.list()).toHaveLength(1);
    expect(row.repeats).toBe(5);
    expect(row.lastAt).toBeGreaterThan(row.at);
    await journal.settled();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toHaveLength(1);
  });

  it("starts a new row once the repeats stop for a while", () => {
    const journal = open();
    journal.record({ level: "error", area: "sync", title: "Down", detail: "x" });
    clock += 11 * 60_000;
    journal.record({ level: "error", area: "sync", title: "Down", detail: "x" });
    expect(journal.list()).toHaveLength(2);
  });

  it("never merges actions", () => {
    const journal = open();
    journal.record({ level: "action", area: "mail", title: "Archived" });
    journal.record({ level: "action", area: "mail", title: "Archived" });
    expect(journal.list()).toHaveLength(2);
  });

  it("persists the repeat counter, at the latest when flushed on quit", async () => {
    const journal = open();
    journal.record({ level: "error", area: "sync", title: "Down", detail: "x" });
    clock += 1000;
    journal.record({ level: "error", area: "sync", title: "Down", detail: "x" });
    journal.flushSync();
    const reopened = open();
    await reopened.load();
    expect(reopened.list()[0].repeats).toBe(2);
  });

  it("marks errors as done without removing anything, and a repeat afterwards is a new row", async () => {
    const journal = open();
    journal.record({ level: "error", area: "sync", title: "Down", detail: "x" });
    journal.record({ level: "action", area: "mail", title: "Archived" });
    clock += 1000;
    journal.markErrorsDone();
    clock += 1000;
    journal.record({ level: "error", area: "sync", title: "Down", detail: "x" });
    await journal.settled();
    const rows = journal.list();
    expect(rows).toHaveLength(3);
    expect(rows.filter((event) => event.done).map((event) => event.title)).toEqual(["Down"]);
    expect(rows.find((event) => event.level === "action")?.done).toBeUndefined();
    expect(rows[0].done).toBeUndefined(); // the new occurrence is open again

    const reopened = open();
    await reopened.load();
    const reloaded = reopened.list();
    expect(reloaded).toHaveLength(3);
    expect(reloaded.filter((event) => event.done)).toHaveLength(1);
  });

  it("skips a damaged line, says so, and leaves the file alone", async () => {
    const first = open();
    first.record({ level: "error", area: "sync", title: "Good", detail: "x" });
    first.flushSync();
    const { appendFileSync } = await import("node:fs");
    appendFileSync(file, "e:not-encrypted-at-all\n");
    const before = readFileSync(file, "utf8");
    clock += 1000;
    const reopened = open();
    await reopened.load();
    expect(reopened.list().map((event) => event.title)).toContain("Good");
    expect(reopened.list().some((event) => event.title.startsWith("Part of the event history"))).toBe(true);
    await reopened.settled();
    expect(readFileSync(file, "utf8").startsWith(before)).toBe(true);
  });

  it("lists every error but only the newest other events", () => {
    const journal = open();
    for (let index = 0; index < 5200; index++) {
      journal.record({ level: "action", area: "mail", title: `Action ${index}` });
    }
    journal.record({ level: "error", area: "sync", title: "An error", detail: "x" });
    const list = journal.list();
    expect(list.filter((event) => event.level === "error")).toHaveLength(1);
    expect(list.filter((event) => event.level === "action")).toHaveLength(5000);
    expect(list[0].title).toBe("An error");
  });

  it("saves a large burst without blocking: the encrypting is done in slices", async () => {
    const journal = open();
    const started = Date.now();
    for (let index = 0; index < 3000; index++) {
      journal.record({ level: "action", area: "mail", title: `Archived ${index}`, context: `Subject ${index}` });
    }
    // Recording is memory only, so a burst returns at once, before anything is written.
    expect(Date.now() - started).toBeLessThan(500);
    expect(existsSync(file)).toBe(false);
    await journal.settled();
    const reopened = open();
    await reopened.load();
    expect(reopened.list()).toHaveLength(3000);
  });

  it("never throws when the cipher does", async () => {
    const broken: Cipher = {
      isEncryptionAvailable: () => true,
      encryptString: () => {
        throw new Error("keychain locked");
      },
      decryptString: () => "",
    };
    const journal = open(broken);
    expect(() => journal.record({ level: "error", area: "x", title: "y" })).not.toThrow();
    await expect(journal.settled()).resolves.toBeUndefined();
    expect(() => journal.flushSync()).not.toThrow();
  });
});

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAIL_WINDOW } from "@shared/mail-window";
import type { MessageSummary } from "@shared/types";

import type { Cipher } from "./category-store";
import { MailCache } from "./mail-cache";

const row = (id: string, subject = "Quarterly numbers"): MessageSummary => ({
  id: `acc1|inbox|${id}`,
  accountId: "acc1",
  folder: "inbox",
  threadId: `t${id}`,
  from: { name: "Ann", email: "ann@example.com" },
  to: [],
  subject,
  snippet: "hello",
  date: "2026-11-01T10:00:00.000Z",
  unread: true,
  pinned: false,
  answered: false,
  hasAttachments: false,
  categoryId: null,
  signal: "person",
});

/** A reversible stand-in for the keychain that shows what passed through it. */
function fakeCipher(available = true): Cipher & { encrypted: number } {
  const cipher = {
    encrypted: 0,
    isEncryptionAvailable: () => available,
    encryptString(plain: string) {
      cipher.encrypted += 1;
      return Buffer.from(`sealed:${plain}`, "utf8").reverse();
    },
    decryptString(data: Buffer) {
      const text = Buffer.from(data).reverse().toString("utf8");
      if (!text.startsWith("sealed:")) throw new Error("bad key");
      return text.slice("sealed:".length);
    },
  };
  return cipher;
}

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "minimail-cache-"));
  file = join(dir, "mail-cache.json");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("MailCache", () => {
  it("keeps a folder between launches", () => {
    const first = new MailCache(file, fakeCipher());
    first.forAccount("acc1").save("inbox", { uidValidity: "7", messages: [row("1"), row("2")] });
    first.flush();

    const second = new MailCache(file, fakeCipher()).forAccount("acc1").load("inbox");
    expect(second?.uidValidity).toBe("7");
    expect(second?.messages.map((message) => message.id)).toEqual(["acc1|inbox|1", "acc1|inbox|2"]);
  });

  it("saves on its own shortly after a change", async () => {
    const cache = new MailCache(file, fakeCipher(), 5);
    cache.forAccount("acc1").save("inbox", { uidValidity: "1", messages: [row("1")] });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(new MailCache(file, fakeCipher()).forAccount("acc1").load("inbox")?.messages).toHaveLength(1);
  });

  it("never writes message text to disk in the clear", () => {
    const cipher = fakeCipher();
    const cache = new MailCache(file, cipher);
    cache.forAccount("acc1").save("inbox", { uidValidity: "1", messages: [row("1", "Secret merger plans")] });
    cache.flush();

    expect(cipher.encrypted).toBe(1);
    const onDisk = readFileSync(file, "utf8");
    expect(onDisk).not.toContain("Secret merger plans");
    expect(onDisk).not.toContain("ann@example.com");
  });

  it("writes nothing when the keychain is unavailable", () => {
    const cache = new MailCache(file, fakeCipher(false));
    cache.forAccount("acc1").save("inbox", { uidValidity: "1", messages: [row("1")] });
    cache.flush();
    expect(() => readFileSync(file)).toThrow();
  });

  it("forgets a removed account and does not take its data back afterwards", () => {
    const cache = new MailCache(file, fakeCipher());
    const store = cache.forAccount("acc1");
    store.save("inbox", { uidValidity: "1", messages: [row("1")] });
    cache.dropAccount("acc1");
    // A list that was still running when the account was removed finishes and saves.
    store.save("inbox", { uidValidity: "1", messages: [row("2")] });
    cache.flush();

    expect(new MailCache(file, fakeCipher()).forAccount("acc1").load("inbox")).toBeUndefined();
  });

  it("starts empty from an unreadable, tampered or outdated file", () => {
    for (const contents of [
      "not json",
      JSON.stringify({ version: 1, data: "AAAA" }),
      JSON.stringify({ version: 2, data: "AAAA" }),
    ]) {
      writeFileSync(file, contents);
      expect(new MailCache(file, fakeCipher()).forAccount("acc1").load("inbox")).toBeUndefined();
    }
  });

  it("drops rows that no longer look like messages instead of crashing the list", () => {
    const cache = new MailCache(file, fakeCipher());
    const broken = { id: 5 } as unknown as MessageSummary;
    cache.forAccount("acc1").save("inbox", { uidValidity: "1", messages: [broken] });
    cache.flush();
    expect(new MailCache(file, fakeCipher()).forAccount("acc1").load("inbox")).toBeUndefined();
  });

  it("caps how many rows one folder keeps", () => {
    const cache = new MailCache(file, fakeCipher());
    const many = Array.from({ length: MAIL_WINDOW + 250 }, (_, index) => row(String(index + 1)));
    cache.forAccount("acc1").save("inbox", { uidValidity: "1", messages: many });
    // The whole list window fits, with some headroom.
    expect(cache.forAccount("acc1").load("inbox")?.messages).toHaveLength(MAIL_WINDOW + 100);
  });

  it("keeps where a folder stands in Outlook's change feed between launches", () => {
    const delta = {
      link: "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=abc",
      since: "2026-11-01T10:00:00Z",
      syncedAt: 1_700_000_000_000,
    };
    const cache = new MailCache(file, fakeCipher());
    cache.forAccount("acc1").save("inbox", { uidValidity: "graph", messages: [row("1")], delta });
    cache.flush();
    expect(new MailCache(file, fakeCipher()).forAccount("acc1").load("inbox")?.delta).toEqual(delta);
  });

  describe("older files", () => {
    /** A file as an earlier version wrote it, sealed with the same stand-in keychain. */
    const writeStored = (version: number, rows: unknown[]) => {
      const payload = { accounts: { acc1: { inbox: { uidValidity: "7", messages: rows } } } };
      const data = fakeCipher().encryptString(JSON.stringify(payload)).toString("base64");
      writeFileSync(file, JSON.stringify({ version, data }));
    };

    it("keeps the rows of a version 1 file and only forgets what it saved wrongly", () => {
      writeStored(1, [{ ...row("1"), unsubscribe: null }, { ...row("2"), unsubscribe: null }]);

      const cache = new MailCache(file, fakeCipher());
      const copy = cache.forAccount("acc1").load("inbox");
      expect(copy?.uidValidity).toBe("7");
      expect(copy?.messages.map((message) => message.subject)).toEqual(["Quarterly numbers", "Quarterly numbers"]);
      // `undefined`, not `null`: the next list re-reads just these headers for the row.
      expect(copy?.messages.every((message) => message.unsubscribe === undefined)).toBe(true);
    });

    it("writes the upgraded file back, so the migration runs once", () => {
      writeStored(1, [{ ...row("1"), unsubscribe: null }]);
      const cache = new MailCache(file, fakeCipher());
      cache.flush();
      expect(JSON.parse(readFileSync(file, "utf8")).version).toBe(3);
      expect(new MailCache(file, fakeCipher()).forAccount("acc1").load("inbox")?.messages).toHaveLength(1);
    });

    it("keeps the rows of a version 2 file, which has no change feed yet", () => {
      writeStored(2, [row("1"), row("2")]);

      const copy = new MailCache(file, fakeCipher()).forAccount("acc1").load("inbox");
      expect(copy?.uidValidity).toBe("7");
      expect(copy?.messages.map((message) => message.id)).toEqual(["acc1|inbox|1", "acc1|inbox|2"]);
      // A folder without a feed starts one on its next list, from these rows.
      expect(copy?.delta).toBeUndefined();
    });

    it("writes a version 2 file back as version 3 without losing a row", () => {
      writeStored(2, [row("1"), row("2")]);
      new MailCache(file, fakeCipher()).flush();
      expect(JSON.parse(readFileSync(file, "utf8")).version).toBe(3);
      expect(new MailCache(file, fakeCipher()).forAccount("acc1").load("inbox")?.messages).toHaveLength(2);
    });

    it("drops a change feed position that does not read back, and keeps the rows", () => {
      const payload = {
        accounts: { acc1: { inbox: { uidValidity: "graph", messages: [row("1")], delta: { link: 5 } } } },
      };
      const data = fakeCipher().encryptString(JSON.stringify(payload)).toString("base64");
      writeFileSync(file, JSON.stringify({ version: 3, data }));

      const copy = new MailCache(file, fakeCipher()).forAccount("acc1").load("inbox");
      expect(copy?.messages).toHaveLength(1);
      expect(copy?.delta).toBeUndefined();
    });

    it("leaves a file from a newer app alone", () => {
      writeStored(99, [row("1")]);
      const before = readFileSync(file, "utf8");

      const cache = new MailCache(file, fakeCipher());
      expect(cache.forAccount("acc1").load("inbox")).toBeUndefined();
      cache.forAccount("acc1").save("inbox", { uidValidity: "1", messages: [row("2")] });
      cache.flush();
      expect(readFileSync(file, "utf8")).toBe(before);
    });
  });
});

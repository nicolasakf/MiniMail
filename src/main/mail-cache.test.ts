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
      JSON.stringify({ version: 99, data: "AAAA" }),
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
});

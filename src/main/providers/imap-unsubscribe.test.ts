import { describe, expect, it, vi } from "vitest";

vi.mock("../events", () => ({ reportError: vi.fn(), recordAction: vi.fn(), recordInfo: vi.fn() }));

import type { Account } from "@shared/types";

import { ImapProvider } from "./imap";

const account = { id: "a", email: "me@example.com", provider: "gmail" } as unknown as Account;

/** Runs a raw message through the same path a list refresh takes. */
async function summarize(headers: string[]) {
  const provider = new ImapProvider(account, async () => ({ kind: "password", password: "x" }) as never);
  const source = Buffer.from([...headers, "", "Hello"].join("\r\n"), "latin1");
  const message = {
    uid: 1,
    source,
    flags: new Set<string>(),
    internalDate: new Date("2026-11-18T10:00:00Z"),
    envelope: {
      subject: "New note",
      messageId: "<m1@example.com>",
      from: [{ name: "Substack", address: "no-reply@substack.com" }],
      to: [{ address: "me@example.com" }],
    },
  };
  return (provider as unknown as { summarize(folder: string, message: unknown): Promise<Awaited<ReturnType<ImapProvider["list"]>>[number]> }).summarize(
    "inbox",
    message,
  );
}

describe("ImapProvider list headers", () => {
  it("reads the unsubscribe address and list id (mailparser hides List-* headers from headers.get)", async () => {
    const row = await summarize([
      "From: Substack <no-reply@substack.com>",
      "List-Id: <notes.substack.com>",
      "List-Unsubscribe: <mailto:u@substack.com>, <https://substack.com/unsub?x=1>",
      "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
    ]);
    expect(row.unsubscribe).toEqual({ url: "https://substack.com/unsub?x=1", oneClick: true, listId: "notes.substack.com" });
  });

  it("reads a List-Unsubscribe header folded over several lines", async () => {
    const row = await summarize([
      "List-Unsubscribe: <mailto:u@substack.com>,",
      "\t<https://substack.com/unsub?x=1>",
    ]);
    expect(row.unsubscribe?.url).toBe("https://substack.com/unsub?x=1");
  });

  it("has no unsubscribe for a message without the header", async () => {
    const row = await summarize(["From: a@b.com"]);
    expect(row.unsubscribe).toBeNull();
  });
});

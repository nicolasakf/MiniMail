import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeMessageId } from "@shared/ids";
import type { MessageDetail } from "@shared/types";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(text, "utf8"),
    decryptString: (data: Buffer) => data.toString("utf8"),
  },
}));
vi.mock("./logos/net-guard", () => ({ safeFetch: vi.fn() }));
vi.mock("./log", () => ({ logEvent: vi.fn(), initLog: vi.fn(), logPath: () => null }));

import type { Categorizer } from "./categorizer";
import { safeFetch } from "./logos/net-guard";
import { MailService } from "./service";
import { AccountStore } from "./store";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "minimail-unsub-"));
  vi.mocked(safeFetch).mockReset();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const id = (accountId: string, nativeId: string) => makeMessageId({ accountId, folder: "inbox", nativeId });

function detail(accountId: string, nativeId: string, url: string, oneClick = true): MessageDetail {
  return {
    id: id(accountId, nativeId),
    accountId,
    folder: "inbox",
    threadId: nativeId,
    from: { name: "Sender", email: `${nativeId}@example.com` },
    to: [],
    subject: "Hi",
    snippet: "",
    date: "2026-11-01T10:00:00Z",
    unread: false,
    pinned: false,
    answered: false,
    hasAttachments: false,
    authenticated: true,
    unsubscribe: { url, oneClick },
    signal: "newsletter",
    categoryId: null,
    cc: [],
    replyTo: null,
    messageId: null,
    references: [],
    html: null,
    text: null,
    attachments: [],
  };
}

function serviceWith(providers: Record<string, { get: (folder: string, ids: string[]) => Promise<MessageDetail[]> }>) {
  const service = new MailService(new AccountStore(join(dir, "accounts.json")), {}, async () => undefined, {} as Categorizer);
  vi.spyOn(service as unknown as { providerForId: (accountId: string) => unknown }, "providerForId").mockImplementation(
    (accountId: string) => providers[accountId],
  );
  return service;
}

const answer = (status: number) => ({ status, contentType: "", body: Buffer.alloc(0), url: "" });

describe("MailService.unsubscribe", () => {
  it("handles each sender on its own: one refusal does not stop the other", async () => {
    vi.mocked(safeFetch).mockImplementation(async (url) => answer(String(url).includes("bad") ? 302 : 200));
    const service = serviceWith({
      a: { get: async (_folder, ids) => ids.map((nativeId) => detail("a", nativeId, `https://${nativeId === "1" ? "good" : "bad"}.example/u`)) },
    });
    const results = await service.unsubscribe([id("a", "1"), id("a", "2")]);
    expect(results[0]).toEqual({ id: id("a", "1"), status: "done" });
    expect(results[1]).toMatchObject({ id: id("a", "2"), status: "failed", error: expect.stringMatching(/redirected/i) });
    expect(safeFetch).toHaveBeenCalledTimes(2);
  });

  it("still unsubscribes the messages of one account when another account cannot be read", async () => {
    vi.mocked(safeFetch).mockResolvedValue(answer(200));
    const service = serviceWith({
      a: { get: async (_folder, ids) => ids.map((nativeId) => detail("a", nativeId, "https://ok.example/u")) },
      b: { get: async () => { throw new Error("Connection lost"); } },
    });
    const results = await service.unsubscribe([id("a", "1"), id("b", "1")]);
    expect(results[0]).toEqual({ id: id("a", "1"), status: "done" });
    expect(results[1]).toMatchObject({ id: id("b", "1"), status: "failed", error: expect.stringContaining("Connection lost") });
  });

  it("reports a message the server no longer has", async () => {
    const service = serviceWith({ a: { get: async () => [] } });
    const [result] = await service.unsubscribe([id("a", "9")]);
    expect(result).toMatchObject({ status: "failed", error: expect.stringMatching(/no longer has/i) });
  });

  it("hands back the page of a sender that has no one-click, without contacting it", async () => {
    const service = serviceWith({ a: { get: async (_folder, ids) => ids.map((nativeId) => detail("a", nativeId, "https://page.example/u", false)) } });
    const [result] = await service.unsubscribe([id("a", "1")]);
    expect(result).toEqual({ id: id("a", "1"), status: "manual", url: "https://page.example/u" });
    expect(safeFetch).not.toHaveBeenCalled();
  });
});

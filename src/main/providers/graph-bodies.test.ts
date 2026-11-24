import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Account, MailFolder, MessageSummary } from "@shared/types";

import { BodyStore } from "../body-store";
import type { Cipher } from "../category-store";
import { GraphProvider } from "./graph";
import type { CachedFolder, SummaryStore } from "./summary-cache";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const account: Account = {
  id: "acc1",
  provider: "outlook",
  email: "me@example.com",
  displayName: "Me",
  auth: "oauth",
  hue: 210,
};

const row = (id: string): MessageSummary => ({
  id: `acc1|inbox|${id}`,
  accountId: "acc1",
  folder: "inbox",
  threadId: `c-${id}`,
  from: { name: "Ann", email: "ann@example.com" },
  to: [],
  subject: `Subject ${id}`,
  snippet: "hello",
  date: "2026-11-20T10:00:00.000Z",
  unread: true,
  pinned: false,
  answered: false,
  hasAttachments: true,
  categoryId: null,
  signal: "person",
});

const cipher: Cipher = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(`sealed:${plain}`, "utf8").reverse(),
  decryptString: (data) => Buffer.from(data).reverse().toString("utf8").slice("sealed:".length),
};

describe("GraphProvider with saved messages", () => {
  let dir: string;
  let saved: BodyStore;
  let requests: string[];
  const rows = new Map<MailFolder, CachedFolder>();
  const persist: SummaryStore = { load: (folder) => rows.get(folder), save: (folder, value) => void rows.set(folder, value) };
  const relaunch = () => new GraphProvider(account, async () => "tok", persist, async () => undefined, saved.forAccount("acc1"));

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "minimail-graph-bodies-"));
    saved = new BodyStore(join(dir, "text.sqlite"), cipher);
    requests = [];
    rows.clear();
    rows.set("inbox", { uidValidity: "", messages: [row("m1"), row("m2")] });
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      requests.push(`${init?.method ?? "GET"} ${url.pathname}`);
      const attachment = /\/messages\/([^/]+)\/attachments\/([^/]+)$/.exec(url.pathname);
      if (attachment) {
        return json({ id: attachment[2], name: "logo.png", contentType: "image/png", contentBytes: Buffer.from("PNG!").toString("base64"), contentId: "<logo>" });
      }
      const message = /\/me\/messages\/([^/]+)$/.exec(url.pathname);
      if (message && (init?.method ?? "GET") === "GET") {
        return json({
          id: message[1],
          conversationId: `c-${message[1]}`,
          subject: `Subject ${message[1]}`,
          from: { emailAddress: { name: "Ann", address: "ann@example.com" } },
          toRecipients: [],
          ccRecipients: [{ emailAddress: { name: "Bob", address: "bob@example.com" } }],
          receivedDateTime: "2026-11-20T10:00:00.000Z",
          bodyPreview: "hello",
          isRead: false,
          hasAttachments: true,
          internetMessageId: `<${message[1]}@example.com>`,
          body: { contentType: "html", content: '<p>Hi</p><img src="cid:logo">' },
          attachments: [
            { id: "a1", name: "report.pdf", contentType: "application/pdf", size: 5000, isInline: false },
            { id: "a2", name: "logo.png", contentType: "image/png", size: 4, isInline: true },
          ],
        });
      }
      return new Response(null, { status: 200 });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    saved.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const downloads = () => requests.filter((request) => /\/me\/messages\/[^/]+$/.test(request)).length;
  const imageRequests = () => requests.filter((request) => request.includes("/attachments/")).length;

  it("keeps a message when it is opened, and opens it later without the network", async () => {
    const first = await relaunch().get("inbox", ["m1"]);
    expect(first[0].cc).toEqual([{ name: "Bob", email: "bob@example.com" }]);
    expect(downloads()).toBe(1);

    const before = requests.length;
    const again = await relaunch().get("inbox", ["m1"]);
    // Only the logo is asked for again: the text and the list of files come from disk.
    expect(requests.slice(before)).toEqual(["GET /v1.0/me/messages/m1/attachments/a2"]);
    expect(again[0].attachments).toEqual([{ id: "a1", filename: "report.pdf", contentType: "application/pdf", size: 5000 }]);
    expect(again[0].html).toContain("data:image/png;base64,");
  });

  it("downloads text ahead of time without any file or embedded image", async () => {
    expect(await relaunch().prefetch("inbox", ["m1", "m2"])).toBe(2);
    expect(downloads()).toBe(2);
    expect(imageRequests()).toBe(0);
    expect(requests.some((request) => request.includes("/a1"))).toBe(false);

    const opened = await relaunch().get("inbox", ["m1"]);
    expect(downloads()).toBe(2);
    expect(opened[0].subject).toBe("Subject m1");
    expect(saved.forAccount("acc1").get("inbox", "m1", "")?.html).toBe('<p>Hi</p><img src="cid:logo">');
  });

  it("ranks mail downloaded ahead of time by its date, and mail that was opened as read just now", async () => {
    await relaunch().prefetch("inbox", ["m1"]);
    expect(saved.stats().oldest).toBe(Date.parse("2026-11-20T10:00:00.000Z"));

    await relaunch().get("inbox", ["m2"]);
    expect(saved.stats().messages).toBe(2);
    expect(saved.stats().oldest).toBe(Date.parse("2026-11-20T10:00:00.000Z"));
    saved.setLimit(Math.round(saved.stats().bytes * 0.6));
    expect(saved.stats().messages).toBe(1);
    expect(saved.stats().oldest).toBeGreaterThan(Date.now() - 60_000);
  });

  it("keeps pinned mail downloaded ahead of time as if it was just read, and under the Inbox", async () => {
    expect(await relaunch().prefetch("pinned", ["m1"])).toBe(1);
    expect(saved.stats().oldest).toBeGreaterThan(Date.now() - 60_000);
    expect(saved.forAccount("acc1").get("inbox", "m1", "")).toBeDefined();
  });

  it("does not download again what is already kept", async () => {
    const provider = relaunch();
    await provider.prefetch("inbox", ["m1"]);
    const before = requests.length;
    expect(await provider.prefetch("inbox", ["m1"])).toBe(0);
    expect(requests.length).toBe(before);
  });

  it("forgets the text of a message that moved", async () => {
    const provider = relaunch();
    await provider.get("inbox", ["m1"]);
    await provider.act("archive", "inbox", ["m1"]);
    expect(saved.forAccount("acc1").get("inbox", "m1", "")).toBeUndefined();
  });
});

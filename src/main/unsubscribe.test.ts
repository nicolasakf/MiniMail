import { describe, expect, it, vi } from "vitest";

import type { MessageSummary } from "@shared/types";

import { unsubscribeFrom } from "./unsubscribe";

function message(unsubscribe: MessageSummary["unsubscribe"], extra: Partial<MessageSummary> = {}): MessageSummary {
  return {
    id: "a|inbox|1",
    accountId: "a",
    folder: "inbox",
    threadId: "t",
    from: { name: "News", email: "news@example.com" },
    to: [],
    subject: "Hi",
    snippet: "",
    date: "2026-11-01T10:00:00Z",
    unread: false,
    pinned: false,
    answered: false,
    hasAttachments: false,
    authenticated: true,
    signal: "newsletter",
    categoryId: null,
    unsubscribe,
    ...extra,
  };
}

const reply = (status: number) => ({ status, contentType: "text/html", body: Buffer.alloc(0), url: "https://x.com/u" });

describe("unsubscribeFrom", () => {
  it("posts the one-click body without following redirects", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply(200));
    const result = await unsubscribeFrom(message({ url: "https://x.com/u", oneClick: true }), fetcher);
    expect(result).toEqual({ id: "a|inbox|1", status: "done" });
    expect(fetcher).toHaveBeenCalledWith(
      "https://x.com/u",
      expect.objectContaining({ postForm: "List-Unsubscribe=One-Click", maxRedirects: 0 }),
    );
  });

  it("reports a refusal from the sender", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply(403));
    const result = await unsubscribeFrom(message({ url: "https://x.com/u", oneClick: true }), fetcher);
    expect(result).toMatchObject({ status: "failed", error: expect.stringContaining("status 403") });
  });

  it("explains a redirect, which the one-click standard does not allow", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply(302));
    const result = await unsubscribeFrom(message({ url: "https://x.com/u", oneClick: true }), fetcher);
    expect(result).toMatchObject({ status: "failed", error: expect.stringMatching(/redirected/i) });
  });

  it("explains an expired link and a slow sender in plain words", async () => {
    const gone = await unsubscribeFrom(message({ url: "https://x.com/u", oneClick: true }), vi.fn().mockResolvedValue(reply(410)));
    expect(gone).toMatchObject({ error: expect.stringMatching(/no longer has/i) });
    const slow = await unsubscribeFrom(
      message({ url: "https://x.com/u", oneClick: true }),
      vi.fn().mockRejectedValue(new Error("Timed out.")),
    );
    expect(slow).toMatchObject({ error: "The sender did not answer in time." });
  });

  it("reports a blocked or failed connection", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("Destination is not a public address."));
    const result = await unsubscribeFrom(message({ url: "https://x.com/u", oneClick: true }), fetcher);
    expect(result).toMatchObject({ status: "failed", error: expect.stringMatching(/not a normal public website/i) });
  });

  it("does not contact a sender that only has a web page", async () => {
    const fetcher = vi.fn();
    const result = await unsubscribeFrom(message({ url: "https://x.com/page", oneClick: false }), fetcher);
    expect(result).toEqual({ id: "a|inbox|1", status: "manual", url: "https://x.com/page" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses mail that should not be offered the command", async () => {
    const fetcher = vi.fn();
    const spam = await unsubscribeFrom(message({ url: "https://x.com/u", oneClick: true }, { folder: "spam" }), fetcher);
    expect(spam.status).toBe("failed");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

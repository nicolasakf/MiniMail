import { describe, expect, it } from "vitest";

import type { Thread } from "./threads";
import type { MessageSummary, UnsubscribeInfo } from "./types";
import {
  listKey,
  messageUnsubscribe,
  messageUnsubscribeState,
  normalizeListId,
  parseUnsubscribe,
  parseUnsubscribedLists,
  planUnsubscribe,
  STILL_RECEIVING_AFTER_MS,
  unsubscribeCommand,
  withUnsubscribed,
} from "./unsubscribe";

function message(overrides: Partial<MessageSummary> & { unsubscribe?: UnsubscribeInfo | null }): MessageSummary {
  return {
    id: "a|inbox|1",
    accountId: "a",
    folder: "inbox",
    threadId: "t1",
    from: { name: "News", email: "news@example.com" },
    to: [],
    subject: "Hello",
    snippet: "",
    date: "2026-11-01T10:00:00Z",
    unread: false,
    pinned: false,
    answered: false,
    hasAttachments: false,
    authenticated: true,
    signal: "newsletter",
    categoryId: null,
    unsubscribe: { url: "https://example.com/u/1", oneClick: true },
    ...overrides,
  };
}

function thread(...messages: MessageSummary[]): Thread {
  const latest = messages[messages.length - 1]!;
  return {
    id: `${latest.accountId}:${latest.threadId}`,
    accountId: latest.accountId,
    messages,
    latest,
    count: messages.length,
    unread: false,
    pinned: false,
    answered: false,
    hasAttachments: false,
    categoryId: null,
  };
}

describe("parseUnsubscribe", () => {
  it("reads a one-click address (https plus the post header)", () => {
    expect(
      parseUnsubscribe("<mailto:u@x.com>, <https://x.com/unsub?id=1>", "List-Unsubscribe=One-Click"),
    ).toEqual({ url: "https://x.com/unsub?id=1", oneClick: true, listId: null });
  });

  it("treats an address without the post header as a page to open", () => {
    expect(parseUnsubscribe("<https://x.com/unsub>", undefined)).toEqual({
      url: "https://x.com/unsub",
      oneClick: false,
      listId: null,
    });
  });

  it("never sends one-click over plain http", () => {
    expect(parseUnsubscribe("<http://x.com/unsub>", "List-Unsubscribe=One-Click")).toMatchObject({
      url: "http://x.com/unsub",
      oneClick: false,
    });
  });

  it("prefers the https address that takes one-click over an earlier page", () => {
    expect(
      parseUnsubscribe("<http://x.com/page>, <https://x.com/post>", "List-Unsubscribe=One-Click"),
    ).toMatchObject({ url: "https://x.com/post", oneClick: true });
  });

  it("has nothing to offer for mailto-only, missing or malformed headers", () => {
    expect(parseUnsubscribe("<mailto:u@x.com>", "List-Unsubscribe=One-Click")).toBeNull();
    expect(parseUnsubscribe(undefined, undefined)).toBeNull();
    expect(parseUnsubscribe("<not a url>, <javascript:alert(1)>", undefined)).toBeNull();
  });

  it("records the list's own name from List-Id", () => {
    expect(parseUnsubscribe("<https://x.com/u>", undefined, '"Weekly Digest" <Digest.Example.com>')).toMatchObject({
      listId: "digest.example.com",
    });
    expect(normalizeListId(undefined)).toBeNull();
    expect(normalizeListId("  ")).toBeNull();
    expect(normalizeListId("plain.example.com")).toBe("plain.example.com");
  });
});

describe("messageUnsubscribe", () => {
  it("is offered for ordinary mail", () => {
    expect(messageUnsubscribe(message({}))).not.toBeNull();
  });

  it("is not offered in Spam, Sent or Drafts", () => {
    for (const folder of ["spam", "sent", "drafts"] as const) {
      expect(messageUnsubscribe(message({ folder }))).toBeNull();
    }
  });

  it("is not offered when the sender failed authentication, but is when that is unknown", () => {
    expect(messageUnsubscribe(message({ authenticated: false }))).toBeNull();
    expect(messageUnsubscribe(message({ authenticated: undefined }))).not.toBeNull();
  });

  it("is not offered for mail with no address or not yet read", () => {
    expect(messageUnsubscribe(message({ unsubscribe: null }))).toBeNull();
    expect(messageUnsubscribe(message({ unsubscribe: undefined }))).toBeNull();
  });
});

describe("listKey", () => {
  it("names a list by its List-Id, so two lists from one address stay apart", () => {
    const digest = message({ unsubscribe: { url: "https://x.com/u", oneClick: true, listId: "digest.x.com" } });
    const deals = message({ unsubscribe: { url: "https://x.com/u", oneClick: true, listId: "deals.x.com" } });
    expect(listKey(digest)).not.toBe(listKey(deals));
  });

  it("falls back to the sender's address, in any letter case", () => {
    const a = message({ from: { name: "A", email: "News@Example.com" } });
    const b = message({ from: { name: "B", email: "news@example.com" } });
    expect(listKey(a)).toBe(listKey(b));
  });

  it("keeps accounts apart", () => {
    expect(listKey(message({ accountId: "a" }))).not.toBe(listKey(message({ accountId: "b" })));
  });
});

describe("unsubscribed lists", () => {
  const sent = Date.parse("2026-11-10T12:00:00Z");
  const record = (m: MessageSummary) => ({ [listKey(m)]: sent });

  it("is available until the user unsubscribes", () => {
    expect(messageUnsubscribeState(message({}), {})).toEqual({ status: "available" });
  });

  it("is done for the list's mail that arrived before or soon after the request", () => {
    const old = message({ date: "2026-11-09T12:00:00Z" });
    const soon = message({ date: new Date(sent + STILL_RECEIVING_AFTER_MS - 60_000).toISOString() });
    expect(messageUnsubscribeState(old, record(old)).status).toBe("done");
    expect(messageUnsubscribeState(soon, record(soon)).status).toBe("done");
  });

  it("comes back for a list message more than a day after the request: it did not work", () => {
    const later = message({ date: new Date(sent + STILL_RECEIVING_AFTER_MS + 60_000).toISOString() });
    expect(messageUnsubscribeState(later, record(later))).toEqual({ status: "again", at: sent });
  });

  it("is not touched by other mail from the same address that is not list mail", () => {
    const list = message({ unsubscribe: { url: "https://x.com/u", oneClick: true, listId: "digest.x.com" } });
    const receipt = message({ id: "a|inbox|2", unsubscribe: null, date: "2026-12-01T12:00:00Z" });
    expect(messageUnsubscribeState(receipt, record(list)).status).toBe("none");
  });

  it("is not touched by another list from the same address", () => {
    const digest = message({ unsubscribe: { url: "https://x.com/u", oneClick: true, listId: "digest.x.com" } });
    const deals = message({ unsubscribe: { url: "https://x.com/u", oneClick: true, listId: "deals.x.com" } });
    expect(messageUnsubscribeState(deals, record(digest)).status).toBe("available");
  });

  it("keeps a clean record: junk is dropped and the oldest go first", () => {
    expect(parseUnsubscribedLists({ a: 5, b: "x", c: NaN })).toEqual({ a: 5 });
    expect(parseUnsubscribedLists(null)).toEqual({});
    expect(parseUnsubscribedLists([1])).toEqual({});
    expect(withUnsubscribed({ old: 1 }, ["k"], 9)).toEqual({ old: 1, k: 9 });
  });
});

describe("planUnsubscribe", () => {
  const withOption = thread(message({ id: "a|inbox|1", threadId: "t1" }));
  const sameSender = thread(message({ id: "a|inbox|2", threadId: "t2" }));
  const otherSender = thread(
    message({ id: "a|inbox|3", threadId: "t3", from: { name: "Deals", email: "DEALS@shop.com" } }),
  );
  const without = thread(message({ id: "a|inbox|4", threadId: "t4", unsubscribe: null }));

  it("sends one request per list and leaves conversations without an option alone", () => {
    const plan = planUnsubscribe([withOption, sameSender, otherSender, without], {});
    expect(plan.entries.map((entry) => entry.messageId)).toEqual(["a|inbox|1", "a|inbox|3"]);
    expect(plan.entries[0]!.threads).toHaveLength(2);
    expect(plan.skipped).toBe(1);
  });

  it("sends two requests for two lists that share one address", () => {
    const digest = thread(
      message({ id: "a|inbox|5", threadId: "t5", unsubscribe: { url: "https://x.com/d", oneClick: true, listId: "digest.x.com" } }),
    );
    const deals = thread(
      message({ id: "a|inbox|6", threadId: "t6", unsubscribe: { url: "https://x.com/e", oneClick: true, listId: "deals.x.com" } }),
    );
    expect(planUnsubscribe([digest, deals], {}).entries).toHaveLength(2);
  });

  it("keeps the same address in two accounts apart", () => {
    const other = thread(message({ id: "b|inbox|1", accountId: "b" }));
    expect(planUnsubscribe([withOption, other], {}).entries).toHaveLength(2);
  });

  it("uses the newest message of a conversation that offers an option", () => {
    const mixed = thread(
      message({ id: "a|inbox|7", date: "2026-11-01T10:00:00Z" }),
      message({ id: "a|inbox|8", date: "2026-11-02T10:00:00Z", unsubscribe: null }),
    );
    expect(planUnsubscribe([mixed], {}).entries[0]!.messageId).toBe("a|inbox|7");
  });

  it("skips lists the user already left, and counts them", () => {
    const done = { [listKey(withOption.latest)]: Date.parse("2026-11-02T00:00:00Z") };
    const plan = planUnsubscribe([withOption, otherSender], done);
    expect(plan.entries.map((entry) => entry.messageId)).toEqual(["a|inbox|3"]);
    expect(plan.alreadyDone).toBe(1);
  });
});

describe("unsubscribeCommand", () => {
  const yes = thread(message({}));
  const no = thread(message({ id: "a|inbox|9", unsubscribe: null }));
  const left = { [listKey(yes.latest)]: Date.parse("2026-11-02T00:00:00Z") };

  it("shows the command when at least one conversation can be unsubscribed from, and enables it", () => {
    expect(unsubscribeCommand([no, yes], {})).toMatchObject({ shown: true, enabled: true, again: false });
  });

  it("is hidden when none can", () => {
    expect(unsubscribeCommand([no], {}).shown).toBe(false);
  });

  it("is greyed out once every list was left, and remembers when", () => {
    expect(unsubscribeCommand([yes, no], left)).toMatchObject({ shown: true, enabled: false, doneAt: Date.parse("2026-11-02T00:00:00Z") });
  });

  it("stays enabled in a selection that still has a list to leave", () => {
    const other = thread(message({ id: "a|inbox|10", from: { name: "Deals", email: "d@shop.com" } }));
    expect(unsubscribeCommand([yes, other], left).enabled).toBe(true);
  });

  it("asks to unsubscribe again when the list keeps sending", () => {
    const later = thread(message({ date: "2026-11-05T00:00:00Z" }));
    expect(unsubscribeCommand([later], left)).toMatchObject({ enabled: true, again: true });
  });
});

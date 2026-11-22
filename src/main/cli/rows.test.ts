import { describe, expect, it, vi } from "vitest";

import type { ListQuery, ListResult, MailFolder, MessageSummary } from "@shared/types";

import { resolveRows } from "./rows";

function row(account: string, folder: MailFolder, native: string): MessageSummary {
  return {
    id: `${account}|${folder}|${native}`,
    accountId: account,
    folder,
    threadId: `t${native}`,
    from: { name: "", email: "a@b.test" },
    to: [],
    subject: native,
    snippet: "",
    date: "2026-11-20T10:00:00.000Z",
    unread: false,
    pinned: false,
    answered: false,
    hasAttachments: false,
    signal: "person",
    categoryId: null,
  };
}

function lists(cache: Record<string, MessageSummary[]>, live: Record<string, MessageSummary[]> = {}) {
  return vi.fn(async (query: ListQuery): Promise<ListResult> => {
    const key = `${query.accountIds?.[0]}|${query.folder}`;
    return { messages: (query.cacheOnly ? cache : { ...cache, ...live })[key] ?? [], errors: [] };
  });
}

describe("resolveRows", () => {
  it("answers from this computer's copy without asking a server", async () => {
    const list = lists({ "a|inbox": [row("a", "inbox", "1"), row("a", "inbox", "2")] });
    expect((await resolveRows(list, ["a|inbox|2", "a|inbox|1"])).map((found) => found.id)).toEqual(["a|inbox|2", "a|inbox|1"]);
    expect(list).toHaveBeenCalledTimes(1);
    expect(list.mock.calls[0]![0]).toMatchObject({ cacheOnly: true, accountIds: ["a"], folder: "inbox" });
  });

  it("asks the server only for what the copy lacks, once per folder", async () => {
    const list = lists({ "a|inbox": [row("a", "inbox", "1")] }, { "a|inbox": [row("a", "inbox", "1"), row("a", "inbox", "5")] });
    const found = await resolveRows(list, ["a|inbox|1", "a|inbox|5"]);
    expect(found.map((item) => item.id)).toEqual(["a|inbox|1", "a|inbox|5"]);
    expect(list.mock.calls.map(([query]) => Boolean(query.cacheOnly))).toEqual([true, false]);
  });

  it("reads each account and folder separately", async () => {
    const list = lists({ "a|inbox": [row("a", "inbox", "1")], "b|archive": [row("b", "archive", "7")] });
    const found = await resolveRows(list, ["a|inbox|1", "b|archive|7"]);
    expect(found).toHaveLength(2);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("leaves out ids that are gone or are not ids, and keeps the rest in order", async () => {
    const list = lists({ "a|inbox": [row("a", "inbox", "1")] });
    expect((await resolveRows(list, ["nonsense", "a|inbox|9", "a|inbox|1"])).map((found) => found.id)).toEqual(["a|inbox|1"]);
  });
});

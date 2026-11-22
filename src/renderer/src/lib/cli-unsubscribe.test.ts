import { beforeAll, describe, expect, it, vi } from "vitest";

import type { MessageSummary, UnsubscribeResult } from "@shared/types";

// The helpers read the window's storage at load; give them a small one.
vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem: () => undefined }, addEventListener: () => undefined, minimail: {} });

let lib: typeof import("./cli-unsubscribe");
beforeAll(async () => {
  lib = await import("./cli-unsubscribe");
});

function mail(id: string, email: string, listId: string | null = null, withList = true): MessageSummary {
  return {
    id: `a|inbox|${id}`,
    accountId: "a",
    folder: "inbox",
    threadId: `t${id}`,
    from: { name: email.split("@")[0]!, email },
    to: [],
    subject: "Deals",
    snippet: "",
    date: "2026-11-20T10:00:00.000Z",
    unread: true,
    pinned: false,
    answered: false,
    hasAttachments: false,
    signal: "newsletter",
    categoryId: null,
    unsubscribe: withList ? { url: "https://shop.test/u?token=SECRET", oneClick: true, listId } : null,
  };
}

function io(results: (ids: string[]) => UnsubscribeResult[]) {
  const remembered: string[][] = [];
  const unsubscribe = vi.fn(async (ids: string[]) => results(ids));
  return { unsubscribe, remember: (keys: readonly string[]) => void remembered.push([...keys]), remembered };
}

describe("unsubscribeForCli", () => {
  it("sends one request per list, even when several messages come from it, and remembers the lists that accepted", async () => {
    const fake = io((ids) => ids.map((id) => ({ id, status: "done" as const })));
    const outcome = await lib.unsubscribeForCli([mail("1", "deals@shop.test"), mail("2", "deals@shop.test"), mail("3", "news@paper.test")], {}, fake);
    expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
    expect(fake.unsubscribe.mock.calls[0]![0]).toHaveLength(2);
    expect(outcome).toEqual({ done: 2, manual: [], failed: [], skipped: 0, alreadyDone: 0 });
    expect(fake.remembered.flat()).toHaveLength(2);
  });

  it("names the host of a sender that only has a web page, never its address with the personal token", async () => {
    const fake = io((ids) => ids.map((id) => ({ id, status: "manual" as const, url: "https://shop.test/u?token=SECRET" })));
    const outcome = await lib.unsubscribeForCli([mail("1", "deals@shop.test")], {}, fake);
    expect(outcome.manual).toEqual([{ sender: "deals", host: "shop.test" }]);
    expect(JSON.stringify(outcome)).not.toContain("SECRET");
    expect(fake.remembered.flat()).toEqual([]);
  });

  it("reports a refusal and a missing answer per list, and remembers only the lists that accepted", async () => {
    const fake = io((ids) => [{ id: ids[0]!, status: "done" as const }, { id: ids[1]!, status: "failed" as const, error: "The sender refused (403)." }]);
    const outcome = await lib.unsubscribeForCli([mail("1", "a@one.test"), mail("2", "b@two.test"), mail("3", "c@three.test")], {}, fake);
    expect(outcome.done).toBe(1);
    expect(outcome.failed).toEqual([{ sender: "b", error: "The sender refused (403)." }, { sender: "c", error: "The mail server did not answer." }]);
    expect(fake.remembered.flat()).toHaveLength(1);
  });

  it("leaves out messages with no way to unsubscribe, and counts them", async () => {
    const fake = io((ids) => ids.map((id) => ({ id, status: "done" as const })));
    const outcome = await lib.unsubscribeForCli([mail("1", "x@none.test", null, false), mail("2", "deals@shop.test")], {}, fake);
    expect(outcome).toMatchObject({ done: 1, skipped: 1, alreadyDone: 0 });
    expect(fake.unsubscribe.mock.calls[0]![0]).toEqual(["a|inbox|2"]);
  });

  it("leaves out a list the person already left, and does not ask the sender again", async () => {
    const { listKey } = await import("@shared/unsubscribe");
    const row = mail("2", "deals@shop.test");
    const fake = io(() => []);
    const outcome = await lib.unsubscribeForCli([row], { [listKey(row)]: Date.now() }, fake);
    expect(fake.unsubscribe).not.toHaveBeenCalled();
    expect(outcome).toEqual({ done: 0, manual: [], failed: [], skipped: 0, alreadyDone: 1 });
  });

  it("does not ask anyone when there is nothing to do", async () => {
    const fake = io(() => []);
    const outcome = await lib.unsubscribeForCli([mail("1", "x@none.test", null, false)], {}, fake);
    expect(fake.unsubscribe).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ done: 0, skipped: 1 });
  });
});

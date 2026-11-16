import { describe, expect, it, vi } from "vitest";

import type { MailActionResult, MailFolder, MessageSummary } from "@shared/types";
import { MOVE_FOLDERS } from "@shared/threads";
import { MailActions } from "./mail-actions";

const folders = new Set<MailFolder>(MOVE_FOLDERS);
const accounts = new Set(["a"]);
const mail = (nativeId: string, folder: MailFolder = "inbox"): MessageSummary => ({
  id: `a|${folder}|${nativeId}`,
  accountId: "a",
  folder,
  internetId: `<${nativeId}@example.com>`,
  threadId: nativeId,
  from: { name: "Sender", email: "sender@example.com" },
  to: [],
  subject: nativeId,
  snippet: "",
  date: "2026-01-01T12:00:00Z",
  unread: true,
  pinned: false,
  answered: false,
  hasAttachments: false,
  signal: "person",
  categoryId: null,
});
const tick = async () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("mail action reconciliation", () => {
  it("keeps the last click visible and sends opposing read writes in order", async () => {
    const row = mail("1");
    let finish!: (results: MailActionResult[]) => void;
    const send = vi.fn()
      .mockImplementationOnce(() => new Promise<MailActionResult[]>((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce([{ id: row.id, status: "applied" }]);
    const actions = new MailActions(send, vi.fn(), vi.fn());
    actions.enqueue("markRead", [row], false);
    await tick();
    expect(actions.project([row], folders)[0].unread).toBe(false);
    actions.enqueue("markUnread", [row], false);
    expect(actions.project([{ ...row, unread: false }], folders)[0].unread).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    finish([{ id: row.id, status: "applied" }]);
    await tick();
    expect(send.mock.calls.map(([action]) => action)).toEqual(["markRead", "markUnread"]);
    actions.observe([row], folders, accounts, performance.now() + 1);
    expect(actions.project([{ ...row, unread: false }], folders, accounts, () => 0)[0].unread).toBe(true);
    expect(actions.project([{ ...row, unread: false }], folders)[0].unread).toBe(false);
  });

  it("cancels only the chosen message in an unsent bulk move and reports partial failures", async () => {
    const [one, two, three] = ["1", "2", "3"].map((id) => mail(id));
    const send = vi.fn().mockResolvedValue([
      { id: two.id, status: "applied", nextId: "a|archive|20" },
      { id: three.id, status: "failed", error: "Rejected" },
    ]);
    const actions = new MailActions(send, vi.fn(), vi.fn());
    actions.enqueue("archive", [one, two, three], true);
    actions.enqueue("unarchive", [actions.project([one, two, three], folders)[0]], false);
    actions.flush();
    await tick();
    expect(send.mock.calls).toEqual([["archive", [two.id, three.id]]]);
    expect(actions.project([one, two, three], folders).map((row) => [row.subject, row.folder]))
      .toEqual(expect.arrayContaining([["1", "inbox"], ["2", "archive"], ["3", "inbox"]]));
    expect(actions.events[0]).toMatchObject({ detail: "3 — Rejected", retry: expect.any(Function) });
  });

  it("uses the destination ID for a move requested while another move is in flight", async () => {
    const row = mail("1");
    let finish!: (results: MailActionResult[]) => void;
    const send = vi.fn()
      .mockImplementationOnce(() => new Promise<MailActionResult[]>((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce([{ id: "a|archive|20", status: "applied", nextId: "a|inbox|30" }]);
    const actions = new MailActions(send, vi.fn(), vi.fn());
    actions.enqueue("archive", [row], false);
    await tick();
    actions.enqueue("unarchive", actions.project([row], folders), false);
    finish([{ id: row.id, status: "applied", nextId: "a|archive|20" }]);
    await tick();
    expect(send.mock.calls).toEqual([["archive", [row.id]], ["unarchive", ["a|archive|20"]]]);
  });

  it("keeps pending pin and read changes separate from incoming flags", async () => {
    const row = mail("1");
    const send = vi.fn().mockResolvedValue([{ id: row.id, status: "applied" }]);
    const actions = new MailActions(send, vi.fn(), vi.fn());
    actions.enqueue("pin", [row], false);
    await tick();
    expect(actions.project([{ ...row, unread: false }], folders)[0]).toMatchObject({ pinned: true, unread: false });
    const pinned = { ...row, id: "a|pinned|1", folder: "pinned" as const, pinned: true };
    actions.enqueue("unpin", [pinned], false);
    expect(actions.project([pinned], new Set(["pinned"]))).toEqual([]);
    await tick();
    expect(send.mock.calls).toEqual([["pin", [row.id]], ["unpin", [row.id]]]);
  });

  it("verifies an ambiguous move before allowing an explicit retry", async () => {
    const row = mail("1", "trash");
    const send = vi.fn()
      .mockResolvedValueOnce([{ id: row.id, status: "unknown", error: "Timed out" }])
      .mockResolvedValueOnce([{ id: row.id, status: "applied", nextId: "a|inbox|20" }]);
    const actions = new MailActions(send, vi.fn(), vi.fn());
    actions.enqueue("unarchive", [row], false);
    await tick();
    expect(actions.events[0].retry).toBeUndefined();
    actions.observe([row], folders, accounts, performance.now() + 1);
    const retry = actions.events[0].retry;
    expect(retry).toBeTypeOf("function");
    expect(send).toHaveBeenCalledTimes(1);
    retry?.();
    retry?.();
    await tick();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("reports a rule moving a message back, without sending another move", async () => {
    const row = mail("1", "trash");
    const inbox = { ...row, id: "a|inbox|20", folder: "inbox" as const };
    const trash = { ...row, id: "a|trash|30" };
    const send = vi.fn().mockResolvedValue([{ id: row.id, status: "applied", nextId: inbox.id }]);
    const actions = new MailActions(send, vi.fn(), vi.fn());
    actions.enqueue("unarchive", [row], false);
    await tick();
    actions.observe([inbox], folders, accounts, performance.now() + 1);
    actions.observe([trash], folders, accounts, performance.now() + 1);
    expect(actions.project([trash], folders)[0].folder).toBe("trash");
    expect(actions.events[0].title).toBe("Server changed the message folder");
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("reportEvent", () => {
  it("puts a failure in the notifications list, newest first, and asks the window to redraw", () => {
    const update = vi.fn();
    const retry = vi.fn();
    const actions = new MailActions(vi.fn(), update, vi.fn());
    actions.reportEvent("Could not unsubscribe from News", "The sender did not answer in time.", retry);
    actions.reportEvent("Could not unsubscribe from Deals", "The sender refused the request (status 403).");
    expect(update).toHaveBeenCalledTimes(2);
    expect(actions.events.map((event) => event.title)).toEqual([
      "Could not unsubscribe from Deals",
      "Could not unsubscribe from News",
    ]);
    expect(actions.events[1]).toMatchObject({ detail: "The sender did not answer in time.", retry });
  });
});

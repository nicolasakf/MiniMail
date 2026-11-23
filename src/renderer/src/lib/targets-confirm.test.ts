import { beforeAll, describe, expect, it, vi } from "vitest";

import { groupThreads } from "@shared/threads";
import type { MessageSummary } from "@shared/types";

import type { TargetsAsk } from "./targets-confirm";

// The block list is saved through the main process; this stands in for it.
vi.stubGlobal("window", {
  addEventListener: () => undefined,
  minimail: { prefs: { set: async () => undefined } },
});

let counter = 0;
function mail(email: string, threadId: string): MessageSummary {
  counter += 1;
  return {
    id: `a|inbox|${counter}`,
    accountId: "a",
    folder: "inbox",
    threadId,
    from: { name: "", email },
    to: [],
    subject: "Hi",
    snippet: "",
    date: new Date(2026, 10, 1, 9, counter).toISOString(),
    unread: true,
    pinned: false,
    answered: false,
    hasAttachments: false,
    signal: "person",
    categoryId: null,
  };
}

const many = groupThreads([mail("ana@acme.com", "t1"), mail("bob@other.org", "t2"), mail("cy@third.net", "t3")]);
const one = groupThreads([mail("ana@acme.com", "t1")]);

let blocklist: typeof import("./blocklist");
let confirm: typeof import("./targets-confirm");
beforeAll(async () => {
  blocklist = await import("./blocklist");
  confirm = await import("./targets-confirm");
});

describe("labels", () => {
  it("end in an ellipsis when a dialog follows (several senders or domains)", () => {
    const [section] = blocklist.blockSections({ senders: [], domains: [] }, many, []);
    expect(section!.choices.map((choice) => choice.label)).toEqual(["Block 3 senders…", "Block 3 domains…"]);
    const [muted] = blocklist.muteSections(() => false, many, []);
    expect(muted!.choices.map(blocklist.muteMenuLabel)).toEqual(["3 conversations", "Everything from 3 senders…", "Everything from 3 domains…"]);
  });

  it("stay plain for one sender, one domain or the conversations", () => {
    const [section] = blocklist.blockSections({ senders: [], domains: [] }, one, []);
    expect(section!.choices.map((choice) => choice.label)).toEqual(["Block ana@acme.com", "Block @acme.com"]);
    const [muted] = blocklist.muteSections(() => false, one, []);
    expect(muted!.choices.map(blocklist.muteMenuLabel)).toEqual(["This conversation", "Everything from ana@acme.com", "Everything from @acme.com"]);
  });
});

describe("targetsAsk", () => {
  const choice = { kind: "senders", values: ["a@x.com", "b@y.com"], active: ["b@y.com"], on: false };

  it("asks for several senders or domains, never for one or for conversations", () => {
    expect(confirm.targetsAsk("Block", choice, () => undefined)?.values).toEqual(choice.values);
    expect(confirm.targetsAsk("Block", { ...choice, values: ["a@x.com"] }, () => undefined)).toBeNull();
    expect(confirm.targetsAsk("Mute", { ...choice, kind: "threads" }, () => undefined)).toBeNull();
  });
});

describe("valuesToApply", () => {
  const ask = { values: ["a@x.com", "b@y.com", "c@z.com"], active: ["b@y.com"], on: false };

  it("keeps the ticked ones and leaves out those already blocked, so Block never unblocks", () => {
    expect(confirm.valuesToApply(ask, new Set(["a@x.com", "b@y.com"]))).toEqual(["a@x.com"]);
  });

  it("keeps every ticked one when taking the command back", () => {
    const undo = { ...ask, active: ask.values, on: true };
    expect(confirm.valuesToApply(undo, new Set(["a@x.com", "c@z.com"]))).toEqual(["a@x.com", "c@z.com"]);
  });
});

describe("targetsConfirm", () => {
  it("words the dialog for each command, and for taking it back", () => {
    const block: Pick<TargetsAsk, "command" | "kind" | "values" | "on"> = { command: "Block", kind: "domains", values: ["a.com", "b.com", "c.com"], on: false };
    expect(confirm.targetsConfirm(block, 2)).toMatchObject({ title: "Block 3 domains?", confirmLabel: "Block 2 domains" });
    expect(confirm.targetsConfirm({ ...block, command: "Priority", kind: "senders" }, 1)).toMatchObject({
      title: "Mark 3 senders as priority?",
      confirmLabel: "Mark a sender",
    });
    expect(confirm.targetsConfirm({ ...block, command: "Mute", on: true }, 3).title).toBe("Unmute 3 domains?");
  });
});

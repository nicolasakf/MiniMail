import { beforeAll, describe, expect, it, vi } from "vitest";

import { groupThreads } from "@shared/threads";
import type { MessageSummary } from "@shared/types";

// The lists are saved through the main process; this stands in for it and keeps what was saved.
const saved = new Map<string, unknown>();
vi.stubGlobal("window", {
  addEventListener: () => undefined,
  minimail: { prefs: { set: async (patch: Record<string, unknown>) => void Object.entries(patch).forEach(([key, value]) => saved.set(key, value)) } },
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

const threads = groupThreads([mail("ana@acme.com", "t1"), mail("bob@acme.com", "t2"), mail("cy@other.org", "t3")]);

let lib: typeof import("./priority");
let sections: typeof import("./blocklist");
beforeAll(async () => {
  lib = await import("./priority");
  sections = await import("./blocklist");
});

describe("priorityChoiceSections", () => {
  it("offers the conversations, then the senders and the domains of the whole selection", () => {
    const [section] = sections.priorityChoiceSections(() => false, threads, []);
    expect(section!.choices.map((choice) => choice.kind)).toEqual(["threads", "senders", "domains"]);
    expect(section!.choices[0]!.values).toHaveLength(3);
    expect(section!.choices[1]!.values.sort()).toEqual(["ana@acme.com", "bob@acme.com", "cy@other.org"]);
    expect(section!.choices[2]!.values).toHaveLength(2);
  });

  it("is on only when every value is already marked", () => {
    const [partly] = sections.priorityChoiceSections((kind, value) => kind === "senders" && value === "ana@acme.com", threads, []);
    expect(partly!.choices.find((choice) => choice.kind === "senders")!.on).toBe(false);
    const [all] = sections.priorityChoiceSections(() => true, threads, []);
    expect(all!.choices.every((choice) => choice.on)).toBe(true);
  });

  it("leaves the user's own address out", () => {
    const [section] = sections.priorityChoiceSections(() => false, threads, ["ana@acme.com"]);
    expect(section!.choices.find((choice) => choice.kind === "senders")!.values).not.toContain("ana@acme.com");
  });
});

describe("setPriority", () => {
  it("marks several senders at once, then takes the marks back", () => {
    lib.setPriority("senders", ["ana@acme.com", "bob@acme.com"], true);
    expect(saved.get("priority")).toMatchObject({ senders: ["ana@acme.com", "bob@acme.com"] });
    lib.setPriority("senders", ["ana@acme.com", "bob@acme.com"], false);
    expect(saved.get("priority")).toMatchObject({ senders: [] });
  });

  it("skips what is already in the wanted state", () => {
    lib.setPriority("threads", ["a:t1"], true);
    lib.setPriority("threads", ["a:t1", "a:t2"], true);
    expect(saved.get("priority")).toMatchObject({ threads: ["a:t1", "a:t2"] });
  });
});

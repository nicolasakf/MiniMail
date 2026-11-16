import { describe, expect, it } from "vitest";

import {
  EMPTY_PRIORITY,
  isPriorityThread,
  parsePriorityList,
  priorityInbox,
  priorityReason,
  togglePriorityEntry,
  withoutBlocked,
} from "./priority";
import { groupThreads } from "./threads";
import type { MessageSummary } from "./types";

let counter = 0;
function message(overrides: Partial<MessageSummary> & { email?: string } = {}): MessageSummary {
  counter += 1;
  const { email = "ana@acme.com", ...rest } = overrides;
  return {
    id: `a|inbox|${counter}`,
    accountId: "a",
    folder: "inbox",
    threadId: `t${counter}`,
    from: { name: "Ana", email },
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
    ...rest,
  };
}

describe("togglePriorityEntry", () => {
  it("adds, then removes, normalizing case", () => {
    const added = togglePriorityEntry(EMPTY_PRIORITY, "senders", " Ana@Acme.com ");
    expect(added.senders).toEqual(["ana@acme.com"]);
    expect(togglePriorityEntry(added, "senders", "ANA@acme.com").senders).toEqual([]);
  });

  it("never keeps a sender and its domain together", () => {
    const sender = togglePriorityEntry(EMPTY_PRIORITY, "senders", "ana@acme.com");
    const domain = togglePriorityEntry(sender, "domains", "acme.com");
    expect(domain).toEqual({ threads: [], senders: [], domains: ["acme.com"] });
    const back = togglePriorityEntry(domain, "senders", "bob@mail.acme.com");
    expect(back).toEqual({ threads: [], senders: ["bob@mail.acme.com"], domains: [] });
  });

  it("leaves senders of other domains alone when a domain is added", () => {
    const list = togglePriorityEntry(EMPTY_PRIORITY, "senders", "bob@other.org");
    expect(togglePriorityEntry(list, "domains", "acme.com").senders).toEqual(["bob@other.org"]);
  });

  it("keeps a conversation together with a sender or a domain", () => {
    const list = togglePriorityEntry(togglePriorityEntry(EMPTY_PRIORITY, "threads", "a:1"), "domains", "acme.com");
    expect(list).toEqual({ threads: ["a:1"], senders: [], domains: ["acme.com"] });
  });

  it("ignores blank values", () => {
    expect(togglePriorityEntry(EMPTY_PRIORITY, "domains", "  ")).toBe(EMPTY_PRIORITY);
  });
});

describe("priorityReason", () => {
  it("matches the conversation, the sender and the domain", () => {
    const m = message();
    expect(priorityReason({ ...EMPTY_PRIORITY, threads: [`a:${m.threadId}`] }, m)).toBe("threads");
    expect(priorityReason({ ...EMPTY_PRIORITY, senders: ["ana@acme.com"] }, m)).toBe("senders");
    expect(priorityReason({ ...EMPTY_PRIORITY, domains: ["acme.com"] }, m)).toBe("domains");
    expect(priorityReason(EMPTY_PRIORITY, m)).toBeNull();
  });

  it("matches any subdomain of a priority domain", () => {
    const m = message({ email: "billing@mail.acme.com" });
    expect(priorityReason({ ...EMPTY_PRIORITY, domains: ["acme.com"] }, m)).toBe("domains");
  });
});

describe("priorityInbox", () => {
  const domains = { ...EMPTY_PRIORITY, domains: ["acme.com"] };

  it("lists unread conversations from a priority domain", () => {
    const threads = groupThreads([message(), message({ email: "bob@other.org" })]);
    expect(priorityInbox(domains, threads).map((t) => t.latest.from.email)).toEqual(["ana@acme.com"]);
  });

  it("leaves a conversation once it has been read", () => {
    expect(priorityInbox(domains, groupThreads([message({ unread: false })]))).toEqual([]);
  });

  it("shows a marked conversation when a new message arrives in it", () => {
    const first = message({ email: "bob@other.org", unread: false });
    const reply = message({ email: "bob@other.org", threadId: first.threadId });
    const list = { ...EMPTY_PRIORITY, threads: [`a:${first.threadId}`] };
    expect(priorityInbox(list, groupThreads([first]))).toEqual([]);
    expect(priorityInbox(list, groupThreads([first, reply]))).toHaveLength(1);
  });

  it("ignores unread mail outside the Inbox and the user's own mail", () => {
    const archived = message({ folder: "archive" });
    const own = message({ email: "me@home.org" });
    const list = { ...EMPTY_PRIORITY, domains: ["acme.com", "home.org"] };
    expect(priorityInbox(list, groupThreads([archived, own]), ["me@home.org"])).toEqual([]);
  });

  it("is empty when nothing is marked", () => {
    expect(priorityInbox(EMPTY_PRIORITY, groupThreads([message()]))).toEqual([]);
  });
});

describe("isPriorityThread", () => {
  it("is true when any message comes from a priority sender", () => {
    const first = message();
    const [thread] = groupThreads([first, message({ email: "bob@other.org", threadId: first.threadId })]);
    expect(isPriorityThread({ ...EMPTY_PRIORITY, senders: ["ana@acme.com"] }, thread!)).toBe(true);
  });
});

describe("parsePriorityList", () => {
  it("drops malformed entries and duplicates", () => {
    expect(parsePriorityList({ threads: ["a:1", 4, "a:1"], senders: "x", domains: ["ACME.com"] })).toEqual({
      threads: ["a:1"],
      senders: [],
      domains: ["acme.com"],
    });
    expect(parsePriorityList(null)).toEqual(EMPTY_PRIORITY);
  });
});

describe("priority and block", () => {
  const list = { ...EMPTY_PRIORITY, domains: ["acme.com"], senders: ["ana@acme.com"] };

  it("ignores blocked mail: a blocked sender inside a priority domain is not priority", () => {
    const domainOnly = { ...EMPTY_PRIORITY, domains: ["acme.com"], blocklist: { senders: ["bob@acme.com"], domains: [] } };
    expect(priorityReason(domainOnly, message({ email: "bob@acme.com" }))).toBeNull();
    expect(priorityReason(domainOnly, message({ email: "eve@acme.com" }))).toBe("domains");
  });

  it("keeps a marked conversation priority", () => {
    const m = message({ email: "bob@acme.com" });
    const marked = { ...EMPTY_PRIORITY, threads: ["a:" + m.threadId], blocklist: { senders: ["bob@acme.com"], domains: [] } };
    expect(priorityReason(marked, m)).toBe("threads");
  });

  it("drops a blocked sender's mark, and a blocked domain's mark with its senders", () => {
    expect(withoutBlocked(list, "senders", "Ana@acme.com")).toEqual({ ...list, senders: [] });
    expect(withoutBlocked(list, "domains", "acme.com")).toEqual({ ...list, domains: [], senders: [] });
  });

  it("blocking one sender leaves the domain marked", () => {
    expect(withoutBlocked({ ...EMPTY_PRIORITY, domains: ["acme.com"] }, "senders", "bob@acme.com").domains).toEqual(["acme.com"]);
  });
});

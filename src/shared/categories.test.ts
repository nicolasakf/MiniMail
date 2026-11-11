import { describe, expect, it } from "vitest";

import { categorySchema } from "./schemas";

import {
  categoryProblems,
  defaultCategories,
  iconFor,
  MAX_CATEGORIES,
  NO_CATEGORY_NAME,
  ruleBasedCategoryId,
  senderDomain,
} from "./categories";
import { buildSenders, groupSendersByDomain, threadsFromDomain, threadsFromSender } from "./sender-list";
import { groupThreads } from "./threads";
import type { MessageSummary } from "./types";

function msg(overrides: Partial<MessageSummary> & { id: string }): MessageSummary {
  return {
    accountId: "a1",
    folder: "inbox",
    threadId: overrides.id,
    from: { name: "Sam", email: "sam@example.com" },
    to: [],
    subject: "Hello",
    snippet: "",
    date: new Date(2026, 10, 9, 12).toISOString(),
    unread: false,
    pinned: false,
    answered: false,
    hasAttachments: false,
    signal: "person",
    categoryId: null,
    ...overrides,
  };
}

describe("default categories", () => {
  it("ships invitations, newsletters, ads, notifications and verification codes, all with criteria", () => {
    const categories = defaultCategories();
    expect(categories.map((c) => c.name)).toEqual([
      "Invitations",
      "Newsletters",
      "Ads",
      "Notifications",
      "Verification codes",
    ]);
    expect(categoryProblems(categories)).toEqual([]);
  });

  it("gives every built-in an icon, and older saved built-ins the same one", () => {
    expect(defaultCategories().every((c) => typeof c.icon === "string")).toBe(true);
    expect(iconFor({ id: "ads" })).toBe("Megaphone");
    expect(iconFor({ id: "ads", icon: "Tag" })).toBe("Tag");
    expect(iconFor({ id: "my-own" })).toBeUndefined();
  });

  it("accepts Lucide-style icon names and rejects anything else", () => {
    const base = { id: "x", name: "X", criteria: "Something specific enough.", hue: 10 };
    expect(categorySchema.safeParse({ ...base, icon: "CalendarPlus" }).success).toBe(true);
    expect(categorySchema.safeParse(base).success).toBe(true);
    for (const icon of ["calendar-plus", "<script>", "", "A".repeat(80)]) {
      expect(categorySchema.safeParse({ ...base, icon }).success, icon).toBe(false);
    }
  });

  it("returns copies, so edits never leak into the defaults", () => {
    const first = defaultCategories();
    first[0].criteria = "changed";
    expect(defaultCategories()[0].criteria).not.toBe("changed");
  });
});

describe("categoryProblems", () => {
  const ok = { id: "x", name: "Receipts", hue: 10, criteria: "Purchase receipts and invoices." };

  it("requires criteria", () => {
    expect(categoryProblems([{ ...ok, criteria: "  short " }])[0]).toMatch(/describe what belongs/);
    expect(categoryProblems([{ ...ok, criteria: "" }])).not.toEqual([]);
  });

  it("requires a name, unique ignoring case, and rejects the reserved one", () => {
    expect(categoryProblems([{ ...ok, name: "  " }])[0]).toMatch(/give it a name/);
    expect(categoryProblems([ok, { ...ok, id: "y", name: "receipts" }])[0]).toMatch(/already has this name/);
    expect(categoryProblems([{ ...ok, name: NO_CATEGORY_NAME.toUpperCase() }])[0]).toMatch(/reserved/);
  });

  it("caps the number of categories", () => {
    const many = Array.from({ length: MAX_CATEGORIES + 1 }, (_, i) => ({ ...ok, id: `c${i}`, name: `Cat ${i}` }));
    expect(categoryProblems(many)[0]).toMatch(/At most/);
  });
});

describe("ruleBasedCategoryId", () => {
  it("maps header signals to the default categories the user still has", () => {
    const categories = defaultCategories();
    expect(ruleBasedCategoryId("newsletter", categories)).toBe("newsletters");
    expect(ruleBasedCategoryId("invitation-response", categories)).toBe("invitations");
    expect(ruleBasedCategoryId("person", categories)).toBeNull();
    expect(ruleBasedCategoryId("notification", categories.filter((c) => c.id !== "notifications"))).toBeNull();
  });
});

describe("senderDomain", () => {
  it("groups subdomains under the organization", () => {
    expect(senderDomain("a@mail.example.com")).toBe("example.com");
    expect(senderDomain("a@news.Example.COM")).toBe("example.com");
    expect(senderDomain("a@example.com")).toBe("example.com");
  });

  it("keeps three labels under two-part public suffixes", () => {
    expect(senderDomain("a@news.bbc.co.uk")).toBe("bbc.co.uk");
    expect(senderDomain("a@shop.example.com.br")).toBe("example.com.br");
  });

  it("copes with malformed addresses", () => {
    expect(senderDomain("not-an-address")).toBe("unknown");
    expect(senderDomain("a@")).toBe("unknown");
  });
});

describe("sender list", () => {
  const at = (hour: number) => new Date(2026, 10, 9, hour).toISOString();
  const threads = groupThreads([
    msg({ id: "1", from: { name: "Ana", email: "ana@acme.com" }, date: at(9) }),
    msg({ id: "2", from: { name: "Ana Lima", email: "Ana@acme.com" }, date: at(12), unread: true }),
    msg({ id: "3", from: { name: "Bo", email: "bo@mail.acme.com" }, date: at(10) }),
    // One conversation with two senders from different domains.
    msg({ id: "4", threadId: "t", from: { name: "Cy", email: "cy@other.org" }, date: at(8) }),
    msg({ id: "5", threadId: "t", from: { name: "", email: "bo@mail.acme.com" }, date: at(11) }),
  ]);
  const ids = (list: typeof threads) => list.map((t) => t.messages[0].id);

  it("lists each address once, most recent first, with its latest name", () => {
    expect(buildSenders(threads).map((s) => [s.key, s.name, s.count, s.unread])).toEqual([
      ["ana@acme.com", "Ana Lima", 2, true],
      ["bo@mail.acme.com", "bo@mail.acme.com", 2, false],
      ["cy@other.org", "Cy", 1, false],
    ]);
  });

  it("finds every conversation a sender wrote in, newest first", () => {
    expect(ids(threadsFromSender(threads, "ana@acme.com"))).toEqual(["2", "1"]);
    expect(ids(threadsFromSender(threads, "bo@mail.acme.com"))).toEqual(["4", "3"]);
    expect(threadsFromSender(threads, "nobody@acme.com")).toEqual([]);
  });

  it("finds every conversation with mail from a domain, subdomains included", () => {
    expect(ids(threadsFromDomain(threads, "acme.com"))).toEqual(["2", "4", "3", "1"]);
    expect(ids(threadsFromDomain(threads, "other.org"))).toEqual(["4"]);
  });

  it("groups senders by organization domain, counting a conversation once per domain", () => {
    const groups = groupSendersByDomain(buildSenders(threads), threads);
    expect(groups.map((g) => [g.domain, g.count, g.unread, g.senders.map((s) => s.key)])).toEqual([
      ["acme.com", 4, true, ["ana@acme.com", "bo@mail.acme.com"]],
      ["other.org", 1, false, ["cy@other.org"]],
    ]);
  });

  it("returns nothing for no threads", () => {
    expect(buildSenders([])).toEqual([]);
    expect(groupSendersByDomain([], [])).toEqual([]);
  });
});

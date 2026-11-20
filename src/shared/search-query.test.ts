import { describe, expect, it } from "vitest";

import {
  applySuggestion,
  joinSearch,
  matchesSearch,
  parseSearch,
  parseSearchDate,
  splitSearch,
  suggestSearch,
  tokenizeSearch,
  type SearchLookups,
} from "./search-query";
import type { MessageSummary } from "./types";

function message(overrides: Partial<MessageSummary> = {}): MessageSummary {
  return {
    id: "a|inbox|1",
    accountId: "a",
    folder: "inbox",
    threadId: "t1",
    from: { name: "Alice Martin", email: "alice@acme.com" },
    to: [{ name: "Bob", email: "bob@home.org" }],
    subject: "Weekly report",
    snippet: "Numbers for the week",
    date: "2026-11-10T12:00:00",
    unread: true,
    pinned: false,
    answered: false,
    hasAttachments: false,
    signal: "person",
    categoryId: null,
    ...overrides,
  };
}

const lookups: SearchLookups = {
  accountNames: (id) => (id === "a" ? "me@work.com" : "me@home.org"),
  categoryName: (id) => (id === "c1" ? "Receipts" : "Travel"),
  isPriority: (m) => m.from.email === "alice@acme.com",
  now: new Date(2026, 10, 19, 15, 30),
};

const hits = (input: string, m: MessageSummary = message()) => matchesSearch(m, parseSearch(input), lookups);

describe("tokenizeSearch", () => {
  it("splits on spaces and keeps quoted text together", () => {
    expect(tokenizeSearch('a  subject:"weekly report" b').map((t) => t.text)).toEqual(["a", "subject:weekly report", "b"]);
  });

  it("keeps the place of each word, and an open quote runs to the end", () => {
    expect(tokenizeSearch('ab from:"al')).toEqual([
      { start: 0, end: 2, text: "ab", quoted: false },
      { start: 3, end: 11, text: "from:al", quoted: true },
    ]);
  });

  it("gives a field with no value the word after it", () => {
    expect(tokenizeSearch("from: alice x").map((t) => t.text)).toEqual(["from:alice", "x"]);
    expect(tokenizeSearch("from: alice")[0]).toMatchObject({ start: 0, end: 11 });
  });

  it("does not take a field, a command or nothing as the value", () => {
    expect(tokenizeSearch("from: is:unread").map((t) => t.text)).toEqual(["from:", "is:unread"]);
    expect(tokenizeSearch("from: /is").map((t) => t.text)).toEqual(["from:", "/is"]);
    expect(tokenizeSearch("from:").map((t) => t.text)).toEqual(["from:"]);
  });
});

describe("parseSearch", () => {
  it("separates plain words from field filters", () => {
    expect(parseSearch("Invoice FROM:Alice is:unread")).toEqual({
      words: ["invoice"],
      filters: [
        { field: "from", values: ["alice"] },
        { field: "is", values: ["unread"] },
      ],
    });
  });

  it("treats an unknown field as a plain word", () => {
    expect(parseSearch("re:meeting 10:30").words).toEqual(["re:meeting", "10:30"]);
  });

  it("reads commas as alternatives, unless quoted", () => {
    expect(parseSearch("from:alice, bob,,").filters).toEqual([{ field: "from", values: ["alice"] }]); // "bob,," is a word
    expect(parseSearch("from:alice,bob").filters).toEqual([{ field: "from", values: ["alice", "bob"] }]);
    expect(parseSearch('from:"Smith, John"').filters).toEqual([{ field: "from", values: ["smith, john"] }]);
  });

  it("reads a value after a space as part of its field", () => {
    expect(parseSearch("from: alice invoice")).toEqual({ words: ["invoice"], filters: [{ field: "from", values: ["alice"] }] });
  });

  it("ignores a filter with no value yet and a command being typed", () => {
    expect(parseSearch("from: /fr /")).toEqual({ words: [], filters: [] });
  });

  it("keeps a slash inside a word", () => {
    expect(parseSearch("11/19 /usr/bin").words).toEqual(["11/19", "/usr/bin"]);
  });
});

describe("matchesSearch", () => {
  it("matches plain words anywhere, as before", () => {
    expect(hits("report alice")).toBe(true);
    expect(hits("report zebra")).toBe(false);
  });

  it("matches from and to by name or address", () => {
    expect(hits("from:alice")).toBe(true);
    expect(hits("from:acme.com")).toBe(true);
    expect(hits("from:bob")).toBe(false);
    expect(hits("to:bob@home")).toBe(true);
    expect(hits("to:alice")).toBe(false);
  });

  it("matches the subject only", () => {
    expect(hits('subject:"weekly rep"')).toBe(true);
    expect(hits("subject:numbers")).toBe(false); // that word is only in the snippet
  });

  it("accepts any value of a comma list", () => {
    expect(hits("from:bob,alice")).toBe(true);
    expect(hits("from:bob,carol")).toBe(false);
    expect(hits("is:pinned,unread")).toBe(true);
    expect(hits("is:pinned,read")).toBe(false);
  });

  it("needs every field and accepts either value of one text field", () => {
    expect(hits("from:alice subject:report")).toBe(true);
    expect(hits("from:alice subject:invoice")).toBe(false);
    expect(hits("from:bob from:alice")).toBe(true);
    expect(hits("from:bob from:carol")).toBe(false);
  });

  it("needs every condition of is, has and dates", () => {
    expect(hits("is:unread is:pinned")).toBe(false);
    expect(hits("is:unread is:priority")).toBe(true);
    expect(hits("is:read")).toBe(false);
    expect(hits("is:replied", message({ answered: true }))).toBe(true);
  });

  it("finds attachments", () => {
    expect(hits("has:attachment")).toBe(false);
    expect(hits("has:attachment", message({ hasAttachments: true }))).toBe(true);
  });

  it("filters by folder", () => {
    expect(hits("in:inbox")).toBe(true);
    expect(hits("in:sent")).toBe(false);
    expect(hits("in:archive in:inbox")).toBe(true);
  });

  it("filters by category name, or none", () => {
    expect(hits("category:rec", message({ categoryId: "c1" }))).toBe(true);
    expect(hits("category:rec", message({ categoryId: "c2" }))).toBe(false);
    expect(hits("category:rec")).toBe(false);
    expect(hits("category:none")).toBe(true);
    expect(hits("category:none", message({ categoryId: "c1" }))).toBe(false);
  });

  it("filters by account address", () => {
    expect(hits("account:work")).toBe(true);
    expect(hits("account:home")).toBe(false);
  });

  it("filters by date", () => {
    expect(hits("after:2026-11-10")).toBe(true);
    expect(hits("after:2026-11-11")).toBe(false);
    expect(hits("before:2026-11-11")).toBe(true);
    expect(hits("before:2026-11-10")).toBe(false);
    expect(hits("after:2026-11-01 before:2026-11-30")).toBe(true);
    expect(hits("after:week")).toBe(false); // since 12 November: the 10th is older
    expect(hits("after:month")).toBe(true);
  });

  it("does not filter on a date still being typed", () => {
    expect(hits("after:2026-1")).toBe(true);
  });

  it("lets everything through for an empty query", () => {
    expect(hits("")).toBe(true);
    expect(hits("from:")).toBe(true);
  });
});

describe("parseSearchDate", () => {
  const now = new Date(2026, 2, 31, 18, 0);

  it("reads the keywords as local midnights", () => {
    expect(parseSearchDate("today", now)).toBe(new Date(2026, 2, 31).getTime());
    expect(parseSearchDate("yesterday", now)).toBe(new Date(2026, 2, 30).getTime());
    expect(parseSearchDate("week", now)).toBe(new Date(2026, 2, 24).getTime());
    expect(parseSearchDate("year", now)).toBe(new Date(2025, 2, 31).getTime());
  });

  it("reads ISO dates and refuses impossible ones", () => {
    expect(parseSearchDate("2026-3-5", now)).toBe(new Date(2026, 2, 5).getTime());
    expect(parseSearchDate("2026-02-31", now)).toBeNull();
    expect(parseSearchDate("soon", now)).toBeNull();
  });
});

describe("suggestSearch", () => {
  const extra = { category: [{ value: "Receipts", hint: "" }], account: [] };

  it("offers every field after a slash, leaving out those with nothing to pick", () => {
    const found = suggestSearch("/", 1, extra);
    expect(found?.kind).toBe("fields");
    if (found?.kind !== "fields") return;
    expect(found.fields.map((f) => f.name)).toEqual(["from", "to", "subject", "has", "is", "in", "category", "after", "before"]);
  });

  it("narrows the fields by what follows the slash", () => {
    const found = suggestSearch("invoice /s", 10, extra);
    expect(found?.kind === "fields" && found.fields.map((f) => f.name)).toEqual(["subject"]);
  });

  it("offers nothing for a slash that matches no field, or inside a word", () => {
    expect(suggestSearch("/zzz", 4, extra)).toBeNull();
    expect(suggestSearch("11/19", 5, extra)).toBeNull();
  });

  it("offers the values of a field", () => {
    const found = suggestSearch("is:un", 5, extra);
    expect(found?.kind === "values" && found.values.map((v) => v.value)).toEqual(["unread"]);
    const cats = suggestSearch("category:", 9, extra);
    expect(cats?.kind === "values" && cats.values.map((v) => v.value)).toEqual(["Receipts"]);
  });

  it("offers values for the last piece of a comma list", () => {
    const found = suggestSearch("category:Receipts,Re", 20, extra);
    expect(found).toMatchObject({ kind: "values", typed: "Re", prefix: "Receipts," });
  });

  it("stops offering once the value is complete", () => {
    const found = suggestSearch("is:unread", 9, extra);
    expect(found?.kind === "values" && found.values).toEqual([]);
  });

  it("follows the cursor to the word it is in", () => {
    const found = suggestSearch("is:un from:al", 5, extra);
    expect(found?.kind === "values" && found.field).toBe("is");
  });

  it("says nothing between words or for plain text", () => {
    expect(suggestSearch("invoice ", 8, extra)).toBeNull();
    expect(suggestSearch("invoice", 7, extra)).toBeNull();
  });
});

describe("applySuggestion", () => {
  it("turns a command into its field and waits for the value", () => {
    const token = { start: 8, end: 11, text: "/fr", quoted: false };
    expect(applySuggestion("invoice /fr", token, { field: "from" })).toEqual({ text: "invoice from:", caret: 13 });
  });

  it("keeps the words after a field", () => {
    const token = { start: 0, end: 3, text: "/fr", quoted: false };
    expect(applySuggestion("/fr invoice", token, { field: "from" })).toEqual({ text: "from: invoice", caret: 5 });
  });

  it("writes a value, quoted when it has spaces, and moves on", () => {
    const token = { start: 0, end: 7, text: "from:al", quoted: false };
    expect(applySuggestion("from:al", token, { field: "from", value: "alice@acme.com" })).toEqual({
      text: "from:alice@acme.com ",
      caret: 20,
    });
    expect(applySuggestion("category:tr rest", { start: 0, end: 11, text: "category:tr", quoted: false }, { field: "category", value: "Trip planning" })).toEqual({
      text: 'category:"Trip planning" rest',
      caret: 25,
    });
  });
});

describe("splitSearch and joinSearch", () => {
  it("makes a finished filter a chip and leaves the rest as text", () => {
    expect(splitSearch("invoice from:alice is:unread ")).toEqual({
      chips: [
        { field: "from", value: "alice", quoted: false },
        { field: "is", value: "unread", quoted: false },
      ],
      draft: "invoice ",
    });
  });

  it("keeps the filter still being typed as text", () => {
    expect(splitSearch("from:alice is:un")).toEqual({
      chips: [{ field: "from", value: "alice", quoted: false }],
      draft: "is:un",
    });
    expect(splitSearch("from:al")).toEqual({ chips: [], draft: "from:al" });
  });

  it("leaves text without chips exactly as typed", () => {
    expect(splitSearch("a  b ")).toEqual({ chips: [], draft: "a  b " });
    expect(splitSearch("from: ")).toEqual({ chips: [], draft: "from: " });
    expect(splitSearch("/fr")).toEqual({ chips: [], draft: "/fr" });
  });

  it("takes a value after a space, and a quoted value with spaces, into the chip", () => {
    expect(splitSearch('from: alice subject:"weekly report" ').chips).toEqual([
      { field: "from", value: "alice", quoted: false },
      { field: "subject", value: "weekly report", quoted: true },
    ]);
  });

  it("does not finish a quote that is still open", () => {
    expect(splitSearch('subject:"weekly ')).toEqual({ chips: [], draft: 'subject:"weekly ' });
  });

  it("keeps the case and commas of a chip", () => {
    expect(splitSearch("from:Alice@X.com,bob ").chips[0].value).toBe("Alice@X.com,bob");
  });

  it("joins back into text that splits the same way", () => {
    const parts = splitSearch("invoice from:alice is:unread ");
    const text = joinSearch(parts.chips, parts.draft);
    expect(text).toBe("from:alice is:unread invoice ");
    expect(splitSearch(text)).toEqual(parts);
    expect(joinSearch(parts.chips, "")).toBe("from:alice is:unread ");
    expect(joinSearch([], "abc")).toBe("abc");
  });

  it("keeps a quoted comma value quoted", () => {
    const parts = splitSearch('from:"Smith,John" ');
    expect(joinSearch(parts.chips, "")).toBe('from:"Smith,John" ');
  });
});

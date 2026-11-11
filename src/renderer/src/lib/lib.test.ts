import { describe, expect, it } from "vitest";

import type { Account, MessageDetail, MessageSummary } from "@shared/types";

import { buildReplySeed, formatRecipients, parseRecipients } from "./compose";
import { formatListTime, initialsOf, normalizeSubject, senderHue } from "./format";
import { applyOptimistic } from "./optimistic";

function summary(id: string, overrides: Partial<MessageSummary> = {}): MessageSummary {
  return {
    id,
    accountId: "a",
    folder: "inbox",
    threadId: id,
    from: { name: "Sam", email: "sam@x.com" },
    to: [],
    subject: "Hi",
    snippet: "",
    date: new Date(2026, 10, 9, 12).toISOString(),
    unread: true,
    pinned: false,
    answered: false,
    hasAttachments: false,
    signal: "person",
    categoryId: null,
    ...overrides,
  };
}

describe("applyOptimistic", () => {
  const rows = [summary("1"), summary("2"), summary("3", { pinned: true })];

  it("removes moved or deleted rows", () => {
    expect(applyOptimistic(rows, "archive", new Set(["1", "2"]), "inbox").map((m) => m.id)).toEqual(["3"]);
    expect(applyOptimistic(rows, "trash", new Set(["3"]), "inbox")).toHaveLength(2);
  });

  it("patches read and pin flags in place", () => {
    const read = applyOptimistic(rows, "markRead", new Set(["1"]), "inbox");
    expect(read.find((m) => m.id === "1")?.unread).toBe(false);
    expect(read.find((m) => m.id === "2")?.unread).toBe(true);
    expect(applyOptimistic(rows, "pin", new Set(["1"]), "inbox").find((m) => m.id === "1")?.pinned).toBe(true);
  });

  it("drops a row from the Pinned view when it is unpinned", () => {
    expect(applyOptimistic(rows, "unpin", new Set(["3"]), "pinned").map((m) => m.id)).toEqual(["1", "2"]);
    expect(applyOptimistic(rows, "unpin", new Set(["3"]), "inbox").find((m) => m.id === "3")?.pinned).toBe(false);
  });
});

describe("recipients", () => {
  it("parses plain, named and mixed lists", () => {
    const { contacts, invalid } = parseRecipients('a@x.com, Bob Stone <b@y.com>; "Cy, Jr" <c@z.com>\nnot-an-address');
    expect(contacts).toEqual([
      { name: "", email: "a@x.com" },
      { name: "Bob Stone", email: "b@y.com" },
      { name: "Cy, Jr", email: "c@z.com" },
    ]);
    expect(invalid).toEqual(["not-an-address"]);
  });

  it("round-trips through formatRecipients", () => {
    const text = formatRecipients([
      { name: "", email: "a@x.com" },
      { name: "Bob", email: "b@y.com" },
    ]);
    expect(text).toBe("a@x.com, Bob <b@y.com>");
    expect(parseRecipients(text).contacts).toHaveLength(2);
  });
});

describe("buildReplySeed", () => {
  const accounts: Account[] = [
    { id: "a", provider: "gmail", email: "me@x.com", displayName: "Me", auth: "oauth", hue: 1 },
  ];
  const message: MessageDetail = {
    ...summary("m1", {
      from: { name: "Sam", email: "sam@x.com" },
      to: [
        { name: "Me", email: "me@x.com" },
        { name: "Pat", email: "pat@x.com" },
      ],
      subject: "Plans",
    }),
    cc: [{ name: "Lee", email: "lee@x.com" }],
    replyTo: null,
    messageId: "<m1@x.com>",
    references: ["<root@x.com>"],
    html: null,
    text: "Line one\nLine two",
    attachments: [],
  };

  it("replies to the sender with a quoted body and Re: subject", () => {
    const seed = buildReplySeed(message, "reply", accounts);
    expect(seed.to).toEqual([{ name: "Sam", email: "sam@x.com" }]);
    expect(seed.subject).toBe("Re: Plans");
    expect(seed.body).toContain("> Line one\n> Line two");
    expect(seed.inReplyTo).toMatchObject({ messageId: "<m1@x.com>", mode: "reply" });
  });

  it("reply-all drops the user's own address and keeps others", () => {
    const seed = buildReplySeed(message, "replyAll", accounts);
    expect(seed.to.map((c) => c.email)).toEqual(["sam@x.com", "pat@x.com"]);
    expect(seed.cc.map((c) => c.email)).toEqual(["lee@x.com"]);
  });

  it("does not stack Re: prefixes and prefixes forwards with Fwd:", () => {
    expect(buildReplySeed({ ...message, subject: "Re: Plans" }, "reply", accounts).subject).toBe("Re: Plans");
    const forward = buildReplySeed(message, "forward", accounts);
    expect(forward.subject).toBe("Fwd: Plans");
    expect(forward.to).toEqual([]);
    expect(forward.body).toContain("Forwarded message");
  });
});

describe("format helpers", () => {
  const now = new Date(2026, 10, 9, 15);
  it("shows a clock time today and a short date otherwise", () => {
    expect(formatListTime(new Date(2026, 10, 9, 12, 31).toISOString(), now)).toMatch(/12:31\s?PM/);
    expect(formatListTime(new Date(2026, 10, 8, 12).toISOString(), now)).toBe("Nov 8");
    expect(formatListTime(new Date(2025, 10, 8, 12).toISOString(), now)).toBe("Nov 8, 2025");
  });

  it("strips stacked reply and forward prefixes from subjects", () => {
    expect(normalizeSubject("Re: Re: FWD: Plans")).toBe("Plans");
    expect(normalizeSubject("Reorganizing the office")).toBe("Reorganizing the office");
    expect(normalizeSubject("Re:")).toBe("Re:");
  });

  it("derives initials and a stable hue", () => {
    expect(initialsOf({ name: "Samantha Reed", email: "s@x.com" })).toBe("SR");
    expect(initialsOf({ name: "", email: "yunwei@x.com" })).toBe("Y");
    expect(senderHue("a@x.com")).toBe(senderHue("a@x.com"));
  });
});

import { describe, expect, it } from "vitest";

import { buildContactIndex, currentToken, entryLabel, guessName, searchContacts } from "./contacts";
import type { MessageSummary } from "./types";

const ME = new Set(["me@x.com"]);

function msg(
  id: string,
  from: { name: string; email: string },
  to: { name: string; email: string }[],
  day: number,
): MessageSummary {
  return {
    id,
    accountId: "a",
    folder: from.email === "me@x.com" ? "sent" : "inbox",
    threadId: id,
    from,
    to,
    subject: "s",
    snippet: "",
    date: new Date(2026, 10, day).toISOString(),
    unread: false,
    pinned: false,
    answered: false,
    hasAttachments: false,
    signal: "person",
    categoryId: null,
  };
}

const me = { name: "Me", email: "me@x.com" };
const index = buildContactIndex(
  [
    msg("1", { name: "Sam Reed", email: "sam@x.com" }, [me], 1),
    msg("2", { name: "Sam Reed", email: "sam@x.com" }, [me], 2),
    msg("3", me, [{ name: "", email: "sandra@y.com" }], 3),
    msg("4", { name: "Sandy Only", email: "sandy@z.com" }, [me], 4),
    msg("5", { name: "", email: "noreply@shop.com" }, [me], 5),
    msg("6", me, [{ name: "Sam Reed", email: "SAM@x.com" }, { name: "Pat", email: "pat@y.com" }], 6),
  ],
  ME,
);

describe("buildContactIndex", () => {
  it("counts sent and received per address, ignoring case and the user's own addresses", () => {
    const sam = index.find((entry) => entry.email === "sam@x.com");
    expect(sam).toMatchObject({ name: "Sam Reed", sentTo: 1, receivedFrom: 2 });
    expect(index.some((entry) => entry.email === "me@x.com")).toBe(false);
  });

  it("drops automated senders nobody wrote to", () => {
    expect(index.some((entry) => entry.email === "noreply@shop.com")).toBe(false);
  });
});

describe("searchContacts", () => {
  it("ranks people we sent to before people who only wrote to us", () => {
    expect(searchContacts(index, "san").map((entry) => entry.email)).toEqual([
      "sandra@y.com",
      "sandy@z.com",
    ]);
  });

  it("puts better matches first within a group and skips people already chosen", () => {
    expect(searchContacts(index, "sam").map((entry) => entry.email)).toEqual(["sam@x.com"]);
    expect(searchContacts(index, "sa", new Set(["sam@x.com"])).map((entry) => entry.email)).toEqual([
      "sandra@y.com",
      "sandy@z.com",
    ]);
  });

  it("matches names as well as addresses, and nothing for an empty query", () => {
    expect(searchContacts(index, "reed").map((entry) => entry.email)).toEqual(["sam@x.com"]);
    expect(searchContacts(index, "  ")).toEqual([]);
  });
});

describe("currentToken", () => {
  it("is what was typed after the last comma", () => {
    expect(currentToken("a@x.com, sa")).toBe("sa");
    expect(currentToken("a@x.com;")).toBe("");
    expect(currentToken("plain")).toBe("plain");
  });
});

describe("entryLabel", () => {
  it("prefers the real name, then a guess from the address, then the address", () => {
    expect(entryLabel({ name: "Sam Reed", email: "sam@x.com" })).toBe("Sam Reed");
    expect(entryLabel({ name: "", email: "jane.doe@x.com" })).toBe("Jane Doe");
    expect(entryLabel({ name: "", email: "j4n3@x.com" })).toBe("j4n3@x.com");
    expect(guessName("a_b_c_d@x.com")).toBe("");
  });
});

import { describe, expect, it } from "vitest";

import type { AccountError, MessageSummary } from "@shared/types";

import { groupByAccount, mergeAccountRows, mergeErrors } from "./merge";

const row = (accountId: string, day: number): MessageSummary => ({
  id: `${accountId}|inbox|${day}`,
  accountId,
  folder: "inbox",
  threadId: `${accountId}${day}`,
  from: { name: "", email: "a@b.co" },
  to: [],
  subject: "s",
  snippet: "",
  date: new Date(Date.UTC(2026, 10, day)).toISOString(),
  unread: false,
  pinned: false,
  answered: false,
  hasAttachments: false,
  categoryId: null,
  signal: "person",
});

const days = (rows: MessageSummary[]) => rows.map((message) => `${message.accountId}${message.date.slice(8, 10)}`);

describe("mergeAccountRows", () => {
  it("shows the accounts that answered, newest first, without waiting for the others", () => {
    const live = new Map([["gmail", [row("gmail", 5), row("gmail", 1)]]]);
    const merged = mergeAccountRows(["gmail", "zoho"], [live], []);
    expect(days(merged)).toEqual(["gmail05", "gmail01"]);
  });

  it("prefers live rows, then the saved copy, then what is already on screen", () => {
    const live = new Map([["gmail", [row("gmail", 9)]]]);
    const disk = new Map([
      ["gmail", [row("gmail", 2)]],
      ["zoho", [row("zoho", 3)]],
    ]);
    const onScreen = [row("outlook", 4), row("gmail", 7)];
    const merged = mergeAccountRows(["gmail", "zoho", "outlook"], [live, disk], onScreen);
    expect(days(merged)).toEqual(["gmail09", "outlook04", "zoho03"]);
  });

  it("lets an account with no mail answer with an empty list", () => {
    const live = new Map([["zoho", [] as MessageSummary[]]]);
    expect(mergeAccountRows(["zoho"], [live], [row("zoho", 3)])).toEqual([]);
  });

  it("ignores accounts that are not part of this view", () => {
    const live = new Map([["gmail", [row("gmail", 1)]], ["zoho", [row("zoho", 2)]]]);
    expect(days(mergeAccountRows(["gmail"], [live], [row("zoho", 5)]))).toEqual(["gmail01"]);
  });
});

describe("mergeErrors", () => {
  const error = (accountId: string, message: string): AccountError => ({ accountId, message });

  it("replaces the answered accounts' errors and keeps the pending ones", () => {
    const previous = [error("gmail", "old"), error("zoho", "still down")];
    const answered = new Map([["gmail", [] as AccountError[]]]);
    expect(mergeErrors(previous, answered)).toEqual([error("zoho", "still down")]);
  });

  it("adds new errors", () => {
    const answered = new Map([["zoho", [error("zoho", "timeout")]]]);
    expect(mergeErrors([], answered)).toEqual([error("zoho", "timeout")]);
  });
});

describe("groupByAccount", () => {
  it("buckets rows by account", () => {
    const groups = groupByAccount([row("a", 1), row("b", 2), row("a", 3)]);
    expect([...groups.keys()]).toEqual(["a", "b"]);
    expect(groups.get("a")).toHaveLength(2);
  });
});

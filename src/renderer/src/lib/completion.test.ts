import { describe, expect, it } from "vitest";

import { COMPLETION_LIMITS } from "@shared/completion";
import { completionRequestSchema } from "@shared/schemas";
import type { Account, MessageDetail, MessageSummary } from "@shared/types";

import { buildCompletionContext, clipAround, earlierMessages, worthSuggesting } from "./completion";

const summary = (id: string, name: string, snippet = ""): MessageSummary =>
  ({ id, from: { name, email: `${name.toLowerCase()}@example.com` }, date: "2026-11-01T09:00:00Z", snippet }) as MessageSummary;

const detail = (id: string, text: string): MessageDetail => ({ ...summary(id, "Anna"), text, html: null }) as MessageDetail;

const account = { id: "a1", email: "me@example.com", displayName: "Alex Morgan" } as Account;

describe("earlierMessages", () => {
  const messages = [summary("1", "Anna"), summary("2", "Ben", "Snippet of Ben"), summary("3", "Anna"), summary("4", "Ben")];

  it("lists the messages before the one being answered, oldest first, from what has been downloaded or else the snippet", () => {
    const earlier = earlierMessages(messages, [detail("1", "First message")], "4");
    expect(earlier.map((message) => message.text)).toEqual(["First message", "Snippet of Ben"]);
    expect(earlier[0]!.from.name).toBe("Anna");
  });

  it("drops quoted lines and empty messages, and keeps only the most recent few", () => {
    const earlier = earlierMessages(messages, [detail("1", "> quoted\nNew words"), detail("3", "")], "4");
    expect(earlier.map((message) => message.text)).toEqual(["New words", "Snippet of Ben"]);
    const many = Array.from({ length: 9 }, (_, index) => summary(String(index), "Anna", `m${index}`));
    expect(earlierMessages(many, [], "8").map((message) => message.text)).toEqual(["m4", "m5", "m6", "m7"]);
  });

  it("cuts a long message", () => {
    const [long] = earlierMessages([summary("1", "Anna"), summary("2", "Ben")], [detail("1", "x".repeat(10_000))], "2");
    expect(long!.text).toHaveLength(COMPLETION_LIMITS.earlierText);
  });
});

describe("buildCompletionContext", () => {
  const input = {
    mode: "reply" as const,
    accountId: "a1",
    accounts: [account],
    to: [{ name: "Anna", email: "anna@example.com" }, { name: "", email: "not an address" }],
    cc: [],
    subject: "Re: Hello",
    quoted: "On Monday Anna wrote:\n> Hello",
  };

  it("says who is writing, to whom, and what is being answered, in a form main accepts", () => {
    const context = buildCompletionContext(input)!;
    expect(context.me).toEqual({ name: "Alex Morgan", email: "me@example.com" });
    expect(context.to).toEqual([{ name: "Anna", email: "anna@example.com" }]); // the half-typed address is left out
    expect(context.quoted).toContain("Hello");
    expect(context.earlier).toBeUndefined();
    const request = completionRequestSchema.safeParse({ session: "s", before: "Hi", after: "", context });
    expect(request.success).toBe(true);
  });

  it("has nothing to say when the account is gone, and leaves out an empty quote", () => {
    expect(buildCompletionContext({ ...input, accountId: "gone" })).toBeNull();
    expect(buildCompletionContext({ ...input, quoted: "  " })!.quoted).toBeUndefined();
  });
});

describe("what is sent of the draft", () => {
  it("keeps the words nearest the cursor", () => {
    const { before, after } = clipAround("a".repeat(5_000) + "END", "b".repeat(2_000));
    expect(before).toHaveLength(COMPLETION_LIMITS.before);
    expect(before.endsWith("END")).toBe(true);
    expect(after).toHaveLength(COMPLETION_LIMITS.after);
  });

  it("does not ask before the draft has begun", () => {
    expect(worthSuggesting("")).toBe(false);
    expect(worthSuggesting(" H ")).toBe(false);
    expect(worthSuggesting("Hi")).toBe(true);
  });
});

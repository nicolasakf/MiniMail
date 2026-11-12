import { describe, expect, it } from "vitest";

import { defaultCategories } from "./categories";
import { classifyMessage } from "./classify";
import { buildFocusedList, sectionFor, threadsInGroup } from "./focus-list";
import { makeMessageId, parseMessageId } from "./ids";
import { groupThreads } from "./threads";
import type { MessageSummary, SmartCategory } from "./types";

const NOW = new Date(2026, 10, 9, 15, 0, 0); // Nov 9 2026, local time

function msg(overrides: Partial<MessageSummary> & { id: string }): MessageSummary {
  return {
    accountId: "a1",
    folder: "inbox",
    threadId: overrides.id,
    from: { name: "Sam", email: "sam@example.com" },
    to: [],
    subject: "Hello",
    snippet: "",
    date: new Date(2026, 10, 9, 12, 0, 0).toISOString(),
    unread: false,
    pinned: false,
    answered: false,
    hasAttachments: false,
    signal: "person" as SmartCategory,
    categoryId: null,
    ...overrides,
  };
}

describe("classifyMessage", () => {
  const base = { fromEmail: "x@y.com", subject: "Hi", headers: {} };

  it("treats plain mail from a person as person", () => {
    expect(classifyMessage({ ...base, fromEmail: "ana@gmail.com" })).toBe("person");
  });

  it("detects calendar requests and replies from the content type", () => {
    expect(
      classifyMessage({ ...base, contentType: "text/calendar; method=REQUEST" }),
    ).toBe("invitation");
    expect(
      classifyMessage({ ...base, contentType: 'text/calendar; method="REPLY"' }),
    ).toBe("invitation-response");
  });

  it("falls back to calendar subject prefixes", () => {
    expect(classifyMessage({ ...base, subject: "Invitation: Standup @ Mon" })).toBe("invitation");
    expect(classifyMessage({ ...base, subject: "Accepted: Standup" })).toBe("invitation-response");
  });

  it("classifies no-reply senders as notifications", () => {
    expect(classifyMessage({ ...base, fromEmail: "no-reply@accounts.google.com" })).toBe(
      "notification",
    );
    expect(classifyMessage({ ...base, fromEmail: "notifications@github.com" })).toBe(
      "notification",
    );
  });

  it("classifies auto-submitted mail as a notification", () => {
    expect(
      classifyMessage({ ...base, headers: { "auto-submitted": "auto-generated" } }),
    ).toBe("notification");
    expect(classifyMessage({ ...base, headers: { "auto-submitted": "no" } })).toBe("person");
  });

  it("classifies bulk mail from a normal sender as a newsletter", () => {
    expect(
      classifyMessage({
        ...base,
        fromEmail: "hello@brand.com",
        headers: { "list-unsubscribe": "<mailto:u@brand.com>" },
      }),
    ).toBe("newsletter");
    expect(
      classifyMessage({ ...base, fromEmail: "hello@brand.com", headers: { precedence: "bulk" } }),
    ).toBe("newsletter");
  });

  it("keeps automated senders as notifications even with unsubscribe headers", () => {
    expect(
      classifyMessage({
        ...base,
        fromEmail: "noreply@service.com",
        headers: { "list-unsubscribe": "<mailto:u@service.com>" },
      }),
    ).toBe("notification");
  });
});

describe("message ids", () => {
  it("round-trips, including native ids that contain the separator", () => {
    const ref = { accountId: "acc", folder: "inbox", nativeId: "AAMk|weird=" } as const;
    expect(parseMessageId(makeMessageId(ref))).toEqual(ref);
  });

  it("rejects malformed ids", () => {
    expect(parseMessageId("nope")).toBeNull();
    expect(parseMessageId("a|inbox")).toBeNull();
    expect(parseMessageId("a|inbox|")).toBeNull();
  });
});

describe("groupThreads", () => {
  it("merges messages sharing a thread id and sorts newest thread first", () => {
    const threads = groupThreads([
      msg({ id: "1", threadId: "t1", date: new Date(2026, 10, 8).toISOString() }),
      msg({ id: "2", threadId: "t2", date: new Date(2026, 10, 9).toISOString() }),
      msg({ id: "3", threadId: "t1", date: new Date(2026, 10, 9, 14).toISOString(), unread: true }),
    ]);
    expect(threads.map((t) => t.id)).toEqual(["a1:t1", "a1:t2"]);
    expect(threads[0].count).toBe(2);
    expect(threads[0].unread).toBe(true);
    expect(threads[0].latest.id).toBe("3");
    expect(threads[0].messages.map((m) => m.id)).toEqual(["1", "3"]);
  });

  it("never merges threads across accounts", () => {
    const threads = groupThreads([
      msg({ id: "1", accountId: "a1", threadId: "same" }),
      msg({ id: "2", accountId: "a2", threadId: "same" }),
    ]);
    expect(threads).toHaveLength(2);
  });

  it("takes the category from the newest message", () => {
    const [thread] = groupThreads([
      msg({ id: "1", threadId: "t", categoryId: "notifications", date: new Date(2026, 10, 8).toISOString() }),
      msg({ id: "2", threadId: "t", categoryId: null, date: new Date(2026, 10, 9).toISOString() }),
    ]);
    expect(thread.categoryId).toBeNull();
  });

  it("is answered or has attachments when any message in it is", () => {
    const [thread] = groupThreads([
      msg({ id: "1", threadId: "t", answered: true, date: new Date(2026, 10, 8).toISOString() }),
      msg({ id: "2", threadId: "t", hasAttachments: true, date: new Date(2026, 10, 9).toISOString() }),
    ]);
    expect(thread).toMatchObject({ answered: true, hasAttachments: true });
  });
});

describe("sectionFor", () => {
  it("buckets by day distance", () => {
    expect(sectionFor(new Date(2026, 10, 9, 1).toISOString(), NOW).label).toBe("Today");
    expect(sectionFor(new Date(2026, 10, 8, 23).toISOString(), NOW).label).toBe("Yesterday");
    expect(sectionFor(new Date(2026, 10, 4).toISOString(), NOW).label).toBe("Last Week");
    expect(sectionFor(new Date(2026, 9, 5).toISOString(), NOW).label).toBe("October");
    expect(sectionFor(new Date(2025, 9, 5).toISOString(), NOW).label).toBe("October 2025");
  });
});

describe("buildFocusedList", () => {
  const threads = groupThreads([
    msg({ id: "p1", threadId: "p1", subject: "Person today", date: new Date(2026, 10, 9, 12).toISOString() }),
    msg({
      id: "n1",
      threadId: "n1",
      categoryId: "notifications",
      from: { name: "Amazon", email: "ship@amazon.com" },
      date: new Date(2026, 10, 9, 10).toISOString(),
      unread: true,
    }),
    msg({
      id: "n2",
      threadId: "n2",
      categoryId: "notifications",
      from: { name: "Amazon", email: "ship@amazon.com" },
      date: new Date(2026, 10, 7).toISOString(),
    }),
    msg({
      id: "pin1",
      threadId: "pin1",
      pinned: true,
      from: { name: "Support", email: "s@x.com" },
      date: new Date(2026, 10, 9, 9).toISOString(),
    }),
    msg({ id: "p2", threadId: "p2", subject: "Person yesterday", date: new Date(2026, 10, 8, 12).toISOString() }),
  ]);

  it("puts category rows first, then Pinned, then the Today heading with uncategorized mail", () => {
    const items = buildFocusedList(threads, { now: NOW, categories: defaultCategories() });
    const labels = items.map((i) =>
      i.type === "section" ? `# ${i.label}` : i.type === "group" ? `[${i.label} ${i.count}]` : i.thread.latest.subject,
    );
    expect(labels).toEqual([
      "[Notifications 2]",
      "# Pinned",
      "Hello",
      "# Today",
      "Person today",
      "# Yesterday",
      "Person yesterday",
    ]);
  });

  it("hides the pinned conversations, but not the heading, when Pinned is collapsed", () => {
    const items = buildFocusedList(threads, {
      now: NOW,
      categories: defaultCategories(),
      pinnedCollapsed: true,
    });
    const pinned = items.find((i) => i.type === "section" && i.label === "Pinned");
    expect(pinned).toMatchObject({ collapsible: { collapsed: true, count: 1 } });
    expect(items.some((i) => i.type === "thread" && i.thread.latest.id === "pin1")).toBe(false);
  });

  it("keeps groups at the top even when their newest thread is older", () => {
    const old = groupThreads([
      msg({
        id: "old-n",
        threadId: "old-n",
        categoryId: "newsletters",
        date: new Date(2026, 9, 1).toISOString(),
      }),
      msg({ id: "old-p", threadId: "old-p", date: new Date(2026, 9, 1).toISOString() }),
    ]);
    const items = buildFocusedList(old, { now: NOW, categories: defaultCategories() });
    expect(items[0]).toMatchObject({ type: "group", kind: "newsletters" });
    expect(items.some((i) => i.type === "section" && i.label === "Today")).toBe(false);
    expect(items.some((i) => i.type === "section" && i.label === "October")).toBe(true);
  });

  it("aggregates sender chips and unread state on a group", () => {
    const items = buildFocusedList(threads, { now: NOW, categories: defaultCategories() });
    const notifications = items.find((i) => i.type === "group" && i.kind === "notifications");
    expect(notifications).toMatchObject({ hasUnread: true, count: 2 });
    if (notifications?.type === "group") {
      expect(notifications.chips).toEqual([
        { key: "ship@amazon.com", name: "Amazon", email: "ship@amazon.com", count: 2, unread: true, logo: null, threadId: "a1:n1", messageId: expect.any(String), date: expect.any(String) },
      ]);
    }
  });

  it("never lists a group's threads in the Focused List itself", () => {
    const items = buildFocusedList(threads, { now: NOW, categories: defaultCategories() });
    const listed = items.flatMap((i) => (i.type === "thread" ? [i.thread.latest.id] : []));
    expect(listed).toEqual(["pin1", "p1", "p2"]);
  });

  it("gives the threads behind a group row, newest first", () => {
    const ids = (kind: string) => threadsInGroup(threads, kind).map((t) => t.latest.id);
    expect(ids("notifications")).toEqual(["n1", "n2"]);
    expect(ids("newsletters")).toEqual([]);
  });

  it("returns nothing for an empty inbox", () => {
    expect(buildFocusedList([], { now: NOW, categories: defaultCategories() })).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";

import {
  addDays,
  buildDashboardStats,
  dropFolderDuplicates,
  matchesDrill,
  receivedMail,
  timelineBuckets,
  weekdayOf,
} from "./dashboard";
import type { MessageSummary } from "./types";

// Wednesday 11 November 2026, 15:30 local time.
const NOW = new Date(2026, 10, 11, 15, 30).getTime();

let next = 0;
function message(overrides: Partial<MessageSummary> & { at: Date }): MessageSummary {
  next += 1;
  const { at, ...rest } = overrides;
  return {
    id: `acc|inbox|${next}`,
    accountId: "acc",
    folder: "inbox",
    threadId: `t${next}`,
    from: { name: "Ann", email: "ann@example.com" },
    to: [],
    subject: "Hello",
    snippet: "",
    date: at.toISOString(),
    unread: false,
    pinned: false,
    answered: false,
    hasAttachments: false,
    signal: "person",
    categoryId: null,
    ...rest,
  };
}

const daysAgo = (days: number, hour: number) => {
  const date = new Date(addDays(NOW, -days));
  date.setHours(hour);
  return date;
};

describe("receivedMail", () => {
  it("drops the user's own messages and duplicates", () => {
    const mine = message({ at: daysAgo(0, 9), from: { name: "Me", email: "Me@Mine.example" } });
    const theirs = message({ at: daysAgo(0, 9) });
    expect(receivedMail([mine, theirs, theirs], ["me@mine.example"])).toEqual([theirs]);
  });
});

describe("buildDashboardStats", () => {
  const mail = [
    message({ at: daysAgo(0, 8), unread: true }),
    message({ at: daysAgo(0, 8), from: { name: "Bob", email: "bob@news.shop.example" }, signal: "newsletter", categoryId: "newsletters" }),
    message({ at: daysAgo(0, 14), from: { name: "Shop", email: "deals@shop.example" }, signal: "newsletter", categoryId: "ads", hasAttachments: true }),
    message({ at: daysAgo(1, 10), accountId: "other" }),
    message({ at: daysAgo(3, 10), answered: true }),
    message({ at: daysAgo(10, 10) }),
    message({ at: daysAgo(40, 10) }),
  ];

  it("counts the headline numbers regardless of the range", () => {
    const stats = buildDashboardStats(mail, "today", NOW);
    expect(stats.today).toBe(3);
    expect(stats.yesterday).toBe(1);
    expect(stats.last7).toBe(5);
    expect(stats.previous7).toBe(1);
    expect(stats.dailyAverage30).toBeCloseTo(6 / 30);
    expect(stats.todayByHour[8]).toBe(2);
    expect(stats.last14Days[13]).toBe(3);
    expect(stats.last14Days[12]).toBe(1);
  });

  it("limits the breakdowns to the range", () => {
    const today = buildDashboardStats(mail, "today", NOW);
    expect(today.total).toBe(3);
    expect(today.unread).toBe(1);
    expect(today.people).toBe(1);
    expect(today.automated).toBe(2);
    expect(today.withAttachments).toBe(1);
    expect(today.timeUnit).toBe("hour");
    expect(today.timeline).toHaveLength(24);
    expect(today.timeline[8]).toMatchObject({ count: 2, unread: 1 });

    const week = buildDashboardStats(mail, "7d", NOW);
    expect(week.total).toBe(5);
    expect(week.timeline).toHaveLength(7);
    expect(week.timeline.at(-1)?.count).toBe(3);
    expect(week.answered).toBe(1);

    expect(buildDashboardStats(mail, "all", NOW).total).toBe(7);
  });

  it("ranks senders, domains, categories and accounts by count", () => {
    const stats = buildDashboardStats(mail, "all", NOW);
    expect(stats.senders[0]).toMatchObject({ key: "ann@example.com", count: 5, unread: 1 });
    expect(stats.domains[0]).toMatchObject({ domain: "example.com", count: 5, senders: 1 });
    // Two addresses under one organization domain.
    expect(stats.domains[1]).toMatchObject({ domain: "shop.example", count: 2, senders: 2 });
    expect(stats.categories[0]).toMatchObject({ categoryId: null, count: 5 });
    expect(stats.accounts).toEqual([
      { accountId: "acc", count: 6 },
      { accountId: "other", count: 1 },
    ]);
  });

  it("fills the weekday × hour grid and finds the busiest slot", () => {
    const stats = buildDashboardStats(mail, "today", NOW);
    expect(stats.heatmap[weekdayOf(NOW)][8]).toBe(2);
    expect(stats.heatmapMax).toBe(2);
    expect(stats.busiestHour).toEqual({ hour: 8, count: 2 });
    expect(stats.busiestWeekday).toEqual({ weekday: 2, count: 3 });
  });

  it("is empty without mail", () => {
    const stats = buildDashboardStats([], "30d", NOW);
    expect(stats.total).toBe(0);
    expect(stats.busiestHour).toBeNull();
    expect(stats.timeline).toHaveLength(30);
  });
});

describe("timelineBuckets", () => {
  it("charts All by month, at least six and at most 24 months", () => {
    expect(timelineBuckets("all", NOW, null).buckets).toHaveLength(6);
    expect(timelineBuckets("all", NOW, new Date(2020, 0, 1).getTime()).buckets).toHaveLength(24);
    const { buckets } = timelineBuckets("all", NOW, new Date(2025, 10, 3).getTime());
    expect(buckets).toHaveLength(13);
    expect(new Date(buckets[0].start).getMonth()).toBe(10);
  });
});

describe("matchesDrill", () => {
  const ad = message({
    at: daysAgo(2, 9),
    from: { name: "Shop", email: "Deals@Mail.Shop.example" },
    categoryId: "ads",
    signal: "newsletter",
    unread: true,
  });

  it("matches each kind of filter within the range", () => {
    const check = (filter: Parameters<typeof matchesDrill>[1]["filter"], range: "7d" | "today" = "7d") =>
      matchesDrill(ad, { filter, range }, NOW);
    expect(check({ kind: "all" })).toBe(true);
    expect(check({ kind: "all" }, "today")).toBe(false);
    expect(check({ kind: "sender", email: "deals@mail.shop.example", name: "Shop" })).toBe(true);
    expect(check({ kind: "domain", domain: "shop.example" })).toBe(true);
    expect(check({ kind: "category", categoryId: "ads" })).toBe(true);
    expect(check({ kind: "category", categoryId: null })).toBe(false);
    expect(check({ kind: "account", accountId: "acc" })).toBe(true);
    expect(check({ kind: "slot", weekday: weekdayOf(Date.parse(ad.date)), hour: 9 })).toBe(true);
    expect(check({ kind: "flag", flag: "unread" })).toBe(true);
    expect(check({ kind: "flag", flag: "people" })).toBe(false);
    expect(check({ kind: "flag", flag: "automated" })).toBe(true);
  });

  it("narrows a time bucket to its read or unread part", () => {
    const filter = { kind: "time", start: addDays(NOW, -2), end: addDays(NOW, -1) } as const;
    expect(matchesDrill(ad, { filter: { ...filter, unread: true }, range: "all" }, NOW)).toBe(true);
    expect(matchesDrill(ad, { filter: { ...filter, unread: false }, range: "all" }, NOW)).toBe(false);
  });

  it("uses a time bucket's own bounds instead of the range", () => {
    const start = addDays(NOW, -2);
    expect(matchesDrill(ad, { filter: { kind: "time", start, end: addDays(NOW, -1) }, range: "today" }, NOW)).toBe(true);
    expect(matchesDrill(ad, { filter: { kind: "time", start: addDays(NOW, -1), end: NOW }, range: "all" }, NOW)).toBe(false);
  });
});

describe("dropFolderDuplicates", () => {
  it("keeps the Inbox copy of a message also listed in Archive (Gmail's All Mail)", () => {
    const inbox = message({ at: daysAgo(1, 9), threadId: "t" });
    const allMail = { ...inbox, id: "acc|archive|99", folder: "archive" as const };
    const archivedOnly = message({ at: daysAgo(2, 9), folder: "archive", threadId: "t" });
    expect(dropFolderDuplicates([allMail, inbox, archivedOnly])).toEqual([inbox, archivedOnly]);
  });

  it("keeps one copy when neither is in the Inbox", () => {
    const archived = message({ at: daysAgo(1, 9), folder: "archive", threadId: "t" });
    const again = { ...archived, id: "acc|archive|77" };
    expect(dropFolderDuplicates([archived, again])).toEqual([archived]);
  });

  it("keeps same-looking messages of different accounts", () => {
    const inbox = message({ at: daysAgo(1, 9), threadId: "t" });
    const other = { ...inbox, id: "other|archive|1", accountId: "other", folder: "archive" as const };
    expect(dropFolderDuplicates([inbox, other])).toHaveLength(2);
  });
});

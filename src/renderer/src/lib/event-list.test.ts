import { describe, expect, it } from "vitest";

import { EVENT_RETENTION_MS, type AppEvent } from "@shared/events";

import { buildRows, dayLabel, eventText, latestErrorId, mergeEvents } from "./event-list";

const NOW = new Date(2026, 10, 16, 15).getTime();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function event(id: number, overrides: Partial<AppEvent> = {}): AppEvent {
  return { id, at: id, lastAt: id, repeats: 1, level: "error", area: "sync", title: `Event ${id}`, detail: "", ...overrides };
}

describe("mergeEvents", () => {
  it("puts new events on top, newest first", () => {
    const merged = mergeEvents([event(5), event(3)], [event(7), event(6)]);
    expect(merged.map((item) => item.id)).toEqual([7, 6, 5, 3]);
  });

  it("replaces an event that changed instead of adding it twice", () => {
    const merged = mergeEvents([event(5), event(3)], [event(5, { repeats: 4 })]);
    expect(merged).toHaveLength(2);
    expect(merged[0].repeats).toBe(4);
  });

  it("places an event that arrives late in the right spot", () => {
    const merged = mergeEvents([event(9), event(5)], [event(7)]);
    expect(merged.map((item) => item.id)).toEqual([9, 7, 5]);
  });

  it("returns the same list when nothing changed", () => {
    const list = [event(1)];
    expect(mergeEvents(list, [])).toBe(list);
  });
});

describe("latestErrorId", () => {
  it("skips actions and info", () => {
    expect(latestErrorId([event(9, { level: "action" }), event(8, { level: "info" }), event(7), event(3)])).toBe(7);
    expect(latestErrorId([event(9, { level: "action" })])).toBe(0);
  });
});

describe("dayLabel", () => {
  it("names today and yesterday and dates the rest", () => {
    expect(dayLabel(NOW - HOUR, NOW)).toBe("Today");
    expect(dayLabel(NOW - DAY, NOW)).toBe("Yesterday");
    expect(dayLabel(NOW - 5 * DAY, NOW)).toMatch(/Nov/);
  });
});

describe("eventText", () => {
  it("reads like a log line, with the private context below", () => {
    const text = eventText(event(Date.UTC(2026, 10, 16, 12), { area: "sorting", title: "Could not sort an email", detail: "rate limited", context: "Tech Networking Event" }));
    expect(text).toBe("2026-11-16T12:00:00.000Z ERROR [sorting] Could not sort an email: rate limited\nTech Networking Event");
  });

  it("leaves out what is empty", () => {
    expect(eventText(event(Date.UTC(2026, 10, 16, 12), { area: "mail", title: "Archived", detail: "", level: "action" }))).toBe(
      "2026-11-16T12:00:00.000Z ACTION [mail] Archived",
    );
  });
});

describe("buildRows", () => {
  const events = [
    event(NOW - HOUR, { title: "A", level: "error" }),
    event(NOW - 2 * HOUR, { title: "B", level: "action" }),
    event(NOW - DAY, { title: "C", level: "error" }),
    event(NOW - EVENT_RETENTION_MS - HOUR, { title: "Too old", level: "error" }),
  ];

  it("shows only errors when asked, with a heading per day", () => {
    const rows = buildRows(events, true, NOW);
    expect(rows.map((row) => (row.kind === "day" ? `# ${row.label}` : row.event.title))).toEqual(["# Today", "A", "# Yesterday", "C"]);
  });

  it("shows everything of the last 30 days otherwise, and nothing older", () => {
    const titles = buildRows(events, false, NOW).flatMap((row) => (row.kind === "event" ? [row.event.title] : []));
    expect(titles).toEqual(["A", "B", "C"]);
  });

  it("dates a repeating error by its last occurrence", () => {
    const rows = buildRows([event(NOW - 3 * DAY, { lastAt: NOW - HOUR, repeats: 9 })], true, NOW);
    expect(rows[0]).toMatchObject({ kind: "day", label: "Today" });
  });

  it("is empty when nothing qualifies", () => {
    expect(buildRows([event(NOW - HOUR, { level: "info" })], true, NOW)).toEqual([]);
    expect(buildRows([event(NOW - HOUR, { done: true })], true, NOW)).toEqual([]);
    expect(buildRows([event(NOW - HOUR, { done: true })], false, NOW)).toHaveLength(2);
  });
});

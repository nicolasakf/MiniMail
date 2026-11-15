import { describe, expect, it } from "vitest";

import { fromDateTimeInput, sendLaterOptions, sendTimeHint, toDateTimeInput } from "./send-later";

// Local-time constructors on purpose: the options are defined in the user's own time zone.
const at = (month: number, day: number, hour = 12, minute = 0) => new Date(2026, month - 1, day, hour, minute);
const byId = (now: Date) => Object.fromEntries(sendLaterOptions(now).map((option) => [option.id, new Date(option.time)]));

describe("sendLaterOptions", () => {
  // 2026-11-11 is a Wednesday.
  it("offers every preset on a weekday morning", () => {
    const now = at(11, 11, 8, 15);
    const options = byId(now);
    expect(Object.keys(options)).toEqual(["hour", "evening", "tomorrow", "weekend", "week"]);
    expect(options.hour.getTime()).toBe(now.getTime() + 3_600_000);
    expect(options.evening.getHours()).toBe(20);
    expect(options.evening.getDate()).toBe(11);
    expect(options.tomorrow.getDate()).toBe(12);
    expect(options.tomorrow.getHours()).toBe(9);
    expect(options.weekend.getDay()).toBe(6);
    expect(options.weekend.getDate()).toBe(14);
    expect(options.week.getDay()).toBe(1);
    expect(options.week.getDate()).toBe(16);
  });

  it("drops this evening once it has passed", () => {
    expect(byId(at(11, 11, 21, 0)).evening).toBeUndefined();
    expect(byId(at(11, 11, 19, 59)).evening).toBeDefined();
  });

  it("never offers a moment that is not ahead", () => {
    for (const hour of [0, 6, 9, 12, 20, 23]) {
      const now = at(11, 14, hour, 30);
      for (const option of sendLaterOptions(now)) expect(option.time).toBeGreaterThan(now.getTime());
    }
  });

  it("moves the weekend to the following Saturday once Saturday 9:00 has passed", () => {
    // 2026-11-14 is a Saturday.
    expect(byId(at(11, 14, 8, 30)).weekend.getDate()).toBe(14);
    expect(byId(at(11, 14, 9, 30)).weekend.getDate()).toBe(21);
    // Sunday looks ahead to the Saturday after it.
    expect(byId(at(11, 15, 10, 0)).weekend.getDate()).toBe(21);
  });

  it("offers a moment once when two names land on it", () => {
    // Friday: tomorrow morning is the weekend.
    const friday = sendLaterOptions(at(11, 13, 10, 0));
    expect(friday.map((option) => option.id)).not.toContain("weekend");
    expect(new Set(friday.map((option) => option.time)).size).toBe(friday.length);
    // Sunday: tomorrow morning is next week.
    const sunday = sendLaterOptions(at(11, 15, 10, 0));
    expect(sunday.map((option) => option.id)).not.toContain("week");
  });

  it("always looks to the next Monday, never to today", () => {
    expect(byId(at(11, 16, 7, 0)).week.getDate()).toBe(23);
  });
});

describe("sendTimeHint", () => {
  it("shortens the label to what is needed to place the moment", () => {
    const now = at(11, 11, 8, 0);
    expect(sendTimeHint(at(11, 11, 20, 0).getTime(), now)).toMatch(/8:00\s?PM|20:00/);
    expect(sendTimeHint(at(11, 14, 9, 0).getTime(), now)).toMatch(/Sat/);
    expect(sendTimeHint(at(11, 30, 9, 0).getTime(), now)).toMatch(/30/);
  });
});

describe("datetime-local values", () => {
  it("round-trips through the input format", () => {
    const time = at(11, 14, 9, 45).getTime();
    expect(toDateTimeInput(time)).toBe("2026-11-14T09:45");
    expect(fromDateTimeInput(toDateTimeInput(time))).toBe(time);
  });

  it("treats an empty or incomplete input as no time", () => {
    expect(fromDateTimeInput("")).toBeUndefined();
    expect(fromDateTimeInput("2026-11-14T")).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";

import { dayIndexAt, dayRatio, moveHandle, parseDay, pickRangeDay, rangePosition, shiftRange } from "./date-range";

describe("pickRangeDay", () => {
  it("starts a range on the first click", () => {
    expect(pickRangeDay({}, "2026-06-10")).toEqual({ from: "2026-06-10" });
  });

  it("closes the range on the second click, whichever side it falls on", () => {
    expect(pickRangeDay({ from: "2026-06-10" }, "2026-06-20")).toEqual({ from: "2026-06-10", to: "2026-06-20" });
    expect(pickRangeDay({ from: "2026-06-10" }, "2026-06-02")).toEqual({ from: "2026-06-02", to: "2026-06-10" });
    expect(pickRangeDay({ from: "2026-06-10" }, "2026-06-10")).toEqual({ from: "2026-06-10", to: "2026-06-10" });
  });

  it("starts over once a range is complete", () => {
    expect(pickRangeDay({ from: "2026-06-10", to: "2026-06-20" }, "2026-07-01")).toEqual({ from: "2026-07-01" });
  });
});

describe("rangePosition", () => {
  const range = { from: "2026-06-10", to: "2026-06-12" };

  it("marks the ends and the days between", () => {
    expect(rangePosition(range, "2026-06-10")).toBe("start");
    expect(rangePosition(range, "2026-06-11")).toBe("middle");
    expect(rangePosition(range, "2026-06-12")).toBe("end");
    expect(rangePosition(range, "2026-06-13")).toBeUndefined();
  });

  it("treats a one-day or half-picked range as a single day", () => {
    expect(rangePosition({ from: "2026-06-10", to: "2026-06-10" }, "2026-06-10")).toBe("single");
    expect(rangePosition({ from: "2026-06-10" }, "2026-06-10")).toBe("single");
    expect(rangePosition({}, "2026-06-10")).toBeUndefined();
  });
});

describe("timeline maths", () => {
  it("maps a pointer position to a day and back", () => {
    expect(dayIndexAt(0, 30)).toBe(0);
    expect(dayIndexAt(1, 30)).toBe(29);
    expect(dayIndexAt(0.5, 30)).toBe(15);
    expect(dayIndexAt(-1, 30)).toBe(0);
    expect(dayIndexAt(dayRatio(7, 30), 30)).toBe(7);
  });

  it("keeps the minimum length when a handle is dragged past the other", () => {
    expect(moveHandle({ from: 10, to: 20 }, "from", 19, 7, 0, 99)).toEqual({ from: 14, to: 20 });
    expect(moveHandle({ from: 10, to: 20 }, "to", 11, 7, 0, 99)).toEqual({ from: 10, to: 16 });
  });

  it("stops handles at the bounds", () => {
    expect(moveHandle({ from: 10, to: 20 }, "from", -5, 1, 2, 99)).toEqual({ from: 2, to: 20 });
    expect(moveHandle({ from: 10, to: 20 }, "to", 500, 1, 0, 40)).toEqual({ from: 10, to: 40 });
  });

  it("slides a range without changing its length", () => {
    expect(shiftRange({ from: 10, to: 20 }, 5, 0, 99)).toEqual({ from: 15, to: 25 });
    expect(shiftRange({ from: 10, to: 20 }, -50, 0, 99)).toEqual({ from: 0, to: 10 });
    expect(shiftRange({ from: 10, to: 20 }, 500, 0, 99)).toEqual({ from: 89, to: 99 });
  });
});

describe("parseDay", () => {
  it("reads local calendar days and rejects junk", () => {
    expect(parseDay("2026-06-15")?.getDate()).toBe(15);
    expect(parseDay("nope")).toBeUndefined();
    expect(parseDay(undefined)).toBeUndefined();
  });
});

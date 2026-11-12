import { isValid, parseISO } from "date-fns";

/** The value the date pickers hold: a local calendar day, `yyyy-MM-dd`. */
export const DAY_FORMAT = "yyyy-MM-dd";

/** A range being picked: only `from` set means the second click is still to come. */
export interface DayRange {
  from?: string;
  to?: string;
}

/** A finished range, as the timeline slider holds it. */
export interface ClosedRange {
  from: string;
  to: string;
}

export function parseDay(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = parseISO(value);
  return isValid(date) ? date : undefined;
}

/**
 * Applies a click on `day` to a range being picked: the first click starts it, the second closes it
 * (earlier or later than the start), and a click after that starts over.
 */
export function pickRangeDay(range: DayRange, day: string): DayRange {
  if (!range.from || range.to) return { from: day };
  return day < range.from ? { from: day, to: range.from } : { from: range.from, to: day };
}

/** Where a day sits in a range, for drawing the band behind it. */
export type RangePosition = "single" | "start" | "middle" | "end";

export function rangePosition(range: DayRange, day: string): RangePosition | undefined {
  const { from, to } = range;
  if (!from) return undefined;
  if (!to) return day === from ? "single" : undefined;
  if (from === to) return day === from ? "single" : undefined;
  if (day === from) return "start";
  if (day === to) return "end";
  return day > from && day < to ? "middle" : undefined;
}

/** Index of the day under a pointer, `ratio` (0 to 1) of the way along a track of `total` days. */
export function dayIndexAt(ratio: number, total: number): number {
  return Math.min(total - 1, Math.max(0, Math.floor(ratio * total)));
}

/** Centre of day `index` along a track of `total` days, as a ratio from 0 to 1. */
export function dayRatio(index: number, total: number): number {
  return (index + 0.5) / total;
}

/** A selection on the timeline, as day offsets from the first visible day (both inclusive). */
export interface IndexRange {
  from: number;
  to: number;
}

/**
 * Moves one end of the selection to `index`. The range keeps at least `minDays` days (counting both
 * ends) and stays between `lo` and `hi`.
 */
export function moveHandle(
  range: IndexRange,
  handle: "from" | "to",
  index: number,
  minDays: number,
  lo: number,
  hi: number,
): IndexRange {
  const gap = Math.max(minDays, 1) - 1;
  if (handle === "from") return { from: Math.min(Math.max(index, lo), Math.max(range.to - gap, lo)), to: range.to };
  return { from: range.from, to: Math.max(Math.min(index, hi), Math.min(range.from + gap, hi)) };
}

/** Slides the whole selection by `delta` days without changing its length, stopping at `lo` and `hi`. */
export function shiftRange(range: IndexRange, delta: number, lo: number, hi: number): IndexRange {
  const length = range.to - range.from;
  const from = Math.min(Math.max(range.from + delta, lo), Math.max(hi - length, lo));
  return { from, to: from + length };
}

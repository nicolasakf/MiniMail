import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMIT_DISTANCE, IDLE_MS, MAX_DRAG, SwipeBack, dragOffset } from "./swipe-back";

describe("swipe back", () => {
  let offsets: Array<[number, boolean]>;
  let commits: number;
  let swipe: SwipeBack;

  beforeEach(() => {
    vi.useFakeTimers();
    offsets = [];
    commits = 0;
    swipe = new SwipeBack({
      onOffset: (offset, settle) => offsets.push([offset, settle]),
      onCommit: () => commits++,
    });
  });
  afterEach(() => vi.useRealTimers());

  /** A slow pull to the left in small steps. */
  const pull = (total: number, step = 10) => {
    for (let moved = 0; moved < total; moved += step) swipe.feed(-step, 1);
  };

  it("drags with resistance and never past the maximum", () => {
    expect(dragOffset(0)).toBe(0);
    expect(dragOffset(100)).toBeLessThan(100);
    expect(dragOffset(100_000)).toBeLessThanOrEqual(MAX_DRAG);
    expect(dragOffset(200) - dragOffset(100)).toBeLessThan(dragOffset(100));
  });

  it("goes back once pulled far enough", () => {
    pull(COMMIT_DISTANCE);
    expect(commits).toBe(1);
    expect(offsets.at(-1)).toEqual([0, true]);
  });

  it("springs back without going back when let go early", () => {
    pull(COMMIT_DISTANCE / 3);
    expect(commits).toBe(0);
    expect(offsets.at(-1)![0]).toBeGreaterThan(0);
    vi.advanceTimersByTime(IDLE_MS + 1);
    expect(commits).toBe(0);
    expect(offsets.at(-1)).toEqual([0, true]);
  });

  it("goes back only once per gesture, and again for the next one", () => {
    pull(COMMIT_DISTANCE * 2);
    expect(commits).toBe(1);
    vi.advanceTimersByTime(IDLE_MS + 1);
    pull(COMMIT_DISTANCE);
    expect(commits).toBe(2);
  });

  it("ignores vertical scrolling and a drift to the right", () => {
    for (let i = 0; i < 50; i++) swipe.feed(-8, 20);
    expect(commits).toBe(0);
    expect(offsets).toEqual([]);
    vi.advanceTimersByTime(IDLE_MS + 1);
    for (let i = 0; i < 50; i++) swipe.feed(20, 0);
    expect(commits).toBe(0);
  });

  it("leaves a gesture to something that scrolls sideways by itself", () => {
    for (let i = 0; i < 100; i++) swipe.feed(-10, 0, true);
    expect(commits).toBe(0);
    expect(offsets).toEqual([]);
  });

  it("lets the page slide back when the fingers reverse", () => {
    pull(150);
    const there = offsets.at(-1)![0];
    for (let i = 0; i < 10; i++) swipe.feed(10, 0);
    expect(offsets.at(-1)![0]).toBeLessThan(there);
  });
});

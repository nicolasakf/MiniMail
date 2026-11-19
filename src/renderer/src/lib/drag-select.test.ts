import { describe, expect, it } from "vitest";

import { DRAG_THRESHOLD, EDGE_BAND, edgeScrollSpeed, pastThreshold } from "./drag-select";

describe("pastThreshold", () => {
  it("treats a small wobble as a click", () => {
    expect(pastThreshold(10, 10, 12, 11)).toBe(false);
  });

  it("treats a real move as a drag, in any direction", () => {
    expect(pastThreshold(10, 10, 10 + DRAG_THRESHOLD, 10)).toBe(true);
    expect(pastThreshold(10, 10, 10, 10 - DRAG_THRESHOLD)).toBe(true);
  });
});

describe("edgeScrollSpeed", () => {
  const top = 100;
  const bottom = 500;

  it("does not scroll while the pointer is well inside the list", () => {
    expect(edgeScrollSpeed(300, top, bottom)).toBe(0);
    expect(edgeScrollSpeed(top + EDGE_BAND, top, bottom)).toBe(0);
  });

  it("scrolls up near the top edge and down near the bottom edge", () => {
    expect(edgeScrollSpeed(top + 10, top, bottom)).toBeLessThan(0);
    expect(edgeScrollSpeed(bottom - 10, top, bottom)).toBeGreaterThan(0);
  });

  it("goes faster the closer to the edge, and tops out beyond it", () => {
    const near = Math.abs(edgeScrollSpeed(top + 30, top, bottom));
    const at = Math.abs(edgeScrollSpeed(top, top, bottom));
    const beyond = Math.abs(edgeScrollSpeed(top - 200, top, bottom));
    expect(at).toBeGreaterThan(near);
    expect(beyond).toBe(at);
  });
});

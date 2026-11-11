import { describe, expect, it } from "vitest";

import { edgeColorFromPixels } from "./edge-color";

/** A width x height image filled with one RGBA color, then individual pixels overridden. */
function image(width: number, height: number, fill: number[], overrides: Record<string, number[]> = {}) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) pixels.set(overrides[`${x},${y}`] ?? fill, (y * width + x) * 4);
  }
  return pixels;
}

describe("edgeColorFromPixels", () => {
  it("reports the solid background of a full-bleed icon", () => {
    expect(edgeColorFromPixels(image(8, 8, [0, 0, 0, 255]), 8, 8)).toBe("rgb(0 0 0)");
    expect(edgeColorFromPixels(image(8, 8, [228, 37, 39, 255]), 8, 8)).toBe("rgb(228 37 39)");
  });

  it("ignores what is inside: only the corners count", () => {
    const logo = image(8, 8, [0, 0, 0, 255], { "3,3": [255, 0, 0, 255], "4,4": [255, 0, 0, 255] });
    expect(edgeColorFromPixels(logo, 8, 8)).toBe("rgb(0 0 0)");
  });

  it("returns null for transparent corners (a logo that needs its own backdrop)", () => {
    expect(edgeColorFromPixels(image(8, 8, [0, 0, 0, 0]), 8, 8)).toBeNull();
    expect(edgeColorFromPixels(image(8, 8, [10, 10, 10, 255], { "0,0": [0, 0, 0, 0], "4,1": [0, 0, 0, 0] }), 8, 8)).toBeNull();
  });

  it("falls back to the middle of the edges for an icon drawn as a rounded tile", () => {
    // Transparent corners, solid tile color along the edges.
    const tile = image(8, 8, [20, 80, 160, 255], {
      "0,0": [0, 0, 0, 0], "7,0": [0, 0, 0, 0], "0,7": [0, 0, 0, 0], "7,7": [0, 0, 0, 0],
    });
    expect(edgeColorFromPixels(tile, 8, 8)).toBe("rgb(20 80 160)");
  });

  it("is null for a glyph on a fully transparent background", () => {
    expect(edgeColorFromPixels(image(8, 8, [0, 0, 0, 0], { "4,4": [255, 0, 0, 255] }), 8, 8)).toBeNull();
  });

  it("returns null when the corners disagree (gradients, photos, rounded tiles on a backdrop)", () => {
    const split: Record<string, number[]> = {};
    for (let y = 0; y < 8; y++) for (let x = 4; x < 8; x++) split[`${x},${y}`] = [255, 255, 255, 255];
    // Black on the left, white on the right: neither corners nor edges agree.
    expect(edgeColorFromPixels(image(8, 8, [0, 0, 0, 255], split), 8, 8)).toBeNull();
  });

  it("tolerates small differences such as compression noise", () => {
    expect(edgeColorFromPixels(image(8, 8, [100, 100, 100, 255], { "7,0": [108, 96, 104, 255] }), 8, 8)).not.toBeNull();
  });
});

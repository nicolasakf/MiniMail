import { describe, expect, it } from "vitest";

import { DEFAULT_COMPOSER_LAYOUT, MIN_COMPOSER_HEIGHT, MIN_COMPOSER_WIDTH, parseComposerLayout } from "./composer-layout";

describe("parseComposerLayout", () => {
  it("uses the defaults when nothing was stored", () => {
    expect(parseComposerLayout(null)).toEqual(DEFAULT_COMPOSER_LAYOUT);
  });

  it("reads a stored layout", () => {
    expect(parseComposerLayout(JSON.stringify({ side: "left", width: 720, height: 500 }))).toEqual({ side: "left", width: 720, height: 500 });
  });

  it("keeps the sizes above the minimum and fills in what is missing or damaged", () => {
    expect(parseComposerLayout(JSON.stringify({ side: "up", width: 10, height: "tall" }))).toEqual({
      side: "right",
      width: MIN_COMPOSER_WIDTH,
      height: DEFAULT_COMPOSER_LAYOUT.height,
    });
    expect(parseComposerLayout(JSON.stringify({ height: 1 })).height).toBe(MIN_COMPOSER_HEIGHT);
    expect(parseComposerLayout("42")).toEqual(DEFAULT_COMPOSER_LAYOUT);
  });
});

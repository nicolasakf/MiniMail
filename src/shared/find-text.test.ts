import { describe, expect, it } from "vitest";

import { containsText, findOffsets, matchLength, stepIndex } from "./find-text";

describe("findOffsets", () => {
  it("finds every match, ignoring case", () => {
    expect(findOffsets("Invoice for the invoice", "INVOICE")).toEqual([0, 16]);
  });

  it("ignores accents in the text and in the query", () => {
    expect(findOffsets("Café au lait", "cafe")).toEqual([0]);
    expect(findOffsets("cafe", "café")).toEqual([0]);
  });

  it("does not overlap matches", () => {
    expect(findOffsets("aaaa", "aa")).toEqual([0, 2]);
  });

  it("finds nothing for an empty or blank query", () => {
    expect(findOffsets("hello", "")).toEqual([]);
    expect(findOffsets("hello", "   ")).toEqual([]);
  });

  it("keeps offsets aligned with the original when characters are decomposed", () => {
    const text = "étude then word";
    expect(findOffsets(text, "word")).toEqual([text.indexOf("word")]);
  });
});

describe("matchLength / containsText", () => {
  it("measures the trimmed query", () => {
    expect(matchLength("  hi ")).toBe(2);
  });
  it("tells whether the text holds the query", () => {
    expect(containsText("Hello there", "there")).toBe(true);
    expect(containsText("Hello there", "bye")).toBe(false);
  });
});

describe("stepIndex", () => {
  it("wraps in both directions", () => {
    expect(stepIndex(2, 1, 3)).toBe(0);
    expect(stepIndex(0, -1, 3)).toBe(2);
  });
  it("stays at 0 with no matches", () => {
    expect(stepIndex(0, 1, 0)).toBe(0);
  });
});

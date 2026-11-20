import { describe, expect, it } from "vitest";

import type { Category } from "@shared/types";

import { categoryChanges, needsResort, resortAdvice } from "./category-changes";

const make = (id: string, overrides: Partial<Category> = {}): Category => ({
  id,
  name: id,
  criteria: `${id} criteria`,
  hue: 10,
  ...overrides,
});

describe("categoryChanges", () => {
  const saved = [make("a"), make("b"), make("c")];

  it("sees nothing when the draft is the saved list", () => {
    expect(needsResort(categoryChanges(saved, saved.map((c) => ({ ...c }))))).toBe(false);
  });

  it("does not count a rename, an icon, a color or a new order", () => {
    const draft = [
      make("c", { name: "Gamma", icon: "Tag", hue: 200 }),
      make("a", { name: "Alpha" }),
      make("b"),
    ];
    expect(needsResort(categoryChanges(saved, draft))).toBe(false);
  });

  it("ignores whitespace around criteria", () => {
    const draft = [make("a", { criteria: "  a criteria  " }), make("b"), make("c")];
    expect(needsResort(categoryChanges(saved, draft))).toBe(false);
  });

  it("finds added, reworded and deleted categories", () => {
    const draft = [make("a", { criteria: "something else" }), make("c"), make("d")];
    const changes = categoryChanges(saved, draft);
    expect(changes.added.map((c) => c.id)).toEqual(["d"]);
    expect(changes.reworded.map((c) => c.id)).toEqual(["a"]);
    expect(changes.deleted.map((c) => c.id)).toEqual(["b"]);
    expect(needsResort(changes)).toBe(true);
  });
});

describe("resortAdvice", () => {
  it("names what changed and says when something was deleted", () => {
    const saved = [make("a", { name: "Ads" }), make("b", { name: "News" }), make("c", { name: "Bills" })];
    const advice = resortAdvice(categoryChanges(saved, [make("c", { name: "Bills" })]));
    expect(advice.deleted).toBe(true);
    expect(advice.lines).toEqual(["You deleted Ads and News. That mail has no category until it is sorted again."]);
  });

  it("is not about deletion when nothing was deleted", () => {
    const advice = resortAdvice(categoryChanges([], [make("a", { name: "Ads" })]));
    expect(advice.deleted).toBe(false);
    expect(advice.lines[0]).toContain("You added Ads");
  });
});

import { describe, expect, it } from "vitest";

import { DEFAULT_CATEGORIES } from "@shared/categories";

import { ICON_NAMES, searchIcons } from "./category-icon";

describe("category icons", () => {
  it("offers the whole Lucide set, including every built-in category's icon", () => {
    expect(ICON_NAMES.length).toBeGreaterThan(1000);
    for (const category of DEFAULT_CATEGORIES) {
      expect(ICON_NAMES, category.name).toContain(category.icon);
    }
  });

  it("finds icons by any words of their name", () => {
    expect(searchIcons("calendar plus")).toContain("CalendarPlus");
    expect(searchIcons("cal-plus")).toContain("CalendarPlus");
    expect(searchIcons("RECEIPT")).toContain("Receipt");
    expect(searchIcons("zzzznothing")).toEqual([]);
  });

  it("returns everything for an empty search", () => {
    expect(searchIcons("  ")).toHaveLength(ICON_NAMES.length);
  });
});

import { describe, expect, it } from "vitest";

import { buildFlatList, PINNED_SECTION } from "./focus-list";
import type { Thread } from "./threads";

const NOW = new Date("2026-11-16T12:00:00.000Z");

const thread = (id: string, date: string, pinned = false): Thread => {
  const latest = { id, date } as Thread["latest"];
  return { id, accountId: "a", messages: [latest], latest, count: 1, unread: false, pinned, answered: false, hasAttachments: false, categoryId: null };
};

const keys = (items: ReturnType<typeof buildFlatList>) => items.map((item) => item.key);

describe("buildFlatList", () => {
  const threads = [thread("new", "2026-11-16T10:00:00.000Z"), thread("old", "2026-11-01T10:00:00.000Z", true)];

  it("lists pinned conversations in their date section unless a Pinned section is asked for", () => {
    expect(keys(buildFlatList(threads, NOW))).not.toContain(PINNED_SECTION);
    expect(keys(buildFlatList(threads, NOW))).toContain("old");
  });

  it("puts pinned conversations under a Pinned heading before the date sections", () => {
    const items = buildFlatList(threads, NOW, { pinnedSection: { collapsed: false } });
    expect(keys(items).slice(0, 2)).toEqual([PINNED_SECTION, "old"]);
    expect(keys(items).filter((key) => key === "old")).toHaveLength(1);
    expect(items[0]).toMatchObject({ label: "Pinned", collapsible: { collapsed: false, count: 1 } });
  });

  it("hides the pinned rows, not the heading, when it is collapsed, and omits it with nothing pinned", () => {
    expect(keys(buildFlatList(threads, NOW, { pinnedSection: { collapsed: true } }))).not.toContain("old");
    expect(keys(buildFlatList(threads, NOW, { pinnedSection: { collapsed: true } }))).toContain(PINNED_SECTION);
    expect(keys(buildFlatList([threads[0]], NOW, { pinnedSection: { collapsed: false } }))).not.toContain(PINNED_SECTION);
  });
});

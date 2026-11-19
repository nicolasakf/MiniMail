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

describe("collapsible date sections", () => {
  const threads = [
    thread("today", "2026-11-16T10:00:00.000Z"),
    thread("last", "2026-11-10T10:00:00.000Z"),
    thread("oct", "2026-10-10T10:00:00.000Z"),
  ];

  it("makes every date heading collapsible and lists them newest first", () => {
    const sections = buildFlatList(threads, NOW).filter((item) => item.type === "section");
    expect(sections.map((item) => item.key)).toEqual(["section:today", "section:last-week", "section:month-2026-9"]);
    for (const section of sections) expect(section).toMatchObject({ collapsible: { collapsed: false, count: 1 } });
  });

  it("keeps a folded heading, with the count it hides, and drops only its conversations", () => {
    const items = buildFlatList(threads, NOW, { collapsedSections: new Set(["section:last-week"]) });
    expect(keys(items)).toEqual(["section:today", "today", "section:last-week", "section:month-2026-9", "oct"]);
    expect(items[2]).toMatchObject({ collapsible: { collapsed: true, count: 1 } });
  });
});

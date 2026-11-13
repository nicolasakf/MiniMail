import { describe, expect, it } from "vitest";

import type { ListItem } from "@shared/focus-list";

import { blockIndexByKey, blockKey, listBlocks } from "./list-blocks";

const section = (key: string): ListItem => ({ type: "section", key, label: key });
const group = (key: string): ListItem =>
  ({ type: "group", key, kind: key, label: key, hue: null, icon: null, count: 0, hasUnread: false, unreadCount: 0, chips: [] }) as ListItem;
const thread = (key: string): ListItem => ({ type: "thread", key, thread: {} as never });

const items = [group("g1"), group("g2"), section("s"), thread("t1"), group("g3"), thread("t2")];

describe("listBlocks", () => {
  it("keeps one block per item when groups are rows", () => {
    expect(listBlocks(items, false)).toHaveLength(items.length);
  });

  it("merges consecutive groups into one run when groups are cards", () => {
    expect(listBlocks(items, true)).toEqual([
      { type: "run", start: 0, end: 2 },
      { type: "item", index: 2 },
      { type: "item", index: 3 },
      { type: "run", start: 4, end: 5 },
      { type: "item", index: 5 },
    ]);
  });

  it("names a run by its first group", () => {
    const blocks = listBlocks(items, true);
    expect(blocks.map((block) => blockKey(items, block))).toEqual(["g1", "s", "t1", "g3", "t2"]);
  });

  it("maps every key, including groups inside a run, to its block", () => {
    const blocks = listBlocks(items, true);
    const byKey = blockIndexByKey(items, blocks);
    expect(byKey.get("g1")).toBe(0);
    expect(byKey.get("g2")).toBe(0);
    expect(byKey.get("t1")).toBe(2);
    expect(byKey.get("t2")).toBe(4);
  });

  it("handles an empty list", () => {
    expect(listBlocks([], true)).toEqual([]);
  });
});

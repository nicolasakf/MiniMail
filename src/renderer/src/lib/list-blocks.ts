import type { ListItem } from "@shared/focus-list";

/**
 * One virtualized row of the list: a single item, or (with the vertical category layout) a whole
 * run of consecutive groups drawn together as one grid of cards.
 */
export type ListBlock =
  | { type: "item"; index: number }
  /** `items[start..end)` are consecutive groups. */
  | { type: "run"; start: number; end: number };

/** Splits the items into the blocks the list virtualizes; `groupRuns` merges consecutive groups into one. */
export function listBlocks(items: readonly ListItem[], groupRuns: boolean): ListBlock[] {
  const blocks: ListBlock[] = [];
  for (let index = 0; index < items.length; index++) {
    if (groupRuns && items[index].type === "group") {
      let end = index + 1;
      while (items[end]?.type === "group") end++;
      blocks.push({ type: "run", start: index, end });
      index = end - 1;
    } else {
      blocks.push({ type: "item", index });
    }
  }
  return blocks;
}

/** The item key a block stands for (a run takes its first group's key): stable across renders. */
export function blockKey(items: readonly ListItem[], block: ListBlock): string {
  return items[block.type === "item" ? block.index : block.start].key;
}

/** Which block each item key lives in, to scroll a selected row into view. */
export function blockIndexByKey(items: readonly ListItem[], blocks: readonly ListBlock[]): Map<string, number> {
  const byKey = new Map<string, number>();
  blocks.forEach((block, position) => {
    if (block.type === "item") {
      byKey.set(items[block.index].key, position);
      return;
    }
    for (let index = block.start; index < block.end; index++) byKey.set(items[index].key, position);
  });
  return byKey;
}

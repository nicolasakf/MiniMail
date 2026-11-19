import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown } from "lucide-react";

import type { GroupKind, ListItem } from "@shared/focus-list";
import type { Thread } from "@shared/threads";
import type { Account, MailAction, MailFolder } from "@shared/types";

import { effectiveCategoryLayout, useAppearance } from "@/lib/appearance";
import {
  blockIndexByKey,
  blockKey,
  listBlocks,
  type ListBlock,
} from "@/lib/list-blocks";
import { cn } from "@/lib/utils";

import { CategoryDock } from "./category-dock";
import { MinimizedIcons } from "./minimized-icons";
import { GroupCard, GroupRow } from "./group-row";
import { ThreadRow, type SelectModifiers } from "./thread-row";

// Category cards: one row, always. Each card flexes between CARD_MIN and CARD_MAX; when even the
// minimum no longer fits, the row scrolls sideways instead of wrapping.
const CARD_MIN = 180;
const CARD_MAX = 280;

interface FocusedListProps {
  items: readonly ListItem[];
  folder: MailFolder;
  /** The list mixes folders: each row marks its own folder (see `ThreadRow`). */
  showFolder?: boolean;
  accounts: readonly Account[];
  selectedKey: string | null;
  checked: ReadonlySet<string>;
  onSelect: (key: string, modifiers?: SelectModifiers) => void;
  onOpenThread: (thread: Thread) => void;
  onOpenGroup: (kind: GroupKind) => void;
  /** Click on a sender chip in a group row: opens that conversation directly. */
  onOpenThreadById: (threadId: string) => void;
  onToggleGroupRead: (kind: GroupKind, unread: boolean) => void;
  onThreadAction: (action: MailAction, thread: Thread) => void;
  /** Asks to unsubscribe from a conversation's list (the hover button); see `ThreadRow`. */
  onThreadUnsubscribe?: (thread: Thread, point: { x: number; y: number }) => void;
  /** Right-click on a row: selects it and opens its menu at the pointer. */
  onItemMenu: (key: string, x: number, y: number) => void;
  /** Click on a collapsible heading (Pinned): hides or shows what is under it. */
  onToggleSection: (key: string) => void;
  /** Categories the user minimized: stacked at the right edge instead of listed. */
  minimized?: readonly Extract<ListItem, { type: "group" }>[];
}

/**
 * Below this list width (px) a conversation no longer fits on one line: the subject and the
 * subject moves under the sender's name and the preview is left out. It matters in the split view, where the list can be dragged narrow.
 */
export const COMPACT_BELOW = 460;

/** Guesses before a block is measured (px); the real height replaces each one once it is on screen. */
const ESTIMATE = { section: 32, thread: 40, group: 57, run: 160 } as const;
/** Compact rows are two lines: the sender, then the subject. */
const COMPACT_THREAD = 64;

/** Blocks drawn above and below the viewport, so fast scrolling and arrowing never show a blank. */
const OVERSCAN = 12;

/**
 * Scrollable list of date sections, conversation rows and group rows. Only the rows in (or near)
 * the viewport are in the DOM: a mailbox holds up to MAIL_WINDOW conversations per account.
 */
export function FocusedList({
  items,
  folder,
  showFolder = false,
  accounts,
  selectedKey,
  checked,
  onSelect,
  onOpenThread,
  onOpenGroup,
  onOpenThreadById,
  onToggleGroupRead,
  onThreadAction,
  onThreadUnsubscribe,
  onItemMenu,
  onToggleSection,
  minimized = [],
}: FocusedListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const showAccountDot = accounts.length > 1;
  const appearance = useAppearance();
  const vertical = effectiveCategoryLayout(appearance) === "vertical";
  // Whether the list is narrower than `COMPACT_BELOW`; its rows then use their stacked layout.
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = (width: number) => setCompact(width < COMPACT_BELOW);
    update(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => update(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const highlighted = (item: ListItem | undefined) =>
    item?.type === "thread" &&
    (selectedKey === item.key || checked.has(item.thread.id));

  // A run of categories is one grid (vertical layout), so it is one block of the virtual list.
  const blocks = useMemo(() => listBlocks(items, vertical), [items, vertical]);
  const blockOfKey = useMemo(
    () => blockIndexByKey(items, blocks),
    [items, blocks],
  );

  const virtualizer = useVirtualizer({
    count: blocks.length,
    getScrollElement: () => containerRef.current,
    estimateSize: (position) => {
      const block = blocks[position];
      if (block.type === "run") return ESTIMATE.run;
      const type = items[block.index].type;
      if (type === "thread" && compact) return COMPACT_THREAD;
      return ESTIMATE[type];
    },
    getItemKey: (position) => blockKey(items, blocks[position]),
    overscan: OVERSCAN,
  });

  // Rows change height when the layout switches; drop the heights measured for the other one.
  useEffect(() => {
    virtualizer.measure();
  }, [compact, virtualizer]);

  // Keep the keyboard selection visible while arrowing through a long list. The row may not be
  // mounted (it is off screen), so scroll by position rather than by element.
  const blockOfKeyRef = useRef(blockOfKey);
  blockOfKeyRef.current = blockOfKey;
  useEffect(() => {
    if (!selectedKey) return;
    const position = blockOfKeyRef.current.get(selectedKey);
    if (position !== undefined)
      virtualizer.scrollToIndex(position, { align: "auto" });
  }, [selectedKey, virtualizer]);

  const renderBlock = (block: ListBlock): ReactNode => {
    if (block.type === "run") {
      const run = items.slice(block.start, block.end) as Extract<
        ListItem,
        { type: "group" }
      >[];
      return (
        <div className="overflow-x-auto">
          <div
            className="grid justify-start gap-3 px-4 pb-3 pt-2"
            style={{
              gridTemplateColumns: `repeat(${run.length}, minmax(${CARD_MIN}px, ${CARD_MAX}px))`,
            }}
          >
            {run.map((group) => (
              <GroupCard
                key={group.key}
                group={group}
                selected={selectedKey === group.key}
                onSelect={onSelect}
                onOpen={onOpenGroup}
                onOpenThread={onOpenThreadById}
                onToggleRead={onToggleGroupRead}
                onMenu={onItemMenu}
              />
            ))}
          </div>
        </div>
      );
    }
    const { index } = block;
    const item = items[index];
    switch (item.type) {
      case "section": {
        const { collapsible, docked } = item;
        const heading =
          "px-6 pb-1 pt-3 text-xs font-medium text-muted-foreground";
        if (!collapsible) return <div className={heading}>{item.label}</div>;
        // The Minimized heading, folded: the minimized categories sit as icons right on the heading line.
        if (docked && collapsible.collapsed) {
          return (
            <div className="flex items-center gap-2 px-6 pb-1 pt-3">
              <button
                type="button"
                aria-expanded={false}
                onClick={() => onToggleSection(item.key)}
                className="flex shrink-0 items-center gap-1 text-left text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
              >
                {item.label}
                <ChevronDown className="size-3.5 -rotate-90" />
              </button>
              <MinimizedIcons
                groups={docked}
                selectedKey={selectedKey}
                onSelect={onSelect}
                onOpen={onOpenGroup}
                onMenu={onItemMenu}
              />
            </div>
          );
        }
        // Looks like the date headings; only the chevron (and the count while hidden) tell it folds.
        // The padding sits on a wrapper, so only the text and chevron are clickable, not the whole width.
        return (
          <div className={heading}>
            <button
              type="button"
              aria-expanded={!collapsible.collapsed}
              onClick={() => onToggleSection(item.key)}
              className="flex items-center gap-1 text-left outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
            >
              {item.label}
              {collapsible.collapsed && (
                <span className="font-normal">{collapsible.count}</span>
              )}
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform",
                  collapsible.collapsed && "-rotate-90",
                )}
              />
            </button>
          </div>
        );
      }
      case "group":
        return (
          <GroupRow
            group={item}
            selected={selectedKey === item.key}
            className={
              items[index - 1]?.type === "group" ? "mt-[5px]" : undefined
            }
            onSelect={onSelect}
            onOpen={onOpenGroup}
            onOpenThread={onOpenThreadById}
            onToggleRead={onToggleGroupRead}
            onMenu={onItemMenu}
          />
        );
      case "thread":
        return (
          <ThreadRow
            rowKey={item.key}
            thread={item.thread}
            folder={folder}
            accounts={accounts}
            selected={selectedKey === item.key}
            checked={checked.has(item.thread.id)}
            joinTop={highlighted(items[index - 1])}
            joinBottom={highlighted(items[index + 1])}
            showAccountDot={showAccountDot}
            showFolder={showFolder}
            compact={compact}
            onSelect={onSelect}
            onOpen={onOpenThread}
            onAction={onThreadAction}
            onUnsubscribe={onThreadUnsubscribe}
            onMenu={onItemMenu}
          />
        );
    }
  };

  // A size container: the rows size their name column from the width of the list, not the window.
  return (
    <div className="flex min-h-0 flex-1">
      <div
        ref={containerRef}
        role="grid"
        className="min-h-0 min-w-0 flex-1 overflow-y-auto pb-20 [container-type:inline-size]"
      >
        <div
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((virtual) => (
            // Absolutely placed: it is also a block formatting context, so a row's own margin counts in the height measured.
            <div
              key={virtual.key}
              ref={virtualizer.measureElement}
              data-index={virtual.index}
              role="presentation"
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${virtual.start}px)` }}
            >
              {renderBlock(blocks[virtual.index])}
            </div>
          ))}
        </div>
      </div>
      <CategoryDock
        groups={minimized}
        selectedKey={selectedKey}
        onSelect={onSelect}
        onOpen={onOpenGroup}
        onMenu={onItemMenu}
      />
    </div>
  );
}

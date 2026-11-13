import { useEffect, useMemo, useRef, type ReactNode } from "react";

import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown } from "lucide-react";

import type { GroupKind, ListItem } from "@shared/focus-list";
import type { Thread } from "@shared/threads";
import type { Account, MailAction, MailFolder } from "@shared/types";

import { useAppearance } from "@/lib/appearance";
import { blockIndexByKey, blockKey, listBlocks, type ListBlock } from "@/lib/list-blocks";
import { cn } from "@/lib/utils";

import { CategoryDock } from "./category-dock";
import { GroupCard, GroupRow } from "./group-row";
import { ThreadRow, type SelectModifiers } from "./thread-row";

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
  /** Right-click on a row: selects it and opens its menu at the pointer. */
  onItemMenu: (key: string, x: number, y: number) => void;
  /** Click on a collapsible heading (Pinned): hides or shows what is under it. */
  onToggleSection: (key: string) => void;
  /** Categories the user minimized: stacked at the right edge instead of listed. */
  minimized?: readonly Extract<ListItem, { type: "group" }>[];
}

/** Guesses before a block is measured (px); the real height replaces each one once it is on screen. */
const ESTIMATE = { section: 32, thread: 40, group: 57, run: 160 } as const;

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
  onItemMenu,
  onToggleSection,
  minimized = [],
}: FocusedListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const showAccountDot = accounts.length > 1;
  const vertical = useAppearance().categoryLayout === "vertical";
  const highlighted = (item: ListItem | undefined) =>
    item?.type === "thread" && (selectedKey === item.key || checked.has(item.thread.id));

  // A run of categories is one grid (vertical layout), so it is one block of the virtual list.
  const blocks = useMemo(() => listBlocks(items, vertical), [items, vertical]);
  const blockOfKey = useMemo(() => blockIndexByKey(items, blocks), [items, blocks]);

  const virtualizer = useVirtualizer({
    count: blocks.length,
    getScrollElement: () => containerRef.current,
    estimateSize: (position) => {
      const block = blocks[position];
      if (block.type === "run") return ESTIMATE.run;
      return ESTIMATE[items[block.index].type];
    },
    getItemKey: (position) => blockKey(items, blocks[position]),
    overscan: OVERSCAN,
  });

  // Keep the keyboard selection visible while arrowing through a long list. The row may not be
  // mounted (it is off screen), so scroll by position rather than by element.
  const blockOfKeyRef = useRef(blockOfKey);
  blockOfKeyRef.current = blockOfKey;
  useEffect(() => {
    if (!selectedKey) return;
    const position = blockOfKeyRef.current.get(selectedKey);
    if (position !== undefined) virtualizer.scrollToIndex(position, { align: "auto" });
  }, [selectedKey, virtualizer]);

  const renderBlock = (block: ListBlock): ReactNode => {
    if (block.type === "run") {
      const run = items.slice(block.start, block.end) as Extract<ListItem, { type: "group" }>[];
      return (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(178px,1fr))] gap-3 px-4 pb-1 pt-2">
          {run.map((group) => (
            <GroupCard
              key={group.key}
              group={group}
              selected={selectedKey === group.key}
              onSelect={onSelect}
              onOpen={onOpenGroup}
              onOpenThread={onOpenThreadById}
              onMenu={onItemMenu}
            />
          ))}
        </div>
      );
    }
    const { index } = block;
    const item = items[index];
    switch (item.type) {
      case "section": {
        const { collapsible } = item;
        const heading = "px-6 pb-1 pt-3 text-xs font-medium text-muted-foreground";
        if (!collapsible) return <div className={heading}>{item.label}</div>;
        // Looks like the date headings; only the chevron (and the count while hidden) tell it folds.
        return (
          <button
            type="button"
            aria-expanded={!collapsible.collapsed}
            onClick={() => onToggleSection(item.key)}
            className={cn(
              heading,
              "flex w-full items-center gap-1 text-left outline-none transition-colors hover:text-foreground focus-visible:text-foreground",
            )}
          >
            {item.label}
            {collapsible.collapsed && <span className="font-normal">{collapsible.count}</span>}
            <ChevronDown
              className={cn("size-3.5 transition-transform", collapsible.collapsed && "-rotate-90")}
            />
          </button>
        );
      }
      case "group":
        return (
          <GroupRow
            group={item}
            selected={selectedKey === item.key}
            className={items[index - 1]?.type === "group" ? "mt-[5px]" : undefined}
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
            onSelect={onSelect}
            onOpen={onOpenThread}
            onAction={onThreadAction}
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
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
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

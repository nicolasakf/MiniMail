import { useEffect, useRef } from "react";

import { ChevronDown } from "lucide-react";

import type { GroupKind, ListItem } from "@shared/focus-list";
import type { Thread } from "@shared/threads";
import type { Account, MailAction, MailFolder } from "@shared/types";

import { cn } from "@/lib/utils";

import { GroupRow } from "./group-row";
import { ThreadRow } from "./thread-row";

interface FocusedListProps {
  items: readonly ListItem[];
  folder: MailFolder;
  /** The list mixes folders: each row marks its own folder (see `ThreadRow`). */
  showFolder?: boolean;
  accounts: readonly Account[];
  selectedKey: string | null;
  selectMode: boolean;
  checked: ReadonlySet<string>;
  onSelect: (key: string) => void;
  onOpenThread: (thread: Thread) => void;
  onOpenGroup: (kind: GroupKind) => void;
  /** Click on a sender chip in a group row: opens that conversation directly. */
  onOpenThreadById: (threadId: string) => void;
  onToggleGroupRead: (kind: GroupKind, unread: boolean) => void;
  onToggleChecked: (threadId: string) => void;
  onThreadAction: (action: MailAction, thread: Thread) => void;
  /** Right-click on a row: selects it and opens its menu at the pointer. */
  onItemMenu: (key: string, x: number, y: number) => void;
  /** Click on a collapsible heading (Pinned): hides or shows what is under it. */
  onToggleSection: (key: string) => void;
}

/** Scrollable list of date sections, conversation rows and group rows. */
export function FocusedList({
  items,
  folder,
  showFolder = false,
  accounts,
  selectedKey,
  selectMode,
  checked,
  onSelect,
  onOpenThread,
  onOpenGroup,
  onOpenThreadById,
  onToggleGroupRead,
  onToggleChecked,
  onThreadAction,
  onItemMenu,
  onToggleSection,
}: FocusedListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const showAccountDot = accounts.length > 1;

  // Keep the keyboard selection visible while arrowing through a long list.
  useEffect(() => {
    if (!selectedKey) return;
    const row = containerRef.current?.querySelector<HTMLElement>(
      `[data-row-key="${CSS.escape(selectedKey)}"]`,
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedKey]);

  // A size container: the rows size their name column from the width of the list, not the window.
  return (
    <div
      ref={containerRef}
      role="grid"
      className="min-h-0 flex-1 overflow-y-auto pb-20 [container-type:inline-size]"
    >
      {items.map((item, index) => {
        switch (item.type) {
          case "section": {
            const { collapsible } = item;
            const heading = "px-6 pb-1 pt-3 text-xs font-medium text-muted-foreground";
            if (!collapsible) {
              return (
                <div key={item.key} className={heading}>
                  {item.label}
                </div>
              );
            }
            // Looks like the date headings; only the chevron (and the count while hidden) tell it folds.
            return (
              <button
                key={item.key}
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
                key={item.key}
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
                key={item.key}
                rowKey={item.key}
                thread={item.thread}
                folder={folder}
                accounts={accounts}
                selected={selectedKey === item.key}
                selectMode={selectMode}
                checked={checked.has(item.thread.id)}
                showAccountDot={showAccountDot}
                showFolder={showFolder}
                onSelect={onSelect}
                onOpen={onOpenThread}
                onToggleChecked={onToggleChecked}
                onAction={onThreadAction}
                onMenu={onItemMenu}
              />
            );
        }
      })}
    </div>
  );
}

import { useEffect, useRef } from "react";

import type { GroupKind, ListItem } from "@shared/focus-list";
import type { Thread } from "@shared/threads";
import type { Account, MailAction, MailFolder } from "@shared/types";

import { GroupRow } from "./group-row";
import { ThreadRow } from "./thread-row";

interface FocusedListProps {
  items: readonly ListItem[];
  folder: MailFolder;
  accounts: readonly Account[];
  selectedKey: string | null;
  selectMode: boolean;
  checked: ReadonlySet<string>;
  onSelect: (key: string) => void;
  onOpenThread: (thread: Thread) => void;
  onOpenGroup: (kind: GroupKind) => void;
  onToggleGroupRead: (kind: GroupKind, unread: boolean) => void;
  onToggleChecked: (threadId: string) => void;
  onThreadAction: (action: MailAction, thread: Thread) => void;
  /** Right-click on a row: selects it and opens its menu at the pointer. */
  onItemMenu: (key: string, x: number, y: number) => void;
}

/** Scrollable list of date sections, conversation rows and group rows. */
export function FocusedList({
  items,
  folder,
  accounts,
  selectedKey,
  selectMode,
  checked,
  onSelect,
  onOpenThread,
  onOpenGroup,
  onToggleGroupRead,
  onToggleChecked,
  onThreadAction,
  onItemMenu,
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
          case "section":
            return (
              <div
                key={item.key}
                className="px-6 pb-1 pt-3 text-xs font-medium text-muted-foreground"
              >
                {item.label}
              </div>
            );
          case "group":
            return (
              <GroupRow
                key={item.key}
                group={item}
                selected={selectedKey === item.key}
                className={items[index - 1]?.type === "group" ? "mt-2.5" : undefined}
                onSelect={onSelect}
                onOpen={onOpenGroup}
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

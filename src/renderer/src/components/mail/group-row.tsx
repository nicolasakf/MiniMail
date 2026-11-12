import { memo, useLayoutEffect, useRef, useState } from "react";

import { ChevronRight } from "lucide-react";

import {
  type GroupDef,
  type GroupKind,
  type ListItem,
  type SenderChip,
} from "@shared/focus-list";

import { cn } from "@/lib/utils";

import { CategoryIcon } from "./category-icon";
import { canShowCode, CodeChip } from "./code-chip";
import { ReadToggle } from "./read-toggle";
import { SenderAvatar } from "./sender-avatar";

type GroupItem = Extract<ListItem, { type: "group" }>;

/** Tint standing in for Spark's colored tiles: the category hue, or Orion's chart color without one. */
function groupStyle(group: GroupDef): { color: string; tint: string } {
  if (group.hue === null) {
    return { color: "hsl(var(--chart-3))", tint: "hsl(var(--chart-3) / 0.16)" };
  }
  return { color: `hsl(${group.hue} 70% 62%)`, tint: `hsl(${group.hue} 70% 55% / 0.16)` };
}

/** The round colored tile with a category's icon. */
export function GroupTile({ group }: { group: GroupDef }) {
  const { color, tint } = groupStyle(group);
  return (
    <span
      className="flex size-9 shrink-0 items-center justify-center rounded-full"
      style={{ background: tint, color }}
    >
      <CategoryIcon icon={group.icon} className="size-[18px]" />
    </span>
  );
}

/** Chips rendered per row; the ones that do not fit on the row's single line stay hidden. */
const MAX_CHIPS = 24;

/** The small avatar on a sender chip: the company logo when there is one, else initials. */
function ChipAvatar({ chip }: { chip: SenderChip }) {
  return <SenderAvatar contact={{ name: chip.name, email: chip.email }} size={18} logo={chip.logo} />;
}

interface GroupRowProps {
  group: GroupItem;
  selected: boolean;
  /** Opens the group's own list. */
  onOpen: (kind: GroupKind) => void;
  /** Opens one conversation straight from a sender chip, without opening the group's list. */
  onOpenThread: (threadId: string) => void;
  onSelect: (key: string) => void;
  /** Marks every conversation in the group read (when it has unread ones) or unread. */
  onToggleRead: (kind: GroupKind, unread: boolean) => void;
  /** Right-click: opens the row's menu at the pointer. */
  onMenu: (key: string, x: number, y: number) => void;
  className?: string;
}

/** A bucket (Notifications, Newsletters, ...) shown as one row of sender chips; click to open its list. */
export const GroupRow = memo(function GroupRow({
  group,
  selected,
  onOpen,
  onOpenThread,
  onSelect,
  onToggleRead,
  onMenu,
  className,
}: GroupRowProps) {
  const chipsRef = useRef<HTMLDivElement>(null);
  const shown = group.chips.slice(0, MAX_CHIPS);
  const [fitting, setFitting] = useState(shown.length);

  // The chips wrap inside a one-line box, so the ones that do not fit drop to a hidden second
  // line whole instead of being cut off mid-name. Counting the ones on the first line gives "+N".
  useLayoutEffect(() => {
    const box = chipsRef.current;
    if (!box) return;
    const measure = () => {
      const first = box.firstElementChild as HTMLElement | null;
      if (!first) return setFitting(0);
      const top = first.offsetTop;
      let count = 0;
      for (const child of Array.from(box.children) as HTMLElement[]) {
        if (child.offsetTop !== top) break;
        count += 1;
      }
      setFitting(count);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [group.chips]);

  const hiddenChips = group.chips.length - fitting;
  // A verification sender gets a small key button beside it that copies its code.
  const codeFor = (chip: SenderChip) => canShowCode(group.kind, chip.date);

  return (
    <div
      role="row"
      data-row-key={group.key}
      aria-selected={selected}
      className={cn(
        "group corner-squircle relative mx-2 flex h-[52px] cursor-default items-center gap-3 rounded-lg border border-border px-3 text-sm",
        selected ? "bg-sidebar-primary/[0.12] dark:bg-sidebar-primary/25" : "hover:bg-accent/50",
        className,
      )}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(group.key, event.clientX, event.clientY);
      }}
      onClick={() => {
        onSelect(group.key);
        onOpen(group.kind);
      }}
    >
      <ReadToggle
        unread={group.hasUnread}
        noun={group.label.toLowerCase()}
        all
        onToggle={() => onToggleRead(group.kind, group.hasUnread)}
      />

      <GroupTile group={group} />

      <span className="w-[clamp(120px,20cqw,300px)] shrink-0 truncate font-semibold">
        {group.label}
        <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
          {group.count}
          {group.unreadCount > 0 && (
            <>
              {" · "}
              <span className="text-unread">{group.unreadCount}</span>
            </>
          )}
        </span>
      </span>

      <div
        ref={chipsRef}
        className="flex h-7 min-w-0 flex-1 flex-wrap content-start gap-x-2.5 overflow-hidden"
      >
        {shown.map((chip) => (
          <div
            key={chip.key}
            className="flex max-w-full shrink-0 items-center gap-0.5"
          >
            <button
              type="button"
              title={chip.count > 1 ? `Open the latest email from ${chip.name}` : `Open email from ${chip.name}`}
              className="inline-flex h-7 max-w-full shrink-0 cursor-default items-center gap-1.5 rounded-md px-1.5 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              onClick={(event) => {
                // Opens this email only; the row's own click would open the whole category.
                event.stopPropagation();
                onSelect(group.key);
                onOpenThread(chip.threadId);
              }}
              onContextMenu={(event) => event.stopPropagation()}
            >
              {chip.unread && <span className="size-1.5 rounded-full bg-unread" />}
              <ChipAvatar chip={chip} />
              <span className="truncate">{chip.name}</span>
              {chip.count > 1 && <span className="text-[11px] text-muted-foreground">{chip.count}</span>}
            </button>
            {codeFor(chip) && (
              <CodeChip
                messageId={chip.messageId}
                date={chip.date}
                categoryId={group.kind}
                compact
              />
            )}
          </div>
        ))}
      </div>

      <div className="flex w-[112px] shrink-0 items-center justify-end gap-1">
        {hiddenChips > 0 && <span className="text-xs text-muted-foreground">+{hiddenChips}</span>}
        <ChevronRight className="size-4 text-muted-foreground" />
      </div>
    </div>
  );
});

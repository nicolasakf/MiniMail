import { memo } from "react";

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

/** The round colored tile with a category's icon; `compact` is the smaller one on a vertical card. */
export function GroupTile({ group, compact = false }: { group: GroupDef; compact?: boolean }) {
  const { color, tint } = groupStyle(group);
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center rounded-full", compact ? "size-8" : "size-9")}
      style={{ background: tint, color }}
    >
      <CategoryIcon icon={group.icon} className={compact ? "size-4" : "size-[18px]"} />
    </span>
  );
}

/** "12 · 3": how many conversations a category holds and how many of them are unread. */
function GroupCount({ group }: { group: GroupItem }) {
  return (
    <>
      {group.count}
      {group.unreadCount > 0 && (
        <>
          {" · "}
          <span className="text-unread">{group.unreadCount}</span>
        </>
      )}
    </>
  );
}

/** Chips rendered per row; they sit on one clipped line, so the last one that half fits is cropped at the edge. */
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
  const shown = group.chips.slice(0, MAX_CHIPS);
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
          <GroupCount group={group} />
        </span>
      </span>

      <div
        className="flex h-7 min-w-0 flex-1 gap-x-2.5 overflow-hidden"
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

      <ChevronRight className="ml-2 size-4 shrink-0 text-muted-foreground" />
    </div>
  );
});

/** Senders listed on a card; a category with more shows its newest ones. */
const CARD_SENDERS = 5;

interface GroupCardProps {
  group: GroupItem;
  selected: boolean;
  onOpen: (kind: GroupKind) => void;
  onOpenThread: (threadId: string) => void;
  onSelect: (key: string) => void;
  onMenu: (key: string, x: number, y: number) => void;
}

/**
 * The vertical layout of a category: icon, name and "count · unread" on top, its senders stacked
 * below. Clicking the card opens the category's list, clicking a sender opens that email.
 */
export const GroupCard = memo(function GroupCard({
  group,
  selected,
  onOpen,
  onOpenThread,
  onSelect,
  onMenu,
}: GroupCardProps) {
  const shown = group.chips.slice(0, CARD_SENDERS);

  return (
    <div
      role="row"
      data-row-key={group.key}
      aria-selected={selected}
      className={cn(
        "corner-squircle flex min-w-0 cursor-default flex-col rounded-xl border pb-1.5 text-sm transition-colors",
        selected
          ? "border-sidebar-primary/40 bg-sidebar-primary/[0.12] dark:bg-sidebar-primary/25"
          : "border-border hover:bg-accent/50",
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
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <GroupTile group={group} compact />
        <div className="min-w-0">
          <div className="truncate font-semibold leading-tight">{group.label}</div>
          <div className="mt-px text-[11px] text-muted-foreground">
            <GroupCount group={group} />
          </div>
        </div>
      </div>

      <div className="flex flex-col px-1.5">
        {shown.map((chip) => (
          <div key={chip.key} className="flex items-center gap-1">
            <button
              type="button"
              title={chip.count > 1 ? `Open the latest email from ${chip.name}` : `Open email from ${chip.name}`}
              className="flex h-7 min-w-0 flex-1 cursor-default items-center gap-2 rounded-md px-1.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              onClick={(event) => {
                // Opens this email only; the card's own click would open the whole category.
                event.stopPropagation();
                onSelect(group.key);
                onOpenThread(chip.threadId);
              }}
              onContextMenu={(event) => event.stopPropagation()}
            >
              <ChipAvatar chip={chip} />
              <span className="min-w-0 flex-1 truncate">{chip.name}</span>
              {chip.count > 1 && <span className="text-[11px] text-muted-foreground">{chip.count}</span>}
              {chip.unread && <span className="size-1.5 shrink-0 rounded-full bg-unread" />}
            </button>
            {canShowCode(group.kind, chip.date) && (
              <CodeChip messageId={chip.messageId} date={chip.date} categoryId={group.kind} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
});

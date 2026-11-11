import { memo } from "react";

import { ChevronRight, Pin } from "lucide-react";

import {
  PINNED_GROUP,
  type GroupDef,
  type GroupKind,
  type ListItem,
  type SenderChip,
} from "@shared/focus-list";

import { cn } from "@/lib/utils";

import { CategoryIcon } from "./category-icon";
import { ReadToggle } from "./read-toggle";
import { SenderAvatar } from "./sender-avatar";

type GroupItem = Extract<ListItem, { type: "group" }>;

/** Tint standing in for Spark's colored tiles: Orion's chart color for Pinned, the category hue otherwise. */
function groupStyle(group: GroupDef): { color: string; tint: string } {
  if (group.kind === PINNED_GROUP || group.hue === null) {
    return { color: "hsl(var(--chart-3))", tint: "hsl(var(--chart-3) / 0.16)" };
  }
  return { color: `hsl(${group.hue} 70% 62%)`, tint: `hsl(${group.hue} 70% 55% / 0.16)` };
}

/** The round colored tile with a group's icon: a pin for Pinned, the category's icon otherwise. */
export function GroupTile({ group }: { group: GroupDef }) {
  const { color, tint } = groupStyle(group);
  return (
    <span
      className="flex size-9 shrink-0 items-center justify-center rounded-full"
      style={{ background: tint, color }}
    >
      {group.kind === PINNED_GROUP ? (
        <Pin className="size-[18px]" />
      ) : (
        <CategoryIcon icon={group.icon} className="size-[18px]" />
      )}
    </span>
  );
}

const MAX_CHIPS = 8;

/** The small avatar on a sender chip: the company logo when there is one, else initials. */
function ChipAvatar({ chip }: { chip: SenderChip }) {
  return <SenderAvatar contact={{ name: chip.name, email: chip.email }} size={18} logo={chip.logo} />;
}

interface GroupRowProps {
  group: GroupItem;
  selected: boolean;
  /** Opens the group's own list. */
  onOpen: (kind: GroupKind) => void;
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
  onSelect,
  onToggleRead,
  onMenu,
  className,
}: GroupRowProps) {
  const hiddenChips = group.chips.length - MAX_CHIPS;

  return (
    <div
      role="row"
      data-row-key={group.key}
      aria-selected={selected}
      className={cn(
        "group relative mx-2 flex h-[52px] cursor-default items-center gap-3 rounded-lg border border-border px-3 text-sm",
        selected ? "bg-sidebar-primary/25" : "hover:bg-accent/50",
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
        <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">{group.count}</span>
      </span>

      <div className="flex min-w-0 flex-1 items-center gap-4 overflow-hidden">
        {group.chips.slice(0, MAX_CHIPS).map((chip) => (
          <span key={chip.key} className="inline-flex shrink-0 items-center gap-1.5">
            {chip.unread && <span className="size-1.5 rounded-full bg-unread" />}
            <ChipAvatar chip={chip} />
            <span className="max-w-[160px] truncate">{chip.name}</span>
            {chip.count > 1 && <span className="text-[11px] text-muted-foreground">{chip.count}</span>}
          </span>
        ))}
        {hiddenChips > 0 && (
          <span className="shrink-0 text-xs text-muted-foreground">+{hiddenChips}</span>
        )}
      </div>

      <div className="flex w-[112px] shrink-0 items-center justify-end gap-1">
        <ChevronRight className="size-4 text-muted-foreground" />
      </div>
    </div>
  );
});

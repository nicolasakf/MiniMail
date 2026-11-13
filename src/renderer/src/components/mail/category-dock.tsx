import type { GroupKind, ListItem } from "@shared/focus-list";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { GroupTile } from "./group-row";

type GroupItem = Extract<ListItem, { type: "group" }>;

interface CategoryDockProps {
  groups: readonly GroupItem[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /** Opens the category's own list. */
  onOpen: (kind: GroupKind) => void;
  /** Right-click: opens the same menu as on a category row (where it can be restored). */
  onMenu: (key: string, x: number, y: number) => void;
}

/**
 * Minimized categories, stacked at the right edge of the list as bare icon circles (the name is in
 * the tooltip), each with a dot when it has unread mail.
 */
export function CategoryDock({ groups, selectedKey, onSelect, onOpen, onMenu }: CategoryDockProps) {
  if (groups.length === 0) return null;

  return (
    <div
      role="toolbar"
      aria-label="Minimized categories"
      aria-orientation="vertical"
      className="flex shrink-0 flex-col items-center gap-2 py-2 pl-1 pr-3"
    >
      {groups.map((group) => {
        const detail = `${group.count} conversation${group.count === 1 ? "" : "s"}${
          group.unreadCount > 0 ? ` · ${group.unreadCount} unread` : ""
        }`;
        return (
          <Tooltip key={group.key}>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-row-key={group.key}
                aria-label={`${group.label}, ${detail}`}
                aria-pressed={selectedKey === group.key}
                onClick={() => {
                  onSelect(group.key);
                  onOpen(group.kind);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onMenu(group.key, event.clientX, event.clientY);
                }}
                className={cn(
                  "relative flex cursor-default items-center justify-center rounded-full outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring",
                  selectedKey === group.key
                    ? "ring-2 ring-sidebar-primary/60"
                    : "hover:ring-2 hover:ring-border",
                )}
              >
                <GroupTile group={group} compact />
                {group.unreadCount > 0 && (
                  <span className="absolute right-0 top-0 size-2.5 rounded-full bg-unread ring-2 ring-background" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">
              <div className="font-medium">{group.label}</div>
              <div className="text-xs opacity-80">{detail}</div>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

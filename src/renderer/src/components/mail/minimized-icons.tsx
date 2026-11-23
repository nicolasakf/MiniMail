import type { GroupKind, GroupListItem } from "@shared/focus-list";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { GroupTile } from "./group-row";

interface MinimizedIconsProps {
  groups: readonly GroupListItem[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /** Opens the category's own list. */
  onOpen: (kind: GroupKind) => void;
  /** Right-click: opens the same menu as on a category row (where it can be restored). */
  onMenu: (key: string, x: number, y: number) => void;
}

/**
 * Minimized categories as small icon circles on the "Minimized" heading while it is folded. The name
 * and counts are in the tooltip, and a dot marks a category with unread mail.
 */
export function MinimizedIcons({ groups, selectedKey, onSelect, onOpen, onMenu }: MinimizedIconsProps) {
  return (
    <div role="toolbar" aria-label="Minimized categories" className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
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
                  "relative flex cursor-default items-center justify-center rounded-full outline-none transition-shadow",
                  selectedKey === group.key ? "ring-2 ring-sidebar-primary/60" : "hover:shadow-raise-2",
                )}
              >
                <GroupTile group={group} small />
                {group.unreadCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-unread ring-2 ring-background" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <div className="font-medium">{group.label}</div>
              <div className="text-xs opacity-80">{detail}</div>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

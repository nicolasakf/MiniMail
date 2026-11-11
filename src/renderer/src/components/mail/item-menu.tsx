import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { LucideIcon } from "lucide-react";

import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

/** One command in an item's menu. */
export interface MenuEntry {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Keyboard shortcut shown at the right edge, the same text the tooltips use. */
  hint?: string;
  destructive?: boolean;
  run: () => void;
}

interface ItemMenuProps {
  /** Viewport point the menu opens at (the pointer, or the selected row). */
  x: number;
  y: number;
  entries: readonly MenuEntry[];
  onClose: () => void;
}

const MENU_WIDTH = 288;
const EDGE = 8;

/**
 * The menu of one list item: opens at the pointer on right-click, or at the selected row with `/`.
 * A text box on top filters the commands as you type; arrows move and Enter runs the highlighted one.
 * (Radix's context menu cannot host a text box, because its own type-ahead would eat the keys.)
 */
export function ItemMenu({ x, y, entries, onClose }: ItemMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Keep the whole menu on screen: flip above / left of the point when it would run off. The size
  // is watched because the list settles after the first paint (filtering changes it too).
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const place = () => {
      const height = element.offsetHeight;
      const left = Math.max(EDGE, Math.min(x, window.innerWidth - MENU_WIDTH - EDGE));
      const top = y + height + EDGE > window.innerHeight ? Math.max(EDGE, y - height) : y;
      setPosition((previous) =>
        previous.left === left && previous.top === top ? previous : { left, top },
      );
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    return () => observer.disconnect();
  }, [x, y]);

  return createPortal(
    <div
      className="fixed inset-0 z-50"
      onMouseDown={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div
        ref={ref}
        role="menu"
        aria-label="Commands"
        style={{ left: position.left, top: position.top, width: MENU_WIDTH }}
        className="corner-squircle absolute overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95"
        onMouseDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <Command loop className="[&_[cmdk-input-wrapper]]:px-3 [&_[cmdk-input-wrapper]_svg]:size-3.5">
          <CommandInput
            autoFocus
            placeholder="Filter commands…"
            aria-label="Filter commands"
            className="h-9 py-0 text-[13px]"
          />
          <CommandList className="max-h-[340px] space-y-1 p-3">
            <CommandEmpty>No matching command</CommandEmpty>
            {entries.map(({ id, label, icon: Icon, hint, destructive, run }) => (
              <CommandItem
                key={id}
                value={label}
                className={cn(
                  "gap-2.5 px-2 py-1.5",
                  destructive &&
                    "text-red-500 data-[selected=true]:bg-red-500/15 data-[selected=true]:text-red-500 dark:text-red-400 dark:data-[selected=true]:text-red-400",
                )}
                onSelect={() => {
                  onClose();
                  run();
                }}
              >
                <Icon />
                {label}
                {hint && <CommandShortcut>{hint}</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </div>
    </div>,
    document.body,
  );
}

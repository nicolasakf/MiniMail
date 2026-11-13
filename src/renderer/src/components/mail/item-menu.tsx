import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Check, ChevronRight, type LucideIcon } from "lucide-react";

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
  /** Marks the entry as the current choice (a check at the right edge). */
  current?: boolean;
  /** A sub-menu that flies out beside the menu while the entry is hovered; `run` is then unused. */
  children?: readonly MenuEntry[];
  run: () => void;
}

interface ItemMenuProps {
  /** Viewport point the menu opens at (the pointer, or the selected row). */
  x: number;
  y: number;
  entries: readonly MenuEntry[];
  onClose: () => void;
}

/** Menus are as wide as their contents, within these bounds. */
const MIN_WIDTH = 176;
const MAX_WIDTH = 340;
const EDGE = 8;
/** The list's top padding plus the border: lines a flyout's first item up with the hovered one. */
const FLYOUT_LIFT = 5;
/** Tight inset and gaps: the highlight of an item sits close to the menu's border. */
const LIST_CLASS = "max-h-[340px] space-y-0.5 p-1";

/** Items of a menu: icon, label, then a check, a chevron or the shortcut at the right edge. */
function MenuItem({ entry, onChoose }: { entry: MenuEntry; onChoose: (entry: MenuEntry) => void }) {
  const { id, label, icon: Icon, hint, destructive, current, children } = entry;
  return (
    <CommandItem
      data-entry={id}
      value={label}
      className={cn(
        "gap-2.5 whitespace-nowrap px-2 py-1",
        destructive &&
          "text-red-500 data-[selected=true]:bg-red-500/15 data-[selected=true]:text-red-500 dark:text-red-400 dark:data-[selected=true]:text-red-400",
      )}
      onSelect={() => onChoose(entry)}
    >
      <Icon />
      {label}
      {current && <Check className="ml-auto size-3.5 text-muted-foreground" />}
      {children && <ChevronRight className="ml-auto size-3.5 text-muted-foreground" />}
      {hint && <CommandShortcut>{hint}</CommandShortcut>}
    </CommandItem>
  );
}

/**
 * The menu of one list item: opens at the pointer on right-click, or at the selected row with `/`.
 * A text box on top filters the commands as you type; arrows move and Enter runs the highlighted one.
 * An entry with `children` shows them in a panel beside the menu as soon as it is hovered or
 * highlighted; → (or Enter) moves into the panel and ← (or Escape) back.
 * (Radix's context menu cannot host a text box, because its own type-ahead would eat the keys.)
 */
export function ItemMenu({ x, y, entries, onClose }: ItemMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const flyoutCommandRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  /** The menu's measured width, which its contents decide; the panel is placed beside it. */
  const [menuWidth, setMenuWidth] = useState(MIN_WIDTH);
  /** Widest the menu has been: filtering must not make it shrink and jump around. */
  const [floorWidth, setFloorWidth] = useState(0);
  /** The entry the pointer or the arrows are on, as the list reports it (its label). */
  const [highlighted, setHighlighted] = useState("");
  /** The panel has the pointer or the keyboard: only then does it show a highlighted item. */
  const [flyoutActive, setFlyoutActive] = useState(false);
  const [flyoutPosition, setFlyoutPosition] = useState<{ left: number; top: number } | null>(null);

  const parent = entries.find((entry) => entry.children && entry.label.toLowerCase() === highlighted.toLowerCase());

  // Keep the whole menu on screen: flip above / left of the point when it would run off. The size
  // is watched because the list settles after the first paint (filtering changes it too).
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const place = () => {
      const height = element.offsetHeight;
      const width = element.offsetWidth;
      setMenuWidth(width);
      setFloorWidth((previous) => Math.max(previous, width));
      const left = Math.max(EDGE, Math.min(x, window.innerWidth - width - EDGE));
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

  // The panel sits beside the hovered entry, on the side with room, and never runs off screen.
  useLayoutEffect(() => {
    if (!parent) {
      setFlyoutPosition(null);
      return;
    }
    const item = ref.current?.querySelector<HTMLElement>(`[data-entry="${CSS.escape(parent.id)}"]`);
    if (!item) return;
    const itemTop = item.getBoundingClientRect().top;
    const flyoutWidth = flyoutRef.current?.offsetWidth ?? MIN_WIDTH;
    const roomRight = position.left + menuWidth + flyoutWidth + EDGE <= window.innerWidth;
    const left = roomRight ? position.left + menuWidth + 4 : Math.max(EDGE, position.left - flyoutWidth - 4);
    const height = flyoutRef.current?.offsetHeight ?? 0;
    const top = Math.max(EDGE, Math.min(itemTop - FLYOUT_LIFT, window.innerHeight - height - EDGE));
    setFlyoutPosition((previous) =>
      previous && previous.left === left && previous.top === top ? previous : { left, top },
    );
  }, [parent, position, menuWidth, flyoutPosition === null]);

  const choose = (entry: MenuEntry) => {
    if (entry.children) {
      // Enter on a parent entry moves into its panel.
      setFlyoutActive(true);
      flyoutCommandRef.current?.focus();
      return;
    }
    onClose();
    entry.run();
  };

  const backToMenu = () => {
    setFlyoutActive(false);
    inputRef.current?.focus();
  };

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
        style={{ left: position.left, top: position.top, minWidth: Math.max(MIN_WIDTH, floorWidth), maxWidth: MAX_WIDTH }}
        className="corner-squircle absolute w-max overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95"
        onMouseDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          } else if (event.key === "ArrowRight" && parent && event.currentTarget === ref.current) {
            // Only from the end of the filter text: inside it → still moves the caret.
            const input = inputRef.current;
            if (input && input.selectionStart === input.value.length) {
              event.preventDefault();
              choose(parent);
            }
          }
        }}
        onPointerMove={() => setFlyoutActive(false)}
      >
        <Command
          loop
          // cmdk only reports the highlighted entry when the list is controlled.
          value={highlighted}
          onValueChange={setHighlighted}
          className="[&_[cmdk-input-wrapper]]:px-3 [&_[cmdk-input-wrapper]_svg]:size-3.5"
        >
          <CommandInput
            ref={inputRef}
            autoFocus
            // A tiny intrinsic width, so the text box never makes the menu wider than its entries.
            size={1}
            placeholder="Filter commands…"
            aria-label="Filter commands"
            className="h-9 py-0 text-[13px]"
          />
          <CommandList className={LIST_CLASS}>
            <CommandEmpty>No matching command</CommandEmpty>
            {entries.map((entry) => (
              <MenuItem key={entry.id} entry={entry} onChoose={choose} />
            ))}
          </CommandList>
        </Command>
      </div>

      {parent?.children && (
        <div
          ref={flyoutRef}
          role="menu"
          aria-label={parent.label}
          style={{
            left: flyoutPosition?.left ?? position.left + menuWidth + 4,
            top: flyoutPosition?.top ?? position.top,
            minWidth: MIN_WIDTH,
            maxWidth: MAX_WIDTH,
            visibility: flyoutPosition ? "visible" : "hidden",
          }}
          className="corner-squircle absolute w-max overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg animate-in fade-in-0 slide-in-from-left-1"
          onMouseDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.stopPropagation()}
          onPointerMove={() => setFlyoutActive(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape" || event.key === "ArrowLeft") {
              event.preventDefault();
              event.stopPropagation();
              backToMenu();
            }
          }}
        >
          <Command ref={flyoutCommandRef} loop tabIndex={-1} className="outline-none">
            <CommandList
              className={cn(
                LIST_CLASS,
                // Until the pointer or keyboard is in the panel, no item looks picked.
                !flyoutActive && "[&_[cmdk-item][data-selected=true]]:bg-transparent",
              )}
            >
              {parent.children.map((entry) => (
                <MenuItem key={entry.id} entry={entry} onChoose={choose} />
              ))}
            </CommandList>
          </Command>
        </div>
      )}
    </div>,
    document.body,
  );
}

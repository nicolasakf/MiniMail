import { useRef, type KeyboardEvent, type PointerEvent } from "react";

import { cn } from "@/lib/utils";

/** The list never gets narrower than this, nor leaves the reading pane less than `MIN_PANE`. */
export const MIN_LIST_WIDTH = 280;
export const MIN_PANE_WIDTH = 400;
/** What the reading pane's card needs beside its own width: the handle (8px) and its right margin (12px). */
const PANE_CHROME = 20;
export const DEFAULT_LIST_WIDTH = 400;
const KEY_STEP = 16;

interface SplitHandleProps {
  width: number;
  /** Called while dragging (or pressing arrow keys) with the new list width. */
  onResize: (width: number) => void;
  /** Called once the new width is final, so it can be remembered. */
  onCommit: (width: number) => void;
}

/**
 * The strip between the list and the reading pane, which can be dragged to resize the list
 * (it must be a direct child of the row holding both). Drag it or focus it and use the arrow keys;
 * double-click puts the list back to its default width.
 */
export function SplitHandle({ width, onResize, onCommit }: SplitHandleProps) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startWidth: number; latest: number } | null>(null);

  /** Keeps the list between its minimum and what leaves the reading pane its own minimum. */
  const clamp = (value: number): number => {
    const total = ref.current?.parentElement?.clientWidth ?? Infinity;
    return Math.round(Math.min(Math.max(value, MIN_LIST_WIDTH), Math.max(MIN_LIST_WIDTH, total - MIN_PANE_WIDTH - PANE_CHROME)));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: width, latest: width };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    state.latest = clamp(state.startWidth + event.clientX - state.startX);
    onResize(state.latest);
  };
  const endDrag = () => {
    const state = drag.current;
    drag.current = null;
    if (state) onCommit(state.latest);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === "ArrowLeft" ? -KEY_STEP : event.key === "ArrowRight" ? KEY_STEP : 0;
    if (delta === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const next = clamp(width + delta);
    onResize(next);
    onCommit(next);
  };

  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize list"
      aria-valuenow={width}
      aria-valuemin={MIN_LIST_WIDTH}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={() => {
        const next = clamp(DEFAULT_LIST_WIDTH);
        onResize(next);
        onCommit(next);
      }}
      className={cn(
        "electron-no-drag relative w-2 shrink-0 cursor-col-resize touch-none outline-none",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:rounded-full after:bg-transparent after:transition-colors",
        "hover:after:bg-sidebar-primary/60 focus-visible:after:bg-sidebar-primary active:after:bg-sidebar-primary",
      )}
    />
  );
}

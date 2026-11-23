import { useRef, type PointerEvent } from "react";

import { MIN_COMPOSER_HEIGHT, MIN_COMPOSER_WIDTH, type ComposerLayout, type ComposerSide } from "@/lib/composer-layout";
import { cn } from "@/lib/utils";

/** The room the floating composer leaves around itself: its margin, and the tray when it is busy. */
const MARGIN = 32;
const TRAY_ROOM = 60;

interface ResizeHandlesProps {
  side: ComposerSide;
  layout: ComposerLayout;
  trayBusy: boolean;
  onPreview: (size: Partial<ComposerLayout>) => void;
  onCommit: (size?: Partial<ComposerLayout>) => void;
  onReset: (axes: "width" | "height" | "both") => void;
}

type Axes = "width" | "height" | "both";

/**
 * Strips on the top and inner edges of the floating composer, and the corner between them, to drag it bigger or smaller.
 * The composer is anchored to the bottom and to its side, so it grows up and away from that side.
 * Double-clicking a strip puts that size back to its default.
 */
export function ResizeHandles({ side, layout, trayBusy, onPreview, onCommit, onReset }: ResizeHandlesProps) {
  const drag = useRef<{ x: number; y: number; width: number; height: number; latest: Partial<ComposerLayout> } | null>(null);

  const start = (axes: Axes) => (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, width: layout.width, height: layout.height, latest: {} };
    event.currentTarget.dataset.axes = axes;
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    const axes = event.currentTarget.dataset.axes as Axes;
    const next: Partial<ComposerLayout> = {};
    if (axes !== "height") {
      const dx = side === "right" ? state.x - event.clientX : event.clientX - state.x;
      next.width = Math.round(Math.min(Math.max(state.width + dx, MIN_COMPOSER_WIDTH), Math.max(MIN_COMPOSER_WIDTH, window.innerWidth - MARGIN)));
    }
    if (axes !== "width") {
      const room = window.innerHeight - MARGIN - (trayBusy ? TRAY_ROOM : 0);
      next.height = Math.round(Math.min(Math.max(state.height + state.y - event.clientY, MIN_COMPOSER_HEIGHT), Math.max(MIN_COMPOSER_HEIGHT, room)));
    }
    state.latest = next;
    onPreview(next);
  };
  const end = () => {
    const state = drag.current;
    drag.current = null;
    if (state) onCommit(state.latest);
  };

  const common = { onPointerMove: move, onPointerUp: end, onPointerCancel: end };
  const inner = side === "right" ? "left-0" : "right-0";
  return (
    <>
      <div aria-hidden className="absolute inset-x-3 top-0 z-20 h-1.5 cursor-ns-resize touch-none"
        onPointerDown={start("height")} onDoubleClick={() => onReset("height")} {...common} />
      <div aria-hidden className={cn("absolute inset-y-3 z-20 w-1.5 cursor-ew-resize touch-none", inner)}
        onPointerDown={start("width")} onDoubleClick={() => onReset("width")} {...common} />
      <div aria-hidden
        className={cn("absolute top-0 z-20 size-3 touch-none", inner, side === "right" ? "cursor-nwse-resize" : "cursor-nesw-resize")}
        onPointerDown={start("both")} onDoubleClick={() => onReset("both")} {...common} />
    </>
  );
}

import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

import { edgeScrollSpeed, pastThreshold } from "@/lib/drag-select";

interface Drag {
  startKey: string;
  startX: number;
  startY: number;
  /** Where the press was, in the list's own (scrolled) coordinates, so the corner stays on its row as the list scrolls. */
  anchorX: number;
  anchorY: number;
  /** The pointer has moved far enough to be dragging: the rectangle is drawn. */
  tracing: boolean;
  /** The pointer has left the row it was pressed on: from now on the rows it crosses are selected. */
  active: boolean;
  /** Last row key reported, so a row is reported once per visit. */
  lastKey: string;
  x: number;
  y: number;
}

/** The conversation row under a point, if any (rows carry `data-thread-row`). */
function threadRowKeyAt(x: number, y: number): string | null {
  const row = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-thread-row]");
  return row?.dataset.rowKey ?? null;
}

/**
 * Press on a conversation row and drag over others to select them all, from the row pressed to the
 * one under the pointer. The list scrolls by itself when the pointer is held near its top or bottom
 * edge (or past it). `onDragSelect(from, to)` is told each time the end of the range changes.
 *
 * `traceRef` is an absolutely placed element inside the scrolling content (so it scrolls with the
 * rows); while dragging it is sized to the rectangle from the press to the pointer. It is moved
 * directly, not through state, so a drag does not re-render the list on every pointer move.
 *
 * Returns the `onPointerDown` to put on the scrolling list. A press with a modifier key, on a
 * button, or a touch is left alone (clicks, ⌘/⇧-click and scrolling keep working as before).
 */
export function useDragSelect(
  containerRef: RefObject<HTMLElement | null>,
  traceRef: RefObject<HTMLElement | null>,
  onDragSelect: (fromKey: string, toKey: string) => void,
): (event: ReactPointerEvent<HTMLElement>) => void {
  const latest = useRef(onDragSelect);
  latest.current = onDragSelect;
  // Tears the drag down early if the list goes away in the middle of one.
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  return (event) => {
    if (event.button !== 0 || event.pointerType !== "mouse") return;
    if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, textarea, [role=menuitem]")) return;
    const startRow = target.closest<HTMLElement>("[data-thread-row]");
    const container = containerRef.current;
    if (!startRow?.dataset.rowKey || !container) return;

    cleanup.current?.();
    const drag: Drag = {
      startKey: startRow.dataset.rowKey,
      startX: event.clientX,
      startY: event.clientY,
      anchorX: event.clientX - container.getBoundingClientRect().left + container.scrollLeft,
      anchorY: event.clientY - container.getBoundingClientRect().top + container.scrollTop,
      active: false,
      tracing: false,
      lastKey: startRow.dataset.rowKey,
      x: event.clientX,
      y: event.clientY,
    };
    let frame = 0;

    /** Draws the rectangle from the press to the pointer, the pointer held inside the list's box. */
    const drawTrace = () => {
      const trace = traceRef.current;
      if (!trace) return;
      const box = container.getBoundingClientRect();
      const x = Math.min(Math.max(drag.x, box.left), box.right) - box.left + container.scrollLeft;
      const y = Math.min(Math.max(drag.y, box.top), box.bottom) - box.top + container.scrollTop;
      trace.style.display = "block";
      trace.style.left = `${Math.min(drag.anchorX, x)}px`;
      trace.style.top = `${Math.min(drag.anchorY, y)}px`;
      trace.style.width = `${Math.abs(x - drag.anchorX)}px`;
      trace.style.height = `${Math.abs(y - drag.anchorY)}px`;
    };
    const hideTrace = () => {
      if (traceRef.current) traceRef.current.style.display = "none";
    };

    /** Selects up to the row under the pointer, which is held inside the list's box so a drag past an edge still reaches the last row. */
    const update = () => {
      const box = container.getBoundingClientRect();
      const x = Math.min(Math.max(drag.x, box.left + 1), box.right - 1);
      const y = Math.min(Math.max(drag.y, box.top + 1), box.bottom - 1);
      const key = threadRowKeyAt(x, y);
      if (!key || key === drag.lastKey) return;
      if (!drag.active && key === drag.startKey) return;
      drag.active = true;
      drag.lastKey = key;
      latest.current(drag.startKey, key);
    };

    const scrollLoop = () => {
      frame = 0;
      const box = container.getBoundingClientRect();
      const speed = edgeScrollSpeed(drag.y, box.top, box.bottom);
      if (speed === 0) return;
      container.scrollTop += speed;
      drawTrace();
      update();
      frame = requestAnimationFrame(scrollLoop);
    };

    const onMove = (move: PointerEvent) => {
      drag.x = move.clientX;
      drag.y = move.clientY;
      if (!drag.active && !drag.tracing && !pastThreshold(drag.startX, drag.startY, move.clientX, move.clientY)) return;
      drag.tracing = true;
      drawTrace();
      update();
      if (frame === 0) frame = requestAnimationFrame(scrollLoop);
    };

    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", stop);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      hideTrace();
      cleanup.current = null;
    };
    const onUp = () => {
      stop();
      if (!drag.active) return;
      // The click that ends a drag must not select the row it lands on: it was part of the drag.
      const swallow = (click: MouseEvent) => click.stopPropagation();
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", stop);
    cleanup.current = stop;
  };
}

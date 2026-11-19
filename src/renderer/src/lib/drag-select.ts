/** How far (px) the pointer must travel from where it was pressed before it counts as a drag, not a click. */
export const DRAG_THRESHOLD = 4;

/** Width (px) of the band along the top and bottom edge of the list where a drag scrolls it. */
export const EDGE_BAND = 40;

/** Fastest autoscroll (px per frame), reached when the pointer is at or beyond the edge. */
const MAX_SCROLL = 18;

/** Whether the pointer has moved far enough from where it was pressed to be dragging. */
export function pastThreshold(startX: number, startY: number, x: number, y: number): boolean {
  return Math.hypot(x - startX, y - startY) >= DRAG_THRESHOLD;
}

/**
 * How far to scroll the list this frame while a row selection is dragged: negative scrolls up,
 * positive down, 0 when the pointer is well inside. The closer to (or the further past) the edge,
 * the faster it goes.
 */
export function edgeScrollSpeed(pointerY: number, top: number, bottom: number): number {
  if (pointerY < top + EDGE_BAND) {
    const depth = Math.min(1, (top + EDGE_BAND - pointerY) / EDGE_BAND);
    return -Math.max(1, Math.round(depth * MAX_SCROLL));
  }
  if (pointerY > bottom - EDGE_BAND) {
    const depth = Math.min(1, (pointerY - (bottom - EDGE_BAND)) / EDGE_BAND);
    return Math.max(1, Math.round(depth * MAX_SCROLL));
  }
  return 0;
}

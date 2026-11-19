/**
 * Two-finger swipe to the left edge (a trackpad "scroll left") goes back.
 *
 * It must never fire by accident, so the page is dragged to the right with growing resistance and
 * only goes back once the person has pulled it a good way. Let go earlier and it springs back.
 * Wheel events have no "end", so a gesture ends when none arrived for `IDLE_MS`.
 */

/** Raw scroll distance (px) that has to be pulled before it goes back. */
export const COMMIT_DISTANCE = 320;
/** The page never moves further than this (px), however far the finger goes. */
export const MAX_DRAG = 120;
/** Larger means a longer, softer pull before the page nears `MAX_DRAG`. */
const RANGE = 280;
/** A gesture ends once no wheel event arrived for this long. */
export const IDLE_MS = 140;
/** A gesture counts as horizontal only when it is this much more sideways than vertical. */
const HORIZONTAL_BIAS = 2;

/** Rubber band: moves almost with the fingers at first, then gets heavier and heavier. */
export function dragOffset(raw: number): number {
  if (raw <= 0) return 0;
  return MAX_DRAG * (1 - Math.exp(-raw / RANGE));
}

export type SwipeBackHandlers = {
  /**
   * The page should sit `offset` px to the right (0 at rest); `settle` asks for it to animate there.
   * `progress` runs from 0 to 1, where 1 is far enough to go back.
   */
  onOffset: (offset: number, settle: boolean, progress: number) => void;
  /** The pull went far enough. */
  onCommit: () => void;
};

export class SwipeBack {
  private raw = 0;
  private rejected = false;
  private committed = false;
  private active = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly handlers: SwipeBackHandlers) {}

  /**
   * Feeds one wheel event (deltaX < 0 is "scroll left"). Pass `blocked` when something under the
   * pointer scrolls sideways by itself, so the gesture belongs to it.
   */
  feed(deltaX: number, deltaY: number, blocked = false): void {
    if (!this.active && !this.rejected) {
      // The first event of a gesture decides whether it is ours.
      const sideways = deltaX < 0 && Math.abs(deltaX) > Math.abs(deltaY) * HORIZONTAL_BIAS;
      if (blocked || !sideways) this.rejected = true;
      else this.active = true;
    } else if (blocked && !this.committed) {
      this.rejected = true;
      this.finish();
    }
    this.rearm();
    if (!this.active || this.rejected || this.committed) return;

    // Moving back to the right (or down) lets the page slide back instead of piling up.
    this.raw = Math.max(0, this.raw - deltaX);
    this.handlers.onOffset(dragOffset(this.raw), false, Math.min(1, this.raw / COMMIT_DISTANCE));
    if (this.raw >= COMMIT_DISTANCE) {
      this.committed = true;
      this.handlers.onCommit();
      // The next view starts from where the page was dragged and settles into place.
      this.handlers.onOffset(0, true, 0);
    }
  }

  /** Drops any gesture in progress (the view went away). */
  cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.finish();
    this.rejected = false;
    this.committed = false;
  }

  private rearm(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.finish();
      this.rejected = false;
      this.committed = false;
    }, IDLE_MS);
  }

  private finish(): void {
    const dragged = this.active && !this.committed;
    this.active = false;
    this.raw = 0;
    if (dragged) this.handlers.onOffset(0, true, 0);
  }
}

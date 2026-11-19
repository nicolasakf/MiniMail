import { useEffect, useRef, type RefObject } from "react";
import { SwipeBack } from "@/lib/swipe-back";

const SETTLE = "transform 360ms cubic-bezier(0.22, 1, 0.36, 1)";

/** True when something between the target and `root` can still scroll to the left by itself. */
function scrollsLeft(target: EventTarget | null, root: HTMLElement): boolean {
  for (let node = target instanceof Element ? target : null; node && node !== root; node = node.parentElement) {
    if (node.scrollLeft > 0 && node.scrollWidth > node.clientWidth) return true;
  }
  return false;
}

/**
 * A trackpad swipe to the left goes back. The element follows the fingers to the right, heavier
 * and heavier, so a stray scroll never triggers it; `onBack` null turns the gesture off.
 */
export function useSwipeBack(ref: RefObject<HTMLElement | null>, onBack: (() => void) | null): void {
  const latest = useRef(onBack);
  latest.current = onBack;

  // Stays attached while the gesture is off: going back often turns it off (nothing left to go back
  // to), and the page must still settle into place instead of snapping.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const swipe = new SwipeBack({
      onOffset: (offset, settle, progress) => {
        // The arrow indicator reads these; it settles with the page.
        element.style.setProperty("--swipe-x", String(offset));
        element.style.setProperty("--swipe-p", String(progress));
        element.style.setProperty("--swipe-ms", settle ? "360ms" : "0ms");
        element.style.willChange = offset > 0 || settle ? "transform" : "";
        element.style.transition = settle ? SETTLE : "none";
        element.style.transform = offset > 0 ? `translate3d(${offset}px, 0, 0)` : "";
        // Nothing to clean up when the page is already at rest.
        if (settle && offset === 0) {
          const done = () => {
            element.removeEventListener("transitionend", done);
            element.style.transition = "";
            element.style.willChange = "";
          };
          element.addEventListener("transitionend", done);
        }
      },
      onCommit: () => latest.current?.(),
    });

    const onWheel = (event: WheelEvent) => {
      if (!latest.current || event.ctrlKey || event.deltaMode !== 0) return; // off, pinch zoom, or a mouse wheel
      swipe.feed(event.deltaX, event.deltaY, scrollsLeft(event.target, element));
    };

    element.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      element.removeEventListener("wheel", onWheel);
      swipe.cancel();
      element.style.transform = "";
      element.style.transition = "";
      element.style.willChange = "";
    };
  }, [ref]);
}

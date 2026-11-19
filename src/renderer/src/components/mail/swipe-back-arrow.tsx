import { ArrowLeft } from "lucide-react";

/**
 * The big back arrow a swipe to the left reveals, as in Chrome: half a disc grows out of the left
 * edge while the page is dragged to the right. `useSwipeBack` drives it through CSS variables on
 * `<main>` (no re-renders): `--swipe-x` is how far the page has moved, `--swipe-p` how close it is
 * to going back, `--swipe-ms` the settle time. The page moves right, so the arrow is moved left by
 * the same amount to stay put on the window's edge.
 */
export function SwipeBackArrow() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute -left-14 top-1/2 z-20 size-28"
      style={{
        // Half a disc: the left half would sit on top of whatever is left of the page.
        clipPath: "inset(0 0 0 50%)",
        transform: "translate3d(calc(var(--swipe-x, 0) * -1px), -50%, 0) scale(calc(0.4 + 0.6 * var(--swipe-p, 0)))",
        opacity: "calc(var(--swipe-p, 0) * 1.6)",
        transitionProperty: "transform, opacity",
        transitionDuration: "var(--swipe-ms, 0ms)",
        transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <div className="size-full rounded-full bg-foreground/90 shadow-lg" />
      <div className="absolute inset-y-0 left-1/2 flex w-14 items-center justify-center text-background">
        <ArrowLeft className="size-8" strokeWidth={2.5} />
      </div>
    </div>
  );
}

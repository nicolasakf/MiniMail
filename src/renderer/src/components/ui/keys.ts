/**
 * Most buttons are flat: nothing is drawn until the pointer is over one, then it rises as a raised plate, and it
 * sinks while held or on. The folder buttons of the list header and the sidebar are the exceptions: they stay
 * raised keys (`plate-1 press-sink face-hover`). The icon keeps its own color on hover.
 */
export const FLAT_KEY =
  "corner-squircle press-sink text-foreground transition-[box-shadow,transform,background-color] duration-100 hover:plate-1 data-[state=open]:shadow-pressed focus-visible:shadow-glow";

/** The same flat key for a part that sits inside a plate (a row in a popover or card): it rises one level higher. */
export const FLAT_KEY_IN =
  "corner-squircle press-sink text-foreground transition-[box-shadow,transform,background-color] duration-100 hover:plate-2 data-[state=open]:shadow-pressed focus-visible:shadow-glow";

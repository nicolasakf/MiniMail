/**
 * Hover look for a control inside a highlighted (selected or checked) card or row. The container's
 * tint is the highlight color, so the control gets a brighter version of it (a white wash over the
 * tint) rather than the gray `accent`, which looks foreign on a colored background. The container
 * must have the `group` class and a `data-tinted` attribute while it is highlighted.
 */
export const HOVER_ON_TINT =
  "group-data-[tinted]:hover:bg-white/50 dark:group-data-[tinted]:hover:bg-white/15";

/** The light red a blocked sender's name is shown in, wherever senders are listed. */
export const BLOCKED_TEXT = "text-red-400 dark:text-red-400";

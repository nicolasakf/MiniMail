import { reportError } from "@/lib/events";

/** The key `next-themes` keeps the chosen color mode under, in the page's own storage. */
export const THEME_STORAGE_KEY = "theme";

/**
 * The color modes the app offers are Light and Dark. There used to be a third, "dimmed", a dark theme on grey
 * instead of near-black; the Dark theme is now that grey plastic, so a choice saved as "dimmed" becomes "dark".
 * (A saved "dark" keeps its name and now looks like the grey one.) Run before the first render.
 */
export function migrateSavedTheme(open: () => Pick<Storage, "getItem" | "setItem">): void {
  try {
    const storage = open();
    if (storage.getItem(THEME_STORAGE_KEY) === "dimmed") storage.setItem(THEME_STORAGE_KEY, "dark");
  } catch (error) {
    reportError("storage", "Could not update the saved color mode", error);
    // The page opens with the default (Dark), which is where a dimmed choice goes anyway.
  }
}

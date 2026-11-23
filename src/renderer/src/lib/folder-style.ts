import { Archive, Inbox, ShieldAlert, Trash2, type LucideIcon } from "lucide-react";

import type { ShownFolder } from "@shared/types";

/** How a folder's mail shows in the Inbox list: its button and row icon, and their colours (blue, gray, red, amber). */
export interface FolderStyle {
  label: string;
  icon: LucideIcon;
  /** Colour of the icon next to a sender's name. */
  text: string;
  /** Look of a tile or button while its folder is on: sunk, tinted with the folder's color. */
  active: string;
}

export const FOLDER_STYLE: Record<ShownFolder, FolderStyle> = {
  // Switched on, a folder's tile sinks and its face and icon take the folder's color.
  inbox: {
    label: "Inbox",
    icon: Inbox,
    text: "text-muted-foreground",
    // A fixed blue (the highlight color's original value in each theme), so the user's highlight color does not recolor it.
    active:
      "shadow-pressed bg-[hsl(218.8_61.5%_52.2%/0.15)] dark:bg-[hsl(219_82.2%_71.4%/0.15)] text-[hsl(218.8_61.5%_52.2%)] hover:text-[hsl(218.8_61.5%_52.2%)] dark:text-[hsl(219_82.2%_71.4%)] dark:hover:text-[hsl(219_82.2%_71.4%)]",
  },
  archive: {
    label: "Archive",
    icon: Archive,
    text: "text-muted-foreground",
    active: "shadow-pressed bg-foreground/10 text-foreground hover:text-foreground",
  },
  trash: {
    label: "Trash",
    icon: Trash2,
    text: "text-destructive",
    active: "shadow-pressed bg-destructive/15 text-destructive hover:text-destructive",
  },
  spam: {
    label: "Spam",
    icon: ShieldAlert,
    text: "text-amber",
    active: "shadow-pressed bg-amber/15 text-amber hover:text-amber",
  },
};

/** The style marking mail that is in Archive, Trash or Spam (the inbox needs no mark), or undefined. */
export function folderStyle(folder: string): FolderStyle | undefined {
  return folder !== "inbox" && Object.hasOwn(FOLDER_STYLE, folder) ? FOLDER_STYLE[folder as ShownFolder] : undefined;
}

/** The list header's folder keys are raised, not sunk, while their folder is on; the tint and icon color are the same. */
export function raisedActive(folder: ShownFolder): string {
  return FOLDER_STYLE[folder].active.replace("shadow-pressed", "grain shadow-raise-2");
}

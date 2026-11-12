import { Archive, Inbox, ShieldAlert, Trash2, type LucideIcon } from "lucide-react";

import type { ShownFolder } from "@shared/types";

/** How a folder's mail shows in the Inbox list: its button and row icon, and their colours (blue, gray, red, amber). */
export interface FolderStyle {
  label: string;
  icon: LucideIcon;
  /** Colour of the icon next to a sender's name. Amber follows the Orion app's: darker on light, 400 on dark. */
  text: string;
  /** Look of the header button while its folder is shown. */
  active: string;
}

export const FOLDER_STYLE: Record<ShownFolder, FolderStyle> = {
  inbox: {
    label: "Inbox",
    icon: Inbox,
    text: "text-muted-foreground",
    active: "bg-sidebar-primary/15 text-sidebar-primary hover:text-sidebar-primary",
  },
  archive: {
    label: "Archive",
    icon: Archive,
    text: "text-gray-500 dark:text-gray-400",
    active: "bg-gray-500/15 text-gray-600 hover:text-gray-600 dark:bg-gray-400/15 dark:text-gray-300 dark:hover:text-gray-300",
  },
  trash: {
    label: "Trash",
    icon: Trash2,
    text: "text-red-600 dark:text-red-400",
    active: "bg-red-500/10 text-red-600 hover:text-red-600 dark:bg-red-400/15 dark:text-red-400 dark:hover:text-red-400",
  },
  spam: {
    label: "Spam",
    icon: ShieldAlert,
    text: "text-amber-700 dark:text-amber-400",
    active: "bg-amber-500/10 text-amber-700 hover:text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 dark:hover:text-amber-400",
  },
};

/** The style marking mail that is in Archive, Trash or Spam (the inbox needs no mark), or undefined. */
export function folderStyle(folder: string): FolderStyle | undefined {
  return folder !== "inbox" && Object.hasOwn(FOLDER_STYLE, folder) ? FOLDER_STYLE[folder as ShownFolder] : undefined;
}

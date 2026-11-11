import {
  Archive,
  Inbox,
  Mail,
  MailOpen,
  Pin,
  PinOff,
  ShieldAlert,
  Trash2,
  type LucideIcon,
} from "lucide-react";

import type { Thread } from "@shared/threads";
import type { MailAction, MailFolder } from "@shared/types";

export interface RowAction {
  action: MailAction;
  label: string;
  icon: LucideIcon;
  /** Keyboard shortcut hint shown in tooltips. */
  hint?: string;
}

/**
 * The quick actions for a thread, which depend on the folder it is in: Trash can only
 * be emptied, Spam can only be deleted, Archive offers a way back to the inbox.
 */
export function actionsForThread(folder: MailFolder, thread: Thread): RowAction[] {
  if (folder === "trash" || folder === "spam") {
    return [{ action: "deleteForever", label: "Delete forever", icon: Trash2 }];
  }

  const actions: RowAction[] = [];
  if (folder === "archive") {
    actions.push({ action: "unarchive", label: "Move to Inbox", icon: Inbox, hint: "A" });
  } else {
    actions.push({ action: "archive", label: "Archive", icon: Archive, hint: "A A" });
  }
  actions.push(
    thread.pinned
      ? { action: "unpin", label: "Unpin", icon: PinOff, hint: "P" }
      : { action: "pin", label: "Pin", icon: Pin, hint: "P" },
    thread.unread
      ? { action: "markRead", label: "Mark as read", icon: MailOpen, hint: "U" }
      : { action: "markUnread", label: "Mark as unread", icon: Mail, hint: "U" },
    { action: "trash", label: "Move to Trash", icon: Trash2, hint: "T T" },
  );
  if (folder === "inbox") {
    actions.push({ action: "spam", label: "Report spam", icon: ShieldAlert, hint: "S S" });
  }
  return actions;
}

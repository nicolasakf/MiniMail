import {
  Archive,
  Flame,
  Inbox,
  Mail,
  MailOpen,
  Pin,
  PinOff,
  ShieldAlert,
  Trash2,
  type LucideIcon,
} from "lucide-react";

import { MOVE_FOLDERS, type Thread } from "@shared/threads";
import type { MailAction, MailFolder } from "@shared/types";

export interface RowAction {
  action: MailAction;
  label: string;
  icon: LucideIcon;
  /** Keyboard shortcut hint shown in tooltips. */
  hint?: string;
}

/** A folder a conversation can be moved to. */
type MoveTarget = (typeof MOVE_FOLDERS)[number];

/**
 * The folders a conversation can be moved to from where it is. The set is the same everywhere:
 * every folder but the one it is already in. Pinned is a view of the Inbox, so it counts as the
 * Inbox. A conversation outside the four folders (Sent, Drafts) can still be archived or trashed.
 */
function moveTargets(folder: MailFolder): MoveTarget[] {
  const current = folder === "pinned" ? "inbox" : folder;
  const inFolder = (MOVE_FOLDERS as readonly MailFolder[]).includes(current);
  return (["inbox", "archive", "trash", "spam"] as const).filter((target) =>
    inFolder ? target !== current : target === "archive" || target === "trash",
  );
}

/** Shortcut hints for the move actions; the keys work in every folder. */
const MOVE_HINTS: Record<MoveTarget, string> = {
  inbox: "I",
  archive: "A A",
  trash: "D D",
  spam: "S S",
};

/**
 * The quick actions for a conversation, in the toolbar of an open conversation and in its menu.
 * They are the same whatever folder it is in (where it sits is just where it happens to be): a
 * move to each of the other folders, Pin, read / unread. A move to the folder it is already in
 * is the only thing left out. In Trash and Spam, where mail is discarded for good, "Delete
 * forever" comes last.
 */
export function actionsForThread(folder: MailFolder, thread: Thread): RowAction[] {
  const moves = moveTargets(folder).map((target) => ({ ...MOVE_TARGETS[target], hint: MOVE_HINTS[target] }));
  const toggles: RowAction[] = [
    thread.pinned
      ? { action: "unpin", label: "Unpin", icon: PinOff, hint: "P" }
      : { action: "pin", label: "Pin", icon: Pin, hint: "P" },
    thread.unread
      ? { action: "markRead", label: "Mark as read", icon: MailOpen, hint: "U" }
      : { action: "markUnread", label: "Mark as unread", icon: Mail, hint: "U" },
  ];
  const actions: RowAction[] = [
    ...moves.filter((move) => move.action === "unarchive" || move.action === "archive"),
    ...toggles,
    ...moves.filter((move) => move.action === "trash" || move.action === "spam"),
  ];
  if (folder === "trash" || folder === "spam") {
    actions.push({ action: "deleteForever", label: "Delete forever", icon: Flame, hint: folder === "trash" ? "D D" : undefined });
  }
  return actions;
}

const MOVE_TARGETS: Record<(typeof MOVE_FOLDERS)[number], Omit<RowAction, "hint">> = {
  inbox: { action: "unarchive", label: "Move to Inbox", icon: Inbox },
  archive: { action: "archive", label: "Archive", icon: Archive },
  trash: { action: "trash", label: "Move to Trash", icon: Trash2 },
  spam: { action: "spam", label: "Report spam", icon: ShieldAlert },
};

/**
 * The buttons shown on a row under the pointer, whatever folder it is in: Pin, then a move to
 * each of the other folders (Inbox, Archive, Trash, Spam).
 */
export function rowHoverActions(folder: MailFolder, thread: Pick<Thread, "pinned">): RowAction[] {
  return [
    thread.pinned
      ? { action: "unpin", label: "Unpin", icon: PinOff, hint: "P" }
      : { action: "pin", label: "Pin", icon: Pin, hint: "P" },
    ...moveTargets(folder).map((target) => ({ ...MOVE_TARGETS[target], hint: MOVE_HINTS[target] })),
  ];
}

import type { MailAction, MailFolder, MessageSummary } from "@shared/types";

/**
 * Applies a mail action to the local list immediately, before the server confirms,
 * so the UI feels instant. Moves and deletes drop the rows from the current view;
 * flag changes patch them in place. A failed request triggers a refresh that
 * restores the truth.
 */
export function applyOptimistic(
  messages: readonly MessageSummary[],
  action: MailAction,
  ids: ReadonlySet<string>,
  folder: MailFolder,
): MessageSummary[] {
  switch (action) {
    case "markRead":
      return messages.map((m) => (ids.has(m.id) ? { ...m, unread: false } : m));
    case "markUnread":
      return messages.map((m) => (ids.has(m.id) ? { ...m, unread: true } : m));
    case "pin":
      return messages.map((m) => (ids.has(m.id) ? { ...m, pinned: true } : m));
    case "unpin":
      // In the Pinned view an unpinned message no longer belongs there.
      return folder === "pinned"
        ? messages.filter((m) => !ids.has(m.id))
        : messages.map((m) => (ids.has(m.id) ? { ...m, pinned: false } : m));
    case "archive":
    case "unarchive":
    case "trash":
    case "spam":
    case "deleteForever":
      return messages.filter((m) => !ids.has(m.id));
  }
}

/** Where each move action puts a message. */
const MOVED_TO: Partial<Record<MailAction, MailFolder>> = {
  archive: "archive",
  unarchive: "inbox",
  spam: "spam",
  trash: "trash",
};

/**
 * Like `applyOptimistic`, for a list that also holds Archive, Spam and Trash mail (the Inbox with
 * those folders shown): a move changes the message's folder instead of dropping it, so it stays
 * in the list when its new folder is shown. Deleting forever still drops it.
 */
export function applyOptimisticKeepingFolders(
  messages: readonly MessageSummary[],
  action: MailAction,
  ids: ReadonlySet<string>,
  folder: MailFolder,
): MessageSummary[] {
  const to = MOVED_TO[action];
  if (!to) return applyOptimistic(messages, action, ids, folder);
  return messages.map((m) => (ids.has(m.id) ? { ...m, folder: to } : m));
}

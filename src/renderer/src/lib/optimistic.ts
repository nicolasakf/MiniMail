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

import { parseMessageId } from "@shared/ids";
import type { MailAction, MailFolder, MessageSummary } from "@shared/types";

/** What was last seen in one folder, kept between launches so the list can paint at once. */
export interface CachedFolder {
  /**
   * IMAP UIDVALIDITY when the copy was taken. UIDs only mean something while it is unchanged,
   * so a different value on the server means the copy is discarded.
   */
  uidValidity: string;
  messages: MessageSummary[];
}

/** Where one account's folder copies live. Optional: without it the provider caches in memory only. */
export interface SummaryStore {
  load(folder: MailFolder): CachedFolder | undefined;
  save(folder: MailFolder, value: CachedFolder): void;
}

/** The provider-native id (IMAP UID) of a summary. */
export function nativeIdOf(message: MessageSummary): string | undefined {
  return parseMessageId(message.id)?.nativeId;
}

/**
 * What a cached list should look like after an action succeeded on the server, so a copy saved
 * just before the action cannot bring a moved or deleted message back on the next launch.
 */
export function patchSummaries<T extends MessageSummary>(
  messages: readonly T[],
  action: MailAction,
  folder: MailFolder,
  nativeIds: ReadonlySet<string>,
): T[] {
  const targeted = (message: T) => nativeIds.has(nativeIdOf(message) ?? "");
  const update = (change: Partial<MessageSummary>): T[] =>
    messages.map((message) => (targeted(message) ? { ...message, ...change } : message));

  switch (action) {
    case "markRead":
      return update({ unread: false });
    case "markUnread":
      return update({ unread: true });
    case "pin":
      return update({ pinned: true });
    case "unpin":
      // In the Pinned view an unpinned message is no longer part of the list.
      return folder === "pinned"
        ? messages.filter((message) => !targeted(message))
        : update({ pinned: false });
    case "archive":
    case "unarchive":
    case "trash":
    case "spam":
    case "deleteForever":
      return messages.filter((message) => !targeted(message));
  }
}

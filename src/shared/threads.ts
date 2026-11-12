import type { MailFolder, MessageSummary } from "./types";

export interface Thread {
  /** Stable across refreshes: `${accountId}:${threadId}`. */
  id: string;
  accountId: string;
  /** Oldest first. */
  messages: MessageSummary[];
  latest: MessageSummary;
  count: number;
  unread: boolean;
  pinned: boolean;
  /** Some message in the conversation is marked as replied to. */
  answered: boolean;
  hasAttachments: boolean;
  /** The user's category; the whole conversation shares one (see the main-process categorizer). */
  categoryId: string | null;
}

/** Orders messages oldest-first by timestamp, keeping input order for ties. */
function byDateAscending(a: MessageSummary, b: MessageSummary): number {
  return Date.parse(a.date) - Date.parse(b.date);
}

/**
 * Collapses a flat message list into conversations, newest conversation first.
 * Messages from different accounts never merge, even if thread ids collide.
 */
export function groupThreads(messages: readonly MessageSummary[]): Thread[] {
  const buckets = new Map<string, MessageSummary[]>();
  for (const message of messages) {
    const key = `${message.accountId}:${message.threadId}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(message);
    else buckets.set(key, [message]);
  }

  const threads: Thread[] = [];
  for (const [id, bucket] of buckets) {
    const sorted = [...bucket].sort(byDateAscending);
    const latest = sorted[sorted.length - 1];
    threads.push({
      id,
      accountId: latest.accountId,
      messages: sorted,
      latest,
      count: sorted.length,
      unread: sorted.some((m) => m.unread),
      pinned: sorted.some((m) => m.pinned),
      answered: sorted.some((m) => m.answered),
      hasAttachments: sorted.some((m) => m.hasAttachments),
      categoryId: latest.categoryId,
    });
  }

  return threads.sort(
    (a, b) => Date.parse(b.latest.date) - Date.parse(a.latest.date),
  );
}

/** The folders a conversation can be moved between, in the order menus list them. */
export const MOVE_FOLDERS = ["inbox", "archive", "spam", "trash"] as const;
export type MoveFolder = (typeof MOVE_FOLDERS)[number];

/**
 * The one folder a conversation is in, for a list that mixes folders. Like Gmail: it is in
 * the Inbox while any of its messages is; otherwise where its newest message is.
 */
export function conversationFolder(thread: Pick<Thread, "messages" | "latest">): MailFolder {
  if (thread.messages.some((message) => message.folder === "inbox")) return "inbox";
  return thread.latest.folder;
}

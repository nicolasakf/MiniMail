import { senderDomain } from "./categories";
import type { Thread } from "./threads";
import type { MessageSummary } from "./types";

/** Who the user blocked: single sender addresses, or every sender of a domain. */
export interface BlockList {
  /** Sender addresses, lower case. */
  senders: string[];
  /** Registrable domains as `senderDomain` names them, lower case. */
  domains: string[];
}

export const EMPTY_BLOCKLIST: BlockList = { senders: [], domains: [] };

/** Upper bound per kind, so the stored list cannot grow without limit. */
export const MAX_BLOCK_ENTRIES = 2000;

export type BlockKind = keyof BlockList;

/** The form an entry is stored and compared in. */
export function blockKey(value: string): string {
  return value.trim().toLowerCase();
}

export function isBlockedEntry(list: BlockList, kind: BlockKind, value: string): boolean {
  return list[kind].includes(blockKey(value));
}

/** The list with the entry added, or removed when it is already there. Oldest entries drop past the cap. */
export function toggleBlockEntry(list: BlockList, kind: BlockKind, value: string): BlockList {
  const key = blockKey(value);
  if (!key) return list;
  const current = list[kind];
  if (current.includes(key)) return { ...list, [kind]: current.filter((entry) => entry !== key) };
  return { ...list, [kind]: [...current, key].slice(-MAX_BLOCK_ENTRIES) };
}

/** The list with the entry added (a no-op when it is already there). */
export function addBlockEntry(list: BlockList, kind: BlockKind, value: string): BlockList {
  return isBlockedEntry(list, kind, value) ? list : toggleBlockEntry(list, kind, value);
}

export function isBlockListEmpty(list: BlockList): boolean {
  return list.senders.length === 0 && list.domains.length === 0;
}

/** Whether mail from this address is blocked: the address itself, or its domain. */
export function isBlockedAddress(list: BlockList, email: string): boolean {
  return list.senders.includes(blockKey(email)) || list.domains.includes(senderDomain(email));
}

export function isBlockedMessage(list: BlockList, message: Pick<MessageSummary, "from">): boolean {
  return isBlockedAddress(list, message.from.email);
}

/** Whether the conversation's newest message is from a blocked sender (the name a list shows). */
export function isBlockedThread(list: BlockList, thread: Pick<Thread, "latest">): boolean {
  return isBlockedMessage(list, thread.latest);
}

/**
 * The messages that still have to go to the Trash: blocked mail sitting in the Inbox or Archive.
 * Spam is already discarded, Trash is where it should be, and the user's own mail (Sent, Drafts,
 * anything from one of their addresses) is never touched.
 */
export function mailToTrash(
  list: BlockList,
  messages: readonly MessageSummary[],
  own: readonly string[] = [],
): MessageSummary[] {
  if (isBlockListEmpty(list)) return [];
  const mine = new Set(own.map(blockKey));
  return messages.filter(
    (message) =>
      (message.folder === "inbox" || message.folder === "archive" || message.folder === "pinned") &&
      !mine.has(blockKey(message.from.email)) &&
      isBlockedMessage(list, message),
  );
}

/** Keeps only well-formed, de-duplicated entries of a stored value; anything else yields an empty list. */
export function parseBlockList(value: unknown): BlockList {
  const read = (kind: BlockKind): string[] => {
    const raw = typeof value === "object" && value !== null ? (value as Record<string, unknown>)[kind] : undefined;
    if (!Array.isArray(raw)) return [];
    const keys = raw.filter((entry): entry is string => typeof entry === "string").map(blockKey);
    return [...new Set(keys.filter(Boolean))].slice(-MAX_BLOCK_ENTRIES);
  };
  return { senders: read("senders"), domains: read("domains") };
}

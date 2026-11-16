import { isBlockedMessage, type BlockList } from "./blocklist";
import { senderDomain } from "./categories";
import type { GroupDef } from "./focus-list";
import type { Thread } from "./threads";
import type { MessageSummary } from "./types";

/**
 * What the user marked as priority: whole conversations, one sender's address, or every sender
 * of a domain. Mail that matches any of them is priority mail.
 */
export interface PriorityList {
  /** Conversation ids (`accountId:threadId`). */
  threads: string[];
  /** Sender addresses, lower case. */
  senders: string[];
  /** Registrable domains as `senderDomain` names them, lower case. */
  domains: string[];
  /**
   * Who is blocked, when the list is read for matching mail: blocked mail is never priority through
   * its sender or domain. Left out of the stored list.
   */
  blocklist?: BlockList;
}

/** The list the priority card opens, in the place of a category's own list. */
export const PRIORITY_GROUP = "group:priority";

export const PRIORITY_GROUP_DEF: GroupDef = { kind: PRIORITY_GROUP, label: "Priority", hue: 40, icon: "Zap" };

export const EMPTY_PRIORITY: PriorityList = { threads: [], senders: [], domains: [] };

/** Upper bound per kind, so the stored list cannot grow without limit. */
export const MAX_PRIORITY_ENTRIES = 1000;

export type PriorityKind = "threads" | "senders" | "domains";

/** The form an entry is stored and compared in. */
export function priorityKey(kind: PriorityKind, value: string): string {
  const trimmed = value.trim();
  return kind === "threads" ? trimmed : trimmed.toLowerCase();
}

export function priorityThreadId(message: Pick<MessageSummary, "accountId" | "threadId">): string {
  return `${message.accountId}:${message.threadId}`;
}

export function isPriorityEntry(list: PriorityList, kind: PriorityKind, value: string): boolean {
  return list[kind].includes(priorityKey(kind, value));
}

/**
 * The list with the entry added, or removed when it is already there. Oldest entries drop past
 * the cap. A sender and its domain are never both marked: adding a sender takes its domain off,
 * and adding a domain takes off every marked sender in it. A conversation is independent of both,
 * since anyone can reply in it.
 */
export function togglePriorityEntry(list: PriorityList, kind: PriorityKind, value: string): PriorityList {
  const key = priorityKey(kind, value);
  if (!key) return list;
  const current = list[kind];
  if (current.includes(key)) return { ...list, [kind]: current.filter((entry) => entry !== key) };
  const added = { ...list, [kind]: [...current, key].slice(-MAX_PRIORITY_ENTRIES) };
  if (kind === "senders") return { ...added, domains: added.domains.filter((domain) => domain !== senderDomain(key)) };
  if (kind === "domains") return { ...added, senders: added.senders.filter((sender) => senderDomain(sender) !== key) };
  return added;
}

/**
 * The list once a sender or domain is blocked: its priority mark goes. Blocking a domain also takes
 * off every marked sender in it. Blocking one sender leaves its domain marked for everyone else.
 */
export function withoutBlocked(list: PriorityList, kind: "senders" | "domains", value: string): PriorityList {
  const key = priorityKey(kind, value);
  if (kind === "senders") return { ...list, senders: list.senders.filter((sender) => sender !== key) };
  return {
    ...list,
    domains: list.domains.filter((domain) => domain !== key),
    senders: list.senders.filter((sender) => senderDomain(sender) !== key),
  };
}

export function isPriorityEmpty(list: PriorityList): boolean {
  return list.threads.length === 0 && list.senders.length === 0 && list.domains.length === 0;
}

/** Why a message counts as priority: its conversation, its sender, or its sender's domain. */
export function priorityReason(
  list: PriorityList,
  message: Pick<MessageSummary, "accountId" | "threadId" | "from">,
): PriorityKind | null {
  if (list.threads.includes(priorityThreadId(message))) return "threads";
  // Block wins: mail from a blocked sender or domain is on its way to the Trash, not priority mail.
  if (list.blocklist && isBlockedMessage(list.blocklist, message)) return null;
  if (list.senders.includes(priorityKey("senders", message.from.email))) return "senders";
  if (list.domains.includes(senderDomain(message.from.email))) return "domains";
  return null;
}

export function isPriorityMessage(
  list: PriorityList,
  message: Pick<MessageSummary, "accountId" | "threadId" | "from">,
): boolean {
  return priorityReason(list, message) !== null;
}

/** Whether a conversation is priority: marked itself, or any message in it is from a priority sender or domain. */
export function isPriorityThread(list: PriorityList, thread: Pick<Thread, "id" | "messages">): boolean {
  return list.threads.includes(thread.id) || thread.messages.some((message) => isPriorityMessage(list, message));
}

/**
 * The conversations that need attention: priority ones in the Inbox with something unread. A
 * new message in a marked conversation, or a new message from a marked sender or domain, is
 * unread, so it shows up here by itself and leaves once it has been read.
 *
 * `own` are the user's addresses: mail they wrote themselves never counts as arriving.
 */
export function priorityInbox(
  list: PriorityList,
  threads: readonly Thread[],
  own: readonly string[] = [],
): Thread[] {
  if (isPriorityEmpty(list)) return [];
  const mine = new Set(own.map((address) => address.trim().toLowerCase()));
  return threads.filter((thread) => {
    const arrived = thread.messages.filter(
      (message) => message.unread && message.folder === "inbox" && !mine.has(message.from.email.trim().toLowerCase()),
    );
    if (arrived.length === 0) return false;
    return list.threads.includes(thread.id) || arrived.some((message) => isPriorityMessage(list, message));
  });
}

/** Why a conversation is priority: the marked conversation itself, else its newest message that matches. */
export function threadPriorityReason(list: PriorityList, thread: Pick<Thread, "id" | "messages">): PriorityKind | null {
  if (list.threads.includes(thread.id)) return "threads";
  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    const reason = priorityReason(list, thread.messages[index]!);
    if (reason) return reason;
  }
  return null;
}

/** Keeps only well-formed, de-duplicated entries of a stored value; anything else yields an empty list. */
export function parsePriorityList(value: unknown): PriorityList {
  const read = (kind: PriorityKind): string[] => {
    const raw = typeof value === "object" && value !== null ? (value as Record<string, unknown>)[kind] : undefined;
    if (!Array.isArray(raw)) return [];
    const keys = raw.filter((entry): entry is string => typeof entry === "string").map((entry) => priorityKey(kind, entry));
    return [...new Set(keys.filter(Boolean))].slice(-MAX_PRIORITY_ENTRIES);
  };
  return { threads: read("threads"), senders: read("senders"), domains: read("domains") };
}

import type { Contact, MailFolder, MessageSummary, UnsubscribeInfo } from "./types";
import type { Thread } from "./threads";

/** The `<...>` entries of a `List-Unsubscribe` header, in the order the sender listed them. */
function listedTargets(header: string): string[] {
  return [...header.matchAll(/<([^<>]+)>/g)].map((match) => match[1]!.trim());
}

/** A `List-Id` header (`"Weekly digest" <digest.example.com>`) reduced to the id alone, lowercase. */
export function normalizeListId(header: string | undefined): string | null {
  if (!header) return null;
  const inside = /<([^<>]+)>/.exec(header)?.[1] ?? header;
  const id = inside.trim().toLowerCase();
  return id || null;
}

/**
 * Reads the sender's unsubscribe address from the `List-Unsubscribe` and `List-Unsubscribe-Post`
 * headers, and the list's name from `List-Id`. Only web addresses count (`mailto:` needs MiniMail
 * to send mail for the user, which is not offered yet). One-click needs https and the
 * `List-Unsubscribe=One-Click` post header (RFC 8058); otherwise the address is only something to
 * open in a browser.
 */
export function parseUnsubscribe(
  listUnsubscribe: string | undefined,
  listUnsubscribePost: string | undefined,
  listId?: string,
): UnsubscribeInfo | null {
  if (!listUnsubscribe) return null;
  const candidates = listedTargets(listUnsubscribe).flatMap((raw) => {
    try {
      const url = new URL(raw);
      return url.protocol === "https:" || url.protocol === "http:" ? [url] : [];
    } catch {
      // expected: a List-Unsubscribe entry that is not a valid address is skipped.
      return [];
    }
  });
  const oneClickPost = /list-unsubscribe\s*=\s*one-click/i.test(listUnsubscribePost ?? "");
  // An https address that takes the one-click request beats a plain page.
  const best = (oneClickPost ? candidates.find((url) => url.protocol === "https:") : undefined) ?? candidates[0];
  if (!best) return null;
  return { url: best.toString(), oneClick: oneClickPost && best.protocol === "https:", listId: normalizeListId(listId) };
}

/** Folders whose mail is never offered an Unsubscribe: the user's own mail, and spam (unsubscribing tells spammers the address is live). */
const NO_UNSUBSCRIBE: ReadonlySet<MailFolder> = new Set(["sent", "drafts", "spam"]);

/** Whether Unsubscribe makes sense in this folder at all; the command is left out of Sent, Drafts and Spam. */
export function unsubscribeAllowedIn(folder: MailFolder): boolean {
  return !NO_UNSUBSCRIBE.has(folder);
}

/** The unsubscribe address of a message, or null when it has none or should not be offered one. */
export function messageUnsubscribe(message: MessageSummary): UnsubscribeInfo | null {
  // A sender that failed authentication may not be who it claims, so its address is not trusted.
  if (!message.unsubscribe || message.authenticated === false || !unsubscribeAllowedIn(message.folder)) return null;
  return message.unsubscribe;
}

/** The newest message of a conversation that can be unsubscribed from. */
export function threadUnsubscribeMessage(thread: Pick<Thread, "messages">): MessageSummary | null {
  for (let index = thread.messages.length - 1; index >= 0; index--) {
    const message = thread.messages[index]!;
    if (messageUnsubscribe(message)) return message;
  }
  return null;
}

/**
 * Names the mailing list a message belongs to, per account: its `List-Id` when it has one, else the
 * sender's address. One address can send several lists, and ordinary mail besides, so the address
 * alone is only the fallback.
 */
export function listKey(message: Pick<MessageSummary, "accountId" | "from" | "unsubscribe">): string {
  const listId = message.unsubscribe?.listId;
  return `${message.accountId}|${listId ? `list:${listId}` : `from:${message.from.email.toLowerCase()}`}`;
}

/** When the user unsubscribed from each list (`listKey`), in milliseconds since 1970. Kept on this computer only. */
export type UnsubscribedLists = Readonly<Record<string, number>>;

/**
 * How long after an unsubscribe a message of the same list is still expected (senders may take a
 * little while to act). A message of that list that arrives later than this means it did not work.
 */
export const STILL_RECEIVING_AFTER_MS = 24 * 60 * 60 * 1000;

/** Most lists remembered; the oldest are forgotten first. */
const MAX_REMEMBERED = 5000;

export function parseUnsubscribedLists(raw: unknown): UnsubscribedLists {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const entries = Object.entries(raw as Record<string, unknown>).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]),
  );
  return Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_REMEMBERED));
}

/** The record with these lists marked as unsubscribed at `at`. */
export function withUnsubscribed(record: UnsubscribedLists, keys: readonly string[], at: number): UnsubscribedLists {
  return parseUnsubscribedLists({ ...record, ...Object.fromEntries(keys.map((key) => [key, at])) });
}

/**
 * What Unsubscribe means for one message:
 * - `none`: it offers no way to unsubscribe.
 * - `available`: it does, and the user has not unsubscribed from its list.
 * - `done`: the user unsubscribed from this list (at `at`) and the message is no later than the grace period after.
 * - `again`: the user did, but this list message arrived after the grace period: it did not work.
 */
export type UnsubscribeState =
  | { status: "none" }
  | { status: "available" }
  | { status: "done"; at: number }
  | { status: "again"; at: number };

export function messageUnsubscribeState(message: MessageSummary, record: UnsubscribedLists): UnsubscribeState {
  if (!messageUnsubscribe(message)) return { status: "none" };
  const at = record[listKey(message)];
  if (at === undefined) return { status: "available" };
  return Date.parse(message.date) > at + STILL_RECEIVING_AFTER_MS ? { status: "again", at } : { status: "done", at };
}

/** The state of a conversation: that of its newest message that offers a way to unsubscribe. */
export function threadUnsubscribeState(thread: Pick<Thread, "messages">, record: UnsubscribedLists): UnsubscribeState {
  const message = threadUnsubscribeMessage(thread);
  return message ? messageUnsubscribeState(message, record) : { status: "none" };
}

/** How the Unsubscribe command looks for a set of conversations. */
export interface UnsubscribeCommand {
  /** At least one of them offers a way to unsubscribe, so the command is there. */
  shown: boolean;
  /** At least one can still be unsubscribed from now; otherwise the command is greyed out. */
  enabled: boolean;
  /** Every one that can be unsubscribed from is one the user already did, which is still sending. */
  again: boolean;
  /** When the user last unsubscribed, for the greyed-out explanation. */
  doneAt: number | null;
}

export function unsubscribeCommand(
  threads: readonly Pick<Thread, "messages">[],
  record: UnsubscribedLists,
): UnsubscribeCommand {
  const states = threads.map((thread) => threadUnsubscribeState(thread, record)).filter((state) => state.status !== "none");
  const open = states.filter((state) => state.status === "available" || state.status === "again");
  const doneAt = states.reduce<number | null>(
    (latest, state) => (state.status === "done" && (latest === null || state.at > latest) ? state.at : latest),
    null,
  );
  return {
    shown: states.length > 0,
    enabled: open.length > 0,
    again: open.length > 0 && open.every((state) => state.status === "again"),
    doneAt,
  };
}

export interface UnsubscribeEntry<T> {
  /** The message whose headers the request is made from. */
  messageId: string;
  /** The list being left (`listKey`); remembered once the request succeeds. */
  key: string;
  /** Who is being unsubscribed from. */
  sender: Contact;
  /** The conversations of this list that were selected. */
  threads: T[];
}

export interface UnsubscribePlan<T> {
  /** One entry per list: ten mails from one newsletter send one request. */
  entries: UnsubscribeEntry<T>[];
  /** Conversations with nothing to unsubscribe from; they are left alone. */
  skipped: number;
  /** Conversations of a list the user already unsubscribed from; they are left alone too. */
  alreadyDone: number;
}

/**
 * What the Unsubscribe command does for these conversations: one request per list, and nothing for
 * conversations that offer no way to unsubscribe or whose list the user already left.
 */
export function planUnsubscribe<T extends Pick<Thread, "messages" | "accountId">>(
  threads: readonly T[],
  record: UnsubscribedLists,
): UnsubscribePlan<T> {
  const byList = new Map<string, UnsubscribeEntry<T>>();
  let skipped = 0;
  let alreadyDone = 0;
  for (const thread of threads) {
    const message = threadUnsubscribeMessage(thread);
    if (!message) {
      skipped += 1;
      continue;
    }
    if (messageUnsubscribeState(message, record).status === "done") {
      alreadyDone += 1;
      continue;
    }
    const key = listKey(message);
    const entry = byList.get(key);
    if (entry) entry.threads.push(thread);
    else byList.set(key, { messageId: message.id, key, sender: message.from, threads: [thread] });
  }
  return { entries: [...byList.values()], skipped, alreadyDone };
}

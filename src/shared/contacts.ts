import type { Contact, MessageSummary, SmartCategory } from "./types";

/**
 * One address we have exchanged mail with, as the composer's recipient boxes suggest it.
 * `sentTo` is what ranks it: people we wrote to (which includes everyone who got a reply from
 * us) come before people who only ever wrote to us.
 */
export interface ContactEntry {
  email: string;
  /** The most informative display name seen for the address; empty when none was ever shown. */
  name: string;
  /** Messages we sent that were addressed to this contact. */
  sentTo: number;
  /** Messages this contact sent us. */
  receivedFrom: number;
  /** Timestamp (ms) of the latest message in either direction. */
  lastSeen: number;
  /** Header signal of their latest message to us; picks person photo or company logo. */
  signal: SmartCategory;
}

/** Automated senders nobody writes back to; suggesting them would only be noise. */
const NO_REPLY = /(^|[._+-])(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?)([._+-]|@)/i;

/**
 * Builds the address book from messages of the Sent and Inbox folders (any folder works: a
 * message from one of `ownEmails` counts as sent, anything else as received).
 */
export function buildContactIndex(
  messages: readonly MessageSummary[],
  ownEmails: ReadonlySet<string>,
): ContactEntry[] {
  const entries = new Map<string, ContactEntry>();

  const touch = (contact: Contact, stamp: number, signal: SmartCategory | null): ContactEntry | null => {
    const email = contact.email.trim().toLowerCase();
    if (!email.includes("@") || ownEmails.has(email)) return null;
    let entry = entries.get(email);
    if (!entry) {
      entry = { email, name: "", sentTo: 0, receivedFrom: 0, lastSeen: 0, signal: "person" };
      entries.set(email, entry);
    }
    const name = contact.name.trim();
    // Prefer a real name over the address repeated as a name, and a longer one over a shorter.
    if (name && name.toLowerCase() !== email && name.length >= entry.name.length) entry.name = name;
    if (stamp > entry.lastSeen) {
      entry.lastSeen = stamp;
      if (signal) entry.signal = signal;
    }
    return entry;
  };

  for (const message of messages) {
    const stamp = Date.parse(message.date) || 0;
    if (ownEmails.has(message.from.email.trim().toLowerCase())) {
      for (const recipient of message.to) {
        const entry = touch(recipient, stamp, null);
        if (entry) entry.sentTo += 1;
      }
    } else {
      const entry = touch(message.from, stamp, message.signal);
      if (entry) entry.receivedFrom += 1;
    }
  }

  return [...entries.values()].filter(
    (entry) => entry.sentTo > 0 || !NO_REPLY.test(entry.email),
  );
}

/** How well `query` (already lowercase words) matches an entry: 0 for no match, higher is better. */
function matchRank(entry: ContactEntry, words: readonly string[]): number {
  const email = entry.email;
  const name = entry.name.toLowerCase();
  const haystack = `${name} ${email}`;
  if (!words.every((word) => haystack.includes(word))) return 0;
  const first = words[0] ?? "";
  if (!first) return 1;
  if (email.startsWith(first) || name.startsWith(first)) return 3;
  const wordStart = name.split(/\s+/).some((part) => part.startsWith(first));
  return wordStart ? 2 : 1;
}

/**
 * The contacts matching what was typed since the last comma, best first: people we have written
 * to before people who only wrote to us; within each group, a better match, then more mail
 * exchanged, then the more recent contact. An empty query matches nobody.
 */
export function searchContacts(
  index: readonly ContactEntry[],
  query: string,
  exclude: ReadonlySet<string> = new Set(),
  limit = 6,
): ContactEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return index
    .map((entry) => ({ entry, rank: exclude.has(entry.email) ? 0 : matchRank(entry, words) }))
    .filter(({ rank }) => rank > 0)
    .sort(
      (a, b) =>
        Number(b.entry.sentTo > 0) - Number(a.entry.sentTo > 0) ||
        b.rank - a.rank ||
        b.entry.sentTo + b.entry.receivedFrom - (a.entry.sentTo + a.entry.receivedFrom) ||
        b.entry.lastSeen - a.entry.lastSeen,
    )
    .slice(0, limit)
    .map(({ entry }) => entry);
}

/**
 * A readable name for an address nobody ever gave a name for ("jane.doe@x.com" is "Jane Doe").
 * Only used for display: it is never put in a message. Addresses that do not look like
 * words (digits, one letter) get no guess.
 */
export function guessName(email: string): string {
  const local = email.split("@")[0] ?? "";
  const words = local.split(/[._+-]+/).filter((word) => /^[a-z]{2,}$/i.test(word));
  if (words.length === 0 || words.length > 3) return "";
  return words.map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase()).join(" ");
}

/** What to call a contact in a list or chip: their name, else a guess from the address, else the address. */
export function entryLabel(entry: Pick<ContactEntry, "name" | "email">): string {
  return entry.name || guessName(entry.email) || entry.email;
}

/** The text after the last comma or semicolon: what the user is typing right now. */
export function currentToken(text: string): string {
  const cut = Math.max(text.lastIndexOf(","), text.lastIndexOf(";"));
  return text.slice(cut + 1).trim();
}

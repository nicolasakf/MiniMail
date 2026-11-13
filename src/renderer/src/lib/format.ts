import type { Thread } from "@shared/threads";
import type { Account, Contact, MailFolder } from "@shared/types";

const TIME_FORMAT = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const SHORT_DATE_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const LONG_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const FULL_FORMAT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Row timestamp as Spark shows it: time today, otherwise "Nov 8" (with the year once it is not this year). */
export function formatListTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (isSameDay(date, now)) return TIME_FORMAT.format(date);
  return date.getFullYear() === now.getFullYear()
    ? SHORT_DATE_FORMAT.format(date)
    : LONG_DATE_FORMAT.format(date);
}

/** Full timestamp for the conversation view. */
export function formatFullDate(iso: string): string {
  return FULL_FORMAT.format(new Date(iso));
}

/** Subject without reply/forward prefixes, so a conversation reads as one topic ("Re: Re: Plans" -> "Plans"). */
export function normalizeSubject(subject: string): string {
  const stripped = subject.replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, "").trim();
  return stripped || subject.trim() || "(no subject)";
}

/** Best human label for a contact. */
export function contactLabel(contact: Contact): string {
  return contact.name.trim() || contact.email;
}

/** Up to two initials for an avatar. */
export function initialsOf(contact: Contact): string {
  // Without a display name, use the part before the @ so the domain never leaks into the initials.
  const source = (contact.name.trim() || contact.email.split("@")[0]).replace(/[<>"']/g, "").trim();
  const words = source.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0] ?? "";
  const second = words.length > 1 ? (words[1][0] ?? "") : "";
  return (first + second).toUpperCase();
}

/** Stable hue (0-360) per sender, drawn from a palette so rings stay distinguishable. */
const RING_HUES = [275, 355, 130, 215, 32, 330, 175, 55];
export function senderHue(email: string): number {
  let hash = 0;
  for (let i = 0; i < email.length; i += 1) {
    hash = (hash * 31 + email.charCodeAt(i)) >>> 0;
  }
  return RING_HUES[hash % RING_HUES.length];
}

function firstName(contact: Contact): string {
  const label = contactLabel(contact);
  return contact.name.trim() ? (label.split(/\s+/)[0] ?? label) : label;
}

/**
 * The name column of a row. Received mail shows who it is from (several first names
 * for a conversation); Sent and Drafts show the recipients instead.
 */
export function threadSenderLabel(thread: Thread, folder: MailFolder): string {
  if (folder === "sent" || folder === "drafts") {
    const recipients = thread.latest.to;
    if (recipients.length === 0) return "(no recipients)";
    const first = contactLabel(recipients[0]);
    return recipients.length > 1 ? `${first} +${recipients.length - 1}` : first;
  }

  const seen = new Map<string, Contact>();
  for (const message of thread.messages) {
    seen.set(message.from.email.toLowerCase(), message.from);
  }
  const people = [...seen.values()];
  if (people.length <= 1) return contactLabel(thread.latest.from);
  const names = people.slice(0, 3).map(firstName);
  return people.length > 3 ? `${names.join(", ")} +${people.length - 3}` : names.join(", ");
}

/** The account a message belongs to, for tinting and labels. */
export function accountFor(accounts: readonly Account[], accountId: string): Account | undefined {
  return accounts.find((account) => account.id === accountId);
}

export const FOLDER_TITLES: Record<MailFolder, string> = {
  inbox: "All Mail",
  pinned: "Pinned",
  drafts: "Drafts",
  sent: "Sent",
  archive: "Archive",
  spam: "Spam",
  trash: "Trash",
};

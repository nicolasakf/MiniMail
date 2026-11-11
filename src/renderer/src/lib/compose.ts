import type { Account, Contact, Draft, MessageDetail } from "@shared/types";

import { contactLabel, formatFullDate } from "./format";

export type ComposeMode = "new" | "reply" | "replyAll" | "forward";

/** What the composer opens with; every field stays editable by the user. */
export interface ComposeSeed {
  mode: ComposeMode;
  accountId: string;
  to: Contact[];
  cc: Contact[];
  subject: string;
  body: string;
  inReplyTo?: Draft["inReplyTo"];
}

/** Plain-text rendition of a message, used for quoting. */
export function messageToText(message: Pick<MessageDetail, "text" | "html">): string {
  if (message.text) return message.text;
  if (!message.html) return "";
  if (typeof DOMParser === "undefined") return message.html.replace(/<[^>]+>/g, " ");
  const doc = new DOMParser().parseFromString(message.html, "text/html");
  doc.querySelectorAll("style, script").forEach((node) => node.remove());
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

function quote(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

function withPrefix(subject: string, prefix: "Re:" | "Fwd:"): string {
  const pattern = prefix === "Re:" ? /^re:\s*/i : /^(fwd?|fw):\s*/i;
  return pattern.test(subject) ? subject : `${prefix} ${subject}`;
}

/** Removes the user's own addresses and duplicates from a recipient list. */
function uniqueOthers(contacts: Contact[], own: ReadonlySet<string>): Contact[] {
  const seen = new Set<string>();
  return contacts.filter((contact) => {
    const key = contact.email.toLowerCase();
    if (own.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Starts an empty message from the given account. */
export function newMessageSeed(accountId: string): ComposeSeed {
  return { mode: "new", accountId, to: [], cc: [], subject: "", body: "" };
}

/**
 * Builds the composer contents for replying to or forwarding a message. The quoted
 * original is written into the body, so providers need no special reply handling.
 */
export function buildReplySeed(
  message: MessageDetail,
  mode: "reply" | "replyAll" | "forward",
  accounts: readonly Account[],
): ComposeSeed {
  const own = new Set(accounts.map((account) => account.email.toLowerCase()));
  const original = messageToText(message);
  const inReplyTo = message.messageId
    ? {
        messageId: message.messageId,
        nativeId: message.id,
        references: message.references,
        mode,
      }
    : undefined;

  if (mode === "forward") {
    const header = [
      "---------- Forwarded message ----------",
      `From: ${contactLabel(message.from)} <${message.from.email}>`,
      `Date: ${formatFullDate(message.date)}`,
      `Subject: ${message.subject}`,
      `To: ${message.to.map((c) => c.email).join(", ")}`,
    ].join("\n");
    return {
      mode,
      accountId: message.accountId,
      to: [],
      cc: [],
      subject: withPrefix(message.subject, "Fwd:"),
      body: `\n\n${header}\n\n${original}`,
      inReplyTo,
    };
  }

  const sender = message.replyTo ?? message.from;
  const attribution = `On ${formatFullDate(message.date)}, ${contactLabel(message.from)} <${message.from.email}> wrote:`;
  const to =
    mode === "replyAll"
      ? uniqueOthers([sender, ...message.to], own)
      : [sender];
  const cc = mode === "replyAll" ? uniqueOthers(message.cc, own) : [];

  return {
    mode,
    accountId: message.accountId,
    // If the user wrote the message themselves (replying from Sent), keep the original recipients.
    to: to.length > 0 ? to : message.to,
    cc,
    subject: withPrefix(message.subject, "Re:"),
    body: `\n\n${attribution}\n${quote(original)}`,
    inReplyTo,
  };
}

/** Splits on commas, semicolons and newlines, except inside a quoted display name. */
function splitOutsideQuotes(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const char of input) {
    if (char === '"') inQuotes = !inQuotes;
    if (!inQuotes && (char === "," || char === ";" || char === "\n")) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

const ADDRESS_PATTERN =/^(?:"?([^"<]*?)"?\s*)?<([^<>@\s]+@[^<>@\s]+)>$|^([^<>@\s,;]+@[^<>@\s,;]+)$/;

/**
 * Parses what the user typed into a recipient box ("a@x.com, Bob <b@y.com>").
 * Anything that is not an address is reported back so the UI can flag it.
 */
export function parseRecipients(input: string): { contacts: Contact[]; invalid: string[] } {
  const contacts: Contact[] = [];
  const invalid: string[] = [];
  for (const part of splitOutsideQuotes(input)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const match = ADDRESS_PATTERN.exec(trimmed);
    if (!match) {
      invalid.push(trimmed);
    } else if (match[2]) {
      contacts.push({ name: (match[1] ?? "").trim(), email: match[2] });
    } else {
      contacts.push({ name: "", email: match[3] });
    }
  }
  return { contacts, invalid };
}

/** Formats contacts back into the text a recipient box shows. */
export function formatRecipients(contacts: readonly Contact[]): string {
  return contacts
    .map((contact) => (contact.name ? `${contact.name} <${contact.email}>` : contact.email))
    .join(", ");
}

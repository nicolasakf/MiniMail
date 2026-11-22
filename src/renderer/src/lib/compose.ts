import type { CompletionMessage } from "@shared/completion";
import type { Account, ComposeMode, Contact, Draft, DraftAttachment, MessageDetail } from "@shared/types";

import { contactLabel, formatFullDate } from "./format";

export type { ComposeMode };

/** What the composer opens with; every field stays editable by the user. */
export interface ComposeSeed {
  mode: ComposeMode;
  accountId: string;
  to: Contact[];
  cc: Contact[];
  bcc?: Contact[];
  /** Text left in a recipient box that is not an address yet (restored drafts only). */
  pendingText?: { to: string; cc: string; bcc: string };
  /** Set when the composer reopens a saved draft: saving again replaces it, sending removes it. */
  draftId?: string;
  subject: string;
  /** What the user types; empty for a reply, whose quoted original lives in `quoted`. */
  body: string;
  bodyHtml?: string;
  sendAt?: number;
  attachments?: DraftAttachment[];
  /** The quoted original of a reply, kept apart so it can stay collapsed under the reply. */
  quoted?: string;
  inReplyTo?: Draft["inReplyTo"];
  /**
   * The earlier messages of the conversation, for the text suggestions. Not saved with a draft: a
   * draft reopened later suggests from the quoted original alone.
   */
  earlier?: CompletionMessage[];
  /** The message in the server's Drafts folder being continued: removed once this is sent or discarded. */
  serverMessageId?: string;
}

export { composeText } from "@shared/compose-text";

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
  // Replying to a message the user wrote (now shown inside conversations) goes to its recipients.
  const wroteIt = own.has(message.from.email.toLowerCase());
  const to =
    mode === "replyAll"
      ? uniqueOthers([sender, ...message.to], own)
      : wroteIt
        ? message.to
        : [sender];
  const cc = mode === "replyAll" ? uniqueOthers(message.cc, own) : [];

  return {
    mode,
    accountId: message.accountId,
    // If the user wrote the message themselves (replying from Sent), keep the original recipients.
    to: to.length > 0 ? to : message.to,
    cc,
    subject: withPrefix(message.subject, "Re:"),
    body: "",
    quoted: `${attribution}\n${quote(original)}`,
    inReplyTo,
  };
}

export { isValidAddress, parseRecipients } from "@shared/recipients";

/** Formats contacts back into the text a recipient box shows. */
export function formatRecipients(contacts: readonly Contact[]): string {
  return contacts
    .map((contact) => (contact.name ? `${contact.name} <${contact.email}>` : contact.email))
    .join(", ");
}

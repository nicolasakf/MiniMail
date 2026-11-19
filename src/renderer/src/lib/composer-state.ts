/**
 * The composer's decisions that need no screen: what counts as changed, what is worth keeping as
 * a draft, who the message goes to, and whether it can be sent. Kept apart from the component so
 * they can be tested and so the component only has to wire them up.
 */
import {
  MAX_ATTACHMENT_BYTES,
  MAX_DRAFT_ATTACHMENTS,
  type ComposeMode,
  type Contact,
  type Draft,
  type DraftAttachment,
  type SavedDraft,
} from "@shared/types";

import { isValidAddress, parseRecipients } from "./compose";
import { base64Bytes } from "./rich-compose";

/** Everything the user can change in the composer. */
export interface ComposerFields {
  accountId: string;
  to: readonly Contact[];
  cc: readonly Contact[];
  bcc: readonly Contact[];
  /** Text left in a recipient box that has not become a chip yet. */
  toText: string;
  ccText: string;
  bccText: string;
  subject: string;
  quoted: string;
  sendAt: number | undefined;
  /** Undefined until the user edits the body; the seed's plain text stands in until then. */
  bodyHtml: string | undefined;
  attachments: readonly DraftAttachment[];
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const attachmentBytes = (file: DraftAttachment): number => base64Bytes(file.contentBase64);

/** Why these files cannot all go in one message, or null when they can. */
export function attachmentProblem(files: readonly DraftAttachment[]): string | null {
  if (files.length > MAX_DRAFT_ATTACHMENTS) return `Use at most ${MAX_DRAFT_ATTACHMENTS} attachments and inline images.`;
  if (files.reduce((sum, file) => sum + attachmentBytes(file), 0) > MAX_ATTACHMENT_BYTES) {
    return `Attachments and inline images can total at most ${formatBytes(MAX_ATTACHMENT_BYTES)}.`;
  }
  return null;
}

const sameContacts = (a: readonly Contact[], b: readonly Contact[]): boolean =>
  a.length === b.length && a.every((contact, index) => contact.email === b[index].email && contact.name === b[index].name);

/** True when `after` differs from `before`. Attachments are compared by identity: they are large. */
export function fieldsChanged(before: ComposerFields, after: ComposerFields): boolean {
  return (
    before.accountId !== after.accountId ||
    before.toText !== after.toText ||
    before.ccText !== after.ccText ||
    before.bccText !== after.bccText ||
    before.subject !== after.subject ||
    before.quoted !== after.quoted ||
    before.sendAt !== after.sendAt ||
    before.bodyHtml !== after.bodyHtml ||
    !sameContacts(before.to, after.to) ||
    !sameContacts(before.cc, after.cc) ||
    !sameContacts(before.bcc, after.bcc) ||
    before.attachments.length !== after.attachments.length ||
    after.attachments.some((file, index) => file !== before.attachments[index])
  );
}

/** Whether there is anything worth keeping as a draft. `bodyText` is the body as plain text. */
export function hasContent(fields: ComposerFields, bodyText: string): boolean {
  return Boolean(
    fields.to.length + fields.cc.length + fields.bcc.length ||
      fields.toText.trim() ||
      fields.ccText.trim() ||
      fields.bccText.trim() ||
      fields.sendAt ||
      fields.subject.trim() ||
      bodyText.trim() ||
      fields.attachments.length ||
      // A picture, rule or table has no text but is still something the user made.
      /<(?:table|hr|img)\b/i.test(fields.bodyHtml ?? ""),
  );
}

/** The same address once, in the order first given. */
export function uniqueContacts(contacts: readonly Contact[]): Contact[] {
  const seen = new Set<string>();
  return contacts.filter((contact) => {
    const key = contact.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface ResolvedRecipients {
  to: Contact[];
  cc: Contact[];
  bcc: Contact[];
  /** Typed text that is not an address. */
  invalid: string[];
}

/** The chips plus whatever complete addresses were typed and not yet turned into chips. */
export function resolveRecipients(fields: ComposerFields): ResolvedRecipients {
  const to = parseRecipients(fields.toText);
  const cc = parseRecipients(fields.ccText);
  const bcc = parseRecipients(fields.bccText);
  // A chip can hold something that is not an address (it is shown in red); it never gets sent to.
  const bad = (list: readonly Contact[]) => list.filter((contact) => !isValidAddress(contact.email));
  const good = (list: readonly Contact[]) => list.filter((contact) => isValidAddress(contact.email));
  return {
    to: uniqueContacts([...good(fields.to), ...to.contacts]),
    cc: uniqueContacts([...good(fields.cc), ...cc.contacts]),
    bcc: uniqueContacts([...good(fields.bcc), ...bcc.contacts]),
    invalid: [
      ...bad(fields.to).map((contact) => contact.email),
      ...to.invalid,
      ...bad(fields.cc).map((contact) => contact.email),
      ...cc.invalid,
      ...bad(fields.bcc).map((contact) => contact.email),
      ...bcc.invalid,
    ],
  };
}

/** What stops this message from being sent as it is, in the words shown to the user; null if nothing does. */
export function sendProblem(fields: ComposerFields, recipients: ResolvedRecipients, now: number = Date.now()): string | null {
  if (fields.sendAt && fields.sendAt <= now) return "Choose a send time in the future.";
  if (!fields.accountId) return "Choose an account to send from.";
  if (recipients.invalid.length > 0) return `Not a valid address: ${recipients.invalid.join(", ")}`;
  if (recipients.to.length === 0) return "Add at least one recipient.";
  return null;
}

/** The record kept on disk for a draft. */
export function toSavedDraft(
  fields: ComposerFields,
  meta: { id: string; mode: ComposeMode; bodyText: string; inReplyTo: Draft["inReplyTo"]; serverMessageId?: string; savedAt?: string },
): SavedDraft {
  return {
    id: meta.id,
    savedAt: meta.savedAt ?? new Date().toISOString(),
    mode: meta.mode,
    accountId: fields.accountId,
    to: [...fields.to],
    cc: [...fields.cc],
    bcc: [...fields.bcc],
    pendingText: { to: fields.toText, cc: fields.ccText, bcc: fields.bccText },
    subject: fields.subject,
    body: meta.bodyText,
    bodyHtml: fields.bodyHtml,
    sendAt: fields.sendAt,
    attachments: fields.attachments.length ? [...fields.attachments] : undefined,
    quoted: fields.quoted || undefined,
    inReplyTo: meta.inReplyTo,
    serverMessageId: meta.serverMessageId,
  };
}

/**
 * What the minimized pill shows about a send, if anything: a spinner while the message goes out,
 * red while the error of the send that failed is still on show (dismissing it clears it).
 */
export function sendStatus(phase: string, failedSend: string | null, error: string | null): "sending" | "failed" | null {
  if (phase === "sending") return "sending";
  return failedSend !== null && failedSend === error ? "failed" : null;
}

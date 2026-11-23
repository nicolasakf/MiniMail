import type {
  AttachmentInfo,
  Contact,
  Draft,
  Invitation,
  InvitationResponse,
  MailAction,
  MailActionResult,
  MailFolder,
  MessageDetail,
  MessageSummary,
} from "@shared/types";

/** The message as the page opens it: the list's row with the downloaded text (not the pieces kept only for the store). */
export function detailFrom(summary: MessageSummary, body: StoredBody, html: string | null = body.html): MessageDetail {
  return {
    ...summary,
    cc: body.cc,
    replyTo: body.replyTo,
    messageId: body.messageId,
    references: body.references,
    html,
    text: body.text,
    attachments: body.attachments,
    invitation: body.invitation,
  };
}

/** A downloaded attachment. */
export interface AttachmentFile {
  filename: string;
  contentType: string;
  data: Buffer;
}

/** An image the text refers to as `cid:...` and that was not downloaded with it. */
export interface InlineRef {
  /** Names the image to the provider (an IMAP part number, a Graph attachment id). */
  id: string;
  contentType: string;
  /** Bytes, as the server counts them. */
  size: number;
  /** The Content-ID the text uses, without the angle brackets, when the server tells it. */
  cid?: string;
  /** IMAP: the transfer encoding to undo when the image is downloaded. */
  encoding?: string;
}

/**
 * What is kept of a message once it has been downloaded: everything of the detail except the part the
 * list already has and changes (flags, thread). Attachment files are never part of it, only their
 * names and sizes, and the same goes for images the text embeds (`inline`).
 */
export interface StoredBody {
  cc: Contact[];
  replyTo: Contact | null;
  messageId: string | null;
  references: string[];
  /** The text as sent, with `cid:` references still pointing at images not downloaded. */
  html: string | null;
  text: string | null;
  attachments: AttachmentInfo[];
  invitation: Invitation | null;
  inline: InlineRef[];
}

/**
 * One account's view of the saved message text. `scope` says which numbering the native ids belong to
 * (an IMAP UIDVALIDITY); text saved under another scope is never returned.
 */
export interface BodyView {
  get(folder: MailFolder, nativeId: string, scope: string): StoredBody | undefined;
  /** The ids, in order, that have no saved text. Cheap: nothing is decrypted. */
  missing(folder: MailFolder, nativeIds: readonly string[], scope: string): string[];
  /** `rank` is the message's date when it was downloaded ahead of time: it then ranks by age, not as read just now. */
  put(folder: MailFolder, nativeId: string, scope: string, body: StoredBody, rank?: number): void;
  /** Forgets the text of these messages (they moved or were deleted, so the ids mean nothing here any more). */
  remove(folder: MailFolder, nativeIds: readonly string[]): void;
  /** Forgets the text of a folder saved under any scope but this one (the server renumbered it). */
  retire(folder: MailFolder, keepScope: string): void;
}

/** One mailbox on one provider. All ids passed in are provider-native (UID / Graph id). */
export interface MailProvider {
  /** Connects and checks credentials; throws a readable error on failure. */
  verify(): Promise<void>;
  list(folder: MailFolder, limit: number): Promise<MessageSummary[]>;
  /** The last list seen for this folder, without touching the network. Providers with no copy omit it. */
  cached?(folder: MailFolder): MessageSummary[];
  get(folder: MailFolder, nativeIds: string[]): Promise<MessageDetail[]>;
  /**
   * Downloads the text of these messages and keeps it, so opening them needs no network. Never downloads
   * attachment files or embedded images. Resolves with how many were saved; providers that keep nothing omit it.
   */
  prefetch?(folder: MailFolder, nativeIds: string[]): Promise<number>;
  act(action: MailAction, folder: MailFolder, nativeIds: string[]): Promise<MailActionResult[]>;
  send(draft: Draft): Promise<void>;
  /** Downloads one attachment of a message, named by the `id` in its `AttachmentInfo`. */
  attachment(folder: MailFolder, nativeId: string, attachmentId: string): Promise<AttachmentFile>;
  /** Answers the invitation in a message and tells the organizer. */
  respondToInvitation(folder: MailFolder, nativeId: string, response: InvitationResponse): Promise<void>;
  /**
   * Starts listening for changes the server pushes (new, removed or re-flagged mail) and calls
   * `onChange` for each burst. Providers that cannot be pushed to omit it and are polled instead.
   * Calling it again while watching does nothing; `close` stops it.
   */
  watch?(onChange: () => void): void;
  /** Whether the push connection is up right now; a provider that is not pushing must be polled. */
  watching?(): boolean;
  close(): Promise<void>;
}

/** Credentials as the IMAP/SMTP layer needs them at connect time. */
export interface MailAuth {
  pass?: string;
  accessToken?: string;
}

/** Turns an unknown thrown value into a message fit for the UI. */
export function describeError(error: unknown): string {
  if (error && typeof error === "object") {
    const candidate = error as { responseText?: unknown; message?: unknown; reason?: unknown };
    if (typeof candidate.responseText === "string" && candidate.responseText) {
      return candidate.responseText;
    }
    if (typeof candidate.message === "string" && candidate.message) {
      // imapflow's "Connection not available" says nothing of why; the server's goodbye does
      // (for example "Too many simultaneous connections").
      return typeof candidate.reason === "string" && candidate.reason
        ? `${candidate.message} (the server said: ${candidate.reason})`
        : candidate.message;
    }
  }
  return String(error);
}

/** Collapses whitespace, drops quoted reply lines and trims to a one-line preview. */
export function makeSnippet(text: string | null | undefined, max = 500): string {
  if (!text) return "";
  const lines = text
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith(">"))
    .join(" ");
  const flat = lines.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

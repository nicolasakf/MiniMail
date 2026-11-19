/**
 * Types shared by the Electron main process, the preload bridge and the renderer.
 * Keep this file free of runtime dependencies so every layer can import it.
 */

import type { ImapSettings } from "./imap-settings";

export type Provider = "gmail" | "outlook" | "zoho" | "imap";

/** How the account signs in. Outlook is OAuth-only (Microsoft removed basic auth). */
export type AuthMethod = "oauth" | "password";

/** Personal Microsoft accounts and work/school (Entra ID) accounts sign in differently. */
export type OutlookKind = "personal" | "work-school";

export type ZohoRegion = "com" | "eu" | "in" | "com.au" | "jp";

export interface Account {
  id: string;
  provider: Provider;
  email: string;
  /** The sender name on outgoing mail. */
  displayName: string;
  /**
   * A short name the user gave the account (for example "Work"). Only MiniMail shows it: it
   * replaces the address in the switcher and lists, and is never sent in mail.
   */
  alias?: string;
  /** A picture the user chose for the account (a small `data:` image), shown instead of a logo. */
  avatar?: string;
  auth: AuthMethod;
  /** Hue (0-360) used for the account's dot in the UI. */
  hue: number;
  outlookKind?: OutlookKind;
  /** Optional tenant id/domain for a work/school Microsoft account. */
  tenant?: string;
  zohoRegion?: ZohoRegion;
  /** Zoho custom-domain / paid orgs use imappro/smtppro hosts. */
  zohoWorkplace?: boolean;
  imapSettings?: ImapSettings;
}

export type AddAccountInput =
  | {
      kind: "password";
      provider: "imap";
      email: string;
      password: string;
      imapSettings: ImapSettings;
      alias?: string;
    }
  | {
      kind: "password";
      provider: "zoho" | "gmail";
      email: string;
      password: string;
      displayName?: string;
      alias?: string;
      zohoRegion?: ZohoRegion;
      zohoWorkplace?: boolean;
    }
  | { kind: "oauth"; provider: "gmail"; email?: string; alias?: string }
  | {
      kind: "oauth";
      provider: "outlook";
      outlookKind?: OutlookKind;
      /** Tenant id or domain, e.g. `myuniversity.edu`. Ignored for personal accounts. */
      tenant?: string;
      email?: string;
      alias?: string;
    };

/** Real folders on the server plus the virtual "pinned" view. */
export type MailFolder =
  | "inbox"
  | "pinned"
  | "drafts"
  | "sent"
  | "archive"
  | "spam"
  | "trash";

/**
 * What the message headers say about the sender (calendar MIME type, bulk headers, automated
 * sender). A cheap rule-based signal: it feeds the AI classifier and is the fallback when no
 * AI key is set. The category the user sees is `MessageSummary.categoryId`.
 */
export type SmartCategory =
  | "person"
  | "notification"
  | "newsletter"
  | "invitation"
  | "invitation-response";

/** A user-defined bucket mail is sorted into by the AI classifier. */
export interface Category {
  id: string;
  /** Shown in the UI and sent to the classifier as the option name; unique, case-insensitive. */
  name: string;
  /** Plain-language rule the classifier applies. Required: a category without one cannot work. */
  criteria: string;
  /** Hue (0-360) of the category's color. */
  hue: number;
  /** A Lucide icon, by its exported name (for example "CalendarPlus"). Unknown or missing shows a tag. */
  icon?: string;
}

export interface AiStatus {
  /** A Vercel AI Gateway key is stored. */
  configured: boolean;
  /** Gateway model id that sorts mail into categories. */
  model: string;
  /** Gateway model id for the AI-enabled features (reading verification codes the rules cannot); empty means rules only. */
  codeModel: string;
  /** Folders whose newly arrived mail is sorted automatically (the Inbox by default; none means new mail is not sorted automatically). */
  sortFolders: SortFolder[];
  /** Last classification failure, cleared by the next success. */
  lastError: string | null;
  /** Conversations waiting to be classified. */
  pending: number;
  /**
   * Progress of the last "sort mail again", or null if none was started. `total` grows as
   * each account's inbox is listed, so it is the count so far, not a promise of the final one.
   */
  sorting: SortProgress | null;
}

/** Folders "sort mail again" can include. */
export const SORT_FOLDERS = ["inbox", "archive", "spam", "trash"] as const;
export type SortFolder = (typeof SORT_FOLDERS)[number];

/** Options of "sort mail again": how far back, and which extra folders join the Inbox. */
export interface SortOptions {
  /** ISO date; only conversations with mail from then on are sorted again. Omitted means all. */
  since?: string;
  /** Folders to sort; omitted means the Inbox only. */
  folders?: SortFolder[];
}

/** Conversations a sort would send to Jev, per folder (what is on this computer for that folder). */
export type SortCounts = Record<SortFolder, number>;

export interface SortAccountProgress {
  accountId: string;
  done: number;
  total: number;
}

export interface SortProgress {
  done: number;
  total: number;
  /** The same counts split by account, in the order each account's mail was first queued. */
  accounts: SortAccountProgress[];
  /** Nothing left waiting (or the run stopped on an error). */
  finished: boolean;
  /** Why it stopped early; null when it ran to the end. */
  error: string | null;
}

export interface CategoryState {
  categories: Category[];
  ai: AiStatus;
}

export interface Contact {
  name: string;
  email: string;
}

/** The web address a sender gave for leaving its list. */
export interface UnsubscribeInfo {
  /** An http(s) address from the `List-Unsubscribe` header. */
  url: string;
  /**
   * The sender accepts the standard one-click request (RFC 8058: an https address plus
   * `List-Unsubscribe-Post`), so MiniMail can unsubscribe without opening a page.
   */
  oneClick: boolean;
  /**
   * The list's own name (`List-Id`, lowercase), which tells apart several lists sent from one
   * address. Null: the message names none. Undefined: saved before this was recorded.
   */
  listId?: string | null;
}

/** What happened to one message's unsubscribe request. */
export type UnsubscribeResult =
  | { id: string; status: "done" }
  /** The sender only gave a web page: nothing was sent; open `url` to finish there. */
  | { id: string; status: "manual"; url: string }
  | { id: string; status: "failed"; error: string };

export interface MessageSummary {
  /** `${accountId}|${folder}|${nativeId}`, see `ids.ts`. */
  id: string;
  accountId: string;
  folder: MailFolder;
  threadId: string;
  /** RFC Message-ID, when available. It can help recognize a server-side move. */
  internetId?: string;
  from: Contact;
  to: Contact[];
  subject: string;
  snippet: string;
  /** ISO timestamp. */
  date: string;
  unread: boolean;
  pinned: boolean;
  /** The server marks it as replied to (IMAP \Answered, Outlook's last-verb property). */
  answered: boolean;
  hasAttachments: boolean;
  /**
   * The receiving server verified the sender (DMARC pass, or DKIM pass for the From domain).
   * Undefined for mail saved before this was recorded; logos are only shown when true.
   */
  authenticated?: boolean;
  /**
   * How the sender lets readers leave the list (the `List-Unsubscribe` headers). Null: the message
   * has no usable address. Undefined: mail saved before this was recorded; it is filled in on the
   * next refresh.
   */
  unsubscribe?: UnsubscribeInfo | null;
  /** Header-based signal from the provider; see `SmartCategory`. */
  signal: SmartCategory;
  /** The user's category for this conversation, or null when none applies. Set by the main process. */
  categoryId: string | null;
  /**
   * True while the model has not yet filed this new conversation. The Inbox list leaves such
   * mail out (the rail shows a sorting spinner instead) so it never appears and then jumps.
   */
  sorting?: boolean;
}

export interface AttachmentInfo {
  /** Names the file to the provider (an IMAP list position, a Graph attachment id); pass it back to `mail.openAttachment`. */
  id: string;
  filename: string;
  contentType: string;
  size: number;
}

/** How the user answers an invitation. */
export type InvitationResponse = "accepted" | "tentative" | "declined";

/** The meeting a calendar invitation (or its cancellation) in a message is about. */
export interface Invitation {
  /** The event's UID; the same across updates of one meeting. */
  uid: string;
  /** REQUEST asks for an answer; CANCEL says the organizer called the meeting off. */
  method: "REQUEST" | "CANCEL";
  title: string;
  /** An ISO timestamp, or `YYYY-MM-DD` when `allDay`. Null when the invitation gives none. */
  start: string | null;
  end: string | null;
  allDay: boolean;
  location: string | null;
  organizer: Contact | null;
  /** The user's answer so far, or null when they have not answered. */
  response: InvitationResponse | null;
}

export interface MessageDetail extends MessageSummary {
  cc: Contact[];
  replyTo: Contact | null;
  /** RFC 5322 Message-ID, used to thread replies. */
  messageId: string | null;
  references: string[];
  html: string | null;
  text: string | null;
  attachments: AttachmentInfo[];
  /** The meeting this message invites to or cancels, if it is a calendar invitation. */
  invitation?: Invitation | null;
}

export type MailAction =
  | "archive"
  | "unarchive"
  | "trash"
  | "spam"
  | "markRead"
  | "markUnread"
  | "pin"
  | "unpin"
  | "deleteForever";

export type MailActionResult =
  | { id: string; status: "applied"; nextId?: string }
  | { id: string; status: "failed" | "unknown"; error: string };

export interface ListQuery {
  /** Empty or omitted means every account. */
  accountIds?: string[];
  folder: MailFolder;
  limit?: number;
  /**
   * Answer from the copy kept on disk only, without contacting any server. Used to paint the
   * list at once while the live request is still running.
   */
  cacheOnly?: boolean;
  /**
   * Also say, per account, how this list differs from the copy kept before it (`ListResult.changes`).
   * Only the refresh buttons ask: the main process reads the old copy just for them.
   */
  changes?: boolean;
}

/** A file attached to an outgoing message; the content travels as base64. */
export interface DraftAttachment {
  filename: string;
  contentType: string;
  contentBase64: string;
  /** Present for an inline image referenced by the HTML body. */
  contentId?: string;
}

/** Largest total size of the files attached to one message. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_DRAFT_ATTACHMENTS = 25;
export const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;

export interface Draft {
  accountId: string;
  to: Contact[];
  cc: Contact[];
  bcc: Contact[];
  subject: string;
  text: string;
  html?: string;
  attachments?: DraftAttachment[];
  /** Present when replying/forwarding, so providers can thread the message. */
  inReplyTo?: { messageId: string; nativeId: string; references: string[]; mode: "reply" | "replyAll" | "forward" };
}

export interface ScheduledMessage {
  id: string;
  subject: string;
  accountId: string;
  sendAt: number;
  status: "scheduled" | "sending" | "needsReview";
}

export type ComposeMode = "new" | "reply" | "replyAll" | "forward";

/**
 * A message the user started and put aside (Esc or the close button). Drafts are kept on this
 * computer only, in a file in the app's data folder: they never reach a mail server.
 */
export interface SavedDraft {
  id: string;
  /** ISO time of the last save. */
  savedAt: string;
  mode: ComposeMode;
  accountId: string;
  to: Contact[];
  cc: Contact[];
  bcc: Contact[];
  /** Text typed into a recipient box that was not a complete address. */
  pendingText: { to: string; cc: string; bcc: string };
  subject: string;
  body: string;
  bodyHtml?: string;
  sendAt?: number;
  attachments?: DraftAttachment[];
  quoted?: string;
  inReplyTo?: Draft["inReplyTo"];
  /**
   * The message in the mail server's Drafts folder this was opened from, if any. The server copy
   * is left alone while this is kept, and removed when the message is sent or discarded.
   */
  serverMessageId?: string;
}

/**
 * How the mail of a folder is laid out: `category` (the "Smart" tab), `sender`, or a plain `list`.
 */
export type MailView = "category" | "sender" | "list";

/** The folders whose mail the Inbox list can show: the inbox itself, and Archive, Trash and Spam. */
export type ShownFolder = "inbox" | "archive" | "trash" | "spam";

/** The list filters and view the app reopens with. */
export interface UiPrefs {
  /** The selected view tab: Smart, Sender or List. */
  view: MailView;
  /** The toolbar's "unread only" filter. */
  unreadOnly: boolean;
  /** The toolbar's Inbox / Archive / Trash / Spam toggles: the folders that are checked. */
  shownFolders: ShownFolder[];
  /**
   * The drafts the user pinned, by message id (a draft written here has a `local-draft:` id). Pins are
   * kept on this computer only: they are never sent to a mail server.
   */
  pinnedDrafts: string[];
}

/** Most drafts kept at once; saving another drops the oldest. */
export const MAX_SAVED_DRAFTS = 50;

/** Result of operations that touch several accounts; one failure must not hide the rest. */
export interface AccountError {
  accountId: string;
  message: string;
}

/** What one list changed in one account's copy of a folder (see `ListQuery.changes`). */
export interface ListChange {
  accountId: string;
  /** Conversations not in the copy before: downloaded now. */
  added: number;
  /** Conversations whose read or pinned state changed on the server. */
  updated: number;
  /** Conversations inside the window that the server no longer has in this folder. */
  removed: number;
}

export interface ListResult {
  messages: MessageSummary[];
  errors: AccountError[];
  /** Present when the query asked for `changes`: one entry per account that answered. */
  changes?: ListChange[];
}

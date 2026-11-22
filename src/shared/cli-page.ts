import type { Contact, DraftAttachment, MailAction, MessageDetail, MessageSummary } from "./types";

/**
 * A draft the CLI asks the page to write. A reply or forward is built by the page the way the composer
 * builds it (quoted original, `Re:`, who it goes to); what is given here is added to or replaces that.
 */
export interface DraftCompose {
  mode: "new" | "reply" | "replyAll" | "forward";
  /** For a new message: the account it is written from. A reply uses the account of the original. */
  accountId: string;
  /** The message being answered or forwarded. */
  original?: MessageDetail;
  to?: Contact[];
  cc?: Contact[];
  bcc?: Contact[];
  subject?: string;
  body?: string;
  attachments?: DraftAttachment[];
}

/** What `draft edit` changes: recipients and subject are replaced, the body is replaced, files are added. */
export interface DraftChanges {
  to?: Contact[];
  cc?: Contact[];
  bcc?: Contact[];
  subject?: string;
  body?: string;
  attachments?: DraftAttachment[];
}

/**
 * What the person is asked about before something that cannot be taken back. The card shows exactly what
 * will happen; "via CLI" and who asked are part of it.
 */
export type ConfirmCard =
  | {
      action: "send";
      from: string;
      to: string[];
      cc: string[];
      bcc: string[];
      subject: string;
      /** The start of the message, so the person sees what is going out. */
      preview: string;
      files: { filename: string; size: number }[];
      /** The agent attached files to this draft: it always asks, and "always allow" is not offered. */
      filesFromCli: boolean;
      /** When it goes out, for a scheduled send; null for now. */
      sendAt: number | null;
      /** Recipients that are not on the allowed list yet: what "always allow" would add. */
      newRecipients: string[];
      canAlways: boolean;
    }
  | { action: "unsubscribe"; lists: { sender: string; email: string; messages: number }[]; skipped: number }
  | { action: "invitation"; answer: "accept" | "maybe" | "decline"; title: string; when: string | null; organizer: string | null; location: string | null };

export type ConfirmDecision = "reject" | "once" | "always";

/** How an unsubscribe went, per list. A sender that only has a web page is reported, never opened for the agent. */
export interface UnsubscribeOutcome {
  done: number;
  manual: { sender: string; host: string }[];
  failed: { sender: string; error: string }[];
  /** Messages with no way to unsubscribe. */
  skipped: number;
  /** Lists the person had already unsubscribed from. */
  alreadyDone: number;
}

/** A draft as the CLI is told about it: who it goes to and what it is called, never its text. */
export interface DraftInfo {
  id: string;
  accountId: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  files: string[];
}

/**
 * What the main process asks the page to do for the CLI. The page does it with the same code as a
 * click (the mail actions, the lists, the undo stack), so each thing the CLI does has a Log row marked
 * "via CLI" and an Undo, and the lists it changes (the block list, priority) are the page's own.
 * The main process resolves everything it can first (which messages, which conversations), so the page
 * only has to act.
 */
export type PageRequest =
  /** Move, flag or pin these messages. */
  | { kind: "mail"; action: MailAction; rows: MessageSummary[] }
  /** File conversations under a category (or none). `before` is where each is now, for the Undo. */
  | { kind: "category"; categoryId: string | null; threads: { key: string; before: string | null }[] }
  /**
   * Block, mark as priority or mute senders, domains or conversations. Blocking also moves the mail
   * already here from them to the Trash (`trash`), as one action with the block.
   */
  | {
      kind: "list";
      list: "block" | "priority" | "mute";
      entry: "senders" | "domains" | "threads";
      values: string[];
      on: boolean;
      accountIds: string[];
      trash: MessageSummary[];
    }
  /** Write, change or delete a draft. They live on this computer; nothing is sent. */
  | { kind: "draft"; op: "create"; compose: DraftCompose }
  | { kind: "draft"; op: "edit"; id: string; changes: DraftChanges }
  | { kind: "draft"; op: "delete"; id: string }
  /** Ask the person, with a card in the app, before something that cannot be taken back. */
  | { kind: "confirm"; card: ConfirmCard }
  /** Unsubscribe from the lists behind these messages. The person was asked first. */
  | { kind: "unsubscribe"; rows: MessageSummary[] }
  /** Take back one of the CLI's own actions. */
  | { kind: "undo"; ref: string };

/** How it ended: "nothing" when there was nothing to change, "timeout" when the server never answered. */
export type PageOutcome = "applied" | "failed" | "undone" | "timeout" | "nothing";

export interface PageResult {
  outcome: PageOutcome;
  /** How many messages, conversations or entries it changed. */
  count: number;
  /** The Undo of what was done, when it can be undone. */
  ref?: string;
  /** The draft that was written, changed or deleted. */
  draft?: DraftInfo;
  /** The person's answer to a card. */
  decision?: ConfirmDecision;
  unsubscribe?: UnsubscribeOutcome;
}

/** The page's answer to a request, by the id the request carried. */
export type PageReply = { id: number; ok: true; result: PageResult } | { id: number; ok: false; error: string };

/**
 * The app's event journal: everything that goes wrong (errors) and, for context, what the user and
 * the app did. The main process keeps the journal; the Log popover shows it.
 */
export type EventLevel = "error" | "action" | "info";

/** Events older than this are neither kept on disk nor shown. */
export const EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface AppEvent {
  /** Time-ordered and unique; also the order the popover sorts by. */
  id: number;
  /** When it first happened (epoch ms). */
  at: number;
  /** When it last happened; later than `at` once the same error repeated. */
  lastAt: number;
  /** How many times it happened, for the same error repeating within a few minutes. */
  repeats: number;
  level: EventLevel;
  /** Where it came from: sync, sorting, send, unsubscribe, ... */
  area: string;
  /** One short sentence a person can read: "Could not sort an email". */
  title: string;
  /** The reason, with email addresses and tokens already removed. Also written to main.log. */
  detail: string;
  /** Sender, subject or similar. Kept encrypted on disk and never written to main.log. */
  context?: string;
  accountId?: string;
  /** Lets the page that raised the event find it again (to attach a Retry button). */
  ref?: string;
  /** An error the user marked as done: still listed, but not under "Errors only". */
  done?: boolean;
}

/** What a caller hands to the journal. */
export interface EventReport {
  level: EventLevel;
  area: string;
  title: string;
  detail?: string;
  context?: string;
  accountId?: string;
  ref?: string;
}

export const MAX_EVENT_TITLE = 200;
export const MAX_EVENT_DETAIL = 600;
export const MAX_EVENT_CONTEXT = 400;

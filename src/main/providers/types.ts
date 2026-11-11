import type { Draft, MailAction, MailFolder, MessageDetail, MessageSummary } from "@shared/types";

/** One mailbox on one provider. All ids passed in are provider-native (UID / Graph id). */
export interface MailProvider {
  /** Connects and checks credentials; throws a readable error on failure. */
  verify(): Promise<void>;
  list(folder: MailFolder, limit: number): Promise<MessageSummary[]>;
  /** The last list seen for this folder, without touching the network. Providers with no copy omit it. */
  cached?(folder: MailFolder): MessageSummary[];
  get(folder: MailFolder, nativeIds: string[]): Promise<MessageDetail[]>;
  act(action: MailAction, folder: MailFolder, nativeIds: string[]): Promise<void>;
  send(draft: Draft): Promise<void>;
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
    const candidate = error as { responseText?: unknown; message?: unknown };
    if (typeof candidate.responseText === "string" && candidate.responseText) {
      return candidate.responseText;
    }
    if (typeof candidate.message === "string" && candidate.message) {
      return candidate.message;
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

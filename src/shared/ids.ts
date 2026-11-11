import type { MailFolder } from "./types";

export interface MessageRef {
  accountId: string;
  folder: MailFolder;
  /** IMAP UID or Graph message id; opaque to everything but the provider. */
  nativeId: string;
}

const SEPARATOR = "|";

/** Builds the app-wide message id from its parts. */
export function makeMessageId(ref: MessageRef): string {
  return [ref.accountId, ref.folder, ref.nativeId].join(SEPARATOR);
}

/**
 * Splits a message id back into its parts. Returns null for malformed ids.
 * The native id may itself contain `|`, so only the first two separators count.
 */
export function parseMessageId(id: string): MessageRef | null {
  const first = id.indexOf(SEPARATOR);
  if (first < 0) return null;
  const second = id.indexOf(SEPARATOR, first + 1);
  if (second < 0) return null;
  const accountId = id.slice(0, first);
  const folder = id.slice(first + 1, second) as MailFolder;
  const nativeId = id.slice(second + 1);
  if (!accountId || !folder || !nativeId) return null;
  return { accountId, folder, nativeId };
}

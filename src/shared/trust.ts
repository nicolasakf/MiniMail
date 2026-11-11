/** Upper bound on remembered senders, so the file cannot grow without limit. */
export const MAX_TRUSTED_SENDERS = 2000;

/** The form a sender address is stored and compared in. */
export function trustKey(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Whether a message's remote images load without asking. Both must hold: the user chose to
 * trust this exact address, and the receiving server verified the message really came from it.
 * Trust alone is not enough, because a From address is trivial to forge and a forged message
 * would otherwise turn the user's own choice into a tracking pixel.
 */
export function autoLoadsImages(
  trusted: ReadonlySet<string>,
  from: { email: string },
  authenticated: boolean | undefined,
): boolean {
  return authenticated === true && trusted.has(trustKey(from.email));
}

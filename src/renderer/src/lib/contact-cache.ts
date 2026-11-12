import type { ContactEntry } from "@shared/contacts";

import { api } from "./api";

/**
 * The address book behind recipient suggestions, kept for the session. Reading Sent and Inbox from
 * the mail servers can take seconds, so the app asks once at start-up and the composer opens with
 * whatever is already known, instead of starting empty and suggesting nothing at first.
 */
let known: ContactEntry[] = [];
let running: Promise<ContactEntry[]> | null = null;

export function cachedContacts(): ContactEntry[] {
  return known;
}

/** Reloads the address book (one request at a time) and returns it; a failure keeps the old one. */
export function refreshContacts(): Promise<ContactEntry[]> {
  running ??= Promise.resolve()
    .then(() => api.mail.contacts())
    .then((found) => {
      known = found;
      return found;
    })
    .catch(() => known) // Suggestions are a convenience; typing addresses still works.
    .finally(() => {
      running = null;
    });
  return running;
}

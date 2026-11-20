import { useEffect, useState } from "react";

import type { ContactEntry } from "@shared/contacts";

import { cachedContacts, refreshContacts } from "@/lib/contact-cache";

/** Everyone we have exchanged mail with: what is already known at once, refreshed when it opens. */
export function useContactIndex(): ContactEntry[] {
  const [contacts, setContacts] = useState<ContactEntry[]>(cachedContacts);
  useEffect(() => {
    let cancelled = false;
    void refreshContacts().then((found) => {
      if (!cancelled) setContacts(found);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return contacts;
}

import { useCallback, useMemo, useSyncExternalStore } from "react";

import { recordAction } from "@/lib/events";
import { savedPref, savePref, subscribePref } from "@/lib/saved-prefs";
import { newUndoRef, undoStack } from "@/lib/undo-stack";

const subscribe = (listener: () => void) => subscribePref("pinnedDomains", listener);
const snapshot = () => savedPref("pinnedDomains");

function flip(domain: string): void {
  const domains = savedPref("pinnedDomains");
  savePref("pinnedDomains", domains.includes(domain) ? domains.filter((entry) => entry !== domain) : [...domains, domain]);
}

/** The sender domains the user pinned to the top of the Sender view; saved in `settings.json`. */
export function usePinnedDomains() {
  const list = useSyncExternalStore(subscribe, snapshot);
  const pinned: ReadonlySet<string> = useMemo(() => new Set(list), [list]);

  const toggle = useCallback((domain: string) => {
    const title = savedPref("pinnedDomains").includes(domain) ? "Unpinned a sender domain" : "Pinned a sender domain";
    const ref = newUndoRef("pin");
    recordAction("mail", title, "", { context: domain, ref });
    flip(domain);
    undoStack.push({ ref, label: title, context: domain, run: () => flip(domain) });
  }, []);

  return { pinned, toggle };
}

import { useCallback, useRef, useState } from "react";
import { recordAction, reportError } from "@/lib/events";
import { newUndoRef, undoStack } from "@/lib/undo-stack";

const STORAGE_KEY = "minimail.pinnedDomains";

function load(): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
  } catch (error) {
    reportError("storage", "Could not read the pinned senders", error);
    return new Set();
  }
}

/** The sender domains the user pinned to the top of the Sender view; kept on this computer. */
export function usePinnedDomains() {
  const [pinned, setPinned] = useState<ReadonlySet<string>>(load);

  const pinnedNow = useRef(pinned);
  pinnedNow.current = pinned;

  const flip = useCallback((domain: string) => {
    setPinned((previous) => {
      const next = new Set(previous);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch (error) {
        reportError("storage", "Could not remember the pinned senders", error);
        // Storage can be unavailable; the pin still holds until the app closes.
      }
      return next;
    });
  }, []);

  const toggle = useCallback(
    (domain: string) => {
      const title = pinnedNow.current.has(domain) ? "Unpinned a sender domain" : "Pinned a sender domain";
      const ref = newUndoRef("pin");
      recordAction("mail", title, "", { context: domain, ref });
      flip(domain);
      undoStack.push({ ref, label: title, context: domain, run: () => flip(domain) });
    },
    [flip],
  );

  return { pinned, toggle };
}

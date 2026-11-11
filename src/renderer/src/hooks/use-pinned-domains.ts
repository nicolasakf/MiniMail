import { useCallback, useState } from "react";

const STORAGE_KEY = "minimail.pinnedDomains";

function load(): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

/** The sender domains the user pinned to the top of the Sender view; kept on this computer. */
export function usePinnedDomains() {
  const [pinned, setPinned] = useState<ReadonlySet<string>>(load);

  const toggle = useCallback((domain: string) => {
    setPinned((previous) => {
      const next = new Set(previous);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // Storage can be unavailable; the pin still holds until the app closes.
      }
      return next;
    });
  }, []);

  return { pinned, toggle };
}

import { useCallback, useSyncExternalStore } from "react";

import { rememberSearch } from "@shared/prefs";

import { savedPref, savePref, subscribePref } from "@/lib/saved-prefs";

const subscribe = (listener: () => void) => subscribePref("recentSearches", listener);
const snapshot = () => savedPref("recentSearches");

/** The searches typed in the search box, newest first; saved in `settings.json`. */
export function useRecentSearches() {
  const recent = useSyncExternalStore(subscribe, snapshot);

  const remember = useCallback((query: string) => {
    const current = savedPref("recentSearches");
    const next = rememberSearch(current, query);
    if (next.length !== current.length || next.some((entry, index) => entry !== current[index])) savePref("recentSearches", next);
  }, []);

  return { recent, remember };
}

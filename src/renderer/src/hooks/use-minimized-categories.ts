import { useCallback, useMemo, useSyncExternalStore } from "react";

import { savedPref, savePref, subscribePref } from "@/lib/saved-prefs";

const subscribe = (listener: () => void) => subscribePref("minimizedCategories", listener);
const snapshot = () => savedPref("minimizedCategories");

/** The categories the user minimized to the dock on the right of the list; saved in `settings.json`. */
export function useMinimizedCategories() {
  const list = useSyncExternalStore(subscribe, snapshot);
  const minimized: ReadonlySet<string> = useMemo(() => new Set(list), [list]);

  const setCategoryMinimized = useCallback((id: string, value: boolean) => {
    const ids = savedPref("minimizedCategories");
    if (ids.includes(id) === value) return;
    savePref("minimizedCategories", value ? [...ids, id] : ids.filter((entry) => entry !== id));
  }, []);

  return { minimized, setCategoryMinimized };
}

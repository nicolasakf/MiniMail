import { useCallback, useState } from "react";

const STORAGE_KEY = "minimail.minimizedCategories";

function load(): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

/** The categories the user minimized to the dock on the right of the list; kept on this computer. */
export function useMinimizedCategories() {
  const [minimized, setMinimized] = useState<ReadonlySet<string>>(load);

  const setCategoryMinimized = useCallback((id: string, value: boolean) => {
    setMinimized((previous) => {
      if (previous.has(id) === value) return previous;
      const next = new Set(previous);
      if (value) next.add(id);
      else next.delete(id);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // Storage can be unavailable; the category stays minimized until the app closes.
      }
      return next;
    });
  }, []);

  return { minimized, setCategoryMinimized };
}

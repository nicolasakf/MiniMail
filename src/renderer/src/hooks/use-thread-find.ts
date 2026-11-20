import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import { stepIndex } from "@shared/find-text";

import { paint, rangesFor } from "@/lib/thread-find";

interface Entry {
  range: Range;
  /** The window whose page holds the range: the app's own, or a message frame's. */
  win: Window;
  /** The frame the range is inside, when it is in a message body. */
  frame: HTMLIFrameElement | null;
}

/** The matches that leave the window at once: more than anyone steps through, and cheap to paint. */
const MAX_MATCHES = 2000;
const NONE: Entry[] = [];

/**
 * Finds `query` in the conversation shown under `listRef` (⌘F): in the message headers and in the
 * bodies, which live in frames of their own. Matches are painted with the CSS Custom Highlight API,
 * so the messages are not changed, and the current one is scrolled into view inside `scrollRef`.
 *
 * `contentKey` changes whenever what is on screen does (a message arrived, one was opened), and the
 * search is run again; a frame that reloads (a new theme, "Load images") is noticed by itself.
 */
export function useThreadFind({
  open,
  query,
  listRef,
  scrollRef,
  contentKey,
  onReveal,
}: {
  open: boolean;
  query: string;
  listRef: RefObject<HTMLElement | null>;
  scrollRef: RefObject<HTMLElement | null>;
  contentKey: string;
  /** Called before the view is scrolled to a match, so the caller can stop re-centering the conversation. */
  onReveal?: () => void;
}) {
  const [found, setFound] = useState<{ query: string; entries: Entry[] }>({ query: "", entries: [] });
  // What was found for an earlier word is not shown for the new one while the search catches up.
  const entries = found.query === query ? found.entries : NONE;
  const [index, setIndex] = useState(0);
  const [reloads, setReloads] = useState(0);
  const painted = useRef(new Set<Window>());
  const revealed = useRef("");

  // A new word starts again from the first match.
  useEffect(() => setIndex(0), [query]);

  // A message frame that loads again has a new page: its matches are found again.
  useEffect(() => {
    const list = listRef.current;
    if (!open || !list) return;
    const again = () => setReloads((count) => count + 1);
    list.addEventListener("load", again, true);
    return () => list.removeEventListener("load", again, true);
  }, [open, listRef]);

  // Find the matches.
  useEffect(() => {
    const list = listRef.current;
    if (!open || !list || query.trim() === "") {
      setFound({ query, entries: NONE });
      return;
    }
    const matches: Entry[] = [];
    for (const article of list.querySelectorAll("article")) {
      for (const range of rangesFor(article, query)) matches.push({ range, win: window, frame: null });
      for (const frame of article.querySelectorAll("iframe")) {
        const body = frame.contentDocument?.body;
        const win = frame.contentWindow;
        if (!body || !win) continue;
        for (const range of rangesFor(body, query)) matches.push({ range, win, frame });
      }
    }
    setFound({ query, entries: matches.slice(0, MAX_MATCHES) });
    setIndex((current) => Math.min(current, Math.max(0, matches.length - 1)));
  }, [open, query, contentKey, reloads, listRef]);

  // Paint them, the current one apart.
  useEffect(() => {
    const current = entries[index];
    const byWindow = new Map<Window, Range[]>();
    for (const entry of entries) byWindow.set(entry.win, [...(byWindow.get(entry.win) ?? []), entry.range]);
    for (const win of painted.current) if (!byWindow.has(win)) paint(win, [], null);
    painted.current = new Set(byWindow.keys());
    for (const [win, ranges] of byWindow) paint(win, ranges, current?.win === win ? current.range : null);
  }, [entries, index]);

  // Nothing stays painted once the bar is gone.
  useEffect(
    () => () => {
      for (const win of painted.current) paint(win, [], null);
      painted.current = new Set();
    },
    [],
  );

  // Bring the current match into view, unless it already is comfortably.
  useEffect(() => {
    const current = entries[index];
    const scroller = scrollRef.current;
    const key = `${query}:${index}:${entries.length > 0}`;
    if (!current || !scroller || revealed.current === key) return;
    revealed.current = key;
    const rect = current.range.getBoundingClientRect();
    const frame = current.frame?.getBoundingClientRect();
    const top = rect.top + (frame?.top ?? 0);
    const bottom = rect.bottom + (frame?.top ?? 0);
    const box = scroller.getBoundingClientRect();
    if (top >= box.top + 48 && bottom <= box.bottom - 48) return;
    onReveal?.();
    scroller.scrollTo({ top: scroller.scrollTop + top - box.top - box.height / 3 });
  }, [entries, index, query, scrollRef, onReveal]);

  // Closing forgets where the last reveal was, so opening again scrolls to the first match.
  useEffect(() => {
    if (!open) revealed.current = "";
  }, [open]);

  const step = useCallback(
    (direction: 1 | -1) => setIndex((current) => stepIndex(current, direction, entries.length)),
    [entries.length],
  );

  return { count: entries.length, index, step };
}

import { useCallback, useEffect, useState } from "react";

import type { AppEvent } from "@shared/events";

import { api } from "@/lib/api";
import { mergeEvents } from "@/lib/event-list";

/**
 * The event journal as the popover shows it. The history is read once, a moment after the first
 * paint so it never competes with the mail list, and live changes arrive in small batches.
 * Nothing here is awaited by anything else on the page.
 */
export function useEventJournal(): { events: AppEvent[]; loaded: boolean; markDone: () => void } {
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const stop = api.events.onChanged((changed) => {
      if (alive) setEvents((previous) => mergeEvents(previous, changed));
    });
    const timer = setTimeout(() => {
      api.events
        .list()
        // What was pushed while the history was being read is newer, so it wins.
        .then((list) => alive && setEvents((previous) => mergeEvents(list, previous)))
        // expected: a failed read was recorded by the main process; the list simply stays as it is.
        .catch(() => undefined)
        .finally(() => alive && setLoaded(true));
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
      stop();
    };
  }, []);

  const markDone = useCallback(() => {
    setEvents((previous) => previous.map((event) => (event.level === "error" && !event.done ? { ...event, done: true } : event)));
    // expected: a failure here is recorded by the main process.
    void api.events.markDone().catch(() => undefined);
  }, []);

  return { events, loaded, markDone };
}

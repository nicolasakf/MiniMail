import { EVENT_RETENTION_MS, type AppEvent } from "@shared/events";

/** Newest first, by id (ids are time-ordered). */
export function mergeEvents(previous: readonly AppEvent[], changed: readonly AppEvent[]): AppEvent[] {
  if (changed.length === 0) return previous as AppEvent[];
  const replacements = new Map(changed.map((event) => [event.id, event]));
  const used = new Set<number>();
  const merged = previous.map((event) => {
    const next = replacements.get(event.id);
    if (!next) return event;
    used.add(event.id);
    return next;
  });
  const fresh = changed.filter((event) => !used.has(event.id)).sort((a, b) => b.id - a.id);
  if (fresh.length === 0) return merged;
  // The usual case: everything new is newer than everything shown, so it just goes on top.
  if (merged.length === 0 || fresh[fresh.length - 1].id > merged[0].id) return [...fresh, ...merged];
  return [...fresh, ...merged].sort((a, b) => b.id - a.id);
}

/** The id of the newest error, or 0. */
export function latestErrorId(events: readonly AppEvent[]): number {
  for (const event of events) if (event.level === "error") return event.id;
  return 0;
}

/** An event as plain text for the clipboard: the same shape as a main.log line, plus its private context. */
export function eventText(event: AppEvent): string {
  const head = `${new Date(event.lastAt).toISOString()} ${event.level.toUpperCase()} [${event.area}] ${event.title}`;
  return [event.detail ? `${head}: ${event.detail}` : head, event.context].filter(Boolean).join("\n");
}

export type EventRow =
  | { kind: "day"; key: string; label: string }
  | { kind: "event"; key: string; event: AppEvent };

const startOfDay = (time: number): number => {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

export function dayLabel(time: number, now: number): string {
  const days = Math.round((startOfDay(now) - startOfDay(time)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Date(time).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", ...(days > 300 ? { year: "numeric" } : {}) });
}

/**
 * What the popover lists: the events of the last 30 days (newest first), only the errors not yet
 * marked as done when asked,
 * with a heading above each day. An event that repeated is placed by when it last happened.
 */
export function buildRows(events: readonly AppEvent[], errorsOnly: boolean, now: number): EventRow[] {
  const cutoff = now - EVENT_RETENTION_MS;
  const rows: EventRow[] = [];
  let day = "";
  for (const event of events) {
    if (errorsOnly && (event.level !== "error" || event.done)) continue;
    if (event.lastAt < cutoff) continue;
    const label = dayLabel(event.lastAt, now);
    if (label !== day) {
      day = label;
      rows.push({ kind: "day", key: `day:${label}`, label });
    }
    rows.push({ kind: "event", key: `event:${event.id}`, event });
  }
  return rows;
}

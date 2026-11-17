import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CircleAlert, Info, MousePointerClick, ScrollText, Undo2 } from "lucide-react";

import { EVENT_RETENTION_MS, type AppEvent } from "@shared/events";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEventJournal } from "@/hooks/use-event-journal";
import { buildRows, eventText, latestErrorId, type EventRow } from "@/lib/event-list";
import { toast } from "@/lib/toast";
import { undoStack, useUndoVersion } from "@/lib/undo-stack";
import { cn } from "@/lib/utils";

const SEEN_KEY = "minimail.events.seen";
const MAX_LIST_HEIGHT = "min(26rem, 65vh)";
const ESTIMATE = { day: 32, event: 92 };

function readSeen(): number | null {
  try {
    const value = Number(localStorage.getItem(SEEN_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    // expected: storage can be blocked; the Log button then starts as "all seen".
    return null;
  }
}

function writeSeen(id: number): void {
  try {
    localStorage.setItem(SEEN_KEY, String(id));
  } catch {
    // expected: storage can be blocked; the dot just returns on the next launch.
  }
}

const formatTime = (time: number) => new Date(time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const LEVEL_ICON = { error: CircleAlert, action: MousePointerClick, info: Info } as const;

interface EventItemProps {
  event: AppEvent;
  retry?: () => void;
  onRetry: () => void;
  /** The action this row records can still be taken back. */
  canUndo: boolean;
}

function copy(text: string, what: string): void {
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${what} copied`),
    () => toast.error(`Could not copy the ${what.toLowerCase()}`),
  );
}

const EventItem = memo(function EventItem({ event, retry, onRetry, canUndo }: EventItemProps) {
  const Icon = LEVEL_ICON[event.level];
  return (
    <div className="relative mx-2 flex cursor-default gap-2.5 rounded-md px-3 py-2.5 hover:bg-accent/50">
      <Icon
        aria-label={event.level === "error" ? (event.done ? "Error, done" : "Error") : event.level === "action" ? "Action" : "Event"}
        className={cn("mt-0.5 size-4 shrink-0", event.level === "error" && !event.done ? "text-destructive" : "text-muted-foreground")}
      />
      {canUndo && event.ref && (
        <button
          type="button"
          title="Undo this action (⌘Z undoes the latest one)"
          onClick={() => undoStack.undo(event.ref!)}
          className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Undo2 className="size-3.5" />
          Undo
        </button>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <button
          type="button"
          title="Click to copy this log entry"
          onClick={() => copy(eventText(event), "Log entry")}
          className={cn(
            "block w-full cursor-default space-y-1 rounded text-left outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring",
            canUndo && "pr-16",
          )}
        >
          <span className="block break-words text-sm font-medium">{event.title}</span>
          {event.detail && <span className="line-clamp-4 block break-words text-xs text-muted-foreground">{event.detail}</span>}
          {event.context && <span className="line-clamp-2 block break-words text-xs text-foreground/70">{event.context}</span>}
        </button>
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">
            <span className="uppercase tracking-wide">{event.area}</span>
            {" · "}
            <time dateTime={new Date(event.lastAt).toISOString()}>{formatTime(event.lastAt)}</time>
            {event.repeats > 1 && (
              <span title={`First at ${formatTime(event.at)}`}>{` · ${event.repeats}× since ${formatTime(event.at)}`}</span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              title={`Copy the ID (${event.id})`}
              onClick={() => copy(String(event.id), "ID")}
              className="relative z-10 hover:text-foreground hover:underline"
            >
              Copy ID
            </button>
            {retry && (
              <button type="button" onClick={onRetry} className="relative z-10 font-medium text-primary hover:underline">
                Retry
              </button>
            )}
          </span>
        </div>
      </div>
    </div>
  );
});

interface ListProps {
  rows: EventRow[];
  retryFor: (event: AppEvent) => (() => void) | undefined;
  onRetry: () => void;
}

/** Only the rows in view are drawn, so thirty days of history costs no more than a handful. */
function VirtualEventList({ rows, retryFor, onRetry }: ListProps) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller,
    estimateSize: (index) => ESTIMATE[rows[index]!.kind],
    getItemKey: (index) => rows[index]!.key,
    overscan: 6,
  });
  return (
    <div ref={setScroller} className="overflow-y-auto" style={{ maxHeight: MAX_LIST_HEIGHT }}>
      <div role="list" className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index]!;
          return (
            <div
              key={item.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              role={row.kind === "event" ? "listitem" : "presentation"}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              {row.kind === "day" ? (
                <h3 className="px-4 py-1.5 text-xs font-medium text-muted-foreground">{row.label}</h3>
              ) : (
                <EventItem event={row.event} retry={retryFor(row.event)} onRetry={onRetry} canUndo={!!row.event.ref && undoStack.has(row.event.ref)} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface Props {
  /** The Retry belonging to an event raised by this page, if one is still available. */
  retryFor: (event: AppEvent) => (() => void) | undefined;
}

/**
 * The Log button and its list: every error from the last 30 days, and with the filter off, what the user
 * and the app did as well. It owns the journal's feed, so a new event re-renders only this.
 */
export function LogPopover({ retryFor }: Props) {
  const { events, loaded, markDone } = useEventJournal();
  useUndoVersion(); // rows re-draw as actions are taken back, so their Undo goes away
  const [open, setOpen] = useState(false);
  const [errorsOnly, setErrorsOnly] = useState(true);
  const [, rerender] = useState(0);
  const [seen, setSeen] = useState<number | null>(readSeen);

  const latest = latestErrorId(events);
  // The first launch has no "seen" mark: what is already there is not news.
  const seenRef = useRef(seen);
  seenRef.current = seen;
  useEffect(() => {
    if (loaded && seenRef.current === null) {
      writeSeen(latest);
      setSeen(latest);
    }
  }, [loaded, latest]);
  const unseen = loaded && seen !== null && latest > seen;

  const markSeen = () => {
    writeSeen(latest);
    setSeen(latest);
  };

  // Built only while open: a closed popover costs nothing however long the history is.
  const rows = useMemo(
    () => (open ? buildRows(events, errorsOnly, Date.now()) : []),
    [open, events, errorsOnly],
  );
  const hasOpenErrors = useMemo(() => events.some((event) => event.level === "error" && !event.done), [events]);
  const errorCount = useMemo(() => (open ? events.reduce((count, event) => count + (event.level === "error" ? 1 : 0), 0) : 0), [open, events]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next || open) markSeen();
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={!open && unseen ? "Log, new errors" : "Log"}
              className="electron-no-drag relative flex size-9 items-center justify-center rounded-xl text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ScrollText className="size-5" />
              {!open && unseen && (
                <span aria-hidden className="absolute right-0 top-0 size-2 rounded-full bg-destructive ring-2 ring-background" />
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">Log</TooltipContent>
      </Tooltip>
      <PopoverContent side="right" align="end" sideOffset={12} aria-label="Log" className="w-96 p-0">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="text-sm font-semibold">Log</h2>
            <span className="truncate text-xs text-muted-foreground">
              {errorCount === 1 ? "1 error" : `${errorCount} errors`} · last {Math.round(EVENT_RETENTION_MS / 86_400_000)} days
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-pressed={errorsOnly}
              onClick={() => setErrorsOnly((current) => !current)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                errorsOnly
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Errors only
            </button>
            {hasOpenErrors && (
              <button
                type="button"
                onClick={markDone}
                title="Hide these errors from the Errors only view. They stay in the list and in main.log."
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Mark all as done
              </button>
            )}
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="space-y-2 px-4 py-5 text-sm text-muted-foreground">
            <p>
              {!loaded
                ? "Loading…"
                : errorsOnly
                  ? "No new errors in the last 30 days."
                  : "Nothing recorded yet."}
            </p>
            {loaded && errorsOnly && events.length > 0 && (
              <button type="button" onClick={() => setErrorsOnly(false)} className="text-xs font-medium text-primary hover:underline">
                Show all activity
              </button>
            )}
          </div>
        ) : (
          <VirtualEventList rows={rows} retryFor={retryFor} onRetry={() => rerender((count) => count + 1)} />
        )}
      </PopoverContent>
    </Popover>
  );
}

import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, CircleAlert, ExternalLink, Info, Maximize2, Minimize2, MousePointerClick, ScrollText, Undo2 } from "lucide-react";

import { EVENT_RETENTION_MS, type AppEvent } from "@shared/events";

import { ToolButton } from "@/components/mail/composer-ui";
import { FLAT_KEY } from "@/components/ui/keys";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEventJournal } from "@/hooks/use-event-journal";
import { buildRows, eventText, latestErrorId, type EventRow } from "@/lib/event-list";
import { api } from "@/lib/api";
import { FOLDER_STYLE } from "@/lib/folder-style";
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
    <div className="corner-squircle relative mx-2 flex cursor-default gap-2.5 rounded-xl px-3 py-2.5 transition-shadow hover:plate-2">
      <Icon
        aria-label={event.level === "error" ? (event.done ? "Error, done" : "Error") : event.level === "action" ? "Action" : "Event"}
        className={cn("mt-0.5 size-4 shrink-0", event.level === "error" && !event.done ? "text-destructive" : "text-muted-foreground")}
      />
      {canUndo && event.ref && (
        <button
          type="button"
          title="Undo this action (⌘Z undoes the latest one)"
          onClick={() => undoStack.undo(event.ref!)}
          className={cn("absolute right-2 top-2 z-10 flex items-center gap-1 rounded-[10px] px-1.5 py-0.5 text-xs font-medium hover:plate-3", FLAT_KEY, "text-muted-foreground hover:text-foreground")}
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
            "block w-full cursor-default space-y-1 rounded-lg text-left outline-none after:absolute after:inset-0 after:rounded-xl",
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
  /** Fills the room its parent gives it, instead of stopping at a fixed height. */
  expanded?: boolean;
}

/** Only the rows in view are drawn, so thirty days of history costs no more than a handful. */
function VirtualEventList({ rows, retryFor, onRetry, expanded }: ListProps) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller,
    estimateSize: (index) => ESTIMATE[rows[index]!.kind],
    getItemKey: (index) => rows[index]!.key,
    overscan: 6,
  });
  return (
    <div ref={setScroller} className={cn("overflow-y-auto", expanded && "min-h-0 flex-1")} style={expanded ? undefined : { maxHeight: MAX_LIST_HEIGHT }}>
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

/** The Log at the composer's expanded size: Escape closes it, like the composer. */
function ExpandedPanel({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => panel.current?.focus(), []);
  return (
    <section
      ref={panel}
      role="dialog"
      aria-modal="false"
      aria-label="Log"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          onClose();
        }
      }}
      // electron-no-drag: it sits over the app's window-drag headers, which would swallow clicks on its buttons.
      className="corner-squircle electron-no-drag fixed inset-x-6 bottom-6 top-6 z-50 mx-auto flex max-w-[1040px] flex-col overflow-hidden rounded-[24px] plate-1 text-popover-foreground shadow-overlay outline-none duration-200 animate-in fade-in-0 slide-in-from-bottom-3"
    >
      {children}
    </section>
  );
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
  const [expanded, setExpanded] = useState(false);
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

  const content = (
    <>
      <div className="flex items-center justify-between gap-2 edge-b px-4 py-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="text-sm font-semibold">Log</h2>
          <span className="truncate text-xs text-muted-foreground">
            {errorCount === 1 ? "1 error" : `${errorCount} errors`} · last {Math.round(EVENT_RETENTION_MS / 86_400_000)} days
          </span>
          {expanded && (
            <button
              type="button"
              onClick={() => void api.events.openLog().catch(() => undefined /* expected: recorded by the main process */)}
              className={cn("flex shrink-0 items-center gap-1 rounded-[10px] px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground", FLAT_KEY)}
            >
              <ExternalLink className="size-3.5" />
              Open log file
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-pressed={errorsOnly}
            onClick={() => setErrorsOnly((current) => !current)}
            className={cn(
              "whitespace-nowrap rounded-[10px] px-2.5 py-1 text-xs font-medium",
              FLAT_KEY,
              errorsOnly ? FOLDER_STYLE.trash.active : "text-muted-foreground hover:text-foreground",
            )}
          >
            Errors only
          </button>
          {hasOpenErrors && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={markDone}
                  aria-label="Mark all as done"
                  className={cn("flex size-6 items-center justify-center rounded-[10px] text-muted-foreground hover:text-foreground", FLAT_KEY)}
                >
                  <Check className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Mark all as done</TooltipContent>
            </Tooltip>
          )}
          <ToolButton
            label={expanded ? "Compact view" : "Expand"}
            className="size-6 rounded-md"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </ToolButton>
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
        </div>
      ) : (
        <VirtualEventList
          rows={rows}
          retryFor={retryFor}
          onRetry={() => rerender((count) => count + 1)}
          expanded={expanded}
        />
      )}
    </>
  );

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
              className={`electron-no-drag relative flex size-9 items-center justify-center rounded-full ${FLAT_KEY}`}
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
      {!expanded && (
        <PopoverContent side="right" align="end" sideOffset={12} aria-label="Log" className="w-96 p-0">
          {content}
        </PopoverContent>
      )}
      {/*
        Expanded, it is the composer's size (see its expanded panel). It is a fixed panel of its own because the
        popover is placed with a transform, which would make "fixed" mean "relative to the popover".
      */}
      {open &&
        expanded &&
        createPortal(
          <ExpandedPanel onClose={() => { setOpen(false); markSeen(); }}>{content}</ExpandedPanel>,
          document.body,
        )}
    </Popover>
  );
}

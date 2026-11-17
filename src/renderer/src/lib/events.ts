import type { MiniMailApi } from "@shared/api";
import type { AppEvent, EventReport } from "@shared/events";

/**
 * How the page tells the event journal (in the main process) what failed and what the user did.
 * Everything here is fire and forget: nothing waits, nothing throws, and until
 * `installEventReporting` runs (unit tests, for instance) reports go nowhere.
 */

type Sink = (report: EventReport) => void;
let sink: Sink | null = null;

/** Errors the journal already holds, newest last, to avoid showing the same failure twice. */
let known: { at: number; title: string; detail: string }[] = [];
const KNOWN_FOR_MS = 30_000;
/** A toast waits this long before it is reported on its own, giving the journal's copy time to arrive. */
const TOAST_GRACE_MS = 1500;

/** Why something failed, as a sentence. */
export function describeCause(cause: unknown): string {
  if (cause === undefined || cause === null) return "";
  if (typeof cause === "string") return cause;
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

export type EventExtras = Pick<EventReport, "context" | "accountId" | "ref">;

export function reportToJournal(report: EventReport): void {
  try {
    if (sink) sink(report);
    else if (report.level === "error") console.error(`[${report.area}] ${report.title}`, report.detail ?? "");
  } catch {
    // Reporting must never break the page.
  }
}

/** Something failed. `title` says what the page was doing; `cause` is the error or a reason. */
export function reportError(area: string, title: string, cause?: unknown, extras: EventExtras = {}): void {
  reportToJournal({ level: "error", area, title, detail: describeCause(cause), ...extras });
}

/** The user did something. */
export function recordAction(area: string, title: string, detail = "", extras: EventExtras = {}): void {
  reportToJournal({ level: "action", area, title, detail, ...extras });
}

export function recordInfo(area: string, title: string, detail = "", extras: EventExtras = {}): void {
  reportToJournal({ level: "info", area, title, detail, ...extras });
}

function remember(events: readonly AppEvent[]): void {
  const now = Date.now();
  known = known.filter((entry) => now - entry.at < KNOWN_FOR_MS);
  for (const event of events) {
    if (event.level === "error") known.push({ at: now, title: event.title, detail: event.detail });
  }
}

function alreadyRecorded(text: string, description: string): boolean {
  const now = Date.now();
  return known.some((entry) => {
    if (now - entry.at >= KNOWN_FOR_MS) return false;
    if (entry.title === text || (description && entry.detail === description)) return true;
    return entry.detail !== "" && (entry.detail === text || text.includes(entry.detail) || entry.detail.includes(text));
  });
}

/**
 * An error toast was shown. It is recorded too, unless the main process already recorded the
 * same failure (a rejected request is, before the page even hears about it).
 */
export function noteErrorToast(message: unknown, description: unknown): void {
  const text = typeof message === "string" && message ? message : "An error was shown";
  const extra = typeof description === "string" ? description : "";
  setTimeout(() => {
    if (!alreadyRecorded(text, extra)) reportError("ui", text, extra);
  }, TOAST_GRACE_MS);
}

/** "a sender", "3 domains"... for an action's title; the values themselves go in the private context. */
export function countedTargets(kind: "senders" | "domains" | "threads", count: number): string {
  const noun = kind === "domains" ? "domain" : kind === "threads" ? "conversation" : "sender";
  return count === 1 ? `a ${noun}` : `${count} ${noun}s`;
}

/** An error was shown inline (not as a toast): recorded the same way, unless the main process already did. */
export function noteShownError(title: string, cause?: unknown): void {
  noteErrorToast(title, describeCause(cause));
}

/** Ignored on purpose: a browser notice about layout timing, not a failure. */
const BENIGN = /ResizeObserver loop/i;

/**
 * Connects the page to the journal and catches what nothing else does: uncaught errors and
 * promises that rejected without a handler. Returns the way to undo it.
 */
export function installEventReporting(events: Pick<MiniMailApi["events"], "report" | "onChanged">): () => void {
  sink = (report) => events.report(report);
  const stop = events.onChanged(remember);
  const onError = (event: ErrorEvent) => {
    if (BENIGN.test(event.message)) return;
    reportError("app", "The page hit an unexpected error", event.error ?? event.message, {
      context: event.filename ? `${event.filename.split("/").pop()}:${event.lineno}` : undefined,
    });
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    reportError("app", "Something failed without being handled", event.reason);
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    sink = null;
    stop();
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}

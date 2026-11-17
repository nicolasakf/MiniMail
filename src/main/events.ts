import type { AppEvent, EventReport } from "@shared/events";

import type { EventJournal } from "./event-journal";
import { setLogSink, writeLogLine } from "./log";

/**
 * The one way the main process reports what happened. Every failure goes through `reportError`,
 * so it is written to main.log and shows up in the Log popover; the rest of the app
 * never has to know where either of those lives. All of it returns at once: the journal does its
 * work later and these never throw.
 */

let journal: EventJournal | null = null;
/** Errors already recorded, so code that records and then rethrows is not recorded again further up. */
const reported = new WeakSet<object>();

export function wasReported(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && reported.has(cause);
}

/** Starts routing events (and the legacy `logEvent`) into this journal. */
export function installJournal(next: EventJournal | null): void {
  journal = next;
  setLogSink(next ? (level, area, message) => void next.record({ level, area, title: message }) : null);
}

/** Why something failed, as a sentence: the message, plus the error code when there is one. */
export function describeCause(cause: unknown): string {
  if (cause === undefined || cause === null) return "";
  if (typeof cause === "string") return cause;
  if (cause instanceof Error) {
    const code = (cause as { code?: unknown }).code;
    return typeof code === "string" && !cause.message.includes(code) ? `${cause.message} (${code})` : cause.message;
  }
  return String(cause);
}

/** Optional extras: `context` (sender, subject) is private and stays out of main.log. */
export type EventExtras = Pick<EventReport, "context" | "accountId" | "ref">;

export function reportEvent(report: EventReport): AppEvent | null {
  try {
    if (journal) return journal.record(report);
    writeLogLine(report.level, report.area, report.detail ? `${report.title}: ${report.detail}` : report.title);
  } catch (error) {
    console.error("[events] could not record an event:", error);
  }
  return null;
}

/** Something failed. `title` says what the app was doing; `cause` is the error or a reason. */
export function reportError(area: string, title: string, cause?: unknown, extras: EventExtras = {}): void {
  if (typeof cause === "object" && cause !== null) reported.add(cause);
  reportEvent({ level: "error", area, title, detail: describeCause(cause), ...extras });
}

/** The user (or the app on their behalf) did something. */
export function recordAction(area: string, title: string, detail = "", extras: EventExtras = {}): void {
  reportEvent({ level: "action", area, title, detail, ...extras });
}

/** Something happened in the background that is worth remembering. */
export function recordInfo(area: string, title: string, detail = "", extras: EventExtras = {}): void {
  reportEvent({ level: "info", area, title, detail, ...extras });
}

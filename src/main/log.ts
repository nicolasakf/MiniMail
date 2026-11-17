import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { appendFile, rename, stat } from "node:fs/promises";
import { join } from "node:path";

import type { EventLevel } from "@shared/events";

/**
 * A persistent log of things that go wrong (a failed sync, a provider error) and, for context, what
 * the user and the app did, so a banner that has since disappeared can still be investigated.
 * Unlike `perfLog` it is always on, in dev and packaged builds, and it is a file: a Dock-launched
 * app has no terminal to print to.
 *
 * Writing never blocks the caller: lines wait in memory and are appended in one batch a moment
 * later (`flushLog` writes them at once, for quit and crashes). Entries carry the account's
 * provider, the folder and the error, never message content. Email addresses and bearer tokens are
 * scrubbed from whatever text is passed in.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const FILE_NAME = "main.log";
const FLUSH_DELAY_MS = 250;

let directory: string | null = null;
let buffer: string[] = [];
let timer: NodeJS.Timeout | null = null;
let writing: Promise<void> = Promise.resolve();

/** Starts writing to `<dir>/main.log`; until this runs, `logEvent` only prints. */
export function initLog(dir: string): void {
  directory = dir;
  try {
    mkdirSync(dir, { recursive: true });
  } catch (error) {
    console.error("[log] could not create the log folder:", error);
    directory = null;
  }
}

/** Where the log is being written, or null before `initLog`. */
export function logPath(): string | null {
  return directory ? join(directory, FILE_NAME) : null;
}

/** Removes email addresses and bearer/access tokens from free text. */
export function scrub(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<email>")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <token>")
    .replace(/\beyJ[A-Za-z0-9._-]{20,}/g, "<token>");
}

async function rotateIfLarge(file: string): Promise<void> {
  try {
    if ((await stat(file)).size < MAX_BYTES) return;
    await rename(file, `${file}.1`);
  } catch {
    // No file yet, or it could not be moved; appending still works.
  }
}

function rotateIfLargeSync(file: string): void {
  try {
    if (statSync(file).size < MAX_BYTES) return;
    renameSync(file, `${file}.1`);
  } catch {
    // No file yet, or it could not be moved; appending still works.
  }
}

function flushLater(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const lines = buffer;
    buffer = [];
    if (!directory || lines.length === 0) return;
    const file = join(directory, FILE_NAME);
    // One write at a time, in order, and never on the caller's turn.
    writing = writing
      .then(async () => {
        await rotateIfLarge(file);
        await appendFile(file, lines.join(""));
      })
      .catch(() => undefined); // Logging must never break the app.
  }, FLUSH_DELAY_MS);
  timer.unref?.();
}

/** Writes what is waiting right now. For quit and crashes, where there is no later. */
export function flushLog(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const lines = buffer;
  buffer = [];
  if (!directory || lines.length === 0) return;
  const file = join(directory, FILE_NAME);
  try {
    rotateIfLargeSync(file);
    appendFileSync(file, lines.join(""));
  } catch {
    // Logging must never break the app.
  }
}

/** Resolves once every write started so far has finished; for tests. */
export function logIdle(): Promise<void> {
  return writing;
}

/**
 * Appends one line: `2026-11-12T18:00:00.000Z ERROR [scope] message`. Never throws, never waits.
 * The event journal calls this for what it records; other code calls `logEvent`.
 */
export function writeLogLine(level: EventLevel, scope: string, message: string): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} [${scope}] ${scrub(message).replace(/\s+/g, " ").trim()}`;
  // The terminal only hears about errors: a synchronous write per action would cost more than the action.
  if (level === "error") console.error(line);
  if (!directory) return;
  buffer.push(`${line}\n`);
  flushLater();
}

type Sink = (level: EventLevel, scope: string, message: string) => void;
let sink: Sink | null = null;

/** Routes `logEvent` into the event journal, which then writes the line itself. */
export function setLogSink(next: Sink | null): void {
  sink = next;
}

/**
 * Records something in the log (and, once the journal is running, in the Log popover).
 * It is an error unless said otherwise.
 */
export function logEvent(scope: string, message: string, level: EventLevel = "error"): void {
  try {
    if (sink) sink(level, scope, message);
    else writeLogLine(level, scope, message);
  } catch {
    // Logging must never break the app.
  }
}

import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A persistent log of things that go wrong (a failed sync, a provider error), so a banner that
 * has since disappeared can still be investigated. Unlike `perfLog` it is always on, in dev and
 * packaged builds, and it is a file: a Dock-launched app has no terminal to print to.
 *
 * Entries carry the account's provider, the folder and the error, never message content. Email
 * addresses and bearer tokens are scrubbed from whatever text is passed in.
 */

const MAX_BYTES = 1024 * 1024;
const FILE_NAME = "main.log";

let directory: string | null = null;

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

function rotateIfLarge(file: string): void {
  try {
    if (statSync(file).size < MAX_BYTES) return;
    renameSync(file, `${file}.1`);
  } catch {
    // No file yet, or it could not be moved; appending still works.
  }
}

/** Appends one line: `2026-11-12T18:00:00.000Z [scope] message`. Never throws. */
export function logEvent(scope: string, message: string): void {
  const line = `${new Date().toISOString()} [${scope}] ${scrub(message).replace(/\s+/g, " ").trim()}`;
  console.error(line);
  if (!directory) return;
  const file = join(directory, FILE_NAME);
  try {
    rotateIfLarge(file);
    appendFileSync(file, `${line}\n`);
  } catch {
    // Logging must never break the app.
  }
}

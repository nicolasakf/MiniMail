import { appendFileSync, chmodSync, existsSync, mkdirSync } from "node:fs";
import { appendFile, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  EVENT_RETENTION_MS,
  MAX_EVENT_CONTEXT,
  MAX_EVENT_DETAIL,
  MAX_EVENT_TITLE,
  type AppEvent,
  type EventReport,
} from "@shared/events";

import type { Cipher } from "./category-store";
import { scrub } from "./log";

/** The same error repeating within this long is one event with a counter, not a new row each time. */
const REPEAT_WINDOW_MS = 10 * 60_000;
/** Changes reach the disk and the page this long after they happen, in one batch. */
const FLUSH_DELAY_MS = 400;
const PUSH_DELAY_MS = 250;
/** A repeat counter is written at most this often; the first occurrence is written at once. */
const REPEAT_FLUSH_MS = 60_000;
const MAX_EVENTS = 20_000;
/** Lines decrypted per turn while loading, so a big journal never freezes the app. */
const LOAD_CHUNK = 250;
/** Events encrypted per turn while saving, for the same reason. */
const SAVE_CHUNK = 200;
/** What the popover is sent: every error, and the newest of the rest. */
const LIST_MAX_ERRORS = 5000;
const LIST_MAX_OTHER = 5000;

export interface JournalOptions {
  now?: () => number;
  retentionMs?: number;
  /** Receives a copy of every line for `main.log`; the journal itself never writes that file. */
  writeLog?: (level: AppEvent["level"], area: string, message: string) => void;
  /** Receives the events that changed since the last call, at most every `PUSH_DELAY_MS`. */
  onChange?: (changed: AppEvent[]) => void;
}

const clip = (text: string | undefined, max: number): string =>
  text && text.length > max ? `${text.slice(0, max - 1)}…` : (text ?? "");

type Pending =
  | { kind: "event"; event: AppEvent }
  | { kind: "repeat"; id: number; repeats: number; lastAt: number }
  | { kind: "done"; at: number };

/**
 * Remembers what happened, for 30 days. It is built so that recording costs the caller almost
 * nothing: `record` only touches memory. Encrypting, writing to disk and telling the page happen
 * later, in batches, off the caller's turn; loading at startup is split into slices for the same
 * reason. `flushSync` writes everything at once for quit and crashes.
 *
 * The file has one line per fact: `e:` an event encrypted with the OS keychain (so sender and
 * subject are protected), `p:` an event without its private part when encryption is unavailable,
 * `r:` a repeat counter, `d:` the moment the user marked the errors so far as done.
 */
export class EventJournal {
  /** Oldest first. */
  private events: AppEvent[] = [];
  private readonly byId = new Map<number, AppEvent>();
  private readonly latestByKey = new Map<string, AppEvent>();
  private readonly pending: Pending[] = [];
  private readonly pendingRepeats = new Map<number, AppEvent>();
  private readonly changed = new Set<AppEvent>();
  private doneAt = 0;
  private lastId = 0;
  private loadDone = false;
  private listedEarly = false;
  private flushTimer: NodeJS.Timeout | null = null;
  private pushTimer: NodeJS.Timeout | null = null;
  private repeatTimer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  private readonly retention: number;

  constructor(
    private readonly filePath: string,
    private readonly cipher: Cipher,
    private readonly options: JournalOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.retention = options.retentionMs ?? EVENT_RETENTION_MS;
  }

  /**
   * Reads the file in slices and merges it with what was recorded meanwhile. Never rejects. The
   * page is sent the history only if it asked for the list before this finished; otherwise its own
   * request already gets all of it, and pushing thousands of events would be wasted work.
   */
  async load(): Promise<void> {
    try {
      await this.loadFile();
    } finally {
      this.loadDone = true;
      if (this.listedEarly) this.markAllChanged();
    }
  }

  private async loadFile(): Promise<void> {
    let text: string;
    try {
      if (!existsSync(this.filePath)) return;
      text = await readFile(this.filePath, "utf8");
    } catch (error) {
      this.record({ level: "error", area: "events", title: "Could not read the event history", detail: String(error) });
      return;
    }
    const lines = text.split("\n");
    const loaded: AppEvent[] = [];
    const repeats: { id: number; repeats: number; lastAt: number }[] = [];
    let doneMark = 0;
    let unreadable = 0;
    for (let start = 0; start < lines.length; start += LOAD_CHUNK) {
      for (const line of lines.slice(start, start + LOAD_CHUNK)) {
        if (!line) continue;
        try {
          const kind = line.slice(0, 2);
          const body = line.slice(2);
          if (kind === "e:") {
            if (this.cipher.isEncryptionAvailable()) {
              loaded.push(JSON.parse(this.cipher.decryptString(Buffer.from(body, "base64"))) as AppEvent);
            } else unreadable++;
          } else if (kind === "p:") loaded.push(JSON.parse(body) as AppEvent);
          else if (kind === "r:") repeats.push(JSON.parse(body) as { id: number; repeats: number; lastAt: number });
          else if (kind === "d:") doneMark = Math.max(doneMark, Number(body) || 0);
          else unreadable++;
        } catch {
          unreadable++;
        }
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    const byId = new Map(loaded.map((event) => [event.id, event]));
    loaded.splice(0, loaded.length, ...byId.values());
    for (const mark of repeats) {
      const event = byId.get(mark.id);
      if (event) {
        event.repeats = Math.max(event.repeats, mark.repeats);
        event.lastAt = Math.max(event.lastAt, mark.lastAt);
      }
    }
    this.doneAt = Math.max(this.doneAt, doneMark);
    const cutoff = this.now() - this.retention;
    let kept = loaded.filter((event) => event.lastAt >= cutoff);
    if (kept.length > MAX_EVENTS) kept = kept.slice(-MAX_EVENTS);
    for (const event of kept) {
      if (this.byId.has(event.id)) continue;
      if (event.level === "error" && event.lastAt <= this.doneAt) event.done = true;
      this.byId.set(event.id, event);
      this.events.push(event);
      this.lastId = Math.max(this.lastId, event.id);
    }
    this.events.sort((a, b) => a.id - b.id);
    this.indexLatest();
    if (unreadable > 0) {
      this.record({
        level: "error",
        area: "events",
        title: "Part of the event history could not be read",
        detail: `${unreadable} ${unreadable === 1 ? "entry was" : "entries were"} skipped.`,
      });
    }
    // Tidy the file only when every line was understood: skipped lines would be lost for good.
    if (unreadable === 0 && (kept.length < loaded.length || lines.length > loaded.length * 2 + 10)) {
      await this.compact(kept);
    }
  }

  /** Adds an event. Cheap: memory only, everything else happens later. Never throws. */
  record(report: EventReport): AppEvent {
    const at = this.now();
    const title = scrub(clip(report.title, MAX_EVENT_TITLE));
    const detail = scrub(clip(report.detail, MAX_EVENT_DETAIL));
    this.options.writeLog?.(report.level, report.area, detail ? `${title}: ${detail}` : title);

    const key = report.level === "error" ? `${report.area}|${title}|${detail}` : null;
    const previous = key ? this.latestByKey.get(key) : undefined;
    if (previous && at - previous.lastAt < REPEAT_WINDOW_MS && !previous.done) {
      previous.repeats += 1;
      previous.lastAt = at;
      this.pendingRepeats.set(previous.id, previous);
      this.changed.add(previous);
      this.schedulePush();
      this.scheduleRepeatFlush();
      return previous;
    }

    this.lastId = Math.max(this.lastId + 1, at);
    const event: AppEvent = {
      id: this.lastId,
      at,
      lastAt: at,
      repeats: 1,
      level: report.level,
      area: report.area,
      title,
      detail,
      ...(report.context ? { context: clip(report.context, MAX_EVENT_CONTEXT) } : {}),
      ...(report.accountId ? { accountId: report.accountId } : {}),
      ...(report.ref ? { ref: report.ref } : {}),
    };
    this.events.push(event);
    this.byId.set(event.id, event);
    if (key) this.latestByKey.set(key, event);
    this.pending.push({ kind: "event", event });
    this.changed.add(event);
    if (this.events.length > MAX_EVENTS + 500) this.trim();
    this.scheduleFlush();
    this.schedulePush();
    return event;
  }

  /** What the popover shows: all errors and the newest other events, newest first, inside the retention. */
  list(): AppEvent[] {
    if (!this.loadDone) this.listedEarly = true;
    const floor = this.now() - this.retention;
    const errors: AppEvent[] = [];
    const other: AppEvent[] = [];
    for (let index = this.events.length - 1; index >= 0; index--) {
      const event = this.events[index];
      if (event.lastAt < floor) continue;
      if (event.level === "error") {
        if (errors.length < LIST_MAX_ERRORS) errors.push(event);
      } else if (other.length < LIST_MAX_OTHER) other.push(event);
    }
    return [...errors, ...other].sort((a, b) => b.id - a.id);
  }

  /**
   * Marks every error so far as done: it stays in the list (and in main.log) until it ages out, but
   * "Errors only" no longer shows it. The same error happening again afterwards is a new row.
   */
  markErrorsDone(): void {
    this.doneAt = this.now();
    for (const event of this.events) {
      if (event.level === "error" && !event.done) {
        event.done = true;
        this.changed.add(event);
      }
    }
    this.pending.push({ kind: "done", at: this.doneAt });
    this.schedulePush();
    this.scheduleFlush();
  }

  /** Writes everything that is waiting, now. For quit and crashes. */
  flushSync(): void {
    this.clearTimers();
    for (const event of this.pendingRepeats.values()) {
      this.pending.push({ kind: "repeat", id: event.id, repeats: event.repeats, lastAt: event.lastAt });
    }
    this.pendingRepeats.clear();
    const text = this.serialize(this.pending.splice(0));
    if (!text) return;
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      appendFileSync(this.filePath, text, { mode: 0o600 });
      chmodSync(this.filePath, 0o600);
    } catch (error) {
      console.error("[events] could not save the event history:", error);
    }
  }

  /** Resolves when everything scheduled so far is on disk and the page has been told; for tests. */
  async settled(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
      this.flush();
    }
    if (this.pushTimer) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
      this.push();
    }
    await this.writing;
  }

  private indexLatest(): void {
    this.latestByKey.clear();
    for (const event of this.events) {
      if (event.level === "error") this.latestByKey.set(`${event.area}|${event.title}|${event.detail}`, event);
    }
  }

  private markAllChanged(): void {
    for (const event of this.events) this.changed.add(event);
    this.schedulePush();
  }

  private trim(): void {
    const dropped = this.events.splice(0, this.events.length - MAX_EVENTS);
    for (const event of dropped) this.byId.delete(event.id);
    this.indexLatest();
  }

  private serialize(items: Pending[]): string {
    const encrypted = this.cipher.isEncryptionAvailable();
    let text = "";
    for (const item of items) {
      try {
        if (item.kind === "event") {
          if (encrypted) {
            text += `e:${this.cipher.encryptString(JSON.stringify(item.event)).toString("base64")}\n`;
          } else {
            // Without the keychain the private part is not stored at all.
            const { context: _context, ...plain } = item.event;
            text += `p:${JSON.stringify(plain)}\n`;
          }
        } else if (item.kind === "repeat") {
          text += `r:${JSON.stringify({ id: item.id, repeats: item.repeats, lastAt: item.lastAt })}\n`;
        } else text += `d:${item.at}\n`;
      } catch (error) {
        console.error("[events] could not encode an event:", error);
      }
    }
    return text;
  }

  private async serializeInSlices(items: Pending[]): Promise<string> {
    let text = "";
    for (let start = 0; start < items.length; start += SAVE_CHUNK) {
      text += this.serialize(items.slice(start, start + SAVE_CHUNK));
      if (start + SAVE_CHUNK < items.length) await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return text;
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, FLUSH_DELAY_MS);
    this.flushTimer.unref?.();
  }

  private scheduleRepeatFlush(): void {
    if (this.repeatTimer) return;
    this.repeatTimer = setTimeout(() => {
      this.repeatTimer = null;
      for (const event of this.pendingRepeats.values()) {
        this.pending.push({ kind: "repeat", id: event.id, repeats: event.repeats, lastAt: event.lastAt });
      }
      this.pendingRepeats.clear();
      this.scheduleFlush();
    }, REPEAT_FLUSH_MS);
    this.repeatTimer.unref?.();
  }

  private flush(): void {
    const items = this.pending.splice(0);
    if (items.length === 0) return;
    this.writing = this.writing
      .then(async () => {
        // Encrypting a burst in slices, with the event loop free in between, keeps the app responsive.
        const text = await this.serializeInSlices(items);
        if (!text) return;
        mkdirSync(dirname(this.filePath), { recursive: true });
        await appendFile(this.filePath, text, { mode: 0o600 });
      })
      .catch((error) => console.error("[events] could not save the event history:", error));
  }

  private schedulePush(): void {
    if (this.pushTimer || !this.options.onChange) return;
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      this.push();
    }, PUSH_DELAY_MS);
    this.pushTimer.unref?.();
  }

  private push(): void {
    if (this.changed.size === 0) return;
    const batch = [...this.changed];
    this.changed.clear();
    try {
      this.options.onChange?.(batch);
    } catch (error) {
      console.error("[events] could not tell the page:", error);
    }
  }

  /**
   * Rewrites the file with the events it already held, minus what aged out. Asynchronous and only
   * called at startup; events recorded since are still waiting in `pending` and are appended after.
   */
  private async compact(fromFile: AppEvent[]): Promise<void> {
    const items: Pending[] = fromFile.map((event) => ({ kind: "event", event }));
    if (this.doneAt) items.push({ kind: "done", at: this.doneAt });
    const temp = `${this.filePath}.tmp`;
    // In the same queue as the appends, so a batch can never land in the file being replaced.
    this.writing = this.writing
      .then(async () => {
        const text = await this.serializeInSlices(items);
        await writeFile(temp, text, { mode: 0o600 });
        await rename(temp, this.filePath);
      })
      .catch((error) => console.error("[events] could not tidy the event history:", error));
    await this.writing;
  }

  private clearTimers(): void {
    for (const timer of [this.flushTimer, this.repeatTimer]) if (timer) clearTimeout(timer);
    this.flushTimer = null;
    this.repeatTimer = null;
  }
}

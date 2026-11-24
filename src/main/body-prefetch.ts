import { OFFLINE_FOLDERS, prefetchSince, type OfflineFolder, type OfflineSettings } from "@shared/offline";
import type { MailFolder, MessageSummary } from "@shared/types";

import { reportError } from "./events";
import { nativeIdOf } from "./providers/summary-cache";
import { describeError, type MailProvider } from "./providers/types";

/**
 * Messages asked of the server at once. A batch is one command for the headers and one more per message
 * for its text, so a message opened in between waits for one batch at most.
 */
export const PREFETCH_BATCH = 8;

interface Run {
  /** What is still to download, newest first; a newer list replaces it. */
  queue: { nativeId: string; date: number }[];
  running: boolean;
}

/** Whether a folder is one that can be downloaded ahead of time. */
export const isOfflineFolder = (folder: MailFolder): folder is OfflineFolder => (OFFLINE_FOLDERS as readonly string[]).includes(folder);

/**
 * What is downloaded in one run: a folder the person chose, or the Pinned view. Pinned mail is always downloaded,
 * whatever its age and whichever folders were chosen (only the switch turns it off), and it is kept as if just read.
 */
type Target = OfflineFolder | "pinned";

const wanted = (settings: OfflineSettings, folder: MailFolder): folder is Target =>
  folder === "pinned" || (isOfflineFolder(folder) && settings.folders.includes(folder));

/**
 * Downloads the text of mail in the background, so opening it needs no network. After each list of a folder the
 * person chose (which is also what a message arriving causes) the messages that are not saved yet are downloaded,
 * newest first, a small batch at a time: those within the look-back, or, when the limit is a size, as many as fit.
 * It never touches attachments or embedded images, folders that were not chosen, or the network when the
 * computer is offline, and what the person chose in Settings is read before every batch, so turning it off
 * takes effect at once. It only reaches the messages the lists show (the newest of each folder).
 */
export class BodyPrefetcher {
  private readonly runs = new Map<string, Run>();
  /** Messages that failed this session, so one that cannot be read does not make every list try it again. */
  private readonly failed = new Set<string>();

  constructor(
    private readonly settings: () => OfflineSettings,
    private readonly online: () => boolean = () => true,
    private readonly now: () => number = Date.now,
    /** Whether a message with this date is worth saving: false once the file is full of newer mail. */
    private readonly roomFor: (date: number) => boolean = () => true,
  ) {}

  /** A folder was just listed: queue what it shows that is within the limit and not saved yet. */
  schedule(accountId: string, provider: MailProvider, folder: MailFolder, rows: readonly MessageSummary[]): Promise<void> {
    const settings = this.settings();
    if (!settings.prefetch || !provider.prefetch || !wanted(settings, folder)) return Promise.resolve();
    // Pinned mail has no look-back: the person flagged it to keep it at hand.
    const since = folder === "pinned" ? null : prefetchSince(settings, this.now());
    const queued = rows
      .filter((row) => row.folder === folder)
      .map((row) => ({ row, date: Date.parse(row.date) }))
      .filter(({ date }) => Number.isFinite(date) && (since === null || date >= since))
      .sort((a, b) => b.date - a.date)
      .flatMap(({ row, date }) => {
        const nativeId = nativeIdOf(row);
        return nativeId !== undefined && !this.failed.has(`${accountId}|${folder}|${nativeId}`) ? [{ nativeId, date }] : [];
      });

    const key = `${accountId}|${folder}`;
    const run = this.runs.get(key) ?? { queue: [], running: false };
    run.queue = queued;
    this.runs.set(key, run);
    if (run.running) return Promise.resolve();
    run.running = true;
    return this.drain(accountId, provider, folder, run).finally(() => {
      run.running = false;
    });
  }

  /** The folders the person chose, and Pinned, were not listed just now: queue what each already shows (after a change in Settings). */
  scheduleCached(accountId: string, provider: MailProvider): void {
    for (const folder of [...this.settings().folders, "pinned" as const]) {
      void this.schedule(accountId, provider, folder, provider.cached?.(folder) ?? []);
    }
  }

  /** Stops downloading for a removed account. */
  forget(accountId: string): void {
    for (const [key, run] of this.runs) {
      if (!key.startsWith(`${accountId}|`)) continue;
      run.queue = [];
      this.runs.delete(key);
    }
  }

  private async drain(accountId: string, provider: MailProvider, folder: Target, run: Run): Promise<void> {
    while (run.queue.length > 0) {
      const settings = this.settings();
      if (!settings.prefetch || !wanted(settings, folder) || !this.online()) {
        run.queue = [];
        return;
      }
      // Newest first, so once the newest left is not worth saving (the file is full of newer mail), none is.
      // Pinned mail is kept as if just read, so it is always worth saving.
      if (folder !== "pinned" && !this.roomFor(run.queue[0].date)) {
        run.queue = [];
        return;
      }
      const batch = run.queue.splice(0, PREFETCH_BATCH).map((entry) => entry.nativeId);
      try {
        await provider.prefetch?.(folder, batch);
      } catch (error) {
        // expected: the batch is tried again one message at a time, which records the one that cannot be read.
        await this.retryOneByOne(accountId, provider, folder, batch, error);
      }
    }
  }

  /** A batch failed: find the message that cannot be read, and leave only that one out. */
  private async retryOneByOne(
    accountId: string,
    provider: MailProvider,
    folder: Target,
    batch: readonly string[],
    cause: unknown,
  ): Promise<void> {
    if (batch.length === 1) {
      this.failed.add(`${accountId}|${folder}|${batch[0]}`);
      reportError("sync", "Could not download a message for offline use", describeError(cause), { accountId });
      return;
    }
    for (const nativeId of batch) {
      if (!this.settings().prefetch || !this.online()) return;
      try {
        await provider.prefetch?.(folder, [nativeId]);
      } catch (error) {
        this.failed.add(`${accountId}|${folder}|${nativeId}`);
        reportError("sync", "Could not download a message for offline use", describeError(error), { accountId });
        // A failure that is not about this message (the connection) would repeat for each one: stop here.
        return;
      }
    }
  }
}

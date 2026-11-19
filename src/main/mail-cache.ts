import { existsSync, readFileSync } from "node:fs";

import { z } from "zod";

import { MAIL_WINDOW } from "@shared/mail-window";
import type { MailFolder, MessageSummary } from "@shared/types";

import { writePrivateFile, type Cipher } from "./category-store";
import type { CachedFolder, SummaryStore } from "./providers/summary-cache";
import { reportError } from "./events";
import { migrate, NewerFileError, type Migration } from "./migrate";

/**
 * Bump when MessageSummary or the file changes shape, and add the step that upgrades the old
 * version to `MIGRATIONS`: a saved list is never thrown away for being old.
 */
const VERSION = 3;

/** Rows as older versions saved them: only what the steps below touch is described. */
const storedSchema = z.object({
  accounts: z.record(
    z.string(),
    z.record(
      z.string(),
      z.object({ uidValidity: z.string(), messages: z.array(z.record(z.string(), z.unknown())) }),
    ),
  ),
});

/** Applies a change to every saved row, leaving the rest of the file as it is. */
function mapRows(payload: unknown, change: (row: Record<string, unknown>) => Record<string, unknown>): unknown {
  const stored = storedSchema.parse(payload);
  return {
    accounts: Object.fromEntries(
      Object.entries(stored.accounts).map(([accountId, folders]) => [
        accountId,
        Object.fromEntries(
          Object.entries(folders).map(([folder, copy]) => [folder, { ...copy, messages: copy.messages.map(change) }]),
        ),
      ]),
    ),
  };
}

/** Keyed by the version a step upgrades from (1 turns a version 1 payload into version 2). */
const MIGRATIONS: Record<number, Migration> = {
  // 1 to 2: version 1 saved every row without its List-Unsubscribe / List-Id (they were read from
  // the wrong place). Dropping the field keeps the row and makes the next list read just those
  // headers for it (the `legacy` pass in providers/imap.ts), not download the preview again.
  1: (payload) => mapRows(payload, (row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "unsubscribe"))),
  // 2 to 3: version 3 lets an Outlook folder remember where it stands in Graph's change feed
  // (`delta`). A version 2 copy has none, and none is what a folder without a feed looks like: the
  // saved rows stay and paint at once, and the next list starts the feed from them.
  2: (payload) => payload,
};
const SAVE_DELAY_MS = 1500;
/** The whole list window plus a little headroom, and a hard stop so the file cannot grow unbounded. */
const MAX_PER_FOLDER = MAIL_WINDOW + 100;

/** Cheap shape check for rows read back from disk; the file is ours, this only catches drift. */
function looksLikeSummary(value: unknown): value is MessageSummary {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  const from = row["from"] as Record<string, unknown> | undefined;
  return (
    typeof row["id"] === "string" &&
    typeof row["accountId"] === "string" &&
    typeof row["threadId"] === "string" &&
    typeof row["subject"] === "string" &&
    typeof row["date"] === "string" &&
    typeof row["unread"] === "boolean" &&
    typeof from === "object" &&
    from !== null &&
    typeof from["email"] === "string"
  );
}

const foldersSchema = z.record(
  z.string(),
  z.object({
    uidValidity: z.string(),
    messages: z.array(z.custom<MessageSummary>(looksLikeSummary)),
    // A feed position that does not read back is dropped alone: the rows are still good, and
    // the folder simply starts a new feed.
    delta: z.object({ link: z.string(), since: z.string().nullable(), syncedAt: z.number() }).optional().catch(undefined),
  }),
);

const payloadSchema = z.object({ accounts: z.record(z.string(), foldersSchema) });
const fileSchema = z.object({ version: z.number().int().positive(), data: z.string() });

type Payload = z.infer<typeof payloadSchema>;

/**
 * The last list seen per account and folder, kept between launches so the inbox can paint
 * before any server answers. It holds sender, subject and a short preview, so it is encrypted
 * with the OS keychain like the account passwords; if encryption is unavailable nothing is
 * written. A corrupt, outdated or undecryptable file is ignored and rebuilt from the server.
 */
export class MailCache {
  private accounts = new Map<string, Map<string, CachedFolder>>();
  /** Removed accounts: a list still in flight must not write their data back. */
  private readonly dropped = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  /** The file on disk is from a newer app: it is neither read nor overwritten. */
  private keepFile = false;

  constructor(
    private readonly filePath: string,
    private readonly cipher: Cipher,
    private readonly saveDelayMs = SAVE_DELAY_MS,
  ) {
    this.load();
  }

  /** The cache view one account's provider reads and writes. */
  forAccount(accountId: string): SummaryStore {
    return {
      load: (folder) => this.accounts.get(accountId)?.get(folder),
      save: (folder, value) => this.set(accountId, folder, value),
    };
  }

  /** Forgets everything held for a removed account. */
  dropAccount(accountId: string): void {
    this.dropped.add(accountId);
    if (this.accounts.delete(accountId)) this.schedule();
  }

  /** Writes pending changes now; called on quit. */
  flush(): void {
    if (this.timer) this.saveNow();
  }

  private set(accountId: string, folder: MailFolder, value: CachedFolder): void {
    if (this.dropped.has(accountId)) return;
    const folders = this.accounts.get(accountId) ?? new Map<string, CachedFolder>();
    folders.set(folder, { ...value, messages: value.messages.slice(0, MAX_PER_FOLDER) });
    this.accounts.set(accountId, folders);
    this.schedule();
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => this.saveNow(), this.saveDelayMs);
    this.timer.unref?.();
  }

  private saveNow(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.keepFile || !this.cipher.isEncryptionAvailable()) return;
    try {
      const payload: Payload = { accounts: {} };
      for (const [accountId, folders] of this.accounts) {
        payload.accounts[accountId] = Object.fromEntries(folders);
      }
      const data = this.cipher.encryptString(JSON.stringify(payload)).toString("base64");
      writePrivateFile(this.filePath, JSON.stringify({ version: VERSION, data }));
    } catch (error) {
      // The cache is an optimisation; failing to save it must never disturb mail.
      reportError("storage", "Could not save the mail cache", error);
    }
  }

  private load(): void {
    if (!existsSync(this.filePath) || !this.cipher.isEncryptionAvailable()) return;
    try {
      const file = fileSchema.parse(JSON.parse(readFileSync(this.filePath, "utf8")));
      const stored: unknown = JSON.parse(this.cipher.decryptString(Buffer.from(file.data, "base64")));
      const payload = payloadSchema.parse(migrate(stored, file.version, VERSION, MIGRATIONS));
      for (const [accountId, folders] of Object.entries(payload.accounts)) {
        this.accounts.set(accountId, new Map(Object.entries(folders)));
      }
      // Write the upgraded format back, so the migration runs once.
      if (file.version < VERSION) this.schedule();
    } catch (error) {
      this.accounts = new Map();
      if (error instanceof NewerFileError) {
        // Opened by an older app after a newer one: leave the newer app's copy alone.
        this.keepFile = true;
        reportError("storage", "The mail cache was saved by a newer MiniMail; it is not used and not changed", error);
        return;
      }
      reportError("storage", "Could not read the mail cache; it will be rebuilt", error);
    }
  }
}

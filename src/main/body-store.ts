import { chmodSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { z } from "zod";

import type { Contact, MailFolder } from "@shared/types";

import type { Cipher } from "./category-store";
import { reportError } from "./events";
import { NewerFileError } from "./migrate";
import type { BodyView, StoredBody } from "./providers/types";

/**
 * Bump when the table changes, and add the step that upgrades the old version to `STEPS`: saved text is
 * never thrown away for being old. Version 1 is the first.
 */
const VERSION = 1;
type Step = (db: DatabaseSync) => void;
const STEPS: Readonly<Record<number, Step>> = {};

/** The most the file holds unless the person set another limit; the text read longest ago goes first. */
export const MAX_BODY_STORE_BYTES = 512 * 1024 * 1024;
/** What it is trimmed down to, so one save does not trim again the next time. */
const TRIM_TARGET = 0.9;
/** The file is checked against the cap this often (in saved messages), and when it opens. */
const TRIM_EVERY = 200;
const TRIM_CHUNK = 100;

const contact: z.ZodType<Contact> = z.object({ name: z.string(), email: z.string() });
const storedBodySchema = z.object({
  cc: z.array(contact),
  replyTo: contact.nullable(),
  messageId: z.string().nullable(),
  references: z.array(z.string()),
  html: z.string().nullable(),
  text: z.string().nullable(),
  attachments: z.array(z.object({ id: z.string(), filename: z.string(), contentType: z.string(), size: z.number() })),
  invitation: z.custom<StoredBody["invitation"]>((value) => value === null || (typeof value === "object" && value !== null)),
  inline: z.array(z.object({ id: z.string(), contentType: z.string(), size: z.number(), cid: z.string().optional(), encoding: z.string().optional() })),
});

/** The folder the ids of a view belong to: the Pinned view is the Inbox seen through a filter. */
const place = (folder: MailFolder): string => (folder === "pinned" ? "inbox" : folder);
/** A draft is edited in place on some servers, so its text is never kept. */
const kept = (folder: MailFolder): boolean => folder !== "drafts";

/**
 * The text of messages already downloaded, kept between launches so opening one needs no network:
 * one row per message in a SQLite file, its content encrypted with the OS keychain like the rest of the
 * mail on disk (the columns that are not encrypted hold only ids, sizes and times). If encryption is
 * unavailable nothing is saved. Only what the server could give again is ever dropped: a file that
 * cannot be read is set aside and reported, and the text is downloaded again as messages are opened.
 *
 * Reading and writing are synchronous (a row is a few tens of kilobytes), so callers keep to one
 * message or a small batch at a time.
 */
export class BodyStore {
  private db: DatabaseSync | null = null;
  private savedSinceTrim = 0;
  private lastStamp = 0;
  private reportedUnreadable = false;

  constructor(
    private readonly filePath: string,
    private readonly cipher: Cipher,
    /** The most the file may hold; null means no limit. */
    private maxBytes: number | null = MAX_BODY_STORE_BYTES,
  ) {
    this.open();
    this.trim();
  }

  /** Changes the most the file may hold (null: no limit). A lower limit drops the text read longest ago at once. */
  setLimit(maxBytes: number | null): void {
    this.maxBytes = maxBytes;
    this.trim();
  }

  /** The limit now in force, or null when there is none. */
  limit(): number | null {
    return this.maxBytes;
  }

  /** The store as one account's provider sees it. */
  forAccount(accountId: string): BodyView {
    return {
      get: (folder, nativeId, scope) => (kept(folder) ? this.get(accountId, place(folder), nativeId, scope) : undefined),
      missing: (folder, nativeIds, scope) => (kept(folder) ? this.missing(accountId, place(folder), nativeIds, scope) : [...nativeIds]),
      put: (folder, nativeId, scope, body, rank) => {
        if (kept(folder)) this.put(accountId, place(folder), nativeId, scope, body, rank);
      },
      remove: (folder, nativeIds) => this.remove(accountId, place(folder), nativeIds),
      retire: (folder, keepScope) => this.retire(accountId, place(folder), keepScope),
    };
  }

  get(accountId: string, folder: string, nativeId: string, scope: string): StoredBody | undefined {
    const db = this.db;
    if (!db || !this.cipher.isEncryptionAvailable()) return undefined;
    try {
      const row = db
        .prepare("SELECT data FROM bodies WHERE account = ? AND folder = ? AND native = ? AND scope = ?")
        .get(accountId, folder, nativeId, scope) as { data: Uint8Array } | undefined;
      if (!row) return undefined;
      let body: StoredBody;
      try {
        body = storedBodySchema.parse(JSON.parse(this.cipher.decryptString(Buffer.from(row.data)))) as StoredBody;
      } catch (error) {
        // The row cannot be read (the keychain item changed, or the shape drifted): it is only a copy of
        // what the server holds, so it goes, and the message is downloaded again.
        db.prepare("DELETE FROM bodies WHERE account = ? AND folder = ? AND native = ? AND scope = ?").run(accountId, folder, nativeId, scope);
        if (!this.reportedUnreadable) {
          this.reportedUnreadable = true; // once per launch: a keychain change makes every row unreadable
          reportError("storage", "A saved message could not be read; it will be downloaded again", error, { accountId });
        }
        return undefined;
      }
      // An invitation saved before its call link and notes were read has neither (undefined, not null). The
      // calendar file is not kept, so the message is downloaded again once to fill them; it is only a copy of the server's.
      if (body.invitation && body.invitation.url === undefined) {
        db.prepare("DELETE FROM bodies WHERE account = ? AND folder = ? AND native = ? AND scope = ?").run(accountId, folder, nativeId, scope);
        return undefined;
      }
      db.prepare("UPDATE bodies SET accessed = ? WHERE account = ? AND folder = ? AND native = ? AND scope = ?").run(
        this.stamp(),
        accountId,
        folder,
        nativeId,
        scope,
      );
      return body;
    } catch (error) {
      reportError("storage", "Could not read a saved message", error, { accountId });
      return undefined;
    }
  }

  missing(accountId: string, folder: string, nativeIds: readonly string[], scope: string): string[] {
    const db = this.db;
    if (!db || !this.cipher.isEncryptionAvailable()) return [...nativeIds];
    try {
      const has = db.prepare("SELECT 1 FROM bodies WHERE account = ? AND folder = ? AND native = ? AND scope = ?");
      return nativeIds.filter((nativeId) => has.get(accountId, folder, nativeId, scope) === undefined);
    } catch (error) {
      reportError("storage", "Could not check the saved messages", error, { accountId });
      return [...nativeIds];
    }
  }

  /**
   * Saves a message. It counts as read now, unless `rank` (the message's own date, for mail downloaded ahead of
   * time) is given: then it ranks by its age, so that when the file is full the oldest mail goes before the
   * mail that was opened or arrived lately.
   */
  put(accountId: string, folder: string, nativeId: string, scope: string, body: StoredBody, rank?: number): void {
    const db = this.db;
    if (!db || !this.cipher.isEncryptionAvailable()) return;
    try {
      const data = this.cipher.encryptString(JSON.stringify(body));
      const now = this.stamp();
      const accessed = rank !== undefined && Number.isFinite(rank) ? Math.min(rank, now) : now;
      db.prepare(
        "INSERT OR REPLACE INTO bodies (account, folder, native, scope, size, saved, accessed, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(accountId, folder, nativeId, scope, data.length, now, accessed, data);
      this.savedSinceTrim += 1;
      if (this.savedSinceTrim >= TRIM_EVERY) this.trim();
    } catch (error) {
      // Saving is an optimisation: the message was downloaded and shown, so it is reported, not thrown.
      reportError("storage", "Could not save a message for offline use", error, { accountId });
    }
  }

  remove(accountId: string, folder: string, nativeIds: readonly string[]): void {
    const db = this.db;
    if (!db || nativeIds.length === 0) return;
    try {
      const drop = db.prepare("DELETE FROM bodies WHERE account = ? AND folder = ? AND native = ?");
      for (const nativeId of nativeIds) drop.run(accountId, folder, nativeId);
    } catch (error) {
      reportError("storage", "Could not forget saved messages", error, { accountId });
    }
  }

  retire(accountId: string, folder: string, keepScope: string): void {
    const db = this.db;
    if (!db) return;
    try {
      db.prepare("DELETE FROM bodies WHERE account = ? AND folder = ? AND scope != ?").run(accountId, folder, keepScope);
    } catch (error) {
      reportError("storage", "Could not forget the saved messages of a renumbered folder", error, { accountId });
    }
  }

  /** Forgets everything held for a removed account. */
  dropAccount(accountId: string): void {
    const db = this.db;
    if (!db) return;
    try {
      db.prepare("DELETE FROM bodies WHERE account = ?").run(accountId);
    } catch (error) {
      reportError("storage", "Could not forget the saved messages of a removed account", error, { accountId });
    }
  }

  /** How many messages are saved, how many bytes they take, and when the one read longest ago was (null: none). */
  stats(): { messages: number; bytes: number; oldest: number | null } {
    const row = this.db
      ?.prepare("SELECT COUNT(*) AS messages, COALESCE(SUM(size), 0) AS bytes, MIN(accessed) AS oldest FROM bodies")
      .get() as { messages: number; bytes: number; oldest: number | null } | undefined;
    return row ?? { messages: 0, bytes: 0, oldest: null };
  }

  /**
   * Whether mail downloaded ahead of time with this date is worth saving: always while there is room, and
   * once the file is full only if it is newer than what would be dropped to make room for it.
   */
  hasRoomFor(date: number): boolean {
    const limit = this.maxBytes;
    if (limit === null) return true;
    const { bytes, oldest } = this.stats();
    return bytes < limit * TRIM_TARGET || oldest === null || date > oldest;
  }

  close(): void {
    try {
      this.db?.close();
    } catch (error) {
      reportError("storage", "Could not close the saved messages", error);
    }
    this.db = null;
  }

  /** The time, never the same twice, so that "read longest ago" is a strict order even for two reads in one millisecond. */
  private stamp(): number {
    this.lastStamp = Math.max(Date.now(), this.lastStamp + 1);
    return this.lastStamp;
  }

  /** Drops the text read longest ago until the file is under its cap. */
  private trim(): void {
    this.savedSinceTrim = 0;
    const db = this.db;
    if (!db) return;
    try {
      const maxBytes = this.maxBytes;
      if (maxBytes === null || this.stats().bytes <= maxBytes) return;
      const target = maxBytes * TRIM_TARGET;
      let bytes = this.stats().bytes;
      const drop = db.prepare("DELETE FROM bodies WHERE account = ? AND folder = ? AND native = ? AND scope = ?");
      while (bytes > target) {
        const oldest = db
          .prepare("SELECT account, folder, native, scope, size FROM bodies ORDER BY accessed LIMIT ?")
          .all(TRIM_CHUNK) as { account: string; folder: string; native: string; scope: string; size: number }[];
        if (oldest.length === 0) break;
        for (const row of oldest) {
          if (bytes <= target) break;
          drop.run(row.account, row.folder, row.native, row.scope);
          bytes -= row.size;
        }
      }
    } catch (error) {
      reportError("storage", "Could not trim the saved messages", error);
    }
  }

  private open(): void {
    try {
      this.db = this.openDatabase();
    } catch (error) {
      this.db = null;
      if (error instanceof NewerFileError) {
        reportError("storage", "The saved messages were written by a newer MiniMail; they are not used and not changed", error);
        return;
      }
      reportError("storage", "Could not read the saved messages; they will be downloaded again", error);
      this.setAside();
      try {
        this.db = this.openDatabase();
      } catch (retry) {
        reportError("storage", "Could not create the file for saved messages; messages are downloaded each time", retry);
      }
    }
  }

  private openDatabase(): DatabaseSync {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const db = new DatabaseSync(this.filePath);
    try {
      db.exec("PRAGMA journal_mode = WAL");
      db.exec("PRAGMA synchronous = NORMAL");
      db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID");
      const found = db.prepare("SELECT value FROM meta WHERE key = 'version'").get() as { value: string } | undefined;
      const version = found ? Number(found.value) : null;
      if (version === null) {
        db.exec(
          `CREATE TABLE IF NOT EXISTS bodies (
             account TEXT NOT NULL, folder TEXT NOT NULL, native TEXT NOT NULL, scope TEXT NOT NULL,
             size INTEGER NOT NULL, saved INTEGER NOT NULL, accessed INTEGER NOT NULL, data BLOB NOT NULL,
             PRIMARY KEY (account, folder, native, scope)
           ) WITHOUT ROWID`,
        );
        db.exec("CREATE INDEX IF NOT EXISTS bodies_accessed ON bodies (accessed)");
        db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('version', ?)").run(String(VERSION));
      } else {
        if (!Number.isInteger(version) || version < 1) throw new Error(`The saved messages file has an invalid version (${found?.value})`);
        if (version > VERSION) throw new NewerFileError(version, VERSION);
        for (let from = version; from < VERSION; from += 1) {
          const step = STEPS[from];
          if (!step) throw new Error(`No migration from version ${from} to ${from + 1}`);
          step(db);
          db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('version', ?)").run(String(from + 1));
        }
      }
      if (existsSync(this.filePath)) chmodSync(this.filePath, 0o600);
      return db;
    } catch (error) {
      try {
        db.close();
      } catch {
        // expected: the file is what failed to open, so there may be nothing to close.
      }
      throw error;
    }
  }

  /** Moves an unreadable file (and its journal) out of the way, keeping it for inspection. */
  private setAside(): void {
    for (const suffix of ["", "-wal", "-shm"]) {
      const path = `${this.filePath}${suffix}`;
      if (!existsSync(path)) continue;
      try {
        renameSync(path, `${path}.corrupt`);
      } catch (error) {
        reportError("storage", "Could not set aside the unreadable saved messages", error);
      }
    }
  }
}

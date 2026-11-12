import { existsSync, readFileSync } from "node:fs";

import { z } from "zod";

import { MAIL_WINDOW } from "@shared/mail-window";
import type { MailFolder, MessageSummary } from "@shared/types";

import { writePrivateFile, type Cipher } from "./category-store";
import type { CachedFolder, SummaryStore } from "./providers/summary-cache";

/** Bump when MessageSummary changes shape; an older file is then ignored instead of misread. */
const VERSION = 1;
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
  }),
);

const payloadSchema = z.object({ accounts: z.record(z.string(), foldersSchema) });
const fileSchema = z.object({ version: z.literal(VERSION), data: z.string() });

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
    if (!this.cipher.isEncryptionAvailable()) return;
    try {
      const payload: Payload = { accounts: {} };
      for (const [accountId, folders] of this.accounts) {
        payload.accounts[accountId] = Object.fromEntries(folders);
      }
      const data = this.cipher.encryptString(JSON.stringify(payload)).toString("base64");
      writePrivateFile(this.filePath, JSON.stringify({ version: VERSION, data }));
    } catch (error) {
      // The cache is an optimisation; failing to save it must never disturb mail.
      console.error("[mail-cache] could not save:", error);
    }
  }

  private load(): void {
    if (!existsSync(this.filePath) || !this.cipher.isEncryptionAvailable()) return;
    try {
      const file = fileSchema.parse(JSON.parse(readFileSync(this.filePath, "utf8")));
      const payload = payloadSchema.parse(
        JSON.parse(this.cipher.decryptString(Buffer.from(file.data, "base64"))),
      );
      for (const [accountId, folders] of Object.entries(payload.accounts)) {
        this.accounts.set(accountId, new Map(Object.entries(folders)));
      }
    } catch (error) {
      console.error("[mail-cache] ignoring unreadable cache:", error);
      this.accounts = new Map();
    }
  }
}

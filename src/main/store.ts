import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import { safeStorage } from "electron";
import { z } from "zod";

import type { Account } from "@shared/types";

const accountSchema = z.object({
  id: z.string(),
  provider: z.enum(["gmail", "outlook", "zoho"]),
  email: z.string(),
  displayName: z.string(),
  alias: z.string().optional(),
  avatar: z.string().optional(),
  auth: z.enum(["oauth", "password"]),
  hue: z.number(),
  outlookKind: z.enum(["personal", "work-school"]).optional(),
  tenant: z.string().optional(),
  zohoRegion: z.enum(["com", "eu", "in", "com.au", "jp"]).optional(),
  zohoWorkplace: z.boolean().optional(),
});

const secretSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("password"), password: z.string() }),
  z.object({
    kind: z.literal("oauth"),
    refreshToken: z.string(),
    accessToken: z.string().optional(),
    /** Epoch milliseconds. */
    expiresAt: z.number().optional(),
  }),
]);

export type AccountSecret = z.infer<typeof secretSchema>;

export interface StoredAccount {
  account: Account;
  secret: AccountSecret;
}

const fileSchema = z.object({
  version: z.literal(1),
  accounts: z.array(
    z.object({
      account: accountSchema,
      /** base64 of `safeStorage.encryptString(JSON.stringify(secret))`. */
      secret: z.string(),
    }),
  ),
});

/**
 * Persists accounts in one JSON file. Passwords and OAuth tokens are encrypted
 * with the OS keychain via Electron's safeStorage; if encryption is unavailable
 * nothing is written (there is deliberately no plaintext fallback).
 */
export class AccountStore {
  private entries: StoredAccount[] = [];

  constructor(private readonly filePath: string) {
    this.load();
  }

  /** Public account metadata only; secrets never leave the main process. */
  list(): Account[] {
    return this.entries.map((entry) => entry.account);
  }

  get(accountId: string): StoredAccount | undefined {
    return this.entries.find((entry) => entry.account.id === accountId);
  }

  add(account: Account, secret: AccountSecret): void {
    this.entries.push({ account, secret });
    this.save();
  }

  updateSecret(accountId: string, secret: AccountSecret): void {
    const entry = this.get(accountId);
    if (!entry) return;
    entry.secret = secret;
    this.save();
  }

  remove(accountId: string): void {
    this.entries = this.entries.filter((entry) => entry.account.id !== accountId);
    this.save();
  }

  /**
   * Sets or clears (undefined) the alias. If the file cannot be written the change is undone,
   * so what the UI shows never differs from what is on disk.
   */
  setAlias(accountId: string, alias: string | undefined): Account | undefined {
    return this.patch(accountId, ({ alias: _old, ...rest }) => (alias === undefined ? rest : { ...rest, alias }));
  }

  /** Sets or clears (undefined) the account's picture, with the same undo-on-failure as the alias. */
  setAvatar(accountId: string, avatar: string | undefined): Account | undefined {
    return this.patch(accountId, ({ avatar: _old, ...rest }) => (avatar === undefined ? rest : { ...rest, avatar }));
  }

  private patch(accountId: string, change: (account: Account) => Account): Account | undefined {
    const entry = this.get(accountId);
    if (!entry) return undefined;
    const previous = entry.account;
    entry.account = change(previous);
    try {
      this.save();
    } catch (error) {
      entry.account = previous;
      throw error;
    }
    return entry.account;
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const parsed = fileSchema.parse(JSON.parse(readFileSync(this.filePath, "utf8")));
      if (!safeStorage.isEncryptionAvailable() && parsed.accounts.length > 0) {
        throw new Error("OS keychain encryption is unavailable");
      }
      this.entries = parsed.accounts.map((entry) => ({
        account: entry.account,
        secret: secretSchema.parse(
          JSON.parse(safeStorage.decryptString(Buffer.from(entry.secret, "base64"))),
        ),
      }));
    } catch (error) {
      // A corrupt or undecryptable file must not crash startup; the user re-adds accounts.
      console.error("[store] could not read accounts, starting empty:", error);
      this.entries = [];
    }
  }

  private save(): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure storage is unavailable, so accounts cannot be saved.");
    }
    const payload = {
      version: 1 as const,
      accounts: this.entries.map((entry) => ({
        account: entry.account,
        secret: safeStorage
          .encryptString(JSON.stringify(entry.secret))
          .toString("base64"),
      })),
    };
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    writeFileSync(temp, JSON.stringify(payload, null, 2), { mode: 0o600 });
    renameSync(temp, this.filePath);
    chmodSync(this.filePath, 0o600);
  }
}

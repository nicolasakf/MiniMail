import { existsSync, readFileSync } from "node:fs";

import { z } from "zod";

import { writePrivateFile, type Cipher } from "../category-store";

/** 2: entries written by the first version may hold failures from a page-size bug, so they are dropped. */
const VERSION = 2;
const SAVE_DELAY_MS = 2000;
const MAX_ENTRIES = 500;

export interface CachedLogo {
  /** A `data:` URL, or null when the lookup found nothing (remembered so it is not repeated). */
  dataUrl: string | null;
  /** Epoch ms after which the entry is stale. */
  expires: number;
}

const fileSchema = z.object({ version: z.literal(VERSION), data: z.string() });
const payloadSchema = z.record(
  z.string(),
  z.object({
    dataUrl: z.string().startsWith("data:image/").nullable(),
    expires: z.number(),
  }),
);

/**
 * Icons found so far, kept between launches. The set of domains is a list of who writes to the
 * user, so like the mail cache it is encrypted with the OS keychain, and nothing is written when
 * that is unavailable. People are keyed by a hash of their address, never the address itself.
 */
export class LogoCache {
  private entries = new Map<string, CachedLogo>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly filePath: string,
    private readonly cipher: Cipher,
    private readonly saveDelayMs = SAVE_DELAY_MS,
  ) {
    this.load();
  }

  /** The entry, or undefined when unknown or stale. */
  get(key: string, now: number): CachedLogo | undefined {
    const entry = this.entries.get(key);
    return entry && entry.expires > now ? entry : undefined;
  }

  set(key: string, entry: CachedLogo): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
    // Oldest first: a Map iterates in insertion order.
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    if (!this.timer) {
      this.timer = setTimeout(() => this.saveNow(), this.saveDelayMs);
      this.timer.unref?.();
    }
  }

  /** Forgets everything (used when the user turns lookups off). */
  clear(): void {
    this.entries.clear();
    this.saveNow();
  }

  flush(): void {
    if (this.timer) this.saveNow();
  }

  private saveNow(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.cipher.isEncryptionAvailable()) return;
    try {
      const data = this.cipher
        .encryptString(JSON.stringify(Object.fromEntries(this.entries)))
        .toString("base64");
      writePrivateFile(this.filePath, JSON.stringify({ version: VERSION, data }));
    } catch (error) {
      console.error("[logo-cache] could not save:", error);
    }
  }

  private load(): void {
    if (!existsSync(this.filePath) || !this.cipher.isEncryptionAvailable()) return;
    try {
      const file = fileSchema.parse(JSON.parse(readFileSync(this.filePath, "utf8")));
      const payload = payloadSchema.parse(
        JSON.parse(this.cipher.decryptString(Buffer.from(file.data, "base64"))),
      );
      this.entries = new Map(Object.entries(payload));
    } catch (error) {
      console.error("[logo-cache] ignoring unreadable cache:", error);
      this.entries = new Map();
    }
  }
}

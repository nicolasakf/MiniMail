import { existsSync, readFileSync } from "node:fs";

import { z } from "zod";

import { MAX_TRUSTED_SENDERS, trustKey } from "@shared/trust";

import { writePrivateFile, type Cipher } from "./category-store";

const fileSchema = z.object({ version: z.literal(1), data: z.string() });
const listSchema = z.array(z.string());

/**
 * Sender addresses whose remote images load without asking. The list says who writes to the
 * user, so it is encrypted with the OS keychain like the mail cache; if encryption is
 * unavailable nothing is saved and adding fails visibly. A file that cannot be read is treated
 * as empty (images are then simply blocked again until re-trusted).
 */
export class TrustedSenders {
  private entries: string[] = [];

  constructor(
    private readonly filePath: string,
    private readonly cipher: Cipher,
  ) {
    this.load();
  }

  list(): string[] {
    return [...this.entries];
  }

  add(email: string): string[] {
    const key = trustKey(email);
    if (!key || this.entries.includes(key)) return this.list();
    const next = [...this.entries.filter((entry) => entry !== key), key].slice(-MAX_TRUSTED_SENDERS);
    this.save(next);
    return this.list();
  }

  remove(email: string): string[] {
    const key = trustKey(email);
    if (this.entries.includes(key)) this.save(this.entries.filter((entry) => entry !== key));
    return this.list();
  }

  private save(next: string[]): void {
    if (!this.cipher.isEncryptionAvailable()) {
      throw new Error("Secure storage is unavailable, so trusted senders cannot be saved.");
    }
    const data = this.cipher.encryptString(JSON.stringify(next)).toString("base64");
    writePrivateFile(this.filePath, JSON.stringify({ version: 1, data }));
    this.entries = next;
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const file = fileSchema.parse(JSON.parse(readFileSync(this.filePath, "utf8")));
      if (!this.cipher.isEncryptionAvailable()) return;
      const plain = this.cipher.decryptString(Buffer.from(file.data, "base64"));
      this.entries = listSchema.parse(JSON.parse(plain)).map(trustKey).slice(-MAX_TRUSTED_SENDERS);
    } catch (error) {
      console.error("[trusted-senders] could not read the list, starting empty:", error);
      this.entries = [];
    }
  }
}

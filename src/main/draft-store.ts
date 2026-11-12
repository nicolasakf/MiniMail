import { copyFileSync, existsSync, readFileSync } from "node:fs";

import { z } from "zod";

import { savedDraftSchema } from "@shared/schemas";
import { MAX_SAVED_DRAFTS, type SavedDraft } from "@shared/types";

import { writePrivateFile, type Cipher } from "./category-store";

const fileSchema = z.object({ version: z.literal(1), data: z.string() });

/** Newest first, as the Drafts folder lists them. */
const newestFirst = (a: SavedDraft, b: SavedDraft) => Date.parse(b.savedAt) - Date.parse(a.savedAt) || 0;

/**
 * Drafts the user put aside, kept in one file on this computer. They never reach a mail server.
 * The text is private, so the file is encrypted with the OS keychain like the mail cache. A draft
 * is written the moment it is saved (not after a delay), so closing the app right after cannot
 * lose it. When encryption is unavailable saving fails loudly instead of pretending to work, and
 * a file that cannot be read is copied aside rather than overwritten.
 */
export class DraftStore {
  private drafts: SavedDraft[] = [];

  constructor(
    private readonly filePath: string,
    private readonly cipher: Cipher,
  ) {
    this.load();
  }

  list(): SavedDraft[] {
    return [...this.drafts];
  }

  /** Saves (or replaces, by id) a draft and returns the new list. Throws if it could not be written. */
  save(draft: SavedDraft): SavedDraft[] {
    const next = [draft, ...this.drafts.filter((existing) => existing.id !== draft.id)]
      .sort(newestFirst)
      .slice(0, MAX_SAVED_DRAFTS);
    this.write(next);
    return this.list();
  }

  remove(id: string): SavedDraft[] {
    if (this.drafts.some((draft) => draft.id === id)) this.write(this.drafts.filter((draft) => draft.id !== id));
    return this.list();
  }

  private write(next: SavedDraft[]): void {
    if (!this.cipher.isEncryptionAvailable()) {
      throw new Error("Secure storage is unavailable, so drafts cannot be saved.");
    }
    const data = this.cipher.encryptString(JSON.stringify(next)).toString("base64");
    writePrivateFile(this.filePath, JSON.stringify({ version: 1, data }));
    this.drafts = next;
  }

  private load(): void {
    if (!existsSync(this.filePath) || !this.cipher.isEncryptionAvailable()) return;
    try {
      const file = fileSchema.parse(JSON.parse(readFileSync(this.filePath, "utf8")));
      const plain: unknown = JSON.parse(this.cipher.decryptString(Buffer.from(file.data, "base64")));
      // One damaged draft must not take the others with it.
      this.drafts = z
        .array(z.unknown())
        .parse(plain)
        .flatMap((item) => {
          const parsed = savedDraftSchema.safeParse(item);
          return parsed.success ? [parsed.data] : [];
        })
        .sort(newestFirst)
        .slice(0, MAX_SAVED_DRAFTS);
    } catch (error) {
      console.error("[drafts] could not read the drafts file, starting empty:", error);
      this.drafts = [];
      try {
        // The next save would replace the file; keep what was there so it can still be recovered.
        copyFileSync(this.filePath, `${this.filePath}.unreadable`);
      } catch {
        // Nothing more to do.
      }
    }
  }
}

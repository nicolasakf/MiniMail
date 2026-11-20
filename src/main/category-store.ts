import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import { z } from "zod";

import { DEFAULT_CATEGORIES, LEGACY_DEFAULT_IDS, defaultCategories, iconFor } from "@shared/categories";
import { AI_PROVIDERS, PROVIDER_LABELS, type AiProvider, type ProviderKeys } from "@shared/ai-providers";
import { categorySchema } from "@shared/schemas";
import type { Category } from "@shared/types";
import { reportError } from "./events";

/** The part of Electron's `safeStorage` this module needs, so it can be tested without Electron. */
export interface Cipher {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** Writes a file atomically so a crash never leaves half a JSON document behind. */
export function writePrivateFile(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, contents, { mode: 0o600 });
  renameSync(temp, path);
  chmodSync(path, 0o600);
}

/** The classifier's verdict for one conversation. */
export interface StoredClassification {
  /** Null means "none of these". */
  categoryId: string | null;
  probability: number;
  /** Epoch milliseconds, used to drop the oldest entries first. */
  at: number;
  /** Chosen by the user: sorting again never replaces it, and it is the last to be dropped. */
  manual?: boolean;
}

const MAX_CLASSIFICATIONS = 5000;
const SAVE_DELAY_MS = 800;

const fileSchema = z.object({
  version: z.literal(1),
  categories: z.array(categorySchema),
  /** Ids of the built-in categories already offered, so one the user deleted is not brought back. */
  offered: z.array(z.string()).optional(),
  classifications: z.record(
    z.string(),
    z.object({
      categoryId: z.string().nullable(),
      probability: z.number(),
      at: z.number(),
      manual: z.boolean().optional(),
    }),
  ),
});

/**
 * The user's categories and the classifier's answers for each conversation. Answers are keyed by
 * conversation (`accountId:threadId`), which is how a reply inherits the category of the thread
 * it belongs to instead of being classified again.
 */
export class CategoryStore {
  private list: Category[] = defaultCategories();
  private readonly results = new Map<string, StoredClassification>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly filePath: string) {
    this.load();
  }

  categories(): Category[] {
    return this.list.map((category) => ({ ...category }));
  }

  setCategories(categories: readonly Category[]): void {
    this.list = categories.map((category) => ({
      id: category.id,
      name: category.name.trim(),
      criteria: category.criteria.trim(),
      hue: category.hue,
      ...(category.icon ? { icon: category.icon } : {}),
    }));
    this.saveNow();
  }

  classification(key: string): StoredClassification | undefined {
    return this.results.get(key);
  }

  setClassification(key: string, value: StoredClassification): void {
    this.results.set(key, value);
    if (this.results.size > MAX_CLASSIFICATIONS) {
      // The user's own choices go last: they cannot be recomputed.
      const oldest = [...this.results.entries()]
        .sort((a, b) => Number(a[1].manual === true) - Number(b[1].manual === true) || a[1].at - b[1].at)
        .slice(0, this.results.size - MAX_CLASSIFICATIONS);
      for (const [oldKey] of oldest) this.results.delete(oldKey);
    }
    this.saveSoon();
  }

  /** Forgets the classifier's answers; what the user chose by hand stays. */
  clearClassifications(): void {
    for (const [key, value] of [...this.results]) {
      if (!value.manual) this.results.delete(key);
    }
    this.saveNow();
  }

  /** Forgets manual choices of categories that no longer exist, so those conversations are sorted again. */
  dropManualNotIn(categoryIds: ReadonlySet<string>): void {
    let changed = false;
    for (const [key, value] of [...this.results]) {
      if (value.manual && value.categoryId !== null && !categoryIds.has(value.categoryId)) {
        this.results.delete(key);
        changed = true;
      }
    }
    if (changed) this.saveNow();
  }

  /** How many conversations are filed under a category that is not in `categoryIds`. */
  countNotIn(categoryIds: ReadonlySet<string>): number {
    let count = 0;
    for (const value of this.results.values()) {
      if (value.categoryId !== null && !categoryIds.has(value.categoryId)) count += 1;
    }
    return count;
  }

  /**
   * Files every conversation whose category is not in `categoryIds` (it was deleted) under none.
   * Hand-filed ones stay hand-filed. Returns how many moved.
   */
  moveNotInToNone(categoryIds: ReadonlySet<string>, at: number): number {
    let moved = 0;
    for (const [key, value] of [...this.results]) {
      if (value.categoryId === null || categoryIds.has(value.categoryId)) continue;
      this.results.set(key, { ...value, categoryId: null, at });
      moved += 1;
    }
    if (moved > 0) this.saveNow();
    return moved;
  }

  /** Writes pending changes now; called on quit. */
  flush(): void {
    if (this.timer) this.saveNow();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const parsed = fileSchema.parse(JSON.parse(readFileSync(this.filePath, "utf8")));
      this.list = parsed.categories.map((category) => {
        const icon = iconFor(category);
        return icon ? { ...category, icon } : category;
      });
      // Built-in categories added since this file was written appear once; deleting one sticks.
      // One the user already made under the same name is left alone: two with a name is an error.
      const offered = new Set(parsed.offered ?? LEGACY_DEFAULT_IDS);
      const taken = (category: Category) =>
        this.list.some(
          (existing) => existing.id === category.id || existing.name.trim().toLowerCase() === category.name.toLowerCase(),
        );
      const added = DEFAULT_CATEGORIES.filter((category) => !offered.has(category.id) && !taken(category));
      const migrate = added.length > 0 || parsed.offered === undefined;
      this.list = [...this.list, ...added.map((category) => ({ ...category }))];
      for (const [key, value] of Object.entries(parsed.classifications)) {
        this.results.set(key, value);
      }
      if (migrate) this.saveNow();
    } catch (error) {
      // A corrupt file must not stop the app; the defaults come back and mail is re-sorted.
      reportError("storage", "Could not read the categories; using the defaults and sorting again", error);
    }
  }

  private saveSoon(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => this.saveNow(), SAVE_DELAY_MS);
  }

  private saveNow(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const payload = {
      version: 1 as const,
      categories: this.list,
      offered: DEFAULT_CATEGORIES.map((category) => category.id),
      classifications: Object.fromEntries(this.results),
    };
    try {
      writePrivateFile(this.filePath, JSON.stringify(payload));
    } catch (error) {
      reportError("storage", "Could not save the categories", error);
    }
  }
}

/** Version 1 held one Vercel AI Gateway key; version 2 holds one key per provider. */
const keyFileSchema = z.discriminatedUnion("version", [
  z.object({ version: z.literal(1), key: z.string() }),
  z.object({ version: z.literal(2), keys: z.record(z.string(), z.string()) }),
]);

/**
 * The AI provider keys (Vercel AI Gateway, OpenRouter, TypeSafe), each encrypted with the OS keychain
 * like account passwords. If encryption is unavailable a key is refused rather than stored in plain
 * text. A file written before providers existed holds the one Vercel key; it is read as such and is
 * written in the new format the next time a key changes.
 */
export class AiKeyStore {
  private values: Partial<Record<AiProvider, string>> = {};

  constructor(
    private readonly filePath: string,
    private readonly cipher: Cipher,
  ) {
    this.load();
  }

  get(provider: AiProvider): string | undefined {
    return this.values[provider];
  }

  /** Which providers have a key saved. */
  saved(): ProviderKeys {
    return Object.fromEntries(AI_PROVIDERS.map((provider) => [provider, Boolean(this.values[provider])])) as ProviderKeys;
  }

  /** Whether any provider has a key. */
  any(): boolean {
    return AI_PROVIDERS.some((provider) => Boolean(this.values[provider]));
  }

  set(provider: AiProvider, key: string): void {
    if (!this.cipher.isEncryptionAvailable()) {
      throw new Error("Secure storage is unavailable, so the key cannot be saved.");
    }
    this.write({ ...this.values, [provider]: key });
  }

  clear(provider: AiProvider): void {
    const next = { ...this.values };
    delete next[provider];
    this.write(next);
  }

  private write(values: Partial<Record<AiProvider, string>>): void {
    const keys: Record<string, string> = {};
    for (const provider of AI_PROVIDERS) {
      const value = values[provider];
      if (value) keys[provider] = this.cipher.encryptString(value).toString("base64");
    }
    writePrivateFile(this.filePath, JSON.stringify({ version: 2, keys }));
    this.values = values;
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    let encrypted: Record<string, string>;
    try {
      const parsed = keyFileSchema.parse(JSON.parse(readFileSync(this.filePath, "utf8")));
      encrypted = parsed.version === 1 ? (parsed.key ? { vercel: parsed.key } : {}) : parsed.keys;
    } catch (error) {
      reportError("storage", "Could not read the saved AI keys", error);
      return;
    }
    for (const provider of AI_PROVIDERS) {
      const value = encrypted[provider];
      if (!value) continue;
      try {
        this.values[provider] = this.cipher.decryptString(Buffer.from(value, "base64"));
      } catch (error) {
        reportError("storage", `Could not read the saved ${PROVIDER_LABELS[provider]} key`, error);
      }
    }
  }
}

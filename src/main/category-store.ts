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
import { categorySchema } from "@shared/schemas";
import type { Category } from "@shared/types";

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
    z.object({ categoryId: z.string().nullable(), probability: z.number(), at: z.number() }),
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
      const oldest = [...this.results.entries()]
        .sort((a, b) => a[1].at - b[1].at)
        .slice(0, this.results.size - MAX_CLASSIFICATIONS);
      for (const [oldKey] of oldest) this.results.delete(oldKey);
    }
    this.saveSoon();
  }

  clearClassifications(): void {
    this.results.clear();
    this.saveNow();
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
      const offered = new Set(parsed.offered ?? LEGACY_DEFAULT_IDS);
      const added = DEFAULT_CATEGORIES.filter(
        (category) => !offered.has(category.id) && !this.list.some((existing) => existing.id === category.id),
      );
      const migrate = added.length > 0 || parsed.offered === undefined;
      this.list = [...this.list, ...added.map((category) => ({ ...category }))];
      for (const [key, value] of Object.entries(parsed.classifications)) {
        this.results.set(key, value);
      }
      if (migrate) this.saveNow();
    } catch (error) {
      // A corrupt file must not stop the app; the defaults come back and mail is re-sorted.
      console.error("[categories] could not read categories, using defaults:", error);
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
      console.error("[categories] could not save:", error);
    }
  }
}

const keyFileSchema = z.object({ version: z.literal(1), key: z.string() });

/**
 * The Vercel AI Gateway key, encrypted with the OS keychain like account passwords. If
 * encryption is unavailable the key is refused rather than stored in plain text.
 */
export class GatewayKeyStore {
  private value: string | undefined;

  constructor(
    private readonly filePath: string,
    private readonly cipher: Cipher,
  ) {
    this.load();
  }

  get(): string | undefined {
    return this.value;
  }

  set(key: string): void {
    if (!this.cipher.isEncryptionAvailable()) {
      throw new Error("Secure storage is unavailable, so the key cannot be saved.");
    }
    const encrypted = this.cipher.encryptString(key).toString("base64");
    writePrivateFile(this.filePath, JSON.stringify({ version: 1, key: encrypted }));
    this.value = key;
  }

  clear(): void {
    this.value = undefined;
    writePrivateFile(this.filePath, JSON.stringify({ version: 1, key: "" }));
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const parsed = keyFileSchema.parse(JSON.parse(readFileSync(this.filePath, "utf8")));
      if (!parsed.key) return;
      this.value = this.cipher.decryptString(Buffer.from(parsed.key, "base64"));
    } catch (error) {
      console.error("[categories] could not read the gateway key:", error);
      this.value = undefined;
    }
  }
}

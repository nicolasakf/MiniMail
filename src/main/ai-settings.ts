import { existsSync, readFileSync } from "node:fs";

import { z } from "zod";

import { sortFoldersSchema } from "@shared/schemas";
import type { SortFolder } from "@shared/types";
import { DEFAULT_CODE_MODEL } from "@shared/verification-code";

import { writePrivateFile } from "./category-store";

const DEFAULT_SORT_FOLDERS: SortFolder[] = ["inbox"];

/** Each choice is checked on its own, so one bad value does not reset the other. */
const fileSchema = z.object({
  version: z.literal(1),
  codeModel: z.string().catch(DEFAULT_CODE_MODEL),
  sortFolders: sortFoldersSchema.catch([...DEFAULT_SORT_FOLDERS]),
});

/**
 * Choices about the AI features that are not secrets (the key lives in `GatewayKeyStore`).
 * `codeModel` is the gateway model that reads verification codes the local rules could not;
 * an empty string is a deliberate "rules only" and is kept as such. `sortFolders` are the
 * folders whose newly arrived mail is sorted into categories automatically.
 */
export class AiSettingsStore {
  private model = DEFAULT_CODE_MODEL;
  private folders: SortFolder[] = [...DEFAULT_SORT_FOLDERS];

  constructor(private readonly filePath: string) {
    if (!existsSync(filePath)) return;
    try {
      const saved = fileSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
      this.model = saved.codeModel;
      this.folders = saved.sortFolders;
    } catch (error) {
      console.error("[ai-settings] using defaults:", error);
    }
  }

  codeModel(): string {
    return this.model;
  }

  sortFolders(): SortFolder[] {
    return [...this.folders];
  }

  setCodeModel(model: string): string {
    this.model = model.trim();
    this.write();
    return this.model;
  }

  setSortFolders(folders: SortFolder[]): SortFolder[] {
    this.folders = sortFoldersSchema.parse(folders);
    this.write();
    return this.sortFolders();
  }

  private write(): void {
    writePrivateFile(
      this.filePath,
      JSON.stringify({ version: 1, codeModel: this.model, sortFolders: this.folders }),
    );
  }
}

import { existsSync, readFileSync } from "node:fs";

import { z } from "zod";

import { DEFAULT_SORT_MODEL, SORT_MODEL_PATTERN } from "@shared/ai-models";
import { sortFoldersSchema } from "@shared/schemas";
import type { SortFolder } from "@shared/types";
import { DEFAULT_CODE_MODEL } from "@shared/verification-code";

import { writePrivateFile } from "./category-store";
import { reportError } from "./events";

const DEFAULT_SORT_FOLDERS: SortFolder[] = ["inbox"];

/**
 * Each choice is checked on its own, so one bad value does not reset the others.
 * Version 1 had no `sortModel`: it was always Jev, which is what a missing value becomes.
 */
const fileSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  codeModel: z.string().catch(DEFAULT_CODE_MODEL),
  sortModel: z
    .string()
    .regex(SORT_MODEL_PATTERN)
    .catch(DEFAULT_SORT_MODEL),
  sortFolders: sortFoldersSchema.catch([...DEFAULT_SORT_FOLDERS]),
});

/**
 * Choices about the AI features that are not secrets (the key lives in `GatewayKeyStore`).
 * `codeModel` is the gateway model for the AI-enabled features (it reads verification codes the
 * local rules could not); an empty string is a deliberate "rules only" and is kept as such.
 * `sortModel` is the model that sorts mail into categories. `sortFolders` are the folders whose
 * newly arrived mail is sorted into categories automatically.
 */
export class AiSettingsStore {
  private model = DEFAULT_CODE_MODEL;
  private sorter = DEFAULT_SORT_MODEL;
  private folders: SortFolder[] = [...DEFAULT_SORT_FOLDERS];

  constructor(private readonly filePath: string) {
    if (!existsSync(filePath)) return;
    try {
      const saved = fileSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
      this.model = saved.codeModel;
      this.sorter = saved.sortModel;
      this.folders = saved.sortFolders;
    } catch (error) {
      reportError("storage", "Could not read the AI settings; using defaults", error);
    }
  }

  codeModel(): string {
    return this.model;
  }

  sortModel(): string {
    return this.sorter;
  }

  sortFolders(): SortFolder[] {
    return [...this.folders];
  }

  setCodeModel(model: string): string {
    this.model = model.trim();
    this.write();
    return this.model;
  }

  setSortModel(model: string): string {
    this.sorter = model.trim();
    this.write();
    return this.sorter;
  }

  setSortFolders(folders: SortFolder[]): SortFolder[] {
    this.folders = sortFoldersSchema.parse(folders);
    this.write();
    return this.sortFolders();
  }

  private write(): void {
    writePrivateFile(
      this.filePath,
      JSON.stringify({ version: 2, codeModel: this.model, sortModel: this.sorter, sortFolders: this.folders }),
    );
  }
}

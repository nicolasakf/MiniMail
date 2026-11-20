import { existsSync, readFileSync } from "node:fs";

import { z } from "zod";

import { SORT_MODEL_PATTERN } from "@shared/ai-models";
import {
  AI_PROVIDERS,
  CHAT_PROVIDERS,
  DEFAULT_CODE_MODELS,
  DEFAULT_PROVIDER,
  DEFAULT_SORT_MODELS,
  type AiProvider,
  type ChatProvider,
} from "@shared/ai-providers";
import { sortFoldersSchema } from "@shared/schemas";
import { SORT_FOLDERS, type SortFolder } from "@shared/types";

import { writePrivateFile } from "./category-store";
import { reportError } from "./events";

/** A fresh install sorts mail in every folder. */
const DEFAULT_SORT_FOLDERS: SortFolder[] = [...SORT_FOLDERS];

/** Until the default changed, only the Inbox was sorted, so that is what a saved file without a choice means. */
const LEGACY_SORT_FOLDERS: SortFolder[] = ["inbox"];

/**
 * Each choice is checked on its own, so one bad value does not reset the others.
 * Version 1 had no `sortModel`: it was always Jev, which is what a missing value becomes.
 * Versions 1 and 2 had no providers: everything ran through the Vercel AI Gateway, which is what a
 * missing provider becomes, so the models saved then keep working.
 */
const fileSchema = z.object({
  version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  sortProvider: z.enum(AI_PROVIDERS).catch(DEFAULT_PROVIDER),
  codeProvider: z.enum(CHAT_PROVIDERS).catch("vercel"),
  codeModel: z.string().catch(DEFAULT_CODE_MODELS.vercel),
  sortModel: z
    .string()
    .regex(SORT_MODEL_PATTERN)
    .catch(DEFAULT_SORT_MODELS.vercel),
  sortFolders: sortFoldersSchema.catch([...LEGACY_SORT_FOLDERS]),
});

/**
 * Choices about the AI features that are not secrets (the keys live in `AiKeyStore`).
 * `sortProvider` and `codeProvider` say where each job runs, and each model id belongs to its provider:
 * choosing another provider puts that provider's default model in its place.
 * `codeModel` is the model for the AI-enabled features (it reads verification codes the
 * local rules could not); an empty string is a deliberate "rules only" and is kept as such.
 * `sortModel` is the model that sorts mail into categories. `sortFolders` are the folders whose
 * newly arrived mail is sorted into categories automatically: all four on a fresh install. An
 * install that already used AI sorting before that default changed keeps sorting only the Inbox
 * until the person chooses otherwise, so nothing starts costing more calls on its own.
 */
export class AiSettingsStore {
  private sortHost: AiProvider = DEFAULT_PROVIDER;
  private codeHost: ChatProvider = "vercel";
  private model = DEFAULT_CODE_MODELS.vercel;
  private sorter = DEFAULT_SORT_MODELS.vercel;
  private folders: SortFolder[] = [...DEFAULT_SORT_FOLDERS];

  /**
   * `keyAlreadySet` is whether any key was saved when this runs: with a key but no settings file,
   * the install has been sorting the Inbox only, so that choice is written down now (it is the one
   * thing that cannot be read from the file, because there is none).
   */
  constructor(
    private readonly filePath: string,
    options: { keyAlreadySet?: boolean } = {},
  ) {
    if (!existsSync(filePath)) {
      if (options.keyAlreadySet) {
        this.folders = [...LEGACY_SORT_FOLDERS];
        this.write();
      }
      return;
    }
    try {
      const saved = fileSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
      this.sortHost = saved.sortProvider;
      this.codeHost = saved.codeProvider;
      this.model = saved.codeModel;
      this.sorter = saved.sortModel;
      this.folders = saved.sortFolders;
    } catch (error) {
      reportError("storage", "Could not read the AI settings; using defaults", error);
    }
  }

  sortProvider(): AiProvider {
    return this.sortHost;
  }

  codeProvider(): ChatProvider {
    return this.codeHost;
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

  /** Sorts mail through `provider`; the sorting model becomes that provider's default unless it stays the same. */
  setSortProvider(provider: AiProvider): AiProvider {
    if (provider !== this.sortHost) {
      this.sortHost = provider;
      this.sorter = DEFAULT_SORT_MODELS[provider];
      this.write();
    }
    return this.sortHost;
  }

  /** Runs the AI-enabled features through `provider`; their model becomes that provider's default unless it stays the same. */
  setCodeProvider(provider: ChatProvider): ChatProvider {
    if (provider !== this.codeHost) {
      this.codeHost = provider;
      // An empty model is a deliberate "rules only" and stays so.
      if (this.model !== "") this.model = DEFAULT_CODE_MODELS[provider];
      this.write();
    }
    return this.codeHost;
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
      JSON.stringify({
        version: 3,
        sortProvider: this.sortHost,
        codeProvider: this.codeHost,
        codeModel: this.model,
        sortModel: this.sorter,
        sortFolders: this.folders,
      }),
    );
  }
}

import { existsSync, readFileSync } from "node:fs";

import { z } from "zod";

import { shownFoldersSchema } from "@shared/schemas";
import type { UiPrefs } from "@shared/types";

import { writePrivateFile } from "./category-store";
import { reportError } from "./events";

const DEFAULTS: UiPrefs = { view: "category", unreadOnly: false, shownFolders: ["inbox"], pinnedDrafts: [] };

/** Each choice is checked on its own, so one bad value does not reset the others. */
const fileSchema = z.object({
  version: z.literal(1),
  view: z.enum(["category", "sender", "list"]).catch(DEFAULTS.view),
  unreadOnly: z.boolean().catch(DEFAULTS.unreadOnly),
  shownFolders: shownFoldersSchema.catch([...DEFAULTS.shownFolders]),
  pinnedDrafts: z.array(z.string().min(1).max(2048)).max(500).catch([]),
});

/**
 * Choices the app reopens with: the selected view tab and the list filters (unread only, and
 * which of Inbox, Archive, Trash and Spam mail shows in the Inbox list), and which drafts are pinned. Holds no mail data, so it is a plain
 * file, written the moment a choice changes.
 */
export class UiPrefsStore {
  private prefs: UiPrefs = { ...DEFAULTS, shownFolders: [...DEFAULTS.shownFolders], pinnedDrafts: [] };

  constructor(private readonly filePath: string) {
    if (!existsSync(filePath)) return;
    try {
      const { version: _version, ...saved } = fileSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
      this.prefs = saved;
    } catch (error) {
      reportError("storage", "Could not read the saved view; using defaults", error);
    }
  }

  get(): UiPrefs {
    return { ...this.prefs, shownFolders: [...this.prefs.shownFolders], pinnedDrafts: [...this.prefs.pinnedDrafts] };
  }

  set(patch: Partial<UiPrefs>): void {
    this.prefs = { ...this.prefs, ...patch };
    writePrivateFile(this.filePath, JSON.stringify({ version: 1, ...this.prefs }));
  }
}

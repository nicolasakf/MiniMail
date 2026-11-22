import { z } from "zod";

import { shownFoldersSchema } from "@shared/schemas";
import type { UiPrefs } from "@shared/types";

import { reportError } from "./events";
import type { SettingsSection } from "./settings-file";

const DEFAULTS: UiPrefs = { view: "category", unreadOnly: false, shownFolders: ["inbox"], pinnedDrafts: [], onboarded: null };

/** Each choice is checked on its own, so one bad value does not reset the others. */
const fileSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  view: z.enum(["category", "sender", "list"]).catch(DEFAULTS.view),
  unreadOnly: z.boolean().catch(DEFAULTS.unreadOnly),
  shownFolders: shownFoldersSchema.catch([...DEFAULTS.shownFolders]),
  pinnedDrafts: z.array(z.string().min(1).max(2048)).max(500).catch([]),
  /** Added in version 2. */
  onboarded: z.boolean().nullable().catch(null),
});

/**
 * Choices the app reopens with: the selected view tab and the list filters (unread only, and
 * which of Inbox, Archive, Trash and Spam mail shows in the Inbox list), and which drafts are pinned. Holds no mail data, so it is a plain
 * section of `settings.json`, written the moment a choice changes.
 */
export class UiPrefsStore {
  private prefs: UiPrefs = { ...DEFAULTS, shownFolders: [...DEFAULTS.shownFolders], pinnedDrafts: [] };

  constructor(private readonly section: SettingsSection) {
    const raw = section.read();
    if (raw === undefined) return;
    try {
      const { version, ...saved } = fileSchema.parse(raw);
      // v1 to v2: a version 1 file was written by someone who already used the app, so the setup guide is not for them.
      this.prefs = version === 1 ? { ...saved, onboarded: true } : saved;
    } catch (error) {
      reportError("storage", "Could not read the saved view; using defaults", error);
    }
  }

  get(): UiPrefs {
    return { ...this.prefs, shownFolders: [...this.prefs.shownFolders], pinnedDrafts: [...this.prefs.pinnedDrafts] };
  }

  set(patch: Partial<UiPrefs>): void {
    this.prefs = { ...this.prefs, ...patch };
    this.section.write({ version: 2, ...this.prefs });
  }
}

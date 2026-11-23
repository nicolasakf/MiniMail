import { z } from "zod";

import { mergeLegacyPrefs, defaultUiPrefs, parseAppearanceValues, parseColorMode, parseStringList, MAX_MINIMIZED_CATEGORIES, MAX_PINNED_DOMAINS, type LegacyPrefs } from "@shared/prefs";
import { parseBlockList } from "@shared/blocklist";
import { parsePriorityList } from "@shared/priority";
import { shownFoldersSchema } from "@shared/schemas";
import type { UiPrefs } from "@shared/types";
import { parseUnsubscribedLists } from "@shared/unsubscribe";

import { reportError } from "./events";
import type { SettingsSection } from "./settings-file";

const VERSION = 3;

const DEFAULTS = defaultUiPrefs();

/** Each choice is checked on its own, so one bad value does not reset the others. */
const fileSchema = z.object({
  version: z.number().int().min(1),
  view: z.enum(["category", "sender", "list"]).catch(DEFAULTS.view),
  unreadOnly: z.boolean().catch(DEFAULTS.unreadOnly),
  shownFolders: shownFoldersSchema.catch([...DEFAULTS.shownFolders]),
  pinnedDrafts: z.array(z.string().min(1).max(2048)).max(500).catch([]),
  /** Added in version 2. */
  onboarded: z.boolean().nullable().catch(null),
  /**
   * Added in version 3: what the page used to keep in its own storage (see `importLegacy`). A file of version 1
   * or 2 has none of them, which is why each is optional before it is read: the read functions turn "missing" and
   * "not valid" alike into an empty value.
   */
  appearance: z.unknown().optional().transform(parseAppearanceValues),
  theme: z.unknown().optional().transform(parseColorMode),
  blocklist: z.unknown().optional().transform(parseBlockList),
  priority: z.unknown().optional().transform(parsePriorityList),
  unsubscribed: z.unknown().optional().transform(parseUnsubscribedLists),
  pinnedDomains: z.unknown().optional().transform((value) => parseStringList(value, MAX_PINNED_DOMAINS)),
  minimizedCategories: z.unknown().optional().transform((value) => parseStringList(value, MAX_MINIMIZED_CATEGORIES)),
});

/**
 * Choices the app reopens with: the selected view tab and the list filters, which drafts are
 * pinned, and what the Appearance page, the Block, Priority, Pin and Unsubscribe commands and the
 * category dock remember. Holds no mail data, so it is a plain section of `settings.json`,
 * written the moment a choice changes.
 *
 * Version 3 added the choices the page used to keep in its own storage (`localStorage`, kept
 * per address the page is loaded from). They cannot be read from here, so the page sends them once
 * through `importLegacy`; a file of version 1 or 2 simply has them empty until then.
 */
export class UiPrefsStore {
  private prefs: UiPrefs = defaultUiPrefs();
  private newer: number | null = null;

  constructor(private readonly section: SettingsSection) {
    const raw = section.read();
    if (raw === undefined) return;
    try {
      const { version, ...saved } = fileSchema.parse(raw);
      if (version > VERSION) {
        // A file of a newer app is left as it is: its choices cannot be read here, and a change would overwrite them.
        this.newer = version;
        reportError("storage", "The saved view was written by a newer version of MiniMail; it is left untouched");
        return;
      }
      // v1 to v2: a version 1 file was written by someone who already used the app, so the setup guide is not for them.
      this.prefs = version === 1 ? { ...saved, onboarded: true } : saved;
    } catch (error) {
      reportError("storage", "Could not read the saved view; using defaults", error);
    }
  }

  get(): UiPrefs {
    return structuredClone(this.prefs);
  }

  set(patch: Partial<UiPrefs>): void {
    this.save({ ...this.prefs, ...patch });
  }

  /** Adds what the page found in its own storage to the saved choices and answers with all of them. */
  importLegacy(legacy: LegacyPrefs): UiPrefs {
    this.save(mergeLegacyPrefs(this.prefs, legacy));
    return this.get();
  }

  private save(next: UiPrefs): void {
    if (this.newer !== null) throw new Error("The saved view was written by a newer version of MiniMail, so this change was not saved");
    this.section.write({ version: VERSION, ...next });
    this.prefs = next;
  }
}

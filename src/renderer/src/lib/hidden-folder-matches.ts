import { dropFolderDuplicates } from "@shared/dashboard";
import { isEmptySearch, matchesSearch, parseSearch, type SearchLookups } from "@shared/search-query";
import { groupThreads } from "@shared/threads";
import type { MessageSummary, ShownFolder } from "@shared/types";

/** Conversations matching a search, by folder, for the folders the list is not showing. */
export type HiddenFolderMatches = Partial<Record<ShownFolder, number>>;

/**
 * How many conversations of each folder that is switched off match the search. Only folders with
 * at least one match appear in the answer. `rows` is what each folder holds, in the order the list
 * shows them: a message the Inbox also holds (Gmail's All Mail) counts for the Inbox only, as in the list.
 */
export function hiddenFolderMatches(
  rows: readonly MessageSummary[],
  shown: readonly ShownFolder[],
  query: string,
  lookups: SearchLookups,
  unreadOnly: boolean,
): HiddenFolderMatches {
  const search = parseSearch(query);
  if (isEmptySearch(search)) return {};
  const matches = dropFolderDuplicates(rows).filter(
    (message) =>
      !message.sorting &&
      !shown.includes(message.folder as ShownFolder) &&
      matchesSearch(message, search, lookups),
  );
  const found: HiddenFolderMatches = {};
  const folders = new Set(matches.map((message) => message.folder as ShownFolder));
  for (const folder of folders) {
    const threads = groupThreads(matches.filter((message) => message.folder === folder));
    const count = unreadOnly ? threads.filter((thread) => thread.unread).length : threads.length;
    if (count > 0) found[folder] = count;
  }
  return found;
}

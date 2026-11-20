import { useEffect, useMemo, useState } from "react";

import { MAIL_WINDOW } from "@shared/mail-window";
import { isEmptySearch, parseSearch, type SearchLookups } from "@shared/search-query";
import type { MessageSummary, ShownFolder } from "@shared/types";

import { api } from "@/lib/api";
import { hiddenFolderMatches, type HiddenFolderMatches } from "@/lib/hidden-folder-matches";

/** How long the box rests before the folders are counted, so typing does not read every folder per key. */
const TYPING_PAUSE_MS = 200;

/** Every folder the list can show, Inbox first: the order a duplicate is kept in (see `dropFolderDuplicates`). */
const FOLDERS: readonly ShownFolder[] = ["inbox", "archive", "trash", "spam"];

const NONE: HiddenFolderMatches = {};

/**
 * How many conversations match the search in each folder the list is not showing, so the folder
 * buttons can say where more results are. Reads the copy saved on disk (no network), so a folder
 * never opened here counts nothing until it has been. Does nothing while the search is empty, and
 * counts again when the main process reports changed mail.
 */
export function useHiddenFolderMatches({
  enabled,
  query,
  shown,
  accountIds,
  lookups,
  unreadOnly,
}: {
  /** Whether the list can show these folders at all (the Inbox list). */
  enabled: boolean;
  query: string;
  shown: readonly ShownFolder[];
  /** The accounts the list is for; empty means all of them. */
  accountIds: readonly string[];
  lookups: SearchLookups;
  unreadOnly: boolean;
}): HiddenFolderMatches {
  const [rows, setRows] = useState<MessageSummary[]>([]);
  const searching = enabled && !isEmptySearch(parseSearch(query));
  const everythingShown = FOLDERS.every((folder) => shown.includes(folder));
  const accountKey = accountIds.join(",");
  // Text that changes the folders' rows is the account scope; the query only changes what counts.
  const [pausedQuery, setPausedQuery] = useState(query);

  useEffect(() => {
    const timer = setTimeout(() => setPausedQuery(query), TYPING_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!searching || everythingShown) {
      setRows([]);
      return undefined;
    }
    let cancelled = false;
    let ticket = 0;
    const load = async () => {
      const current = ++ticket;
      const results = await Promise.all(
        FOLDERS.map((folder) =>
          api.mail
            .list({ folder, accountIds: accountKey === "" ? [] : accountKey.split(","), limit: MAIL_WINDOW, cacheOnly: true })
            .then((result) => result.messages)
            // expected: the failed request was recorded by the main process; the folder just shows no count.
            .catch((): MessageSummary[] => []),
        ),
      );
      if (!cancelled && current === ticket) setRows(results.flat());
    };
    void load();
    const stopListening = api.mail.onChanged(() => void load());
    return () => {
      cancelled = true;
      stopListening();
    };
  }, [searching, everythingShown, accountKey]);

  const shownKey = shown.join(",");
  return useMemo(
    () =>
      searching && !everythingShown
        ? hiddenFolderMatches(rows, shownKey === "" ? [] : (shownKey.split(",") as ShownFolder[]), pausedQuery, lookups, unreadOnly)
        : NONE,
    [rows, searching, everythingShown, shownKey, pausedQuery, lookups, unreadOnly],
  );
}

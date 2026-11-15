import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { toast } from "sonner";

import { FIRST_PAGE, MAIL_WINDOW } from "@shared/mail-window";
import { dropFolderDuplicates } from "@shared/dashboard";
import { groupThreads, type Thread } from "@shared/threads";
import type {
  Account,
  AccountError,
  MailAction,
  MailFolder,
  MessageSummary,
  ShownFolder,
} from "@shared/types";

import { api } from "@/lib/api";
import { groupByAccount, mergeAccountRows, mergeErrors } from "@/lib/merge";
import { applyCategory } from "@/lib/optimistic";
import { MailActions } from "@/lib/mail-actions";

/** Every folder whose mail the Inbox list can show, in display order. */
export const SHOWN_FOLDERS: readonly ShownFolder[] = ["inbox", "archive", "trash", "spam"];

/** "all" means every account; otherwise an account id. */
export type AccountScope = "all" | string;

const UNDOABLE: Partial<Record<MailAction, string>> = {
  archive: "archived",
  trash: "moved to Trash",
  spam: "reported as spam",
};

const TAKEOVER_AFTER_MS = 15_000;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** True when a message matches every word of the search query. */
export function matchesQuery(message: MessageSummary, words: string[]): boolean {
  const haystack = [
    message.subject,
    message.from.name,
    message.from.email,
    message.snippet,
    ...message.to.map((contact) => `${contact.name} ${contact.email}`),
  ]
    .join(" ")
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/**
 * Loads accounts and the messages for the current folder/account scope, keeps them
 * fresh, and exposes actions that update the list optimistically.
 */
export function useMailbox(shownFolders: readonly ShownFolder[] = ["inbox"]) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [scope, setScope] = useState<AccountScope>("all");
  const [folder, setFolder] = useState<MailFolder>("inbox");
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<AccountError[]>([]);
  const [query, setQuery] = useState("");
  const [actionVersion, redrawActions] = useState(0);
  const actionChanged = useRef<() => void>(() => undefined);
  const refreshAfterAction = useRef<() => void>(() => undefined);
  const [actions] = useState(() => new MailActions(
    api.mail.act,
    () => redrawActions((version) => version + 1),
    () => {
      refreshAfterAction.current();
      actionChanged.current();
    },
  ));
  const ticket = useRef(0);
  const snapshots = useRef(new Map<string, number>());
  /** The Inbox list's folders besides the inbox; read at refresh time. */
  const extraRef = useRef<readonly MailFolder[]>([]);
  extraRef.current = shownFolders.filter((name) => name !== "inbox");
  const extraKey = [...extraRef.current].sort().join(",");
  const shownKey = [...shownFolders].sort().join(",");
  /** The folders the list on screen is made of: the Inbox adds the ones the user turned on. */
  const foldersOf = (current: MailFolder): MailFolder[] =>
    current === "inbox" ? ["inbox", ...extraRef.current] : [current];
  /** When the running refresh of the current view started (ms), or null when none is running. */
  const runningSince = useRef<number | null>(null);
  /** A background refresh asked for while another was running; it runs right after. */
  const rerun = useRef(false);

  const loadAccounts = useCallback(async (): Promise<Account[]> => {
    const list = await api.accounts.list();
    setAccounts(list);
    setAccountsLoaded(true);
    return list;
  }, []);

  useEffect(() => {
    loadAccounts().catch((error: unknown) => toast.error(errorText(error)));
  }, [loadAccounts]);

  // A removed account must not leave the view pointing at nothing.
  useEffect(() => {
    if (scope !== "all" && accountsLoaded && !accounts.some((account) => account.id === scope)) {
      setScope("all");
    }
  }, [accounts, accountsLoaded, scope]);

  const accountCount = accounts.length;
  // Read at refresh time so renaming an account does not restart the list; only adding or
  // removing one does (through accountCount).
  const accountIds = useRef<string[]>([]);
  accountIds.current = accounts.map((account) => account.id);
  const accountLabels = useRef(new Map<string, string>());
  accountLabels.current = new Map(accounts.map((account) => [account.id, account.email]));

  const refresh = useCallback(
    /**
     * `reload` is the refresh button: the rows on screen stay as they are until the servers answer
     * (no replay of the older copy on disk), and `loading` is on while it runs.
     */
    async (silent = false, reload = false): Promise<void> => {
      // A background refresh (poll, window focus, new classifications) does not interrupt one
      // that just started: it runs when that one ends. Otherwise the focus event that fires as
      // the window opens would throw away the first paint of the list. A refresh that has been
      // running a long time (a hung server) is taken over so updates never stall behind it.
      const running = runningSince.current;
      if (silent && running !== null && performance.now() - running < TAKEOVER_AFTER_MS) {
        rerun.current = true;
        return;
      }
      const current = ++ticket.current;
      rerun.current = false;
      if (accountCount === 0) {
        runningSince.current = null;
        setMessages([]);
        setErrors([]);
        setLoading(false);
        return;
      }
      runningSince.current = performance.now();
      if (reload || (!silent && messagesRef.current.length === 0)) setLoading(true);

      const targets = scope === "all" ? [...accountIds.current] : [scope];
      const verification = actions.verification();
      const requestedAccounts = [...new Set([...targets, ...verification.keys()])]
        .filter((id) => accountIds.current.includes(id));
      const started = performance.now();
      const live = new Map<string, MessageSummary[]>();
      const fromDisk = new Map<string, MessageSummary[]>();
      const answered = new Map<string, AccountError[]>();
      const stale = () => current !== ticket.current;
      const folders = foldersOf(folder);
      const perf = (what: string) => {
        if (import.meta.env.DEV) {
          console.log(`[perf] list ${folder} ${what} (${Math.round(performance.now() - started)}ms)`);
        }
      };

      // A fresh view (first launch, folder or account switch) starts from the copy saved on disk,
      // so rows appear at once instead of after the slowest server answers.
      // It also tells which accounts have never listed this folder here (no copy yet).
      const diskCopy: Promise<ReadonlySet<string> | null> = silent || reload
        ? Promise.resolve(null)
        : Promise.all(
            folders.map((name) =>
              api.mail.list({ folder: name, accountIds: targets, limit: MAIL_WINDOW, cacheOnly: true }),
            ),
          )
            .then((results) => {
              const rows = results.flatMap((result) => result.messages);
              // Only the primary folder says which accounts have never listed this view here.
              const withCopy = new Set(results[0].messages.map((message) => message.accountId));
              if (stale() || rows.length === 0) return withCopy;
              for (const [id, accountRows] of groupByAccount(rows)) {
                if (!live.has(id)) fromDisk.set(id, accountRows);
              }
              setMessages((onScreen) => mergeAccountRows(targets, [live, fromDisk], onScreen));
              setLoading(false);
              perf(`painted ${rows.length} rows from disk copy`);
              return withCopy;
            })
            .catch(() => null);

      // One request per account, shown as each answers: a slow server only delays its own rows.
      await Promise.all(
        requestedAccounts.map(async (accountId) => {
          try {
            // A folder never listed here shows its newest mail first, then the whole window,
            // instead of waiting for every preview in the window to download.
            const withCopy = await diskCopy;
            if (withCopy && !withCopy.has(accountId)) {
              const first = await api.mail
                .list({ folder: folders[0], accountIds: [accountId], limit: FIRST_PAGE })
                .catch(() => null);
              if (stale()) return;
              if (first && first.messages.length > 0) {
                live.set(accountId, first.messages);
                setMessages((onScreen) => mergeAccountRows(targets, [live, fromDisk], onScreen));
                setLoading(false);
                perf(`account first page of ${first.messages.length}`);
              }
            }
            // The same window the Dashboard and the copy on disk use; see MAIL_WINDOW.
            const names = [...new Set([...folders, ...(verification.get(accountId) ?? [])])];
            const results = await Promise.all(
              names.map((name) =>
                api.mail.list({ folder: name, accountIds: [accountId], limit: MAIL_WINDOW })
                  .catch((error: unknown) => ({ messages: [], errors: [{ accountId, message: errorText(error) }] })),
              ),
            );
            if (stale()) return;
            const successful = new Set(names.filter((_, index) => results[index].errors.length === 0));
            const previous = live.get(accountId) ?? fromDisk.get(accountId) ??
              rawMessages.current.filter((row) => row.accountId === accountId);
            const accountRows = results.flatMap((result, index) => {
              const name = names[index];
              if (!folders.includes(name)) return [];
              return successful.has(name) ? result.messages : previous.filter((row) => row.folder === name);
            });
            if (folders.some((name) => successful.has(name))) {
              live.set(accountId, accountRows);
              if (folders.every((name) => successful.has(name))) snapshots.current.set(accountId, started);
            }
            actions.observe(results.flatMap((result) => result.messages), successful, new Set([accountId]), started);
            answered.set(accountId, results.flatMap((result) => result.errors));
          } catch (error) {
            if (stale()) return;
            answered.set(accountId, [{ accountId, message: errorText(error) }]);
          }
          setMessages((onScreen) => mergeAccountRows(targets, [live, fromDisk], onScreen));
          const account = accountLabels.current.get(accountId) ?? accountId;
          for (const error of answered.get(accountId) ?? []) actions.reportSyncError(account, error.message);
          setErrors((previous) => mergeErrors(previous, answered));
          setLoading(false);
          perf(`account ${answered.size}/${targets.length} answered`);
        }),
      );
      if (stale()) return;
      setLoading(false);
      runningSince.current = null;
      if (rerun.current) {
        rerun.current = false;
        void refreshAgain.current(true);
      }
    },
    [accountCount, actions, folder, scope],
  );
  const refreshAgain = useRef(refresh);
  refreshAgain.current = refresh;
  refreshAfterAction.current = () => void refresh(true);

  // Switching folder or account shows a loading state instead of the previous view's rows.
  useEffect(() => {
    snapshots.current.clear();
    setMessages([]);
    void refresh();
  }, [refresh]);

  // Turning an extra folder on or off keeps the rows on screen and brings in (or drops) its mail.
  const firstExtraKey = useRef(extraKey);
  useEffect(() => {
    if (firstExtraKey.current === extraKey) return;
    firstExtraKey.current = extraKey;
    void refresh();
  }, [extraKey, refresh]);

  useEffect(() => api.mail.onChanged(() => void refresh(true)), [refresh]);

  const projected = useMemo(
    () => actions.project(
      messages, new Set(foldersOf(folder)), new Set(scope === "all" ? accountIds.current : [scope]),
      (accountId) => snapshots.current.get(accountId) ?? 0,
    ),
    [actions, actionVersion, messages, folder, scope, extraKey],
  );
  const rawMessages = useRef(messages);
  rawMessages.current = messages;
  const messagesRef = useRef(projected);
  messagesRef.current = projected;

  useEffect(() => {
    const flush = () => actions.flush();
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
    };
  }, [actions]);

  const act = useCallback(
    (action: MailAction, ids: string[], source: readonly MessageSummary[] = messagesRef.current) => {
      const wanted = new Set(ids);
      const rows = source.filter((row) => wanted.has(row.id));
      const done = UNDOABLE[action];
      const { batch, count, undoable } = actions.enqueue(action, rows, !!done, (id) => toast.dismiss(`undo-${id}`));
      if (count && undoable) {
        toast(count === 1 ? `Message ${done}` : `${count} messages ${done}`, {
          id: `undo-${batch}`,
          duration: 6000,
          action: { label: "Undo", onClick: () => actions.undo(batch) },
        });
      }
    },
    [actions],
  );
  const undo = useCallback(() => actions.undo(), [actions]);

  /** Files conversations (ids as in `Thread.id`) under a category by hand, or under none (null). */
  const assignCategory = useCallback(
    async (threadIds: string[], categoryId: string | null): Promise<void> => {
      if (threadIds.length === 0) return;
      setMessages((previous) => applyCategory(previous, new Set(threadIds), categoryId));
      try {
        await api.categories.assign(threadIds, categoryId);
      } catch (error) {
        toast.error(`Could not change the category: ${errorText(error)}`);
        actions.reportSyncError("", `Could not change the category: ${errorText(error)}`);
        void refresh(true);
      }
    },
    [actions, refresh],
  );

  const visibleMessages = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    // The Inbox list holds only the folders checked; a message moved elsewhere stays out of sight.
    // Duplicates go first so a message that is in the inbox is not shown again from Archive.
    const inFolders =
      folder === "inbox"
        ? dropFolderDuplicates(projected).filter(
            (m) =>
              !m.sorting && (!SHOWN_FOLDERS.includes(m.folder as ShownFolder) || shownKey.split(",").includes(m.folder)),
          )
        : projected;
    return words.length === 0 ? inFolders : inFolders.filter((m) => matchesQuery(m, words));
  }, [projected, query, folder, shownKey]);

  const threads: Thread[] = useMemo(() => groupThreads(visibleMessages), [visibleMessages]);

  return {
    accounts,
    accountsLoaded,
    reloadAccounts: loadAccounts,
    scope,
    setScope,
    folder,
    setFolder,
    messages,
    threads,
    loading,
    errors,
    query,
    setQuery,
    refresh,
    act,
    assignCategory,
    undo,
    actions,
    actionVersion,
    actionChanged,
  };
}

export type Mailbox = ReturnType<typeof useMailbox>;

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
import { applyOptimistic, applyOptimisticKeepingFolders } from "@/lib/optimistic";

/** Every folder whose mail the Inbox list can show, in display order. */
export const SHOWN_FOLDERS: readonly ShownFolder[] = ["inbox", "archive", "trash", "spam"];

/** "all" means every account; otherwise an account id. */
export type AccountScope = "all" | string;

/** How long an archive, trash, spam or delete waits for an Undo before it reaches the server. */
const UNDO_WINDOW_MS = 6000;
/** What the toast says once the action is done, by action. */
const UNDOABLE: Partial<Record<MailAction, string>> = {
  archive: "archived",
  trash: "moved to Trash",
  spam: "reported as spam",
  deleteForever: "deleted forever",
};

/** An undoable action that is hidden from the list and waiting out its Undo window. */
interface PendingAction {
  token: number;
  action: MailAction;
  ids: string[];
  folder: MailFolder;
  toastId: string;
  timer: ReturnType<typeof setTimeout>;
  /** True once the request has been sent: it can no longer be undone. */
  sent: boolean;
}
/** How an action ended, as told to `onSettled` listeners. */
export type ActionOutcome = "committed" | "undone" | "failed";
export type SettledListener = (outcome: ActionOutcome, action: MailAction, ids: string[]) => void;

/** A background refresh may replace a running one once that has taken this long. */
const TAKEOVER_AFTER_MS = 15_000;

/** The Inbox list holds the other folders' mail too, so a move there changes a message's folder. */
function applyToList(
  messages: readonly MessageSummary[],
  action: MailAction,
  ids: ReadonlySet<string>,
  folder: MailFolder,
): MessageSummary[] {
  return folder === "inbox"
    ? applyOptimisticKeepingFolders(messages, action, ids, folder)
    : applyOptimistic(messages, action, ids, folder);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** True when a message matches every word of the search query. */
function matchesQuery(message: MessageSummary, words: string[]): boolean {
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
  const ticket = useRef(0);
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

  const refresh = useCallback(
    async (silent = false): Promise<void> => {
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
      if (!silent && messagesRef.current.length === 0) setLoading(true);

      const targets = scope === "all" ? [...accountIds.current] : [scope];
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
      const diskCopy: Promise<ReadonlySet<string> | null> = silent
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
        targets.map(async (accountId) => {
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
            const results = await Promise.all(
              folders.map((name) =>
                api.mail.list({ folder: name, accountIds: [accountId], limit: MAIL_WINDOW }),
              ),
            );
            if (stale()) return;
            live.set(accountId, results.flatMap((result) => result.messages));
            answered.set(accountId, results.flatMap((result) => result.errors));
          } catch (error) {
            if (stale()) return;
            answered.set(accountId, [{ accountId, message: errorText(error) }]);
          }
          setMessages((onScreen) => mergeAccountRows(targets, [live, fromDisk], onScreen));
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
    [accountCount, folder, scope],
  );
  const refreshAgain = useRef(refresh);
  refreshAgain.current = refresh;

  // Switching folder or account shows a loading state instead of the previous view's rows.
  useEffect(() => {
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

  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const pending = useRef(new Map<number, PendingAction>());
  const nextToken = useRef(0);
  /** Ids of messages whose archive / trash / spam / delete is pending: hidden from every list. */
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  /**
   * Told how each action ended: an archive / trash / spam / delete once the server took it or
   * it was undone, and any action the server refused. Lets another copy of the mail follow.
   */
  const settledListeners = useRef(new Set<SettledListener>());
  const onSettled = useCallback((listener: SettledListener) => {
    settledListeners.current.add(listener);
    return () => {
      settledListeners.current.delete(listener);
    };
  }, []);
  const notifySettled = useCallback((outcome: ActionOutcome, action: MailAction, ids: string[]) => {
    for (const listener of settledListeners.current) listener(outcome, action, ids);
  }, []);
  const syncPendingIds = useCallback(() => {
    setPendingIds(new Set([...pending.current.values()].flatMap((entry) => entry.ids)));
  }, []);

  /** Sends a pending action to the server and, once it answers, drops its rows for good. */
  const commit = useCallback(
    async (token: number): Promise<void> => {
      const entry = pending.current.get(token);
      if (!entry || entry.sent) return;
      entry.sent = true;
      clearTimeout(entry.timer);
      toast.dismiss(entry.toastId);
      try {
        await api.mail.act(entry.action, entry.ids);
        setMessages((previous) =>
          applyToList(previous, entry.action, new Set(entry.ids), entry.folder),
        );
        notifySettled("committed", entry.action, entry.ids);
      } catch (error) {
        toast.error(`Could not ${entry.action}: ${errorText(error)}`);
        notifySettled("failed", entry.action, entry.ids);
        void refresh(true);
      } finally {
        pending.current.delete(token);
        syncPendingIds();
      }
    },
    [notifySettled, refresh, syncPendingIds],
  );

  /** Takes back a pending action before it is sent: its rows reappear where they were. */
  const undoToken = useCallback(
    (token: number): boolean => {
      const entry = pending.current.get(token);
      if (!entry || entry.sent) return false;
      clearTimeout(entry.timer);
      toast.dismiss(entry.toastId);
      pending.current.delete(token);
      syncPendingIds();
      notifySettled("undone", entry.action, entry.ids);
      return true;
    },
    [notifySettled, syncPendingIds],
  );

  /** Undoes the latest archive / trash / spam / delete still inside its window (⌘Z). */
  const undo = useCallback((): boolean => {
    const latest = [...pending.current.values()].reverse().find((entry) => !entry.sent);
    return latest ? undoToken(latest.token) : false;
  }, [undoToken]);

  // Nothing waiting may be lost when the window closes or the app reloads.
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => {
    const flush = () => {
      for (const entry of [...pending.current.values()]) void commitRef.current(entry.token);
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, []);

  const act = useCallback(
    async (action: MailAction, ids: string[]): Promise<void> => {
      if (ids.length === 0) return;

      const done = UNDOABLE[action];
      if (done) {
        // Hide the rows now, tell the server after the Undo window.
        const idSet = new Set(ids);
        const conversations = new Set(
          messagesRef.current.filter((m) => idSet.has(m.id)).map((m) => m.threadId),
        ).size;
        const token = ++nextToken.current;
        const toastId = `undo-${token}`;
        pending.current.set(token, {
          token,
          action,
          ids,
          folder,
          toastId,
          sent: false,
          timer: setTimeout(() => void commit(token), UNDO_WINDOW_MS),
        });
        syncPendingIds();
        toast(
          conversations > 1 ? `${conversations} conversations ${done}` : `Conversation ${done}`,
          {
            id: toastId,
            duration: UNDO_WINDOW_MS,
            action: { label: "Undo", onClick: () => undoToken(token) },
          },
        );
        return;
      }

      setMessages((previous) => applyToList(previous, action, new Set(ids), folder));
      try {
        await api.mail.act(action, ids);
      } catch (error) {
        toast.error(`Could not ${action}: ${errorText(error)}`);
        notifySettled("failed", action, ids);
        void refresh(true);
      }
    },
    [commit, folder, notifySettled, refresh, syncPendingIds, undoToken],
  );

  const visibleMessages = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = pendingIds.size === 0 ? messages : messages.filter((m) => !pendingIds.has(m.id));
    // The Inbox list holds only the folders checked; a message moved elsewhere stays out of sight.
    // Duplicates go first so a message that is in the inbox is not shown again from Archive.
    const inFolders =
      folder === "inbox"
        ? dropFolderDuplicates(shown).filter(
            (m) => !SHOWN_FOLDERS.includes(m.folder as ShownFolder) || shownKey.split(",").includes(m.folder),
          )
        : shown;
    return words.length === 0 ? inFolders : inFolders.filter((m) => matchesQuery(m, words));
  }, [messages, query, pendingIds, folder, shownKey]);

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
    undo,
    /** Ids hidden while their archive / trash / spam / delete waits out its Undo window. */
    pendingIds,
    onSettled,
  };
}

export type Mailbox = ReturnType<typeof useMailbox>;

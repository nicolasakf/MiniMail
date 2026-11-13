import { useCallback, useEffect, useRef, useState } from "react";

import { MAIL_WINDOW } from "@shared/mail-window";
import { MOVE_DESTINATION } from "@shared/threads";
import type { AccountError, MailAction, MailFolder, MessageSummary } from "@shared/types";

import { api } from "@/lib/api";
import { applyOptimistic } from "@/lib/optimistic";

/** Every folder received mail can be in: the same tabs the rail offers. */
export const DASHBOARD_FOLDERS: readonly MailFolder[] = ["inbox", "archive", "spam", "trash"];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Keeps the newest answer per folder and flattens them. */
function flatten(byFolder: Map<MailFolder, MessageSummary[]>): MessageSummary[] {
  return [...byFolder.values()].flat();
}

/**
 * The mail the Dashboard counts: Inbox, Archive, Spam and Trash of every account, in the same
 * window the folder lists use (`MAIL_WINDOW`), so both always show the same mail. Loads only
 * while `active`, paints the copy on disk first, then the servers' answer,
 * and reloads quietly whenever the main process reports changed mail.
 */
export function useDashboardMail(accountCount: number, active: boolean) {
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<AccountError[]>([]);
  const ticket = useRef(0);

  const load = useCallback(
    async (silent: boolean) => {
      const current = ++ticket.current;
      const stale = () => current !== ticket.current;
      if (accountCount === 0) {
        setMessages([]);
        setErrors([]);
        setLoading(false);
        return;
      }
      if (!silent) {
        setLoading(true);
        // The disk copy answers at once; it is replaced by the live answer below.
        void Promise.all(
          DASHBOARD_FOLDERS.map((folder) =>
            api.mail.list({ folder, limit: MAIL_WINDOW, cacheOnly: true }).catch(() => null),
          ),
        ).then((results) => {
          if (stale()) return;
          const rows = results.flatMap((result) => result?.messages ?? []);
          if (rows.length === 0) return;
          setMessages((onScreen) => (onScreen.length === 0 ? rows : onScreen));
          setLoading(false);
        });
      }

      const byFolder = new Map<MailFolder, MessageSummary[]>();
      const failures: AccountError[] = [];
      await Promise.all(
        DASHBOARD_FOLDERS.map(async (folder) => {
          try {
            const result = await api.mail.list({ folder, limit: MAIL_WINDOW });
            byFolder.set(folder, result.messages);
            failures.push(...result.errors);
          } catch (error) {
            failures.push({ accountId: "", message: errorText(error) });
          }
        }),
      );
      if (stale()) return;
      // A folder that failed outright keeps what is on screen rather than emptying the charts.
      setMessages((onScreen) => {
        for (const folder of DASHBOARD_FOLDERS) {
          if (!byFolder.has(folder)) byFolder.set(folder, onScreen.filter((m) => m.folder === folder));
        }
        return flatten(byFolder);
      });
      const seen = new Set<string>();
      setErrors(
        failures.filter((failure) => {
          const key = `${failure.accountId}|${failure.message}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
      );
      setLoading(false);
    },
    [accountCount],
  );

  useEffect(() => {
    if (active) void load(false);
  }, [active, load]);

  useEffect(() => {
    if (!active) return undefined;
    return api.mail.onChanged(() => void load(true));
  }, [active, load]);

  /** Applies an action to the Dashboard's copy right away, like the list does. */
  const apply = useCallback((action: MailAction, ids: readonly string[]) => {
    const idSet = new Set(ids);
    setMessages((previous) => {
      // Every folder it can move to is loaded: the message changes folder instead of leaving.
      const to = MOVE_DESTINATION[action];
      if (to) return previous.map((m) => (idSet.has(m.id) ? { ...m, folder: to } : m));
      return applyOptimistic(previous, action, idSet, "inbox");
    });
  }, []);

  return { messages, loading, errors, reload: load, apply };
}

export type DashboardMail = ReturnType<typeof useDashboardMail>;

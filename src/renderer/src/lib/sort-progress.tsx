import { toast } from "sonner";

import { accountLabel } from "@shared/accounts";
import type { Account, SortFolder, SortOptions, SortProgress } from "@shared/types";

import { api } from "./api";

const TOAST_ID = "sort-mail-again";
const POLL_MS = 600;
/** Gives up watching (not sorting) after this long, so a stuck run cannot leave a toast spinning forever. */
const WATCH_LIMIT_MS = 10 * 60_000;

let watching = false;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const plural = (count: number) => `${count} conversation${count === 1 ? "" : "s"}`;

function Bar({ label, done, total }: { label: string; done: number; total: number }) {
  const percent = total === 0 ? 0 : Math.min(100, Math.round((done / total) * 100));
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="min-w-0 truncate text-foreground">{label}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {done} / {total}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/** One bar per account, in the order the accounts are listed in the app. */
function Bars({ progress, accounts }: { progress: SortProgress; accounts: Account[] }) {
  const order = new Map(accounts.map((account, index) => [account.id, index]));
  const rows = [...progress.accounts].sort(
    (a, b) => (order.get(a.accountId) ?? accounts.length) - (order.get(b.accountId) ?? accounts.length),
  );
  return (
    <div className="mt-2 w-full space-y-2.5">
      {rows.map((row) => {
        const account = accounts.find((candidate) => candidate.id === row.accountId);
        return (
          <Bar
            key={row.accountId}
            label={account ? accountLabel(account) : "Account"}
            done={row.done}
            total={row.total}
          />
        );
      })}
    </div>
  );
}

/**
 * Starts "sort all mail again" and keeps one toast up to date with how far it has got, then
 * replaces it with the outcome. Each account gets its own bar. A total is what has been queued
 * so far: an account's inbox adds its conversations as it loads, so it can grow while this runs.
 * With `since`, only conversations with mail from that moment on are sorted again; `folders`
 * picks which folders (Inbox, Archive, Spam, Trash) are sorted.
 */
export async function sortMailAgain(since?: Date, folders: SortFolder[] = ["inbox"]): Promise<void> {
  try {
    const options: SortOptions = {};
    if (since) options.since = since.toISOString();
    options.folders = folders;
    await api.categories.reclassify(options);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
    return;
  }
  // A second click restarts the run in the main process; the loop below already follows it.
  if (watching) return;
  watching = true;

  toast.loading("Sorting your mail again…", { id: TOAST_ID, duration: Infinity });
  const startedAt = Date.now();
  try {
    const accounts = await api.accounts.list().catch((): Account[] => []);
    while (Date.now() - startedAt < WATCH_LIMIT_MS) {
      await sleep(POLL_MS);
      const { ai } = await api.categories.get();

      if (!ai.configured) {
        toast.info("Add an AI key in Categories to sort mail.", { id: TOAST_ID, description: undefined, duration: 5000 });
        return;
      }
      const progress = ai.sorting;
      if (!progress) {
        // A run always exists after `reclassify`. None means the main process is older than this
        // page (the page hot-reloads in development, the main process does not).
        toast.info("Sorting started, but progress is unavailable.", {
          id: TOAST_ID,
          description: "Restart MiniMail to see it.",
          duration: 6000,
        });
        return;
      }
      if (progress.finished) {
        if (progress.error) {
          toast.error(`Sorting stopped after ${progress.done} of ${progress.total}`, {
            id: TOAST_ID,
            description: progress.error,
            duration: 8000,
          });
        } else if (progress.total === 0) {
          toast.info("Nothing to sort.", { id: TOAST_ID, description: undefined, duration: 4000 });
        } else {
          toast.success(`Sorted ${plural(progress.done)}`, { id: TOAST_ID, description: undefined, duration: 4000 });
        }
        return;
      }
      toast.loading(
        progress.total > 0 ? "Sorting your mail again…" : "Sorting your mail again… waiting for your inbox",
        {
          id: TOAST_ID,
          duration: Infinity,
          description: progress.total > 0 ? <Bars progress={progress} accounts={accounts} /> : undefined,
        },
      );
    }
    toast.dismiss(TOAST_ID);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error), { id: TOAST_ID, description: undefined });
  } finally {
    watching = false;
  }
}

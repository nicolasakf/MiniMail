import { CircleCheck, Inbox, Mail, Search, TriangleAlert } from "lucide-react";

import { accountLabel } from "@shared/accounts";
import type { Account, AccountError, MailFolder } from "@shared/types";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FOLDER_TITLES } from "@/lib/format";

/** First-run screen shown until at least one account is connected. */
export function NoAccounts({ onAdd, demo }: { onAdd: () => void; demo: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-muted">
        <Mail className="size-7 text-muted-foreground" />
      </span>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Connect your email</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          Add Gmail, Outlook (personal or university) and Zoho accounts. Everything is read directly
          from your providers and stays on this computer.
        </p>
      </div>
      <Button onClick={onAdd}>Add account</Button>
      {demo && <p className="text-xs text-muted-foreground">Browser demo: sign-in is simulated.</p>}
    </div>
  );
}

/** Placeholder rows while a folder loads. */
export function ListSkeleton() {
  return (
    <div className="space-y-0.5 px-2 pt-4" aria-busy="true" aria-label="Loading mail">
      {Array.from({ length: 9 }, (_, index) => (
        <div key={index} className="flex h-10 items-center gap-2.5 px-3">
          <span className="w-4" />
          <Skeleton className="size-[26px] rounded-full" />
          <Skeleton className="h-3.5 w-[clamp(110px,18vw,260px)]" />
          <Skeleton className="h-3.5 flex-1" style={{ maxWidth: `${70 - (index % 4) * 12}%` }} />
        </div>
      ))}
    </div>
  );
}

/** Shown when a folder, or a search, has nothing to list. */
export function EmptyList({
  folder,
  query,
  unreadOnly = false,
}: {
  folder: MailFolder;
  query: string;
  unreadOnly?: boolean;
}) {
  if (query) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <Search className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No mail matches “{query}”.</p>
      </div>
    );
  }
  if (unreadOnly) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <CircleCheck className="size-10 text-muted-foreground" />
        <p className="text-sm font-medium">No unread mail</p>
        <p className="text-xs text-muted-foreground">Turn off the unread filter to see everything.</p>
      </div>
    );
  }
  const Icon = folder === "inbox" ? CircleCheck : Inbox;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
      <Icon className="size-10 text-muted-foreground" />
      <p className="text-sm font-medium">
        {folder === "inbox" ? "You're all done" : `${FOLDER_TITLES[folder]} is empty`}
      </p>
      {folder === "inbox" && (
        <p className="text-xs text-muted-foreground">Nothing left in your inbox.</p>
      )}
    </div>
  );
}

/** Lists accounts that failed to load, so one broken account never hides the others. */
export function ErrorBanner({
  errors,
  accounts,
  onRetry,
  onManage,
}: {
  errors: readonly AccountError[];
  accounts: readonly Account[];
  onRetry: () => void;
  onManage: () => void;
}) {
  if (errors.length === 0) return null;
  return (
    <div
      role="alert"
      className="corner-squircle mx-6 mb-2 flex items-start gap-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-red-300" />
      <ul className="min-w-0 flex-1 space-y-1">
        {errors.map((error, index) => {
          const account = accounts.find((candidate) => candidate.id === error.accountId);
          return (
            <li key={`${error.accountId}-${index}`} className="break-words text-red-200">
              {account ? <strong className="font-semibold">{accountLabel(account)}: </strong> : null}
              {error.message}
            </li>
          );
        })}
      </ul>
      <Button size="sm" variant="outline" className="h-7" onClick={onRetry}>
        Retry
      </Button>
      <Button size="sm" variant="ghost" className="h-7" onClick={onManage}>
        Accounts
      </Button>
    </div>
  );
}

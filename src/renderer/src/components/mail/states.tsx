import { useEffect, useRef } from "react";
import { CircleCheck, Inbox, Mail, Search } from "lucide-react";
import { toast } from "sonner";

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
  /** Null for a list that is not a folder (the mail behind a Dashboard click). */
  folder: MailFolder | null;
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
  if (folder === null) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <Inbox className="size-10 text-muted-foreground" />
        <p className="text-sm font-medium">No mail left here</p>
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

/**
 * Shows each account that failed to load as a persistent error toast, so one broken account
 * never hides the others and the list is not pushed down by a banner. A toast stays until the
 * account loads again or it is dismissed, and is not re-shown for the same unchanged error.
 */
export function AccountErrorToasts({
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
  // The latest callbacks, so a toast raised earlier never calls a stale closure.
  const actions = useRef({ onRetry, onManage });
  actions.current = { onRetry, onManage };
  // What each account's toast last said; a dismissed toast stays dismissed until that changes.
  const shown = useRef(new Map<string, string>());

  useEffect(() => {
    // Several lists can fail at once with the same error; say each distinct message once.
    const messages = new Map<string, Set<string>>();
    for (const error of errors) {
      messages.set(error.accountId, (messages.get(error.accountId) ?? new Set()).add(error.message));
    }
    const current = new Map([...messages].map(([accountId, set]) => [accountId, [...set].join("\n")]));
    for (const [accountId, message] of current) {
      if (shown.current.get(accountId) === message) continue;
      shown.current.set(accountId, message);
      const account = accounts.find((candidate) => candidate.id === accountId);
      toast.error("Couldn't load mail", {
        id: `account-error-${accountId}`,
        description: account ? `${accountLabel(account)}: ${message}` : message,
        duration: Infinity,
        action: { label: "Retry", onClick: () => actions.current.onRetry() },
        cancel: { label: "Accounts", onClick: () => actions.current.onManage() },
      });
    }
    // Accounts that recovered: close their toast and forget it so a new failure shows again.
    for (const accountId of [...shown.current.keys()]) {
      if (current.has(accountId)) continue;
      shown.current.delete(accountId);
      toast.dismiss(`account-error-${accountId}`);
    }
  }, [errors, accounts]);

  return null;
}

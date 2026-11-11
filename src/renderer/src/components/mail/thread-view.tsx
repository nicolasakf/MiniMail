import { useEffect, useMemo, useRef, useState } from "react";

import {
  ArrowLeft,
  Forward,
  Loader2,
  Paperclip,
  Reply,
  ReplyAll,
} from "lucide-react";

import { accountLabel } from "@shared/accounts";
import { logoRequestFor } from "@shared/logos";
import type { Thread } from "@shared/threads";
import type { Account, MailAction, MailFolder, MessageDetail } from "@shared/types";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { buildReplySeed, type ComposeSeed } from "@/lib/compose";
import { accountFor, contactLabel, formatFullDate, normalizeSubject } from "@/lib/format";
import { isTypingTarget } from "@/lib/keyboard";
import { actionsForThread } from "@/lib/row-actions";
import { withTimeout } from "@/lib/timeout";
import { cn } from "@/lib/utils";

import { MessageBody } from "./message-body";
import { SenderAvatar } from "./sender-avatar";

interface ThreadViewProps {
  thread: Thread;
  folder: MailFolder;
  accounts: readonly Account[];
  onBack: () => void;
  onAction: (action: MailAction) => void;
  onCompose: (seed: ComposeSeed) => void;
  /** True while the composer or a dialog is open, so R / E / F do not fire behind it. */
  shortcutsDisabled?: boolean;
}

function ToolbarButton({
  label,
  hint,
  onClick,
  children,
}: {
  label: string;
  hint?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className="corner-squircle electron-no-drag flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        {hint ? <span className="ml-2 text-muted-foreground">{hint}</span> : null}
      </TooltipContent>
    </Tooltip>
  );
}

/** After this long the view says the server is slow instead of just spinning. */
const SLOW_AFTER_MS = 5_000;
/** After this long the view stops waiting and offers a retry (the download carries on behind it). */
const GIVE_UP_AFTER_MS = 60_000;

/** What is already known about a conversation while its full text is still downloading. */
function KnownMessages({ thread, slow }: { thread: Thread; slow: boolean }) {
  return (
    <div className="space-y-3" aria-busy="true">
      {thread.messages.map((message, index) => {
        const last = index === thread.messages.length - 1;
        return (
          <article
            key={message.id}
            className={cn(
              "corner-squircle rounded-xl border border-border p-4",
              last ? "bg-card" : "bg-card/40",
            )}
          >
            <div className="flex items-center gap-3">
              <SenderAvatar contact={message.from} size={36} logo={logoRequestFor(message)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate font-semibold">{contactLabel(message.from)}</span>
                  <span className="truncate text-xs text-muted-foreground">{message.from.email}</span>
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {formatFullDate(message.date)}
                </div>
              </div>
            </div>
            {last && message.snippet && (
              <p className="mt-3 line-clamp-6 whitespace-pre-wrap text-sm text-foreground/80">
                {message.snippet}
              </p>
            )}
          </article>
        );
      })}
      <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
        <Loader2 className="size-3.5 animate-spin" />
        {slow
          ? "The mail server is slow to respond. Still waiting for the full message…"
          : "Loading the full message…"}
      </p>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Full conversation: toolbar, subject, and each message (older ones collapsed). */
export function ThreadView({
  thread,
  folder,
  accounts,
  onBack,
  onAction,
  onCompose,
  shortcutsDisabled = false,
}: ThreadViewProps) {
  const [details, setDetails] = useState<MessageDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  /** Bumped by "Try again" to run the download again. */
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const markedRead = useRef<string | null>(null);

  const idsKey = thread.messages.map((message) => message.id).join(",");

  useEffect(() => {
    let cancelled = false;
    setDetails(null);
    setError(null);
    setSlow(false);
    const slowTimer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    const asked = performance.now();
    if (import.meta.env.DEV) console.log(`[perf] open conversation: asking for ${thread.messages.length} message(s)`);
    withTimeout(
      api.mail.get(thread.messages.map((message) => message.id)),
      GIVE_UP_AFTER_MS,
      "The mail server took too long to send this conversation.",
    )
      .then((loaded) => {
        if (import.meta.env.DEV) {
          console.log(`[perf] open conversation: got ${loaded.length} in ${Math.round(performance.now() - asked)}ms${cancelled ? " (ignored, view moved on)" : ""}`);
        }
        if (cancelled) return;
        setDetails(loaded);
        // Open the newest message and anything unread; keep the rest collapsed.
        const open = new Set<string>();
        loaded.forEach((message, index) => {
          if (index === loaded.length - 1 || message.unread) open.add(message.id);
        });
        setExpanded(open);
      })
      .catch((reason: unknown) => {
        if (import.meta.env.DEV) console.log(`[perf] open conversation: failed after ${Math.round(performance.now() - asked)}ms`);
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
      clearTimeout(slowTimer);
    };
    // idsKey captures the message list; thread identity alone would miss new replies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, attempt]);

  // Opening a conversation reads it, once per thread.
  useEffect(() => {
    if (details && thread.unread && markedRead.current !== thread.id) {
      markedRead.current = thread.id;
      onAction("markRead");
    }
  }, [details, thread.id, thread.unread, onAction]);

  const latest = details?.[details.length - 1];
  const actions = useMemo(() => actionsForThread(folder, thread), [folder, thread]);
  const owner = accountFor(accounts, thread.accountId);

  const startCompose = (mode: "reply" | "replyAll" | "forward") => {
    if (latest) onCompose(buildReplySeed(latest, mode, accounts));
  };

  // R replies, E replies to all, F forwards (once the full message has loaded).
  useEffect(() => {
    const modes: Record<string, "reply" | "replyAll" | "forward"> = {
      r: "reply",
      e: "replyAll",
      f: "forward",
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (shortcutsDisabled || !latest || isTypingTarget(event.target)) return;
      const mode = modes[event.key.toLowerCase()];
      if (!mode) return;
      event.preventDefault();
      onCompose(buildReplySeed(latest, mode, accounts));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [accounts, latest, onCompose, shortcutsDisabled]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="electron-window-drag flex h-[88px] shrink-0 items-end justify-between px-6 pb-3 pt-10">
        <div className="flex items-center gap-1">
          <ToolbarButton label="Back" hint="Esc" onClick={onBack}>
            <ArrowLeft className="size-[18px]" />
          </ToolbarButton>
          <span className="mx-1 h-5 w-px bg-border" />
          {actions.map(({ action, label, icon: Icon, hint }) => (
            <ToolbarButton key={action} label={label} hint={hint} onClick={() => onAction(action)}>
              <Icon className="size-[18px]" />
            </ToolbarButton>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <ToolbarButton label="Reply" hint="R" onClick={() => startCompose("reply")}>
            <Reply className="size-[18px]" />
          </ToolbarButton>
          <ToolbarButton label="Reply all" hint="E" onClick={() => startCompose("replyAll")}>
            <ReplyAll className="size-[18px]" />
          </ToolbarButton>
          <ToolbarButton label="Forward" hint="F" onClick={() => startCompose("forward")}>
            <Forward className="size-[18px]" />
          </ToolbarButton>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-16">
        <div className="mx-auto max-w-3xl">
          <h1 className="mb-1 text-2xl font-semibold leading-tight">
            {normalizeSubject(thread.latest.subject)}
          </h1>
          <p className="mb-6 text-sm text-muted-foreground">
            {thread.count} {thread.count === 1 ? "message" : "messages"}
            {accounts.length > 1 && owner ? ` · ${accountLabel(owner)}` : ""}
          </p>

          {error && (
            <div className="flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm">
              <span className="min-w-0 flex-1">Could not load this conversation: {error}</span>
              <Button size="sm" variant="outline" onClick={() => setAttempt((count) => count + 1)}>
                Try again
              </Button>
            </div>
          )}

          {!details && !error && <KnownMessages thread={thread} slow={slow} />}

          <div className="space-y-3">
            {details?.map((message) => {
              const open = expanded.has(message.id);
              return (
                <article
                  key={message.id}
                  className={cn(
                    "corner-squircle rounded-xl border border-border",
                    open ? "bg-card" : "bg-card/40 hover:bg-card/70",
                  )}
                >
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 p-4 text-left"
                    onClick={() =>
                      setExpanded((previous) => {
                        const next = new Set(previous);
                        if (next.has(message.id)) next.delete(message.id);
                        else next.add(message.id);
                        return next;
                      })
                    }
                  >
                    <SenderAvatar contact={message.from} size={36} logo={logoRequestFor(message)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="truncate font-semibold">{contactLabel(message.from)}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {message.from.email}
                        </span>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {open
                          ? `to ${message.to.map(contactLabel).join(", ") || "me"}${
                              message.cc.length ? `, cc ${message.cc.map(contactLabel).join(", ")}` : ""
                            }`
                          : message.snippet}
                      </div>
                    </div>
                    {message.attachments.length > 0 && (
                      <Paperclip className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatFullDate(message.date)}
                    </span>
                  </button>

                  {open && (
                    <div className="space-y-4 px-4 pb-4">
                      <MessageBody message={message} />
                      {message.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {message.attachments.map((attachment, index) => (
                            <span
                              key={`${attachment.filename}-${index}`}
                              className="corner-squircle inline-flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-xs"
                            >
                              <Paperclip className="size-3.5 text-muted-foreground" />
                              {attachment.filename}
                              <span className="text-muted-foreground">{formatSize(attachment.size)}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

import { memo, useState } from "react";

import { Paperclip } from "lucide-react";

import { accountDetail } from "@shared/accounts";
import { logoRequestFor } from "@shared/logos";
import type { Thread } from "@shared/threads";
import type { Account, MailAction, MailFolder } from "@shared/types";

import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { accountFor, formatListTime, normalizeSubject, threadSenderLabel } from "@/lib/format";
import { actionsForThread } from "@/lib/row-actions";
import { cn } from "@/lib/utils";

import { AccountMark } from "./account-mark";
import { ReadToggle } from "./read-toggle";
import { SenderAvatar } from "./sender-avatar";

interface ThreadRowProps {
  thread: Thread;
  folder: MailFolder;
  accounts: readonly Account[];
  selected: boolean;
  selectMode: boolean;
  checked: boolean;
  /** Show a dot for the owning account (only useful with several accounts). */
  showAccountDot: boolean;
  onOpen: (thread: Thread) => void;
  onSelect: (key: string) => void;
  rowKey: string;
  onToggleChecked: (threadId: string) => void;
  onAction: (action: MailAction, thread: Thread) => void;
  /** Right-click: opens the row's menu at the pointer. */
  onMenu: (key: string, x: number, y: number) => void;
}

/** One conversation in the list: avatar, sender, subject, preview and time. */
export const ThreadRow = memo(function ThreadRow({
  thread,
  folder,
  accounts,
  selected,
  selectMode,
  checked,
  showAccountDot,
  onOpen,
  onSelect,
  rowKey,
  onToggleChecked,
  onAction,
  onMenu,
}: ThreadRowProps) {
  const [hovered, setHovered] = useState(false);
  const { latest } = thread;
  const account = accountFor(accounts, thread.accountId);
  const avatarContact =
    folder === "sent" || folder === "drafts" ? (latest.to[0] ?? latest.from) : latest.from;

  return (
    <div
      role="row"
      data-row-key={rowKey}
      aria-selected={selected}
      className={cn(
        "group relative mx-2 flex h-10 cursor-default items-center gap-2.5 rounded-md px-3 text-[13px]",
        selected ? "bg-sidebar-primary/25" : "hover:bg-accent/50",
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(rowKey, event.clientX, event.clientY);
      }}
      onClick={() => {
        onSelect(rowKey);
        if (selectMode) onToggleChecked(thread.id);
        else onOpen(thread);
      }}
    >
      <span className="-mx-1 flex size-6 shrink-0 items-center justify-center">
        {selectMode ? (
          <Checkbox
            checked={checked}
            aria-label="Select conversation"
            onClick={(event) => event.stopPropagation()}
            onCheckedChange={() => onToggleChecked(thread.id)}
          />
        ) : (
          <ReadToggle
            unread={thread.unread}
            noun="conversation"
            hint="U"
            onToggle={() => onAction(thread.unread ? "markRead" : "markUnread", thread)}
          />
        )}
      </span>

      <SenderAvatar
        contact={avatarContact}
        size={26}
        logo={folder === "sent" || folder === "drafts" ? null : logoRequestFor(latest)}
      />

      <span
        className={cn(
          "w-[clamp(110px,18cqw,260px)] shrink-0 truncate",
          thread.unread ? "font-semibold" : "font-medium",
        )}
      >
        {threadSenderLabel(thread, folder)}
      </span>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className={cn("shrink truncate", thread.unread ? "font-semibold" : "font-medium")}>
          {normalizeSubject(latest.subject)}
        </span>
        {thread.count > 1 && (
          <span className="shrink-0 rounded bg-muted px-1.5 text-[11px] font-medium leading-4 text-muted-foreground">
            {thread.count}
          </span>
        )}
        {latest.hasAttachments && <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{latest.snippet}</span>
      </div>

      <div className="relative flex h-full w-24 shrink-0 items-center justify-end">
        {hovered && !selectMode ? (
          <div className="flex items-center gap-0.5" onClick={(event) => event.stopPropagation()}>
            {actionsForThread(folder, thread)
              .filter(({ action }) => action !== "markRead" && action !== "markUnread")
              .slice(0, 4)
              .map(({ action, label, icon: Icon, hint }) => (
                <Tooltip key={action}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={label}
                      className="corner-squircle flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      onClick={() => onAction(action, thread)}
                    >
                      <Icon className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {label}
                    {hint ? <span className="ml-2 text-muted-foreground">{hint}</span> : null}
                  </TooltipContent>
                </Tooltip>
              ))}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {showAccountDot && account && (
              <span title={accountDetail(account)} className="flex">
                <AccountMark account={account} size={16} />
              </span>
            )}
            <span className="text-[11px] font-semibold text-muted-foreground">
              {formatListTime(latest.date)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
});

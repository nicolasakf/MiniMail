import { memo, useRef, useState } from "react";

import { Archive, ChevronDown, Inbox, Paperclip, ShieldAlert, Trash2, type LucideIcon } from "lucide-react";

import { accountDetail } from "@shared/accounts";
import { logoRequestFor } from "@shared/logos";
import { conversationFolder, MOVE_FOLDERS, type MoveFolder, type Thread } from "@shared/threads";
import type { Account, MailAction, MailFolder } from "@shared/types";

import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { accountFor, formatListTime, normalizeSubject, threadSenderLabel } from "@/lib/format";
import { folderStyle } from "@/lib/folder-style";
import { actionsForThread } from "@/lib/row-actions";
import { cn } from "@/lib/utils";

import { AccountMark } from "./account-mark";
import { CodeChip } from "./code-chip";
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
  /**
   * For lists that mix folders (opened from the Dashboard): instead of the hover actions, a
   * button names the folder the conversation is in and moves it to another.
   */
  showFolder?: boolean;
  onOpen: (thread: Thread) => void;
  onSelect: (key: string) => void;
  rowKey: string;
  onToggleChecked: (threadId: string) => void;
  onAction: (action: MailAction, thread: Thread) => void;
  /** Right-click: opens the row's menu at the pointer. */
  onMenu: (key: string, x: number, y: number) => void;
}

const FOLDER_INFO: Record<MoveFolder, { icon: LucideIcon; label: string; action: MailAction }> = {
  inbox: { icon: Inbox, label: "Inbox", action: "unarchive" },
  archive: { icon: Archive, label: "Archive", action: "archive" },
  spam: { icon: ShieldAlert, label: "Spam", action: "spam" },
  trash: { icon: Trash2, label: "Trash", action: "trash" },
};

function isMoveFolder(folder: MailFolder): folder is MoveFolder {
  return (MOVE_FOLDERS as readonly MailFolder[]).includes(folder);
}

/** Names the conversation's folder; opens a "Move to…" menu of the others. */
function MoveMenu({ thread, onAction }: { thread: Thread; onAction: (action: MailAction, thread: Thread) => void }) {
  const current = conversationFolder(thread);
  const info = isMoveFolder(current) ? FOLDER_INFO[current] : null;
  const Icon = info?.icon ?? Inbox;
  return (
    // Events inside the menu (portaled, but still inside this React tree) must not reach the row.
    <span
      className="flex"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`In ${info?.label ?? current}. Move to…`}
            className="corner-squircle flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent data-[state=open]:text-foreground"
          >
            <Icon className="size-3.5" />
            {info?.label ?? current}
            <ChevronDown className="size-3 opacity-70" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Move to…</DropdownMenuLabel>
          {MOVE_FOLDERS.filter((folder) => folder !== current).map((folder) => {
            const { icon: TargetIcon, label, action } = FOLDER_INFO[folder];
            return (
              <DropdownMenuItem key={folder} onSelect={() => onAction(action, thread)}>
                <TargetIcon className="mr-2 size-4" />
                {label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

/** Sort key that puts pin ahead of archive; every other action keeps its place (sort is stable). */
function hoverRank(action: MailAction): number {
  if (action === "pin" || action === "unpin") return 0;
  if (action === "archive" || action === "unarchive") return 1;
  return 2;
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
  showFolder = false,
  onOpen,
  onSelect,
  rowKey,
  onToggleChecked,
  onAction,
  onMenu,
}: ThreadRowProps) {
  const [hovered, setHovered] = useState(false);
  /**
   * A press that started on this row. Picking from the Move menu closes it under the pointer,
   * and the browser then delivers that click to whichever row is below: only a click whose
   * press began on the row itself opens it.
   */
  const pressed = useRef(false);
  const { latest } = thread;
  // The Inbox list can also show Archive, Trash and Spam mail: each conversation then acts and
  // is marked by the folder it is actually in.
  const rowFolder = folder === "inbox" ? conversationFolder(thread) : folder;
  const rowStyle = folder === "inbox" && !showFolder ? folderStyle(rowFolder) : undefined;
  const account = accountFor(accounts, thread.accountId);
  const avatarContact =
    folder === "sent" || folder === "drafts" ? (latest.to[0] ?? latest.from) : latest.from;

  return (
    <div
      role="row"
      data-row-key={rowKey}
      aria-selected={selected}
      className={cn(
        // Lists hold up to MAIL_WINDOW conversations per account: rows off screen skip layout and paint.
        "group relative mx-2 flex h-10 cursor-default items-center gap-2.5 rounded-md px-3 text-[13px] [contain-intrinsic-size:auto_40px] [content-visibility:auto]",
        selected ? "bg-sidebar-primary/[0.12] dark:bg-sidebar-primary/25" : "hover:bg-accent/50",
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(rowKey, event.clientX, event.clientY);
      }}
      onPointerDown={() => {
        pressed.current = true;
      }}
      onClick={() => {
        const started = pressed.current;
        pressed.current = false;
        if (showFolder && !started) return;
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

      <span className="flex w-[clamp(110px,18cqw,260px)] shrink-0 items-center gap-1.5">
        <span className={cn("truncate", thread.unread ? "font-semibold" : "font-medium")}>
          {threadSenderLabel(thread, folder)}
        </span>
        {rowStyle && (
          <span title={`In ${rowStyle.label}`} className="flex shrink-0">
            <rowStyle.icon aria-label={`In ${rowStyle.label}`} className={cn("size-3.5", rowStyle.text)} />
          </span>
        )}
      </span>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className={cn("shrink truncate", thread.unread ? "font-semibold" : "font-medium")}>
          {normalizeSubject(latest.subject)}
        </span>
        <CodeChip messageId={latest.id} date={latest.date} categoryId={latest.categoryId} />
        {thread.count > 1 && (
          <span className="shrink-0 rounded bg-muted px-1.5 text-[11px] font-medium leading-4 text-muted-foreground">
            {thread.count}
          </span>
        )}
        {latest.hasAttachments && <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{latest.snippet}</span>
      </div>

      <div
        className={cn("relative flex h-full shrink-0 items-center justify-end", showFolder ? "w-44" : "w-24")}
      >
        {hovered && !selectMode && !showFolder ? (
          <div className="flex items-center gap-0.5" onClick={(event) => event.stopPropagation()}>
            {actionsForThread(rowFolder, thread)
              .filter(({ action }) => action !== "markRead" && action !== "markUnread")
              // Pin / unpin comes before archive / move to inbox in the row's hover buttons.
              .sort((a, b) => hoverRank(a.action) - hoverRank(b.action))
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
            {showFolder && <MoveMenu thread={thread} onAction={onAction} />}
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

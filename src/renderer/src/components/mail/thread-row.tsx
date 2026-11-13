import { memo, useRef, useState, type CSSProperties } from "react";

import { Archive, Inbox, Paperclip, ShieldAlert, Trash2, type LucideIcon } from "lucide-react";

import { accountDetail } from "@shared/accounts";
import { logoRequestFor } from "@shared/logos";
import { conversationFolder, MOVE_FOLDERS, type MoveFolder, type Thread } from "@shared/threads";
import type { Account, MailAction, MailFolder } from "@shared/types";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppearance } from "@/lib/appearance";
import { accountFor, formatListTime, normalizeSubject, threadSenderLabel } from "@/lib/format";
import { folderStyle } from "@/lib/folder-style";
import { rowHoverActions } from "@/lib/row-actions";
import { cn } from "@/lib/utils";

import { AccountMark } from "./account-mark";
import { CodeChip } from "./code-chip";
import { ReadToggle } from "./read-toggle";
import { SenderAvatar } from "./sender-avatar";

/** Keys held during a click on a row. */
export interface SelectModifiers {
  range: boolean;
  toggle: boolean;
}

interface ThreadRowProps {
  thread: Thread;
  folder: MailFolder;
  accounts: readonly Account[];
  /** The row with the cursor (keyboard focus, last click). */
  selected: boolean;
  /** Part of a multi-selection (shift-click, shift+arrows, ⌘-click). */
  checked: boolean;
  /** The row above / below is highlighted too: the corners between them stay square. */
  joinTop?: boolean;
  joinBottom?: boolean;
  /** Show a dot for the owning account (only useful with several accounts). */
  showAccountDot: boolean;
  /**
   * For lists that mix folders (opened from the Dashboard): instead of the hover actions, a
   * button names the folder the conversation is in and moves it to another.
   */
  showFolder?: boolean;
  /** Double-click: opens the conversation. */
  onOpen: (thread: Thread) => void;
  /** Click: selects the row; shift extends from the anchor, ⌘/Ctrl adds or removes it. */
  onSelect: (key: string, modifiers?: SelectModifiers) => void;
  rowKey: string;
  onAction: (action: MailAction, thread: Thread) => void;
  /** Right-click: opens the row's menu at the pointer. */
  onMenu: (key: string, x: number, y: number) => void;
}

const FOLDER_INFO: Record<MoveFolder, { icon: LucideIcon; label: string }> = {
  inbox: { icon: Inbox, label: "Inbox" },
  archive: { icon: Archive, label: "Archive" },
  spam: { icon: ShieldAlert, label: "Spam" },
  trash: { icon: Trash2, label: "Trash" },
};

function isMoveFolder(folder: MailFolder): folder is MoveFolder {
  return (MOVE_FOLDERS as readonly MailFolder[]).includes(folder);
}

/** Names the folder a conversation is in (lists that mix folders). */
function FolderBadge({ folder }: { folder: MailFolder }) {
  const info = isMoveFolder(folder) ? FOLDER_INFO[folder] : null;
  const Icon = info?.icon ?? Inbox;
  return (
    <span className="flex h-6 items-center gap-1 px-1.5 text-[11px] font-medium text-muted-foreground">
      <Icon className="size-3.5" />
      {info?.label ?? folder}
    </span>
  );
}

/** One conversation in the list: avatar, sender, subject, preview and time. */
export const ThreadRow = memo(function ThreadRow({
  thread,
  folder,
  accounts,
  selected,
  checked,
  joinTop = false,
  joinBottom = false,
  showAccountDot,
  showFolder = false,
  onOpen,
  onSelect,
  rowKey,
  onAction,
  onMenu,
}: ThreadRowProps) {
  const [hovered, setHovered] = useState(false);
  const { showPreviews } = useAppearance();
  /**
   * A press that started on this row. Picking from the Move menu closes it under the pointer,
   * and the browser then delivers that click to whichever row is below: only a click whose
   * press began on the row itself opens it.
   */
  const pressed = useRef(false);
  const { latest } = thread;
  // The Inbox list can also show Archive, Trash and Spam mail: each conversation then acts and
  // is marked by the folder it is actually in.
  const rowFolder = folder === "inbox" || folder === "pinned" ? conversationFolder(thread) : folder;
  const rowStyle = folder === "inbox" && !showFolder ? folderStyle(rowFolder) : undefined;
  const account = accountFor(accounts, thread.accountId);
  const actions = hovered ? rowHoverActions(rowFolder, thread) : [];
  // Each action button is 24px wide with a 2px gap; the fade starts 20px before the first one.
  const actionsWidth = actions.length * 26 + 4;
  const hoverFade: CSSProperties | undefined = hovered
    ? (() => {
        const mask = `linear-gradient(to right, black calc(100% - ${actionsWidth + 20}px), transparent calc(100% - ${actionsWidth}px))`;
        return { maskImage: mask, WebkitMaskImage: mask };
      })()
    : undefined;
  const avatarContact =
    folder === "sent" || folder === "drafts" ? (latest.to[0] ?? latest.from) : latest.from;

  return (
    <div
      role="row"
      data-row-key={rowKey}
      aria-selected={selected}
      className={cn(
        "group relative mx-2 flex select-none h-10 cursor-default items-center gap-2.5 rounded-md px-3 text-[13px]",
        selected || checked
          ? "bg-sidebar-primary/[0.12] dark:bg-sidebar-primary/25"
          : "hover:bg-accent/50",
        // A run of highlighted rows reads as one block: only its first and last rows are rounded.
        (selected || checked) && joinTop && "rounded-t-none",
        (selected || checked) && joinBottom && "rounded-b-none",
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
      onClick={(event) => {
        const started = pressed.current;
        pressed.current = false;
        if (showFolder && !started) return;
        onSelect(rowKey, { range: event.shiftKey, toggle: event.metaKey || event.ctrlKey });
      }}
      onDoubleClick={(event) => {
        // A double-click on a button (read dot, hover actions, Move menu) is not a request to open.
        if ((event.target as HTMLElement).closest("button, [role=menuitem]")) return;
        onOpen(thread);
      }}
    >
      <span className="-mx-1 flex size-6 shrink-0 items-center justify-center">
        <ReadToggle
          unread={thread.unread}
          noun="conversation"
          hint="U"
          onToggle={() => onAction(thread.unread ? "markRead" : "markUnread", thread)}
        />
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

      <div
        className="flex min-w-0 flex-1 items-center gap-2"
        // Under the hover actions the text fades out instead of running behind the buttons.
        style={hoverFade}
      >
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
        {showPreviews ? (
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{latest.snippet}</span>
        ) : (
          <span className="flex-1" />
        )}
      </div>

      <div
        className={cn("relative flex h-full shrink-0 items-center justify-end", showFolder ? "w-44" : "w-24")}
      >
        {/* Hover actions sit just left of the time / account mark, over the end of the preview. */}
        {hovered && (
          <div
            className="absolute right-full top-0 flex h-full items-center gap-0.5 pr-1"
            onClick={(event) => event.stopPropagation()}
          >
            {actions.map(({ action, label, icon: Icon, hint }) => (
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
        )}
        <div className="flex items-center gap-2">
          {showFolder && <FolderBadge folder={rowFolder} />}
          {showAccountDot && account && (
            <span title={accountDetail(account)} className="flex">
              <AccountMark account={account} size={16} />
            </span>
          )}
          <span className="text-[11px] font-semibold text-muted-foreground">
            {formatListTime(latest.date)}
          </span>
        </div>
      </div>
    </div>
  );
});

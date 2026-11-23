import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties, type ReactNode } from "react";

import { ArrowLeft, Ban, BellOff, Check, ChevronDown, Forward, FolderInput, ListX, Loader2, Paperclip, Pencil, Reply, ReplyAll, ShieldBan, User, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "@/lib/toast";

import { isBlockedAddress, type BlockKind } from "@shared/blocklist";
import { unsubscribeCommand } from "@shared/unsubscribe";
import { accountLabel, CALENDAR_ACCESS_REQUIRED } from "@shared/accounts";
import { iconFor } from "@shared/categories";
import { isPriorityEntry, isPriorityThread, type PriorityKind } from "@shared/priority";
import { parseMessageId } from "@shared/ids";
import { logoRequestFor, type LogoRequest } from "@shared/logos";
import type { Thread } from "@shared/threads";
import type { Account, Category, Contact, InvitationResponse, MailAction, MailFolder, MessageDetail } from "@shared/types";

import { FLAT_KEY } from "@/components/ui/keys";
import { Button } from "@/components/ui/button";
import { ConfirmPopover } from "@/components/ui/confirm-popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { ShortcutHint } from "@/components/ui/keyboard-shortcut-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { collectArtifacts, withAnswer, type ThreadAttachment, type ThreadInvitation } from "@/lib/artifacts";
import { EMAIL_WIDTH_REM, useAppearance } from "@/lib/appearance";
import { earlierMessages } from "@/lib/completion";
import { buildReplySeed, newMessageSeed, type ComposeSeed } from "@/lib/compose";
import { accountFor, contactLabel, formatFullDate, normalizeSubject } from "@/lib/format";
import { isTypingTarget } from "@/lib/keyboard";
import { useIsMac } from "@/hooks/use-platform";
import { useThreadFind } from "@/hooks/use-thread-find";
import { containsText } from "@shared/find-text";
import { messageText } from "@/lib/thread-find";
import { blockSections, muteMenuLabel, muteSections, priorityChoiceSections, useBlockList, type BlockChoice, type BlockSection, type MuteKind } from "@/lib/blocklist";
import { mutedCheck } from "@/lib/mute";
import { useNotificationSettings } from "@/hooks/use-notification-settings";
import { BLOCKED_TEXT, MUTED_TEXT } from "@/lib/highlight";
import { prioritySections, togglePriority, usePriority } from "@/lib/priority";
import { targetsAsk, type TargetsAsk, type TargetsCommand } from "@/lib/targets-confirm";
import { TargetsDialog } from "@/components/mail/targets-dialog";
import type { MailActions } from "@/lib/mail-actions";
import { actionsForThread } from "@/lib/row-actions";
import { DELETE_FOREVER_CONFIRM } from "@/lib/delete-confirm";
import { unsubscribeButton, unsubscribeConfirm } from "@/lib/unsubscribe-confirm";
import { useUnsubscribed } from "@/lib/unsubscribed";
import { withTimeout } from "@/lib/timeout";
import { cn } from "@/lib/utils";

import { categoryMenuIcon } from "./category-icon";
import { ContactCard } from "./contact-card";
import { MessageBody } from "./message-body";
import { FindBar } from "./find-bar";
import { FolderBadge } from "./folder-badge";
import { ThreadCard } from "./thread-card";
import { AccountMark } from "./account-mark";
import { SenderAvatar } from "./sender-avatar";
import { noteShownError } from "@/lib/events";
import { seedFromDraft, useDrafts } from "@/lib/drafts";
import { draftIdOf, draftsForThread, isLocalDraftId } from "@/lib/local-drafts";

interface ThreadViewProps {
  mailActions: MailActions;
  thread: Thread;
  folder: MailFolder;
  accounts: readonly Account[];
  onBack: () => void;
  onAction: (action: MailAction) => void;
  onCompose: (seed: ComposeSeed) => void;
  /** The categories the conversation can be moved to; without them (or in Sent and Drafts) there is no category menu. */
  categories?: readonly Category[];
  /** Files the conversation under a category, or under none (`null`). */
  onMoveToCategory?: (categoryId: string | null) => void;
  /** Opens the settings dialog on the categories page. */
  onEditCategories?: () => void;
  /** Blocks (or unblocks) the conversation's sender or domain; its mail goes to the Trash. */
  onBlock?: (kind: BlockKind, values: string[]) => void;
  /** Mutes (or unmutes) the conversation, its sender or domain: no notifications for the new mail. */
  onMute?: (kind: MuteKind, values: string[]) => void;
  /** Unsubscribes from the list the conversation came from; the button shows only when its mail offers a way. */
  onUnsubscribe?: () => void;
  /** Shows every message from a person: leaves the conversation and searches for their address. */
  onSearch?: (contact: Contact) => void;
  /** True while the composer or a dialog is open, so R / E / F do not fire behind it. */
  shortcutsDisabled?: boolean;
  /**
   * Shown beside the list (split view) rather than in place of it: the toolbar sits under the
   * window's own toolbar instead of reserving room for the window controls.
   */
  embedded?: boolean;
}

function ToolbarButton({
  label,
  hint,
  onClick,
  confirm,
  disabled = false,
  tip,
  children,
}: {
  label: string;
  hint?: string;
  onClick: () => void;
  /** Greyed out and not pressable; `tip` then says why. */
  disabled?: boolean;
  /** What the tooltip says when it is not just the label. */
  tip?: string;
  /** Asks first: the button opens this card, and `onClick` runs only when it is confirmed. */
  confirm?: { title: string; description: string; confirmLabel: string; confirmVariant?: ComponentProps<typeof ConfirmPopover>["confirmVariant"] };
  children: React.ReactNode;
}) {
  const button = (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={confirm ? undefined : onClick}
      className={`electron-no-drag flex size-9 items-center justify-center rounded-xl disabled:opacity-40 ${FLAT_KEY}`}
    >
      {children}
    </button>
  );
  const trigger = (
    <TooltipTrigger asChild>
      {/* A greyed-out button gets no pointer events, so the span is what shows the tooltip. */}
      {disabled ? <span className="flex">{button}</span> : button}
    </TooltipTrigger>
  );
  return (
    <Tooltip>
      {confirm && !disabled ? (
        <ConfirmPopover {...confirm} onConfirm={onClick} side="bottom" align="start">
          {trigger}
        </ConfirmPopover>
      ) : (
        trigger
      )}
      <TooltipContent side="bottom">
        {tip ?? label}
        {hint ? <ShortcutHint hint={hint} /> : null}
      </TooltipContent>
    </Tooltip>
  );
}

/** The toolbar's "Move to category" dropdown: the same choices as the conversation's context menu. */
export function CategoryMenuButton({
  categories,
  currentId,
  onMove,
  onEdit,
  placement = "toolbar",
}: {
  categories: readonly Category[];
  /** The category the conversation is in; leave out when the move applies to several conversations. */
  currentId?: string | null;
  onMove: (categoryId: string | null) => void;
  /** Opens the settings dialog on the categories page. */
  onEdit?: () => void;
  /** "bar" is the bulk action bar's: opens upward, sized like its icon buttons. */
  placement?: "toolbar" | "bar";
}) {
  const [open, setOpen] = useState(false);
  const inBar = placement === "bar";
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip open={open ? false : undefined}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Move to category"
              className={cn(
                "corner-squircle electron-no-drag flex items-center gap-0.5",
                FLAT_KEY,
                // The bar's trigger matches its ghost buttons: inherited color, accent on hover.
                inBar
                  ? "h-8 rounded-[10px] px-1.5"
                  : "h-9 rounded-xl pl-2 pr-1.5 text-foreground",
              )}
            >
              <FolderInput className={inBar ? "size-4" : "size-[18px]"} />
              <ChevronDown className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side={inBar ? "top" : "bottom"}>Move to category</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align={inBar ? "center" : "start"} side={inBar ? "top" : "bottom"} className="min-w-48">
        {categories.map((category) => {
          const Icon = categoryMenuIcon(iconFor(category));
          return (
            <DropdownMenuItem key={category.id} onSelect={() => onMove(category.id)}>
              <Icon />
              <span className="truncate">{category.name}</span>
              {currentId === category.id && <Check className="ml-auto text-muted-foreground" />}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onMove(null)}>
          <Ban />
          No category
          {currentId === null && <Check className="ml-auto text-muted-foreground" />}
        </DropdownMenuItem>
        {onEdit && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil />
              Edit categories
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The toolbar's "Priority" dropdown, beside the category menu: marks this conversation, a sender or
 * a sender's domain as priority, with the same choices as the conversation's context menu. A
 * conversation with several people lists each of them with their own address and domain.
 */
function PriorityMenuButton({ thread, own }: { thread: Thread; own: readonly string[] }) {
  const [open, setOpen] = useState(false);
  const list = usePriority();
  const on = isPriorityThread(list, thread);
  const sections = prioritySections(thread, own);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip open={open ? false : undefined}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Priority"
              className={cn(
                "corner-squircle electron-no-drag flex h-9 items-center gap-0.5 rounded-xl pl-2 pr-1.5",
                FLAT_KEY,
                on ? "text-amber" : "text-foreground",
              )}
            >
              <Zap className={cn("size-[18px]", on && "fill-current")} />
              <ChevronDown className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Priority</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="min-w-48">
        {sections.map((section) => {
          const items = section.choices.map((choice) => (
            <DropdownMenuItem
              key={`${choice.kind}:${choice.value}`}
              onSelect={(event) => {
                // Stays open, so the conversation and a sender or domain can be ticked in one go.
                event.preventDefault();
                togglePriority(choice.kind, choice.value);
              }}
            >
              <Zap />
              <span className="truncate">{choice.label}</span>
              {isPriorityEntry(list, choice.kind, choice.value) && <Check className="ml-auto text-muted-foreground" />}
            </DropdownMenuItem>
          ));
          // With several people, each opens a menu of their own address and domain.
          if (!section.contact) return <Fragment key="conversation">{items}</Fragment>;
          return (
            <DropdownMenuSub key={section.contact.email}>
              <DropdownMenuSubTrigger>
                <User />
                <span className="truncate">{contactLabel(section.contact)}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-48">{items}</DropdownMenuSubContent>
            </DropdownMenuSub>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The dropdown behind the Block and Mute commands: one choice per sender or domain, the same
 * wherever it is shown (the open conversation's toolbar, the selection bar). One conversation with
 * several people lists each of them with their own address and domain.
 */
function FilterMenuButton<K extends string>({
  label,
  command,
  icon: Icon,
  sections,
  onChoose,
  activeClass,
  placement,
  choiceLabel,
}: {
  label: string;
  /** Which command this is, for the dialog that asks before it acts on several senders or domains. */
  command: TargetsCommand;
  icon: LucideIcon;
  sections: BlockSection<K>[];
  onChoose: (kind: K, values: string[]) => void;
  /** The trigger's color while something is already blocked / muted. */
  activeClass: string;
  placement: "toolbar" | "bar";
  /**
   * Words each choice without a verb and shows a check beside the ones that are on, keeping the menu
   * open after a pick, as the Priority menu does. Without it a choice reads "Block x" / "Unblock x" and closes the menu.
   */
  choiceLabel?: (choice: BlockChoice<K>) => string;
}) {
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState<TargetsAsk | null>(null);
  const inBar = placement === "bar";
  if (sections.length === 0) return null;
  const on = sections.some((section) => section.choices.some((choice) => choice.on));
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip open={open ? false : undefined}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={label}
              className={cn(
                "corner-squircle electron-no-drag flex items-center gap-0.5",
                FLAT_KEY,
                inBar ? "h-8 rounded-[10px] px-1.5" : "h-9 rounded-xl pl-2 pr-1.5",
                on ? activeClass : !inBar && "text-foreground",
              )}
            >
              <Icon className={inBar ? "size-4" : "size-[18px]"} />
              <ChevronDown className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side={inBar ? "top" : "bottom"}>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align={inBar ? "center" : "start"} side={inBar ? "top" : "bottom"} className="min-w-48">
        {sections.map((section) => {
          const items = section.choices.map((choice) => (
            <DropdownMenuItem
              key={choice.kind}
              onSelect={(event) => {
                // Several senders or domains ask first, in a dialog that lists them.
                const many = targetsAsk(command, choice, (values) => onChoose(choice.kind, values));
                if (many) {
                  setAsk(many);
                  return;
                }
                // Stays open, so the conversation and a sender or domain can be ticked in one go.
                if (choiceLabel) event.preventDefault();
                onChoose(choice.kind, choice.values);
              }}
            >
              <Icon />
              <span className="truncate">{choiceLabel ? choiceLabel(choice) : choice.label}</span>
              {choiceLabel && choice.on && <Check className="ml-auto text-muted-foreground" />}
            </DropdownMenuItem>
          ));
          // With several people, each opens a menu of their own address and domain.
          if (!section.contact) return <Fragment key="all">{items}</Fragment>;
          return (
            <DropdownMenuSub key={section.contact.email}>
              <DropdownMenuSubTrigger>
                <User />
                <span className="truncate">{contactLabel(section.contact)}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-48">{items}</DropdownMenuSubContent>
            </DropdownMenuSub>
          );
        })}
      </DropdownMenuContent>
      {/* A portal of its own: it stays open after the menu closes. */}
      <TargetsDialog ask={ask} onClose={() => setAsk(null)} />
    </DropdownMenu>
  );
}

/**
 * The "Block" dropdown: blocks the sender or the sender's domain, whose mail then goes to the Trash.
 * One component for the open conversation's toolbar and the selection bar; `threads` are the
 * conversations it applies to.
 */
export function BlockMenuButton({
  threads,
  own,
  onBlock,
  placement = "toolbar",
}: {
  threads: readonly Thread[];
  /** The user's own addresses, never offered for blocking. */
  own: readonly string[];
  onBlock: (kind: BlockKind, values: string[]) => void;
  /** "bar" is the bulk action bar's: opens upward, sized like its icon buttons. */
  placement?: "toolbar" | "bar";
}) {
  const list = useBlockList();
  return (
    <FilterMenuButton
      label="Block"
      command="Block"
      icon={ShieldBan}
      sections={blockSections(list, threads, own)}
      onChoose={onBlock}
      activeClass={BLOCKED_TEXT}
      placement={placement}
    />
  );
}

/**
 * The "Mute" dropdown: stops notifications for the conversation, the sender or the sender's domain.
 * The mail still arrives where it always did. Same choices in every place it is shown.
 */
export function MuteMenuButton({
  threads,
  own,
  onMute,
  placement = "toolbar",
}: {
  threads: readonly Thread[];
  /** The user's own addresses, never offered for muting. */
  own: readonly string[];
  onMute: (kind: MuteKind, values: string[]) => void;
  placement?: "toolbar" | "bar";
}) {
  const { settings } = useNotificationSettings();
  const isMuted = mutedCheck(settings, threads.map((thread) => thread.accountId));
  return (
    <FilterMenuButton
      label="Mute"
      command="Mute"
      icon={BellOff}
      sections={muteSections(isMuted, threads, own)}
      onChoose={onMute}
      activeClass={MUTED_TEXT}
      choiceLabel={muteMenuLabel}
      placement={placement}
    />
  );
}

/**
 * The "Priority" dropdown of the selection bar: the same choices as the open conversation's, over
 * every selected conversation (the conversations themselves, their senders, their domains).
 */
export function PrioritySelectionMenuButton({
  threads,
  own,
  onChoose,
}: {
  threads: readonly Thread[];
  /** The user's own addresses, never offered for marking. */
  own: readonly string[];
  onChoose: (kind: PriorityKind, values: string[], on: boolean) => void;
}) {
  const list = usePriority();
  return (
    <FilterMenuButton
      label="Priority"
      command="Priority"
      icon={Zap}
      sections={priorityChoiceSections((kind, value) => isPriorityEntry(list, kind, value), threads, own)}
      onChoose={(kind, values) => onChoose(kind, values, !values.every((value) => isPriorityEntry(list, kind, value)))}
      activeClass="text-amber"
      choiceLabel={muteMenuLabel}
      placement="bar"
    />
  );
}

/** The toolbar buttons that file a conversation away. */
const DISCARDING_ACTIONS: ReadonlySet<MailAction> = new Set(["archive", "trash", "spam", "deleteForever"]);
/** Every move to a folder: the first of them is preceded by the category and priority menus and a divider. */
const MOVE_ACTIONS: ReadonlySet<MailAction> = new Set(["unarchive", ...DISCARDING_ACTIONS]);

/** After this long the view says the server is slow instead of just spinning. */
const SLOW_AFTER_MS = 5_000;
/** After this long the view stops waiting and offers a retry (the download carries on behind it). */
const GIVE_UP_AFTER_MS = 60_000;

/** Stands in for a message body that has not downloaded yet; the header above it comes from the list. */
function BodySkeleton() {
  return (
    <div className="space-y-2 px-4 pb-4" aria-hidden="true">
      <Skeleton className="h-3.5 w-full" />
      <Skeleton className="h-3.5 w-[92%]" />
      <Skeleton className="h-3.5 w-[96%]" />
      <Skeleton className="h-3.5 w-[60%]" />
    </div>
  );
}

/** Under the messages while older ones are still downloading. */
function LoadingNote({ slow }: { slow: boolean }) {
  return (
    <p className="text-xs text-muted-foreground" role="status">
      {slow ? (
        <span className="flex items-center gap-2">
          <Loader2 className="size-3.5 animate-spin" />
          The mail server is slow to respond. Still waiting for the rest of the conversation…
        </span>
      ) : (
        <span className="sr-only">Loading the rest of the conversation…</span>
      )}
    </p>
  );
}

/** In a long conversation, only this many of the newest messages are listed; the rest fold into one row. */
const FOLD_KEEP = 5;

/** How many of the oldest messages are folded into the "Show earlier" row. */
function foldedCountFor(total: number, showEarlier: boolean): number {
  return showEarlier ? 0 : Math.max(0, total - FOLD_KEEP);
}

/** Full conversation: toolbar, subject, and each message (older ones collapsed). */
export function ThreadView({
  mailActions,
  thread,
  folder,
  accounts,
  onBack,
  onAction,
  onCompose,
  categories,
  onMoveToCategory,
  onEditCategories,
  onBlock,
  onMute,
  onUnsubscribe,
  onSearch,
  shortcutsDisabled = false,
  embedded = false,
}: ThreadViewProps) {
  /** The messages downloaded so far, by id: the newest arrives first, then each older one. */
  const [loaded, setLoaded] = useState<ReadonlyMap<string, MessageDetail>>(() => new Map());
  /** True once every message has been asked for (a failure leaves it false and sets `error`). */
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  /** Bumped by "Try again" to run the download again. */
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** Whether the messages before the last `FOLD_KEEP` are listed, or folded into one row. */
  const [showEarlier, setShowEarlier] = useState(false);
  const markedRead = useRef(false);
  /** The scrolling column and the list of messages inside it, to keep the newest message centered. */
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** Set once the reader scrolls or clicks: from then on the view is theirs and is not moved again. */
  const userMoved = useRef(false);
  const openedAt = useRef(mailActions.manualVersion);
  const isMac = useIsMac();
  /** ⌘F: the bar that finds words in this conversation, and what it looks for. */
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const findInput = useRef<HTMLInputElement>(null);

  /** The messages that are on a mail server: a draft written here is shown as the draft row instead, never fetched. */
  const mailMessages = useMemo(() => thread.messages.filter((message) => !isLocalDraftId(message.id)), [thread.messages]);
  const idsKey = mailMessages.map((message) => message.id).join(",");

  useEffect(() => {
    let cancelled = false;
    setLoaded(new Map());
    setFinished(false);
    setError(null);
    // Open the newest message and anything unread; keep the rest collapsed.
    setExpanded(
      new Set(mailMessages.filter((message, index, all) => index === all.length - 1 || message.unread).map((message) => message.id)),
    );
    // Older messages stay folded, unless one of them is unread: that one must not be hidden.
    setShowEarlier(mailMessages.slice(0, -FOLD_KEEP).some((message) => message.unread));
    // The "slow" notice counts from the last arrival, so it only shows while the server is stuck.
    let slowTimer: ReturnType<typeof setTimeout> | undefined;
    const waitForServer = () => {
      clearTimeout(slowTimer);
      setSlow(false);
      slowTimer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    };
    waitForServer();
    const asked = performance.now();
    if (import.meta.env.DEV) console.log(`[perf] open conversation: asking for ${mailMessages.length} message(s), newest first`);
    void (async () => {
      try {
        // One message at a time, newest first: each shows as soon as it arrives, the older ones follow.
        for (const { id } of [...mailMessages].reverse()) {
          const [detail] = await withTimeout(
            api.mail.get([id]),
            GIVE_UP_AFTER_MS,
            "The mail server took too long to send this conversation.",
          );
          if (cancelled) return;
          waitForServer();
          if (import.meta.env.DEV) {
            console.log(`[perf] open conversation: ${detail ? "got" : "no"} message ${Math.round(performance.now() - asked)}ms in`);
          }
          if (!detail) continue;
          setLoaded((known) => new Map(known).set(detail.id, detail));
        }
        clearTimeout(slowTimer);
        setSlow(false);
        setFinished(true);
      } catch (reason: unknown) {
        if (cancelled) return;
        clearTimeout(slowTimer);
        setSlow(false);
        if (import.meta.env.DEV) console.log(`[perf] open conversation: failed after ${Math.round(performance.now() - asked)}ms`);
        setError(reason instanceof Error ? reason.message : String(reason));
        noteShownError("Could not open the conversation", reason);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(slowTimer);
    };
    // idsKey captures the message list; thread identity alone would miss new replies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, attempt]);

  // Opening a conversation puts the newest message in the middle of the screen. Older messages arrive
  // above it and images load, which pushes it around, so the view is re-centered on every size change
  // until the reader scrolls or clicks.
  useEffect(() => {
    const scroller = scrollRef.current;
    const list = listRef.current;
    if (!scroller || !list) return;
    userMoved.current = false;
    const center = () => {
      const last = list.lastElementChild;
      if (userMoved.current || !last) return;
      const box = scroller.getBoundingClientRect();
      const rect = last.getBoundingClientRect();
      const top = rect.top - box.top + scroller.scrollTop;
      // A message taller than the screen starts at the top instead: its beginning must stay visible.
      const offset = rect.height < box.height ? (box.height - rect.height) / 2 : 16;
      scroller.scrollTop = Math.max(0, top - offset);
    };
    const observer = new ResizeObserver(center);
    observer.observe(list);
    observer.observe(scroller);
    const stop = () => {
      userMoved.current = true;
    };
    const events = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const name of events) scroller.addEventListener(name, stop, { passive: true });
    return () => {
      observer.disconnect();
      for (const name of events) scroller.removeEventListener(name, stop);
    };
    // idsKey stands for the message list: a new conversation is centered again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  // Scrolling to a match is the reader's own move: the view stops re-centering the newest message.
  const stopCentering = useCallback(() => {
    userMoved.current = true;
  }, []);
  const { count: findCount, index: findIndex, step } = useThreadFind({
    open: findOpen,
    query: findQuery,
    listRef,
    scrollRef,
    contentKey: `${loaded.size}:${[...expanded].join(",")}:${showEarlier}`,
    onReveal: stopCentering,
  });

  // A conversation has its own search: opening another one closes the bar.
  useEffect(() => {
    setFindOpen(false);
  }, [thread.id]);

  // ⌘F (Ctrl+F elsewhere) opens the bar, or puts the cursor back in it; ⌘G / ⇧⌘G step through the matches.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (shortcutsDisabled || event.altKey) return;
      if (!(isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "f" && !event.shiftKey) {
        event.preventDefault();
        if (findOpen) {
          findInput.current?.focus();
          findInput.current?.select();
        } else setFindOpen(true);
      } else if (key === "g" && findOpen) {
        event.preventDefault();
        step(event.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isMac, shortcutsDisabled, findOpen, step]);

  // Looking for a word opens the messages that hold it, so there is something to find.
  useEffect(() => {
    if (!findOpen || findQuery.trim() === "") return;
    const holding = [...loaded.values()].filter((message) => containsText(messageText(message), findQuery)).map((message) => message.id);
    setExpanded((previous) => (holding.every((id) => previous.has(id)) ? previous : new Set([...previous, ...holding])));
    // Folded-away older messages are shown too when one of them holds the word.
    if (holding.some((id) => mailMessages.findIndex((message) => message.id === id) < foldedCountFor(mailMessages.length, showEarlier))) {
      setShowEarlier(true);
    }
  }, [findOpen, findQuery, loaded, showEarlier, mailMessages]);

  const closeFind = () => {
    setFindOpen(false);
    setFindQuery("");
  };

  /** What has arrived, in conversation order (oldest first). */
  const details = useMemo(
    () => mailMessages.flatMap((message) => loaded.get(message.id) ?? []),
    // idsKey stands for the message list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [idsKey, loaded],
  );

  // Opening a conversation reads it, once per thread.
  useEffect(() => {
    // The newest message is the one that counts as opened; the older ones follow within moments.
    if (details.length === 0 || markedRead.current) return;
    markedRead.current = true;
    if (thread.unread && !mailActions.manuallyUnreadSince(thread.id, openedAt.current)) onAction("markRead");
  }, [details, thread.id, thread.unread, onAction, mailActions]);

  /** How many of the oldest messages are folded into the "Show earlier" row. */
  const foldedCount = foldedCountFor(mailMessages.length, showEarlier);
  const latest = details[details.length - 1];
  const actions = useMemo(() => actionsForThread(folder, thread), [folder, thread]);
  const owner = accountFor(accounts, thread.accountId);
  const blockList = useBlockList();
  const ownAddresses = useMemo(() => accounts.map((account) => account.email), [accounts]);
  // A message sent from one of the user's own addresses shows that account's picture, not a sender avatar.
  const accountByAddress = useMemo(
    () => new Map(accounts.map((account) => [account.email.toLowerCase(), account])),
    [accounts],
  );
  const threadList = useMemo(() => [thread], [thread]);
  const unsubscribedLists = useUnsubscribed();
  const unsubscribeCmd = useMemo(() => unsubscribeCommand(threadList, unsubscribedLists), [threadList, unsubscribedLists]);
  const unsubscribeAction = unsubscribeButton(unsubscribeCmd, false);
  // The category, priority, mute and block menus sit after Pin and read, then a divider and the moves (Inbox, Archive, ...).
  /** Sent and Drafts hold the user's own mail, which is never priority mail and is never blocked. */
  const savedDrafts = useDrafts();
  const draftsHere = useMemo(() => {
    const replies = draftsForThread(savedDrafts, thread);
    // A draft that is the open conversation itself (a new message, or one opened from the Drafts list).
    const own = thread.messages.flatMap((message) => {
      const id = draftIdOf(message.id);
      const draft = id === null ? undefined : savedDrafts.find((item) => item.id === id);
      return draft && !replies.some((item) => item.id === draft.id) ? [draft] : [];
    });
    return [...replies, ...own].sort((a, b) => a.savedAt.localeCompare(b.savedAt));
  }, [savedDrafts, thread]);
  const priorityShown = folder !== "sent" && folder !== "drafts";
  const categoryMenuBefore = useMemo(
    () => actions.find(({ action }) => MOVE_ACTIONS.has(action))?.action ?? null,
    [actions],
  );
  const filterMenus = priorityShown ? (
    <>
      {onMute && <MuteMenuButton threads={threadList} own={ownAddresses} onMute={onMute} />}
      {onBlock && <BlockMenuButton threads={threadList} own={ownAddresses} onBlock={onBlock} />}
      {onUnsubscribe && unsubscribeCmd.shown && (
        <ToolbarButton
          label="Unsubscribe"
          tip={unsubscribeAction.label}
          disabled={unsubscribeAction.disabled}
          onClick={onUnsubscribe}
          confirm={unsubscribeConfirm(1)}
        >
          <ListX className="size-[18px]" />
        </ToolbarButton>
      )}
    </>
  ) : null;

  const toggle = (id: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** A name or address in a message header that opens the card with that person's actions. */
  const card = (contact: Contact, label: ReactNode, logo?: LogoRequest | null, className?: string) => (
    <ContactCard
      contact={contact}
      className={className}
      logo={logo}
      own={ownAddresses}
      hideFiltering={!priorityShown}
      onCompose={(to) => onCompose({ ...newMessageSeed(thread.accountId), to: [to] })}
      onSearch={(from) => onSearch?.(from)}
      onBlock={onBlock}
      onMute={onMute}
      accountId={thread.accountId}
    >
      {label}
    </ContactCard>
  );
  const recipients = (contacts: readonly Contact[]) =>
    contacts.map((contact, index) => (
      <Fragment key={`${contact.email}:${index}`}>
        {card(contact, contactLabel(contact))}
        {index < contacts.length - 1 && <span className="-ml-1">,</span>}
      </Fragment>
    ));

  /** A reply, with the conversation before it so the text suggestions can read it. */
  const replySeed = (message: MessageDetail, mode: "reply" | "replyAll" | "forward"): ComposeSeed => ({
    ...buildReplySeed(message, mode, accounts),
    earlier: earlierMessages(mailMessages, details, message.id),
  });
  const startCompose = (mode: "reply" | "replyAll" | "forward") => {
    if (latest) onCompose(replySeed(latest, mode));
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
      onCompose(replySeed(latest, mode));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // replySeed only reads what these already list, or what changes with them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, details, latest, onCompose, shortcutsDisabled]);

  // What the conversation holds, listed in the dropdown left of Reply.
  // Listed once the whole conversation is here, so the list does not grow while older messages arrive.
  const artifacts = useMemo(() => (finished ? collectArtifacts(details) : null), [finished, details]);
  const expecting = {
    attachments: !error && mailMessages.some((message) => message.hasAttachments),
    invitations: !error && mailMessages.some((message) => message.signal === "invitation"),
  };
  const { emailWidth } = useAppearance();

  const openAttachment = async (attachment: ThreadAttachment) => {
    try {
      await api.mail.openAttachment(attachment.messageId, attachment.id);
    } catch (failure) {
      toast.error(`Couldn't open ${attachment.filename}`, { description: failure instanceof Error ? failure.message : String(failure) });
    }
  };
  const saveAttachment = async (attachment: ThreadAttachment) => {
    try {
      await api.mail.saveAttachment(attachment.messageId, attachment.id);
    } catch (failure) {
      toast.error(`Couldn't save ${attachment.filename}`, { description: failure instanceof Error ? failure.message : String(failure) });
    }
  };
  const respond = async (entry: ThreadInvitation, response: InvitationResponse) => {
    try {
      await api.mail.respondToInvitation(entry.messageId, response);
      setLoaded((known) => new Map(withAnswer([...known.values()], entry.invitation.uid, response).map((message) => [message.id, message])));
      toast.success({ accepted: "You accepted the invitation", tentative: "You answered maybe", declined: "You declined the invitation" }[response]);
    } catch (failure) {
      const description = failure instanceof Error ? failure.message : String(failure);
      const ref = parseMessageId(entry.messageId);
      if (description === CALENDAR_ACCESS_REQUIRED && ref) {
        toast.error("Calendar access required", {
          description,
          action: {
            label: "Allow access",
            onClick: async () => {
              try {
                await api.accounts.reconnect(ref.accountId, true);
                toast.success("Calendar access enabled. Choose your answer again to send it.");
              } catch (error) {
                toast.error(error instanceof Error ? error.message : String(error));
              }
            },
          },
        });
        return;
      }
      toast.error("Couldn't send your answer", { description });
    }
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <header
        className={cn(
          "flex shrink-0 items-center justify-between [container-type:inline-size]",
          embedded
            ? "h-12 px-3"
            : "electron-window-drag h-16 items-end px-6 pb-3 pt-3",
        )}
      >
        <div className="flex items-center gap-1">
          {!embedded && (
            <>
              <ToolbarButton label="Back" hint="Esc" onClick={onBack}>
                <ArrowLeft className="size-[18px]" />
              </ToolbarButton>
              <span className="groove-v mx-1.5 h-5" />
            </>
          )}
          {actions.map(({ action, label, icon: Icon, hint }) => (
            <Fragment key={action}>
              {/* The category and priority menus close the everyday buttons; a divider sets the moves to a folder apart. */}
              {action === categoryMenuBefore && categories && onMoveToCategory && (
                <CategoryMenuButton
                  categories={categories}
                  currentId={thread.categoryId}
                  onMove={onMoveToCategory}
                  onEdit={onEditCategories}
                />
              )}
              {action === categoryMenuBefore && categories && onMoveToCategory && priorityShown && (
                <PriorityMenuButton thread={thread} own={ownAddresses} />
              )}
              {action === categoryMenuBefore && filterMenus}
              {action === categoryMenuBefore && <span className="groove-v mx-1.5 h-5" />}
              <ToolbarButton
                label={label}
                hint={hint}
                onClick={() => onAction(action)}
                confirm={action === "deleteForever" ? DELETE_FOREVER_CONFIRM : undefined}
              >
                <Icon className="size-[18px]" />
              </ToolbarButton>
            </Fragment>
          ))}
          {categoryMenuBefore === null && filterMenus}
          {categories && onMoveToCategory && categoryMenuBefore === null && (
            <CategoryMenuButton
              categories={categories}
              currentId={thread.categoryId}
              onMove={onMoveToCategory}
              onEdit={onEditCategories}
            />
          )}
          {priorityShown && (categoryMenuBefore === null || !(categories && onMoveToCategory)) && (
            <PriorityMenuButton thread={thread} own={ownAddresses} />
          )}
          <FolderBadge folder={folder} />
        </div>
        <div className="flex items-center gap-1">
          <ThreadCard
            artifacts={artifacts}
            expecting={expecting}
            onOpenAttachment={openAttachment}
            onSaveAttachment={saveAttachment}
            onRespond={respond}
          />
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

      {/* Floats over the conversation, so opening it does not move the page. */}
      {findOpen && (
        <FindBar
          inputRef={findInput}
          query={findQuery}
          onQueryChange={setFindQuery}
          count={findCount}
          index={findIndex}
          onStep={step}
          onClose={closeFind}
          className={cn("absolute right-6 z-20", embedded ? "top-12" : "top-[4.25rem]")}
        />
      )}

      <div ref={scrollRef} className={cn("min-h-0 flex-1 overflow-y-auto pb-[45vh]", embedded ? "px-6 pt-4" : "px-8 pt-6")}>
        <div
          className={cn(
            "gap-8",
            embedded
              ? "mx-auto flex max-w-3xl flex-col"
              : "mx-auto flex max-w-[var(--reading-width)] items-start",
          )}
          style={{ "--reading-width": `${EMAIL_WIDTH_REM[emailWidth]}rem` } as CSSProperties}
        >
          <div className="min-w-0 flex-1">
            <h1 className="mb-1 text-2xl font-semibold leading-tight">
              {normalizeSubject(thread.latest.subject)}
            </h1>
            <p className="mb-6 text-sm text-muted-foreground">
              {mailMessages.length === 0 ? "Draft" : `${thread.count} ${thread.count === 1 ? "message" : "messages"}`}
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

            <div ref={listRef} className="space-y-3" aria-busy={!finished && !error}>
              {foldedCount > 0 && (
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center justify-center gap-2 py-1 text-sm text-muted-foreground hover:text-foreground"
                  onClick={() => setShowEarlier(true)}
                >
                  <ChevronDown className="size-4" />
                  Show {foldedCount} earlier {foldedCount === 1 ? "message" : "messages"}
                </button>
              )}
              {mailMessages.map((summary, index) => {
                if (index < foldedCount) return null;
                // The header comes from the list, so it is there at once; the body and the cc line arrive with the download.
                const message = loaded.get(summary.id);
                const header = message ?? summary;
                const copied = message?.cc ?? [];
                const open = expanded.has(summary.id);
                return (
                  <article
                    key={summary.id}
                    className={cn(
                      "corner-squircle rounded-2xl",
                      // In the split view the pane is itself a plate, so the messages sit one level higher.
                      embedded
                        ? open ? "plate-2" : "shadow-raise-3 hover:plate-2 hover:shadow-raise-2"
                        : open ? "plate-1" : "shadow-raise-3 hover:plate-1 hover:shadow-raise-1",
                    )}
                  >
                    {/* A div, not a button: the names and addresses inside it open their own cards. */}
                    <div
                      role="button"
                      tabIndex={0}
                      aria-expanded={open}
                      className="flex w-full cursor-pointer items-center gap-3 p-4 text-left"
                      onClick={() => toggle(summary.id)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
                        event.preventDefault();
                        toggle(summary.id);
                      }}
                    >
                      {(() => {
                        const own = accountByAddress.get(header.from.email.toLowerCase());
                        return own ? (
                          <AccountMark account={own} size={36} />
                        ) : (
                          <SenderAvatar contact={header.from} size={36} logo={logoRequestFor(header)} />
                        );
                      })()}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          {card(header.from, contactLabel(header.from), logoRequestFor(header), "min-w-0 truncate font-semibold")}
                          {isBlockedAddress(blockList, header.from.email) && (
                            <span title="Blocked" className="flex shrink-0 self-center">
                              <ShieldBan aria-label="Blocked" className="size-3.5 text-destructive" />
                            </span>
                          )}
                          {card(header.from, header.from.email, logoRequestFor(header), "min-w-0 truncate text-xs text-muted-foreground")}
                        </div>
                        <div className="flex flex-wrap items-baseline gap-x-1 text-xs text-muted-foreground">
                          <span>to</span>
                          {header.to.length === 0 && <span>me</span>}
                          {recipients(header.to)}
                          {copied.length > 0 && <span>, cc</span>}
                          {recipients(copied)}
                        </div>
                      </div>
                      {(message ? message.attachments.length > 0 : summary.hasAttachments) && (
                        <Paperclip className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatFullDate(header.date)}
                      </span>
                    </div>

                    {open &&
                      (message ? (
                        <div className="space-y-4 px-4 pb-4">
                          <MessageBody message={message} />
                        </div>
                      ) : (
                        !finished && !error && <BodySkeleton />
                      ))}
                  </article>
                );
              })}
              {/* A draft written for this conversation closes it, as the next thing to say. */}
              {draftsHere.map((draft) => (
                <button
                  key={draft.id}
                  type="button"
                  onClick={() => onCompose(seedFromDraft(draft))}
                  className="corner-squircle flex w-full cursor-pointer items-center gap-3 rounded-2xl p-4 text-left shadow-raise-3 hover:plate-1 hover:shadow-raise-1"
                >
                  <Pencil className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="shrink-0 font-semibold">Draft</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                    {draft.body.replace(/\s+/g, " ").trim() || "Empty"}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatFullDate(draft.savedAt)}</span>
                </button>
              ))}
            </div>
            {!finished && !error && <LoadingNote slow={slow} />}
          </div>
        </div>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Archive, ArrowUpRight, Ban, FolderInput, Inbox, Mail, MailOpen, PanelRightClose, PanelRightOpen, Pin, PinOff, ShieldAlert, Trash2, type LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { iconFor } from "@shared/categories";
import {
  buildFlatList,
  buildFocusedList,
  groupDefs,
  MINIMIZED_SECTION,
  PINNED_SECTION,
  threadsInGroup,
  type GroupKind,
  type GroupListItem,
  type ListItem,
} from "@shared/focus-list";
import { dropFolderDuplicates, matchesDrill, receivedMail, type DashboardRange } from "@shared/dashboard";
import { buildSenders, threadsFromDomain, threadsFromSender } from "@shared/sender-list";
import { conversationFolder, groupThreads, MOVE_DESTINATION, withRelatedMessages, type Thread } from "@shared/threads";
import type { MailAction, MailFolder, MessageSummary, ShownFolder, UiPrefs } from "@shared/types";

import { Composer } from "@/components/mail/composer";
import { Dashboard, type DashboardSelection } from "@/components/mail/dashboard";
import { FocusedList } from "@/components/mail/focused-list";
import { LocalDrafts } from "@/components/mail/local-drafts";
import { categoryMenuIcon } from "@/components/mail/category-icon";
import { ItemMenu, type MenuEntry } from "@/components/mail/item-menu";
import { DrillHeader, GroupHeader, ListHeader, VIEWS, type MailView } from "@/components/mail/list-header";
import type { SelectModifiers } from "@/components/mail/thread-row";
import { Rail } from "@/components/mail/rail";
import { SplitHandle } from "@/components/mail/split-handle";
import {
  SenderHeading,
  GroupByDomainButton,
  SenderPanel,
  useSenderPanelState,
  type SenderNavRow,
  type SenderPanelState,
} from "@/components/mail/sender-panel";
import { AccountErrorToasts, EmptyList, ListSkeleton, NoAccounts } from "@/components/mail/states";
import { ThreadView } from "@/components/mail/thread-view";
import { useIsMac } from "@/hooks/use-platform";
import { SettingsDialog, type SettingsTab } from "@/components/settings/settings-dialog";
import { ConfirmPopover } from "@/components/ui/confirm-popover";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCategories } from "@/hooks/use-categories";
import { useDashboardMail } from "@/hooks/use-dashboard-mail";
import { useConversationMail } from "@/hooks/use-conversation-mail";
import { useMinimizedCategories } from "@/hooks/use-minimized-categories";
import { matchesQuery, SHOWN_FOLDERS, useMailbox } from "@/hooks/use-mailbox";
import { api } from "@/lib/api";
import { effectiveCategoryLayout, setAppearance, useAppearance } from "@/lib/appearance";
import { newMessageSeed, type ComposeSeed } from "@/lib/compose";
import { refreshContacts } from "@/lib/contact-cache";
import { seedFromDraft, useDrafts } from "@/lib/drafts";
import { FOLDER_TITLES } from "@/lib/format";
import { isTypingTarget } from "@/lib/keyboard";
import { DELETE_FOREVER_CONFIRM } from "@/lib/delete-confirm";
import { actionsForThread } from "@/lib/row-actions";
import { cn } from "@/lib/utils";

/** The folders behind ⌘2–⌘4, in rail order (⌘1 is the Dashboard). */
const RAIL_FOLDERS: readonly MailFolder[] = ["inbox", "drafts", "sent"];

/** What the split view's pane shows for a selected row: its conversation, or nothing for a category row. */
function paneIdFor(item: ListItem | undefined): string | null {
  return item?.type === "thread" ? item.thread.id : null;
}

/** Actions that take a conversation out of the current view. */
function removesFromView(action: MailAction, folder: MailFolder): boolean {
  return (
    action === "archive" ||
    action === "unarchive" ||
    action === "trash" ||
    action === "spam" ||
    action === "deleteForever" ||
    (action === "unpin" && folder === "pinned")
  );
}

/** Actions that move a conversation to another folder. */
const MOVE_ACTIONS: ReadonlySet<MailAction> = new Set(["archive", "unarchive", "trash", "spam", "deleteForever"]);

/**
 * The messages of a conversation in a mixed list an action applies to: a move takes the messages
 * in the folder the conversation is shown in (see `conversationFolder`); flags take them all.
 */
function idsForAction(action: MailAction, thread: Thread): string[] {
  const from = conversationFolder(thread);
  return thread.messages
    .filter((message) => !MOVE_ACTIONS.has(action) || message.folder === from)
    .map((message) => message.id);
}

const PINNED_COLLAPSED_KEY = "minimail.pinnedCollapsed";
const MINIMIZED_EXPANDED_KEY = "minimail.minimizedExpanded";

/** Whether the user unfolded the Minimized heading last time (it starts folded); never throws. */
function readMinimizedExpanded(): boolean {
  try {
    return window.localStorage.getItem(MINIMIZED_EXPANDED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Whether the user folded the Pinned heading last time; storage may be unavailable, so never throw. */
function readPinnedCollapsed(): boolean {
  try {
    return window.localStorage.getItem(PINNED_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

/** How long a first press of a destructive shortcut waits for its confirming second press. */
const CONFIRM_WINDOW_MS = 3000;
const CONFIRM_TOAST_ID = "confirm-shortcut";

/** A destructive shortcut that has been pressed once and is waiting for the same key again. */
interface PendingConfirm {
  key: string;
  action: MailAction;
  threadId: string;
  timer: ReturnType<typeof setTimeout>;
}

/** An open item menu: where it is, and which list row (or the open conversation) it is for. */
interface ItemMenuState {
  x: number;
  y: number;
  /** A row key, or null for the conversation on screen. */
  key: string | null;
}

interface ComposeState {
  seed: ComposeSeed;
  /** Remounts the composer so each opening starts from a fresh seed. */
  id: number;
}

/**
 * The whole client: rail, the list in the chosen view (by category, by sender, or plain),
 * conversation view and dialogs.
 */
export function MailApp() {
  /** The folders whose mail the Inbox list shows: only the inbox until others are checked. */
  const [shownFolders, setShownFolders] = useState<readonly ShownFolder[]>(["inbox"]);
  /** Choices the user has made since launch; the saved ones arriving late must not override them. */
  const touchedPrefs = useRef(new Set<keyof UiPrefs>());
  /** Remembers a choice on disk so the app reopens the same way. */
  const savePrefs = useCallback((patch: Partial<UiPrefs>) => {
    for (const key of Object.keys(patch)) touchedPrefs.current.add(key as keyof UiPrefs);
    api.prefs.set(patch).catch(() => undefined); // Only the memory of the choice is lost.
  }, []);
  const shownFoldersRef = useRef(shownFolders);
  shownFoldersRef.current = shownFolders;
  const toggleShownFolder = useCallback(
    (name: ShownFolder) => {
      const current = shownFoldersRef.current;
      const next = current.includes(name) ? current.filter((entry) => entry !== name) : [...current, name];
      shownFoldersRef.current = next;
      setShownFolders(next);
      savePrefs({ shownFolders: [...next] });
    },
    [savePrefs],
  );
  const {
    accounts,
    accountsLoaded,
    reloadAccounts,
    scope,
    setScope,
    folder,
    setFolder,
    threads: allThreads,
    loading,
    errors,
    query,
    setQuery,
    refresh,
    act,
    assignCategory,
    undo,
    onSettled,
  } = useMailbox(shownFolders);
  const { categories, ai, setState: setCategoryState } = useCategories();
  /** The toolbar's unread filter: lists show only conversations with unread mail, in every view and folder. */
  const [unreadOnly, setUnreadOnlyState] = useState(false);
  const setUnreadOnly = useCallback(
    (on: boolean) => {
      setUnreadOnlyState(on);
      savePrefs({ unreadOnly: on });
    },
    [savePrefs],
  );

  // --- Dashboard: statistics over Inbox, Archive, Spam and Trash, and the mail behind them -------
  const [screen, setScreen] = useState<"mail" | "dashboard">("mail");
  const onDashboard = screen === "dashboard";
  const [dashboardRange, setDashboardRange] = useState<DashboardRange>("30d");
  /** What a Dashboard click picked; its mail is listed instead of the charts. */
  const [drill, setDrill] = useState<DashboardSelection | null>(null);
  /** The mail behind a Dashboard click is on screen, as a list like the Inbox's. */
  const inDrill = onDashboard && drill !== null;
  /** The folders a Dashboard list shows: all of them until the user turns some off. */
  const [drillShown, setDrillShown] = useState<readonly ShownFolder[]>(SHOWN_FOLDERS);
  const toggleDrillFolder = useCallback((name: ShownFolder) => {
    setDrillShown((previous) =>
      previous.includes(name) ? previous.filter((entry) => entry !== name) : [...previous, name],
    );
  }, []);
  /** The folder the list on screen belongs to: a Dashboard list mixes folders, like the Inbox list. */
  const listFolder: MailFolder = inDrill ? "inbox" : folder;
  /** The folder a conversation is in; in a list that mixes folders that can be Archive, Trash or Spam. */
  const threadFolder = useCallback(
    (thread: Thread): MailFolder => (listFolder === "inbox" ? conversationFolder(thread) : listFolder),
    [listFolder],
  );
  const dashboardMail = useDashboardMail(accounts.length, onDashboard);
  const { apply: applyToDashboard, reload: reloadDashboard } = dashboardMail;

  // Dashboard actions change its copy at once. Once an action reaches the server, is undone or
  // fails, the copy is reloaded so it matches the server again.
  useEffect(
    () =>
      onSettled(() => {
        if (onDashboard) void reloadDashboard(true);
      }),
    [onSettled, reloadDashboard, onDashboard],
  );

  const dashboardMessages = useMemo(() => dropFolderDuplicates(dashboardMail.messages), [dashboardMail.messages]);

  const drillMatches = useMemo(() => {
    if (!drill) return [];
    const now = Date.now();
    return receivedMail(dashboardMessages, accounts.map((account) => account.email)).filter((message) =>
      matchesDrill(message, drill, now),
    );
  }, [drill, dashboardMessages, accounts]);

  /** Whole conversations of the matching mail (the user's own replies included), newest first. */
  const drillThreads = useMemo(() => {
    const keys = new Set(drillMatches.map((message) => `${message.accountId}:${message.threadId}`));
    return groupThreads(
      dashboardMessages.filter((message) => keys.has(`${message.accountId}:${message.threadId}`)),
    );
  }, [drillMatches, dashboardMessages]);

  /** Whether a message of a Dashboard list is in the account and folders the toolbar shows. */
  const inDrillView = useCallback(
    (message: MessageSummary) =>
      (scope === "all" || message.accountId === scope) &&
      (!SHOWN_FOLDERS.includes(message.folder as ShownFolder) || drillShown.includes(message.folder as ShownFolder)),
    [scope, drillShown],
  );

  /** The conversations of a Dashboard list after the toolbar's account, folders, search and unread filter. */
  const drillListThreads = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const messages = drillThreads
      .flatMap((thread) => thread.messages)
      .filter((message) => inDrillView(message) && (words.length === 0 || matchesQuery(message, words)));
    const shown = groupThreads(messages);
    return unreadOnly ? shown.filter((thread) => thread.unread) : shown;
  }, [drillThreads, inDrillView, query, unreadOnly]);

  const threads = useMemo(
    () =>
      inDrill
        ? drillListThreads
        : unreadOnly
          ? allThreads.filter((thread) => thread.unread)
          : allThreads,
    [allThreads, drillListThreads, inDrill, unreadOnly],
  );
  const [view, setView] = useState<MailView>("category");
  /** Drafts and Sent are always a plain list: the Smart and Sender views make no sense there. */
  const listOnly = !inDrill && (folder === "drafts" || folder === "sent");
  const activeView: MailView = listOnly ? "list" : view;
  // Reopen with the view tab and list filters that were last chosen.
  useEffect(() => {
    api.prefs
      .get()
      .then((saved) => {
        const touched = touchedPrefs.current;
        if (!touched.has("view")) setView(saved.view);
        if (!touched.has("unreadOnly")) setUnreadOnlyState(saved.unreadOnly);
        if (!touched.has("shownFolders")) setShownFolders(saved.shownFolders);
      })
      .catch(() => undefined); // The defaults are fine if the saved choices cannot be read.
  }, []);

  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  /** The group whose own list is showing (Category view). */
  const [openGroupKind, setOpenGroupKind] = useState<GroupKind | null>(null);
  /** The sender picked in the Sender view's panel; the first one stands in until one is picked. */
  const [senderKey, setSenderKey] = useState<string | null>(null);
  /** A domain picked in the panel (grouped by domain); it lists the mail of all its senders. */
  const [senderDomain, setSenderDomain] = useState<string | null>(null);
  /** Sender view: the arrow keys walk the senders panel instead of the mail list. */
  const [senderPanelFocus, setSenderPanelFocus] = useState(false);
  /** The panel's rows as it shows them (filled by the panel), and its state, for the keyboard. */
  const senderNavRows = useRef<readonly SenderNavRow[]>([]);
  const senderPanelRef = useRef<SenderPanelState | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  /** Where a shift-click or shift+arrow range starts; follows plain clicks and plain arrows. */
  const anchorKey = useRef<string | null>(null);
  /** The vertical card Down left from, so Up from the list below returns to that card. */
  const cardBelowKey = useRef<string | null>(null);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const savedDrafts = useDrafts();
  const [itemMenu, setItemMenu] = useState<ItemMenuState | null>(null);
  // The card that asks before a conversation chosen in the menu is deleted for good.
  const [deleteConfirm, setDeleteConfirm] = useState<{ x: number; y: number; thread: Thread } | null>(null);
  // Learn who the user writes to as soon as accounts are known, so the composer can suggest at once.
  useEffect(() => {
    if (accountsLoaded && accounts.length > 0) void refreshContacts();
  }, [accountsLoaded, accounts.length]);

  const clearListState = useCallback(() => {
    setOpenThreadId(null);
    setOpenGroupKind(null);
    setChecked(new Set());
    anchorKey.current = null;
    setSenderPanelFocus(false);
    setQuery("");
    setSearchOpen(false);
  }, [setQuery]);

  const openDashboard = useCallback(() => {
    setScreen("dashboard");
    setDrill(null);
    clearListState();
  }, [clearListState]);

  const navigateFolder = useCallback(
    (next: MailFolder) => {
      setScreen("mail");
      setDrill(null);
      setOpenThreadId(null);
      setFolder(next);
    },
    [setFolder],
  );

  const openDrill = useCallback(
    (selection: DashboardSelection) => {
      setDrill(selection);
      setDrillShown(SHOWN_FOLDERS);
      clearListState();
    },
    [clearListState],
  );

  /** Back from a Dashboard list to the charts. */
  const closeDrill = useCallback(() => {
    setDrill(null);
    clearListState();
  }, [clearListState]);

  const [pinnedCollapsed, setPinnedCollapsed] = useState(readPinnedCollapsed);
  const [minimizedExpanded, setMinimizedExpanded] = useState(readMinimizedExpanded);
  const isMac = useIsMac();
  /** The settings dialog: open or not, the page it opens on, and whether Accounts opens on the add picker. */
  const [settingsDialog, setSettingsDialog] = useState<{ open: boolean; tab: SettingsTab; adding: boolean }>({
    open: false,
    tab: "appearance",
    adding: false,
  });

  // Section boundaries (Today / Yesterday) are recomputed whenever the data changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [threads]);

  // Categories collapse into group rows on the Inbox only; other folders list by date.
  const focused = activeView === "category" && (inDrill || folder === "inbox");

  // The group stays open while the unread filter hides all its mail (it then shows the empty state);
  // it only closes once it has no mail at all.
  const openGroup = useMemo(() => {
    if (!focused || openGroupKind === null) return null;
    const def = groupDefs(categories).find((candidate) => candidate.kind === openGroupKind);
    if (!def || threadsInGroup(inDrill ? drillThreads : allThreads, openGroupKind).length === 0) return null;
    return { def, threads: threadsInGroup(threads, openGroupKind) };
  }, [focused, openGroupKind, categories, allThreads, drillThreads, inDrill, threads]);

  const senderView = activeView === "sender";
  const senders = useMemo(() => (senderView ? buildSenders(threads) : []), [senderView, threads]);
  const activeSender =
    senderView
      ? (senders.find((sender) => sender.key === senderKey) ?? senders[0] ?? null)
      : null;
  const activeDomain = senderView ? senderDomain : null;
  const activeSenderKey = activeDomain ? null : (activeSender?.key ?? null);

  /** The conversations the list on screen is made of. */
  const listThreads = useMemo(() => {
    if (openGroup) return openGroup.threads;
    if (!senderView) return threads;
    if (activeDomain) return threadsFromDomain(threads, activeDomain);
    return activeSenderKey ? threadsFromSender(threads, activeSenderKey) : [];
  }, [openGroup, senderView, threads, activeDomain, activeSenderKey]);

  const appearance = useAppearance();
  const categoryLayout = effectiveCategoryLayout(appearance);
  const { minimized, setCategoryMinimized } = useMinimizedCategories();
  const { items, dockGroups } = useMemo(() => {
    if (!focused || openGroup) return { items: buildFlatList(listThreads, now), dockGroups: [] };
    const all = buildFocusedList(threads, { now, categories, pinnedCollapsed });
    // Minimized categories leave the category rows (and their place in the keyboard navigation).
    const isDocked = (item: ListItem): item is GroupListItem => item.type === "group" && minimized.has(item.kind);
    const rest: ListItem[] = all.filter((item) => !isDocked(item));
    const docked = all.filter(isDocked);
    // Cards keep their dock at the list's right edge. Rows get a foldable "Minimized" heading right
    // after the category rows: folded it shows the categories as icons, unfolded as slim rows.
    if (categoryLayout === "vertical" || docked.length === 0) return { items: rest, dockGroups: docked };
    const at = rest.findIndex((item) => item.type !== "group");
    const heading: ListItem = {
      type: "section",
      key: MINIMIZED_SECTION,
      label: "Minimized",
      collapsible: { collapsed: !minimizedExpanded, count: docked.length },
      docked,
    };
    const slim = minimizedExpanded ? docked.map((group): ListItem => ({ ...group, slim: true })) : [];
    rest.splice(at < 0 ? rest.length : at, 0, heading, ...slim);
    return { items: rest, dockGroups: docked };
  }, [focused, openGroup, threads, listThreads, now, categories, pinnedCollapsed, minimized, categoryLayout, minimizedExpanded]);
  const navigable = useMemo(() => items.filter((item) => item.type !== "section"), [items]);
  /** Split view: the selected conversation is read beside the list instead of replacing it. */
  const split = appearance.splitView && !(onDashboard && !drill) && !(accountsLoaded && accounts.length === 0);
  const openThread = useMemo(
    // Looked up unfiltered: reading a conversation must not make it vanish from under the reader.
    () =>
      openThreadId
        ? (inDrill ? drillThreads : allThreads).find((thread) => thread.id === openThreadId)
        : undefined,
    [openThreadId, inDrill, drillThreads, allThreads],
  );
  // A folder list loads only its own folder, so the rest of a conversation (the user's replies in
  // Sent, what they received in the Inbox or Archive) is added when a conversation opens.
  const conversationMail = useConversationMail(openThread !== undefined && folder !== "drafts");
  /** The open conversation with all its messages; actions still use `openThread` itself. */
  const viewedThread = useMemo(
    () => (openThread ? withRelatedMessages(openThread, conversationMail) : undefined),
    [openThread, conversationMail],
  );

  // Keep a valid keyboard selection as the list changes underneath it.
  useEffect(() => {
    if (!navigable.some((item) => item.key === selectedKey)) {
      setSelectedKey(navigable[0]?.key ?? null);
    }
  }, [navigable, selectedKey]);

  // Leaving a folder resets transient list state; a trashed open thread closes itself.
  useEffect(() => {
    setOpenThreadId(null);
    setOpenGroupKind(null);
    setChecked(new Set());
    anchorKey.current = null;
  }, [folder, scope]);

  // A group that emptied out (all trashed) or is gone hands the screen back to the folder's list.
  useEffect(() => {
    if (openGroupKind !== null && !openGroup) setOpenGroupKind(null);
  }, [openGroupKind, openGroup]);

  useEffect(() => {
    if (openThreadId && !openThread) setOpenThreadId(null);
  }, [openThreadId, openThread]);

  // Conversations that left the list (archived, trashed, refreshed away) leave the selection too.
  useEffect(() => {
    setChecked((previous) => {
      if (previous.size === 0) return previous;
      const present = new Set<string>();
      for (const item of navigable) if (item.type === "thread") present.add(item.thread.id);
      const kept = [...previous].filter((id) => present.has(id));
      return kept.length === previous.size ? previous : new Set(kept);
    });
  }, [navigable]);

  const selectedItem = navigable.find((item) => item.key === selectedKey);
  /** The conversation that replaces the list, full screen; in the split view it sits beside it instead. */
  const fullOpen = openThread !== undefined && !split;
  /** The conversation beside the list (split view), if one is shown. */
  const paneThread = split ? openThread : undefined;
  /** Several conversations are selected: the pane shows how many instead of one of them. */
  const paneSelection = split && checked.size > 0;
  /** The senders panel has the keyboard: only in the Sender view with its list on screen. */
  const senderPanelFocused = senderPanelFocus && senderView && !fullOpen && !(onDashboard && !drill);

  /** Shows a conversation (or nothing) beside the list. Arrowing waits a beat so a run of presses loads one. */
  /** The list's width while it is being resized; it is saved once the drag ends. */
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const paneTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const showInPane = useCallback((threadId: string | null, delayed = false) => {
    clearTimeout(paneTimer.current);
    if (delayed && threadId !== null) paneTimer.current = setTimeout(() => setOpenThreadId(threadId), 150);
    else setOpenThreadId(threadId);
  }, []);
  useEffect(() => () => clearTimeout(paneTimer.current), []);
  const selectedThread = selectedItem?.type === "thread" ? selectedItem.thread : undefined;

  /** Moves the selection to the nearest row that is not part of `thread`, before it disappears. */
  const selectNeighbor = useCallback(
    (thread: Thread) => {
      const index = navigable.findIndex(
        (item) => item.type === "thread" && item.thread.id === thread.id,
      );
      if (index < 0) return;
      const isOther = (item: ListItem | undefined) =>
        item !== undefined && !(item.type === "thread" && item.thread.id === thread.id);
      const next = [navigable[index + 1], navigable[index - 1]].find(isOther);
      if (!next) return;
      setSelectedKey(next.key);
      // The conversation being read leaves with its row: the pane moves on to the neighbor.
      if (split && openThreadId === thread.id) showInPane(paneIdFor(next));
    },
    [navigable, split, openThreadId, showInPane],
  );

  const actOnThread = useCallback(
    (action: MailAction, thread: Thread) => {
      // A move to a folder the list shows only changes the row's folder mark: it stays put.
      const destination = MOVE_DESTINATION[action];
      const staysListed = inDrill
        ? destination !== undefined
        : folder === "inbox" && destination !== undefined && shownFolders.includes(destination as ShownFolder);
      const stays = inDrill ? staysListed && drillShown.includes(destination as ShownFolder) : staysListed;
      const ids =
        listFolder === "inbox" ? idsForAction(action, thread) : thread.messages.map((message) => message.id);
      if (ids.length === 0) return;
      if (removesFromView(action, listFolder) && !stays) selectNeighbor(thread);
      // The Dashboard shows its own copy of the mail: it changes at once, like the list does.
      if (inDrill) applyToDashboard(action, ids);
      void act(action, ids);
    },
    [act, applyToDashboard, drillShown, folder, inDrill, listFolder, selectNeighbor, shownFolders],
  );

  const actOnChecked = useCallback(
    (action: MailAction) => {
      const targets = threads.filter((thread) => checked.has(thread.id));
      const ids = targets.flatMap((thread) =>
        inDrill ? idsForAction(action, thread) : thread.messages.map((message) => message.id),
      );
      if (inDrill && ids.length > 0) applyToDashboard(action, ids);
      void act(action, ids);
      setChecked(new Set());
    },
    [act, applyToDashboard, checked, inDrill, threads],
  );

  const toggleGroupRead = useCallback(
    (kind: GroupKind, unread: boolean) => {
      const members = threadsInGroup(threads, kind);
      if (members.length === 0) return;
      void act(
        unread ? "markRead" : "markUnread",
        members.flatMap((thread) => thread.messages.map((message) => message.id)),
      );
    },
    [act, threads],
  );

  const toggleSection = useCallback((key: string) => {
    if (key === MINIMIZED_SECTION) {
      setMinimizedExpanded((previous) => {
        const next = !previous;
        try {
          window.localStorage.setItem(MINIMIZED_EXPANDED_KEY, next ? "1" : "0");
        } catch {
          // Storage is a convenience; the fold still works for this session.
        }
        return next;
      });
      return;
    }
    if (key !== PINNED_SECTION) return;
    setPinnedCollapsed((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(PINNED_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // Storage is a convenience; the fold still works for this session.
      }
      return next;
    });
  }, []);

  const showGroup = useCallback((kind: GroupKind) => {
    setOpenGroupKind(kind);
    setChecked(new Set());
  }, []);

  /** Back from a group's list to the folder, with the group's row selected again. */
  const closeGroup = useCallback(() => {
    if (openGroupKind !== null) setSelectedKey(`group:${openGroupKind}`);
    setOpenGroupKind(null);
    setChecked(new Set());
  }, [openGroupKind]);

  const changeView = useCallback((next: MailView) => {
    setView(next);
    savePrefs({ view: next });
    setOpenGroupKind(null);
    setChecked(new Set());
    setSenderPanelFocus(false);
  }, [savePrefs]);

  const pickSender = useCallback((key: string) => {
    setSenderKey(key);
    setSenderDomain(null);
    setOpenThreadId(null);
    setChecked(new Set());
    setSenderPanelFocus(true);
  }, []);

  const pickDomain = useCallback((domain: string | null) => {
    setSenderDomain(domain);
    setOpenThreadId(null);
    setChecked(new Set());
    setSenderPanelFocus(true);
  }, []);

  /** Up/down in the senders panel: the next or previous row (a domain, or a sender) is picked. */
  const moveSenderSelection = useCallback(
    (delta: number) => {
      const rows = senderNavRows.current;
      if (rows.length === 0) return;
      const index = rows.findIndex((row) =>
        senderDomain ? row.kind === "domain" && row.domain === senderDomain : row.kind === "sender" && row.key === activeSenderKey,
      );
      const row = rows[Math.min(rows.length - 1, Math.max(0, (index < 0 ? 0 : index) + delta))];
      if (row.kind === "domain") pickDomain(row.domain);
      else pickSender(row.key);
    },
    [senderDomain, activeSenderKey, pickDomain, pickSender],
  );

  /**
   * Left/right in the senders panel, like a tree: left folds the domain (from one of its senders it
   * goes up to the domain and folds it), right unfolds it; with nothing to fold or unfold, right
   * hands the keyboard to the mail list.
   */
  const stepSenderPanel = useCallback(
    (direction: "left" | "right") => {
      const panel = senderPanelRef.current;
      const rows = senderNavRows.current;
      const row = rows.find((candidate) =>
        senderDomain
          ? candidate.kind === "domain" && candidate.domain === senderDomain
          : candidate.kind === "sender" && candidate.key === activeSenderKey,
      );
      const setOpen = (domain: string, open: boolean) =>
        panel?.setOpenDomains((previous) => {
          const next = new Set(previous);
          if (open) next.add(domain);
          else next.delete(domain);
          return next;
        });
      if (direction === "left") {
        if (!panel?.byDomain || !row) return;
        if (row.kind === "domain" && row.open) setOpen(row.domain, false);
        else if (row.kind === "sender" && row.nested) {
          const parent = rows.find((candidate) => candidate.kind === "domain" && candidate.domain === row.domain);
          if (parent?.kind === "domain") {
            setOpen(parent.domain, false);
            pickDomain(parent.domain);
          }
        }
        return;
      }
      if (row?.kind === "domain" && !row.open) setOpen(row.domain, true);
      else setSenderPanelFocus(false);
    },
    [senderDomain, activeSenderKey, pickDomain],
  );

  /** Ids of the conversations between two rows of the list, both included. */
  const threadIdsBetween = useCallback(
    (fromKey: string, toKey: string): string[] => {
      const from = navigable.findIndex((item) => item.key === fromKey);
      const to = navigable.findIndex((item) => item.key === toKey);
      if (from < 0 || to < 0) return [];
      const [start, end] = from < to ? [from, to] : [to, from];
      const ids: string[] = [];
      for (const item of navigable.slice(start, end + 1)) {
        if (item.type === "thread") ids.push(item.thread.id);
      }
      return ids;
    },
    [navigable],
  );

  /** A range of one conversation is just the cursor: no multi-selection to show. */
  const checkRange = useCallback(
    (fromKey: string, toKey: string) => {
      const ids = threadIdsBetween(fromKey, toKey);
      setChecked(ids.length > 1 ? new Set(ids) : new Set());
    },
    [threadIdsBetween],
  );

  /** Click on a row: select it. Shift extends from the anchor, ⌘/Ctrl adds or removes it. */
  const selectRow = useCallback(
    (key: string, modifiers?: SelectModifiers) => {
      setSenderPanelFocus(false);
      const anchor = anchorKey.current ?? selectedKey;
      if (modifiers?.range && anchor) {
        checkRange(anchor, key);
      } else if (modifiers?.toggle) {
        const item = navigable.find((it) => it.key === key);
        if (item?.type === "thread") {
          const id = item.thread.id;
          const base = checked.size > 0 ? checked : new Set(selectedThread ? [selectedThread.id] : []);
          const next = new Set(base);
          if (next.has(id) && next.size > 1) {
            // Deselecting: the cursor can't stay on a row that is no longer selected, so it
            // moves to the nearest row that still is.
            next.delete(id);
            const clicked = navigable.findIndex((it) => it.key === key);
            let nearest: (typeof navigable)[number] | undefined;
            let distance = Infinity;
            navigable.forEach((it, index) => {
              if (it.type !== "thread" || !next.has(it.thread.id)) return;
              if (Math.abs(index - clicked) < distance) {
                distance = Math.abs(index - clicked);
                nearest = it;
              }
            });
            if (nearest) {
              anchorKey.current = nearest.key;
              setSelectedKey(nearest.key);
              setChecked(next.size > 1 ? next : new Set());
              if (split && next.size === 1) showInPane(paneIdFor(nearest));
              return;
            }
          } else if (next.has(id)) {
            // The last selected row: nothing to deselect to, the cursor stays.
            next.delete(id);
          } else {
            next.add(id);
          }
          setChecked(next.size > 1 ? next : new Set());
        }
        anchorKey.current = key;
      } else {
        anchorKey.current = key;
        setChecked(new Set());
        // One click is enough in the split view: the conversation opens beside the list.
        if (split) showInPane(paneIdFor(navigable.find((it) => it.key === key)));
      }
      setSelectedKey(key);
    },
    [checkRange, checked, navigable, selectedKey, selectedThread, split, showInPane],
  );

  /** ⌘A: selects every conversation on screen. `navigable` is exactly that list, group rows aside. */
  const selectAll = useCallback(() => {
    const ids = navigable.flatMap((item) => (item.type === "thread" ? [item.thread.id] : []));
    setChecked(ids.length > 1 ? new Set(ids) : new Set());
  }, [navigable]);

  /** Shift+Up/Down: moves the cursor and stretches (or shrinks) the selection back to the anchor. */
  const extendSelection = useCallback(
    (delta: number) => {
      if (navigable.length === 0) return;
      const index = navigable.findIndex((item) => item.key === selectedKey);
      const next = Math.min(navigable.length - 1, Math.max(0, (index < 0 ? 0 : index) + delta));
      const anchor = anchorKey.current ?? selectedKey ?? navigable[next].key;
      anchorKey.current = anchor;
      setSelectedKey(navigable[next].key);
      checkRange(anchor, navigable[next].key);
    },
    [checkRange, navigable, selectedKey],
  );

  const startCompose = useCallback(
    (seed?: ComposeSeed) => {
      const fallbackAccount =
        scope !== "all" ? scope : (selectedThread?.accountId ?? accounts[0]?.id ?? "");
      setCompose((previous) => ({
        seed: seed ?? newMessageSeed(fallbackAccount),
        id: (previous?.id ?? 0) + 1,
      }));
    },
    [accounts, scope, selectedThread],
  );

  const openAccounts = useCallback((adding: boolean) => {
    setSettingsDialog({ open: true, tab: "accounts", adding });
  }, []);

  const moveSelection = useCallback(
    (delta: number) => {
      if (navigable.length === 0) return;
      const index = navigable.findIndex((item) => item.key === selectedKey);
      const next = Math.min(navigable.length - 1, Math.max(0, (index < 0 ? 0 : index) + delta));
      anchorKey.current = navigable[next].key;
      setChecked(new Set());
      setSelectedKey(navigable[next].key);
      if (split) showInPane(paneIdFor(navigable[next]), true);
    },
    [navigable, selectedKey, split, showInPane],
  );

  /** Vertical category cards: Down leaves the row of cards for the first conversation below it. */
  const moveBelowCards = useCallback(() => {
    const next = navigable.find((item) => item.type !== "group");
    if (!next) return;
    cardBelowKey.current = selectedKey;
    anchorKey.current = next.key;
    setChecked(new Set());
    setSelectedKey(next.key);
    if (split) showInPane(paneIdFor(next), true);
  }, [navigable, selectedKey, split, showInPane]);

  /** Up from the first conversation under vertical cards: back to the card Down came from (else the last card). */
  const moveBackToCards = useCallback(() => {
    const remembered = navigable.find((item) => item.type === "group" && item.key === cardBelowKey.current);
    const lastCard = navigable.filter((item) => item.type === "group").pop();
    const card = remembered ?? lastCard;
    if (!card) return;
    anchorKey.current = card.key;
    setChecked(new Set());
    setSelectedKey(card.key);
    if (split) showInPane(paneIdFor(card), true);
  }, [navigable, split, showInPane]);

  /** Right-click on a row: that row becomes the selection and its menu opens at the pointer. */
  const openItemMenu = useCallback((key: string, x: number, y: number) => {
    setSelectedKey(key);
    setItemMenu({ x, y, key });
  }, []);

  /** `/`: the menu of the open conversation, or of the selected row, anchored just under it. */
  const openMenuForSelection = useCallback(() => {
    if (fullOpen) {
      setItemMenu({ x: window.innerWidth - 320, y: 80, key: null });
      return;
    }
    if (!selectedKey) return;
    const row = document.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(selectedKey)}"]`);
    const rect = row?.getBoundingClientRect();
    setItemMenu({ x: (rect?.left ?? 0) + 56, y: rect?.bottom ?? 120, key: selectedKey });
  }, [fullOpen, selectedKey]);

  /** The commands of the menu on screen, built from the current state of its item. */
  const menuEntries = useMemo((): MenuEntry[] => {
    if (!itemMenu) return [];
    const item =
      itemMenu.key === null
        ? undefined
        : (navigable.find((it) => it.key === itemMenu.key) ?? dockGroups.find((it) => it.key === itemMenu.key));
    const thread = itemMenu.key === null ? openThread : item?.type === "thread" ? item.thread : undefined;

    if (thread) {
      const entries: MenuEntry[] = [];
      if (!fullOpen && openThread?.id !== thread.id) {
        entries.push({
          id: "open",
          label: "Open",
          icon: ArrowUpRight,
          hint: "↵",
          run: () => setOpenThreadId(thread.id),
        });
      }
      const isDanger = (action: string) => action === "trash" || action === "deleteForever" || action === "spam";
      const actionEntry = ({ action, label, icon, hint }: ReturnType<typeof actionsForThread>[number]): MenuEntry => ({
        id: action,
        label,
        icon,
        hint,
        destructive: action === "trash" || action === "deleteForever",
        warning: action === "spam",
        run: () => {
          if (action === "deleteForever") {
            setDeleteConfirm({ x: itemMenu.x, y: itemMenu.y, thread });
            return;
          }
          actOnThread(action, thread);
          if (fullOpen && removesFromView(action, listFolder)) setOpenThreadId(null);
        },
      });
      const actions = actionsForThread(threadFolder(thread), thread);
      for (const entry of actions.filter((a) => !isDanger(a.action))) entries.push(actionEntry(entry));
      if (categories.length > 0 && listFolder !== "sent" && listFolder !== "drafts") {
        // A menu opened on a row inside a multi-selection acts on the whole selection.
        const targets = checked.has(thread.id) && checked.size > 1 ? [...checked] : [thread.id];
        const filed = (categoryId: string | null) => () => {
          void assignCategory(targets, categoryId);
          const where = categoryId === null ? "no category" : (categories.find((c) => c.id === categoryId)?.name ?? "category");
          toast(`${targets.length > 1 ? `${targets.length} conversations` : "Conversation"} moved to ${where}`);
        };
        entries.push({
          id: "moveToCategory",
          label: "Move to category",
          icon: FolderInput,
          run: () => undefined,
          children: [
            ...categories.map((category): MenuEntry => ({
              id: `category:${category.id}`,
              label: category.name,
              icon: categoryMenuIcon(iconFor(category)),
              current: thread.categoryId === category.id,
              run: filed(category.id),
            })),
            {
              id: "category:none",
              label: "No category",
              icon: Ban,
              current: thread.categoryId === null,
              run: filed(null),
            },
          ],
        });
      }
      // Spam, trash and delete go last, set apart from the everyday commands.
      const danger = actions.filter((a) => isDanger(a.action)).map(actionEntry);
      if (danger.length > 0 && entries.length > 0) danger[0] = { ...danger[0]!, separatorBefore: true };
      entries.push(...danger);
      return entries;
    }

    if (item?.type === "group") {
      return [
        {
          id: "open",
          label: "Open",
          icon: ArrowUpRight,
          hint: "↵",
          run: () => showGroup(item.kind),
        },
        {
          id: "toggleRead",
          label: item.hasUnread ? "Mark all as read" : "Mark all as unread",
          icon: item.hasUnread ? MailOpen : Mail,
          hint: "U",
          run: () => toggleGroupRead(item.kind, item.hasUnread),
        },
        minimized.has(item.kind)
          ? {
              id: "restore",
              label: "Restore",
              icon: PanelRightOpen,
              run: () => setCategoryMinimized(item.kind, false),
            }
          : {
              id: "minimize",
              label: "Minimize",
              icon: PanelRightClose,
              run: () => setCategoryMinimized(item.kind, true),
            },
      ];
    }
    return [];
  }, [
    itemMenu,
    navigable,
    dockGroups,
    minimized,
    setCategoryMinimized,
    openThread,
    fullOpen,
    listFolder,
    threadFolder,
    actOnThread,
    showGroup,
    toggleGroupRead,
    categories,
    checked,
    assignCategory,
  ]);

  // A menu whose item vanished (archived from elsewhere, list refreshed) has nothing left to show.
  useEffect(() => {
    if (itemMenu && menuEntries.length === 0) setItemMenu(null);
  }, [itemMenu, menuEntries.length]);

  const pendingConfirm = useRef<PendingConfirm | null>(null);
  const clearPendingConfirm = useCallback(() => {
    if (!pendingConfirm.current) return;
    clearTimeout(pendingConfirm.current.timer);
    pendingConfirm.current = null;
    toast.dismiss(CONFIRM_TOAST_ID);
  }, []);
  useEffect(() => clearPendingConfirm, [clearPendingConfirm]);

  // ⌘, (Ctrl+, elsewhere) opens Settings from anywhere, even while typing or composing.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "," || event.shiftKey || event.altKey) return;
      if (!(isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)) return;
      event.preventDefault();
      setSettingsDialog((previous) =>
        previous.open ? previous : { open: true, tab: "appearance", adding: false },
      );
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isMac]);

  // ⌘1–⌘4 (Ctrl+1–4 elsewhere) switch the rail's tabs: Dashboard, Inbox, Drafts, Sent.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.shiftKey || event.altKey || compose || settingsDialog.open) return;
      if (!(isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)) return;
      const tab = ["1", "2", "3", "4"].indexOf(event.key);
      if (tab < 0) return;
      event.preventDefault();
      if (tab === 0) openDashboard();
      else navigateFolder(RAIL_FOLDERS[tab - 1]);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isMac, compose, settingsDialog.open, openDashboard, navigateFolder]);

  // Keyboard shortcuts, in the spirit of Spark: arrows/J/K move, Enter opens.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey) return;
      if (compose || settingsDialog.open) return;

      // The Dashboard's charts have no list shortcuts, only ⌘Z to take back the last action. The
      // mail behind a chart is an ordinary list and uses all of them.
      if (onDashboard && !drill) {
        if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
          if (!isTypingTarget(event.target) && undo()) event.preventDefault();
        }
        return;
      }

      // ⌘K / Ctrl+K searches; it works from a text field too, and plain K stays "up".
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "k") {
        if (fullOpen) return; // no list on screen to search
        setItemMenu(null);
        setSearchOpen(true);
        event.preventDefault();
        return;
      }

      // ⌘Z / Ctrl+Z takes back the last archive, trash, spam or delete. In a text field it stays
      // the field's own undo, and with nothing to undo it is left alone.
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
        if (!isTypingTarget(event.target) && undo()) event.preventDefault();
        return;
      }
      // ⌘A / Ctrl+A selects every conversation of the list on screen: in the Sender view that is the
      // chosen sender's (or domain's) mail, in the Smart view the mail outside any category, and
      // inside a category all of its mail. In a text field it stays the field's own select-all.
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "a") {
        if (fullOpen || isTypingTarget(event.target)) return;
        selectAll();
        event.preventDefault();
        return;
      }
      if (event.metaKey || event.ctrlKey || isTypingTarget(event.target)) return;

      // Any other key (Shift and friends excepted) abandons a half-confirmed shortcut.
      const pressed = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (pendingConfirm.current && pressed !== pendingConfirm.current.key && pressed !== "Shift") {
        clearPendingConfirm();
      }

      // With several conversations selected (shift-click, shift+arrows) the shortcuts act on all of them.
      const bulk = !fullOpen && checked.size > 0;
      const target = openThread ?? selectedThread;
      const targetFolder = target && !bulk ? threadFolder(target) : listFolder;
      const act_ = (action: MailAction) => {
        if (bulk) {
          actOnChecked(action);
          return;
        }
        if (!target) return;
        actOnThread(action, target);
        if (fullOpen && removesFromView(action, listFolder)) setOpenThreadId(null);
      };
      /** Archive, trash, spam and delete need the same key twice: the first press only asks. */
      const confirmThenAct = (action: MailAction, message: (key: string) => string) => {
        if (!target && !bulk) return;
        const subject = bulk ? `bulk:${[...checked].join(",")}` : (target?.id ?? "");
        const pending = pendingConfirm.current;
        if (pending && pending.key === pressed && pending.action === action && pending.threadId === subject) {
          clearPendingConfirm();
          act_(action);
          return;
        }
        clearPendingConfirm();
        const label = event.key.length === 1 ? event.key.toUpperCase() : event.key;
        pendingConfirm.current = {
          key: pressed,
          action,
          threadId: subject,
          timer: setTimeout(clearPendingConfirm, CONFIRM_WINDOW_MS),
        };
        toast(message(label), { id: CONFIRM_TOAST_ID, duration: CONFIRM_WINDOW_MS });
      };

      // In the Sender view the panel can have the keyboard: up/down walk the senders, left/right fold
      // a domain or hand the keyboard back to the mail. Mail shortcuts wait until the list has it
      // again, so a key meant for the senders never archives a conversation out of sight.
      if (senderPanelFocused) {
        switch (event.key) {
          case "ArrowDown":
          case "j":
            moveSenderSelection(1);
            break;
          case "ArrowUp":
          case "k":
            moveSenderSelection(-1);
            break;
          case "ArrowLeft":
            stepSenderPanel("left");
            break;
          case "ArrowRight":
            stepSenderPanel("right");
            break;
          case "Enter":
          case "o":
          case "Escape":
            setSenderPanelFocus(false);
            break;
          case "Tab":
          case "c":
            break; // handled below, as everywhere
          default:
            return;
        }
        if (event.key !== "Tab" && event.key !== "c") {
          event.preventDefault();
          return;
        }
      }

      // Shift+Up/Down grows or shrinks the selection from where it started.
      if (event.shiftKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        if (!fullOpen && !senderPanelFocused) {
          extendSelection(event.key === "ArrowDown" ? 1 : -1);
          event.preventDefault();
        }
        return;
      }

      switch (event.key) {
        case "Escape":
          if (fullOpen) setOpenThreadId(null);
          else if (checked.size > 0) setChecked(new Set());
          else if (openThread) showInPane(null);
          else if (openGroup) closeGroup();
          else if (searchOpen) {
            setQuery("");
            setSearchOpen(false);
          } else if (inDrill) closeDrill();
          return;
        case "Tab": {
          // Cycles the Smart / Sender / List tabs (Shift+Tab goes back); only while their header shows.
          if (fullOpen || openGroup || listOnly || (accountsLoaded && accounts.length === 0)) return;
          const at = VIEWS.findIndex((candidate) => candidate.view === view);
          const step = event.shiftKey ? -1 : 1;
          changeView(VIEWS[(at + step + VIEWS.length) % VIEWS.length].view);
          setItemMenu(null);
          break;
        }
        case "ArrowDown":
        case "j":
          if (fullOpen) break;
          // Vertical cards sit side by side: Down goes to the list below them, not to the next card.
          if (selectedItem?.type === "group" && categoryLayout === "vertical") moveBelowCards();
          else moveSelection(1);
          break;
        case "ArrowUp":
        case "k":
          // Nothing sits above the row of vertical cards (left and right step between them).
          if (fullOpen) break;
          if (selectedItem?.type === "group" && categoryLayout === "vertical") break;
          // From the first conversation under the cards, Up returns to the card Down left.
          if (
            categoryLayout === "vertical" &&
            selectedItem &&
            navigable.find((item) => item.type !== "group")?.key === selectedItem.key &&
            navigable[0]?.type === "group"
          ) {
            moveBackToCards();
          } else moveSelection(-1);
          break;
        case "ArrowRight":
        case "ArrowLeft":
          // Vertical category cards sit side by side: left and right step between them.
          if (!fullOpen && selectedItem?.type === "group" && categoryLayout === "vertical") {
            moveSelection(event.key === "ArrowRight" ? 1 : -1);
          } else if (!fullOpen && senderView && !openGroup && event.key === "ArrowLeft") {
            // Sender view: left from the mail list goes to the senders panel.
            setSenderPanelFocus(true);
          }
          break;
        case "Enter":
        case "o":
          if (fullOpen) return;
          if (selectedItem?.type === "group") showGroup(selectedItem.kind);
          else if (selectedThread) showInPane(selectedThread.id);
          break;
        case "a":
          // In Archive, A is the way back to the inbox and needs no confirmation.
          if (targetFolder === "archive") act_("unarchive");
          else confirmThenAct("archive", (key) => `Press ${key} again to archive`);
          break;
        case "i":
          // Back to the Inbox from wherever it is (Archive also has A for this).
          if (targetFolder === "archive" || targetFolder === "trash" || targetFolder === "spam") act_("unarchive");
          break;
        case "d":
        case "Backspace":
        case "Delete":
          // Trash is emptied for good; Spam moves to Trash with D and is emptied with Delete.
          if (targetFolder === "trash" || (targetFolder === "spam" && event.key !== "d")) {
            confirmThenAct("deleteForever", (key) => `Press ${key} again to delete forever`);
          } else {
            confirmThenAct("trash", (key) => `Press ${key} again to move to Trash`);
          }
          break;
        case "s":
          if (targetFolder !== "spam" && targetFolder !== "sent" && targetFolder !== "drafts") {
            confirmThenAct("spam", (key) => `Press ${key} again to report spam`);
          }
          break;
        case "p":
          if (bulk) {
            // Same toggle as the bar's button: unpin only when everything selected is already pinned.
            const allPinned = threads.filter((thread) => checked.has(thread.id)).every((thread) => thread.pinned);
            act_(allPinned ? "unpin" : "pin");
          } else if (target) act_(target.pinned ? "unpin" : "pin");
          break;
        case "u":
          if (bulk) {
            const anyUnread = threads.some((thread) => checked.has(thread.id) && thread.unread);
            act_(anyUnread ? "markRead" : "markUnread");
          } else if (target) act_(target.unread ? "markRead" : "markUnread");
          else if (!fullOpen && selectedItem?.type === "group") {
            // A category row: same as clicking its dot, marks every conversation in it read or unread.
            toggleGroupRead(selectedItem.kind, selectedItem.hasUnread);
          }
          break;
        case "c":
          startCompose();
          break;
        case "/":
          openMenuForSelection();
          break;
        default:
          return;
      }
      event.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    settingsDialog.open,
    senderPanelFocused,
    senderView,
    moveSenderSelection,
    stepSenderPanel,
    act,
    actOnThread,
    changeView,
    closeDrill,
    drill,
    inDrill,
    listFolder,
    listOnly,
    onDashboard,
    clearPendingConfirm,
    closeGroup,
    compose,
    moveSelection,
    moveBelowCards,
    moveBackToCards,
    navigable,
    selectAll,
    openGroup,
    openMenuForSelection,
    openThread,
    fullOpen,
    showInPane,
    searchOpen,
    checked,
    actOnChecked,
    extendSelection,
    threads,
    selectedItem,
    categoryLayout,
    selectedThread,
    setQuery,
    accountsLoaded,
    accounts.length,
    view,
    showGroup,
    startCompose,
    threadFolder,
    toggleGroupRead,
    undo,
  ]);

  /**
   * The buttons of the multi-selection bar: Pin, read/unread, then a move to each folder. The
   * selection can mix folders, so every button is always there; moving mail to the folder it is
   * already in does nothing.
   */
  const bulkActions = useMemo((): { action: MailAction; label: string; icon: LucideIcon }[] => {
    const selected = threads.filter((thread) => checked.has(thread.id));
    const anyUnread = selected.some((thread) => thread.unread);
    const allPinned = selected.length > 0 && selected.every((thread) => thread.pinned);
    return [
      allPinned
        ? { action: "unpin", label: "Unpin", icon: PinOff }
        : { action: "pin", label: "Pin", icon: Pin },
      anyUnread
        ? { action: "markRead", label: "Mark as read", icon: MailOpen }
        : { action: "markUnread", label: "Mark as unread", icon: Mail },
      { action: "unarchive", label: "Move to Inbox", icon: Inbox },
      { action: "archive", label: "Archive", icon: Archive },
      { action: "trash", label: "Move to Trash", icon: Trash2 },
      { action: "spam", label: "Report spam", icon: ShieldAlert },
    ];
  }, [checked, threads]);

  const bulkBar =
    checked.size > 0 ? (
      <div className="corner-squircle absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-popover px-3 py-2 shadow-lg">
        <span className="mr-2 text-sm text-muted-foreground">{checked.size} selected</span>
        {bulkActions.map(({ action, label, icon: Icon }) => (
          <Tooltip key={action}>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                aria-label={label}
                className="size-8"
                onClick={() => actOnChecked(action)}
              >
                <Icon />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    ) : null;

  const headerActions = {
    unreadOnly,
    onUnreadOnlyChange: setUnreadOnly,
    // Only the Inbox list and a Dashboard list can show Archive, Trash and Spam mail.
    shownFolders: inDrill ? drillShown : folder === "inbox" ? shownFolders : null,
    onToggleFolder: inDrill ? toggleDrillFolder : toggleShownFolder,
    searchOpen,
    onSearchOpenChange: setSearchOpen,
    query,
    onQueryChange: setQuery,
    onCompose: () => startCompose(),
  };

  const showNoAccounts = accountsLoaded && accounts.length === 0;
  // Drafts written here are kept on this computer; the Drafts folder lists them above the server's.
  const folderDrafts = useMemo(
    () =>
      folder === "drafts"
        ? savedDrafts.filter((draft) => scope === "all" || draft.accountId === scope)
        : [],
    [folder, savedDrafts, scope],
  );

  const senderPanelState = useSenderPanelState(
    senders,
    activeSenderKey,
    activeView === "sender" && !showNoAccounts && (!onDashboard || inDrill),
    () => pickDomain(null),
  );
  senderPanelRef.current = senderPanelState;
  const groupToggle = activeView === "sender" ? <GroupByDomainButton state={senderPanelState} /> : null;
  const senderPanelProps = {
    state: senderPanelState,
    focused: senderPanelFocused,
    navRows: senderNavRows,
    senders,
    threads,
    selectedKey: activeSenderKey,
    selectedDomain: activeDomain,
    onSelect: pickSender,
    onSelectDomain: pickDomain,
    loading: loading && allThreads.length === 0,
  };

  /** The list's column: the whole width, or a fixed share of it when a reading pane sits beside it. */
  const listColumn = split
    ? "relative flex min-h-0 min-w-[280px] max-w-[calc(100%-420px)] shrink-0 flex-col"
    : "relative flex min-h-0 min-w-0 flex-1 flex-col";
  const listRow = "flex min-h-0 flex-1";
  const listColumnStyle = split ? { width: dragWidth ?? appearance.splitListWidth } : undefined;
  const splitHandle = split ? (
    <SplitHandle
      width={dragWidth ?? appearance.splitListWidth}
      onResize={setDragWidth}
      onCommit={(width) => {
        setAppearance({ splitListWidth: width });
        setDragWidth(null);
      }}
    />
  ) : null;

  /** Split view: the selected conversation, under the same toolbar as the list. */
  const readingPane = split ? (
    <section
      aria-label="Conversation"
      className="corner-squircle mb-3 mr-3 mt-1 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-sidebar-border bg-sidebar shadow"
    >
      {paneThread && !paneSelection ? (
        <ThreadView
          key={paneThread.id}
          embedded
          thread={viewedThread ?? paneThread}
          folder={threadFolder(paneThread)}
          accounts={accounts}
          onBack={() => showInPane(null)}
          onAction={(action) => actOnThread(action, paneThread)}
          onCompose={startCompose}
          shortcutsDisabled={compose !== null || settingsDialog.open}
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
          <Mail className="size-8 opacity-50" aria-hidden />
          <p className="text-sm">
            {paneSelection ? `${checked.size} conversations selected` : "Select a conversation to read it"}
          </p>
        </div>
      )}
    </section>
  ) : null;

  return (
    <div className="flex h-full w-full bg-background text-foreground">
      <Rail
        folder={folder}
        dashboard={onDashboard}
        onOpenDashboard={openDashboard}
        accounts={accounts}
        onNavigate={navigateFolder}
        onOpenSettings={() => setSettingsDialog({ open: true, tab: "appearance", adding: false })}
        aiOff={ai !== null && !ai.configured}
        sorting={ai?.pending ?? 0}
      />

      {/* With a thread open there is no list toolbar, so the panel keeps the full height beside it. */}
      {activeView === "sender" && !showNoAccounts && (!onDashboard || inDrill) && fullOpen && (
        <SenderPanel {...senderPanelProps} underToolbar={false} />
      )}

      <main className="relative flex min-w-0 flex-1 flex-col">
        {onDashboard && showNoAccounts ? (
          <NoAccounts demo={api.system.demo} onAdd={() => openAccounts(true)} />
        ) : onDashboard && !drill ? (
          <Dashboard
            messages={dashboardMessages}
            accounts={accounts}
            categories={categories}
            loading={dashboardMail.loading}
            errors={dashboardMail.errors}
            range={dashboardRange}
            onRangeChange={setDashboardRange}
            onOpen={openDrill}
            onRefresh={() => void reloadDashboard(false)}
          />
        ) : fullOpen && openThread ? (
          <ThreadView
            key={openThread.id}
            thread={viewedThread ?? openThread}
            folder={threadFolder(openThread)}
            accounts={accounts}
            onBack={() => setOpenThreadId(null)}
            onAction={(action) => {
              actOnThread(action, openThread);
              if (removesFromView(action, listFolder)) setOpenThreadId(null);
            }}
            onCompose={startCompose}
            shortcutsDisabled={compose !== null || settingsDialog.open}
          />
        ) : drill ? (
          <>
            {openGroup ? (
              <GroupHeader
                group={openGroup.def}
                count={openGroup.threads.length}
                onBack={closeGroup}
                {...headerActions}
              />
            ) : (
              <DrillHeader
                title={drill.title}
                onBack={closeDrill}
                view={view}
                onViewChange={changeView}
                viewExtra={groupToggle}
                accounts={accounts}
                scope={scope}
                onScopeChange={setScope}
                onManageAccounts={() => openAccounts(false)}
                {...headerActions}
              />
            )}
            <div className={listRow}>
              {activeView === "sender" && <SenderPanel {...senderPanelProps} />}
              <div className={listColumn} style={listColumnStyle}>
                {listThreads.length === 0 ? (
                  <EmptyList folder={null} query={query} unreadOnly={unreadOnly} />
                ) : (
                  <>
                    {activeDomain ? (
                      <SenderHeading domain={activeDomain} count={listThreads.length} />
                    ) : (
                      activeSender && <SenderHeading sender={activeSender} />
                    )}
                    <FocusedList
                      items={items}
                      folder="inbox"
                      accounts={accounts}
                      selectedKey={senderPanelFocused ? null : selectedKey}
                      checked={checked}
                      onSelect={selectRow}
                      onOpenThread={(thread) => setOpenThreadId(thread.id)}
                      onOpenGroup={showGroup}
                      onOpenThreadById={setOpenThreadId}
                      onToggleGroupRead={toggleGroupRead}
                      onThreadAction={actOnThread}
                      onItemMenu={openItemMenu}
                      onToggleSection={toggleSection}
                      minimized={categoryLayout === "vertical" ? dockGroups : undefined}
                    />
                  </>
                )}
                {bulkBar}
              </div>
              {splitHandle}
              {readingPane}
            </div>
          </>
        ) : (
          <>
            {openGroup ? (
              <GroupHeader
                group={openGroup.def}
                count={openGroup.threads.length}
                onBack={closeGroup}
                {...headerActions}
              />
            ) : (
              <ListHeader
                title={FOLDER_TITLES[folder]}
                view={view}
                showViews={!listOnly}
                onViewChange={changeView}
                viewExtra={groupToggle}
                accounts={accounts}
                scope={scope}
                onScopeChange={setScope}
                onManageAccounts={() => openAccounts(false)}
                {...headerActions}
              />
            )}

            <div className={listRow}>
            {activeView === "sender" && !showNoAccounts && <SenderPanel {...senderPanelProps} />}
            <div className={cn(listColumn, "min-h-0")} style={listColumnStyle}>
            <AccountErrorToasts
              errors={errors}
              accounts={accounts}
              onRetry={() => void refresh()}
              onManage={() => openAccounts(false)}
            />

            {showNoAccounts ? (
              <NoAccounts demo={api.system.demo} onAdd={() => openAccounts(true)} />
            ) : loading && allThreads.length === 0 ? (
              <ListSkeleton />
            ) : listThreads.length === 0 && folderDrafts.length === 0 ? (
              <EmptyList folder={folder} query={query} unreadOnly={unreadOnly} />
            ) : (
              <>
                {folderDrafts.length > 0 && (
                  <LocalDrafts
                    drafts={folderDrafts}
                    onOpen={(draft) => startCompose(seedFromDraft(draft))}
                  />
                )}
                {activeDomain ? (
                  <SenderHeading domain={activeDomain} count={listThreads.length} />
                ) : (
                  activeSender && <SenderHeading sender={activeSender} />
                )}
                <FocusedList
                  items={items}
                  folder={folder}
                  accounts={accounts}
                  selectedKey={senderPanelFocused ? null : selectedKey}
                  checked={checked}
                  onSelect={selectRow}
                  onOpenThread={(thread) => setOpenThreadId(thread.id)}
                  onOpenGroup={showGroup}
                  onOpenThreadById={setOpenThreadId}
                  onToggleGroupRead={toggleGroupRead}
                  onThreadAction={actOnThread}
                  onItemMenu={openItemMenu}
                  onToggleSection={toggleSection}
                  minimized={categoryLayout === "vertical" ? dockGroups : undefined}
                />
              </>
            )}

            {bulkBar}
            </div>
            {splitHandle}
            {readingPane}
            </div>
          </>
        )}
      </main>

      {itemMenu && menuEntries.length > 0 && (
        <ItemMenu
          x={itemMenu.x}
          y={itemMenu.y}
          entries={menuEntries}
          onClose={() => setItemMenu(null)}
        />
      )}

      {deleteConfirm && (
        <ConfirmPopover
          {...DELETE_FOREVER_CONFIRM}
          open
          onOpenChange={(open) => {
            if (!open) setDeleteConfirm(null);
          }}
          onConfirm={() => {
            const { thread } = deleteConfirm;
            actOnThread("deleteForever", thread);
            if (fullOpen) setOpenThreadId(null);
          }}
          side="bottom"
          align="start"
        >
          <span aria-hidden className="pointer-events-none fixed size-0" style={{ left: deleteConfirm.x, top: deleteConfirm.y }} />
        </ConfirmPopover>
      )}

      {compose && (
        <Composer
          key={compose.id}
          seed={compose.seed}
          accounts={accounts}
          onClose={() => setCompose(null)}
        />
      )}

      <SettingsDialog
        open={settingsDialog.open}
        onOpenChange={(open) => setSettingsDialog((previous) => ({ ...previous, open }))}
        initialTab={settingsDialog.tab}
        startAdding={settingsDialog.adding}
        accounts={accounts}
        categories={categories}
        ai={ai}
        onAccountsChanged={() => void reloadAccounts()}
        onCategoryState={setCategoryState}
      />
    </div>
  );
}

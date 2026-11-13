import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Archive, ArrowUpRight, Ban, FolderInput, Inbox, Mail, MailOpen, PanelRightClose, PanelRightOpen, Pin, PinOff, ShieldAlert, Trash2, type LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { iconFor } from "@shared/categories";
import {
  buildFlatList,
  buildFocusedList,
  groupDefs,
  PINNED_SECTION,
  threadsInGroup,
  type GroupKind,
  type ListItem,
} from "@shared/focus-list";
import { dropFolderDuplicates, matchesDrill, receivedMail, type DashboardRange } from "@shared/dashboard";
import { buildSenders, threadsFromDomain, threadsFromSender } from "@shared/sender-list";
import { conversationFolder, groupThreads, MOVE_DESTINATION, type Thread } from "@shared/threads";
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
import { SenderHeading, SenderPanel, useSenderPanelState } from "@/components/mail/sender-panel";
import { AccountErrorToasts, EmptyList, ListSkeleton, NoAccounts } from "@/components/mail/states";
import { ThreadView } from "@/components/mail/thread-view";
import { useIsMac } from "@/hooks/use-platform";
import { SettingsDialog, type SettingsTab } from "@/components/settings/settings-dialog";
import { ConfirmPopover } from "@/components/ui/confirm-popover";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCategories } from "@/hooks/use-categories";
import { useDashboardMail } from "@/hooks/use-dashboard-mail";
import { useMinimizedCategories } from "@/hooks/use-minimized-categories";
import { matchesQuery, SHOWN_FOLDERS, useMailbox } from "@/hooks/use-mailbox";
import { api } from "@/lib/api";
import { useAppearance } from "@/lib/appearance";
import { newMessageSeed, type ComposeSeed } from "@/lib/compose";
import { refreshContacts } from "@/lib/contact-cache";
import { seedFromDraft, useDrafts } from "@/lib/drafts";
import { FOLDER_TITLES } from "@/lib/format";
import { isTypingTarget } from "@/lib/keyboard";
import { DELETE_FOREVER_CONFIRM } from "@/lib/delete-confirm";
import { actionsForThread } from "@/lib/row-actions";

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
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  /** Where a shift-click or shift+arrow range starts; follows plain clicks and plain arrows. */
  const anchorKey = useRef<string | null>(null);
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

  const { minimized, setCategoryMinimized } = useMinimizedCategories();
  const { items, dockGroups } = useMemo(() => {
    if (!focused || openGroup) return { items: buildFlatList(listThreads, now), dockGroups: [] };
    const all = buildFocusedList(threads, { now, categories, pinnedCollapsed });
    // Minimized categories leave the list (and its keyboard navigation) for the dock at the right.
    const isDocked = (item: ListItem): item is Extract<ListItem, { type: "group" }> =>
      item.type === "group" && minimized.has(item.kind);
    return { items: all.filter((item) => !isDocked(item)), dockGroups: all.filter(isDocked) };
  }, [focused, openGroup, threads, listThreads, now, categories, pinnedCollapsed, minimized]);
  const navigable = useMemo(() => items.filter((item) => item.type !== "section"), [items]);
  const openThread = useMemo(
    // Looked up unfiltered: reading a conversation must not make it vanish from under the reader.
    () =>
      openThreadId
        ? (inDrill ? drillThreads : allThreads).find((thread) => thread.id === openThreadId)
        : undefined,
    [openThreadId, inDrill, drillThreads, allThreads],
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
  const { categoryLayout } = useAppearance();
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
      if (next) setSelectedKey(next.key);
    },
    [navigable],
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
  }, [savePrefs]);

  const pickSender = useCallback((key: string) => {
    setSenderKey(key);
    setSenderDomain(null);
    setOpenThreadId(null);
    setChecked(new Set());
  }, []);

  const pickDomain = useCallback((domain: string | null) => {
    setSenderDomain(domain);
    setOpenThreadId(null);
    setChecked(new Set());
  }, []);

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
      const anchor = anchorKey.current ?? selectedKey;
      if (modifiers?.range && anchor) {
        checkRange(anchor, key);
      } else if (modifiers?.toggle) {
        const item = navigable.find((it) => it.key === key);
        if (item?.type === "thread") {
          const id = item.thread.id;
          const base = checked.size > 0 ? checked : new Set(selectedThread ? [selectedThread.id] : []);
          const next = new Set(base);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          setChecked(next.size > 1 ? next : new Set());
        }
        anchorKey.current = key;
      } else {
        anchorKey.current = key;
        setChecked(new Set());
      }
      setSelectedKey(key);
    },
    [checkRange, checked, navigable, selectedKey, selectedThread],
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
    },
    [navigable, selectedKey],
  );

  /** Right-click on a row: that row becomes the selection and its menu opens at the pointer. */
  const openItemMenu = useCallback((key: string, x: number, y: number) => {
    setSelectedKey(key);
    setItemMenu({ x, y, key });
  }, []);

  /** `/`: the menu of the open conversation, or of the selected row, anchored just under it. */
  const openMenuForSelection = useCallback(() => {
    if (openThread) {
      setItemMenu({ x: window.innerWidth - 320, y: 80, key: null });
      return;
    }
    if (!selectedKey) return;
    const row = document.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(selectedKey)}"]`);
    const rect = row?.getBoundingClientRect();
    setItemMenu({ x: (rect?.left ?? 0) + 56, y: rect?.bottom ?? 120, key: selectedKey });
  }, [openThread, selectedKey]);

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
      if (!openThread) {
        entries.push({
          id: "open",
          label: "Open",
          icon: ArrowUpRight,
          hint: "↵",
          run: () => setOpenThreadId(thread.id),
        });
      }
      for (const { action, label, icon, hint } of actionsForThread(threadFolder(thread), thread)) {
        entries.push({
          id: action,
          label,
          icon,
          hint,
          destructive: action === "trash" || action === "deleteForever" || action === "spam",
          run: () => {
            if (action === "deleteForever") {
              setDeleteConfirm({ x: itemMenu.x, y: itemMenu.y, thread });
              return;
            }
            actOnThread(action, thread);
            if (openThread && removesFromView(action, listFolder)) setOpenThreadId(null);
          },
        });
      }
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
        if (openThread) return; // no list on screen to search
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
        if (openThread || isTypingTarget(event.target)) return;
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
      const bulk = !openThread && checked.size > 0;
      const target = openThread ?? selectedThread;
      const targetFolder = target && !bulk ? threadFolder(target) : listFolder;
      const act_ = (action: MailAction) => {
        if (bulk) {
          actOnChecked(action);
          return;
        }
        if (!target) return;
        actOnThread(action, target);
        if (openThread && removesFromView(action, listFolder)) setOpenThreadId(null);
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

      // Shift+Up/Down grows or shrinks the selection from where it started.
      if (event.shiftKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        if (!openThread) {
          extendSelection(event.key === "ArrowDown" ? 1 : -1);
          event.preventDefault();
        }
        return;
      }

      switch (event.key) {
        case "Escape":
          if (openThread) setOpenThreadId(null);
          else if (checked.size > 0) setChecked(new Set());
          else if (openGroup) closeGroup();
          else if (searchOpen) {
            setQuery("");
            setSearchOpen(false);
          } else if (inDrill) closeDrill();
          return;
        case "Tab": {
          // Cycles the Smart / Sender / List tabs (Shift+Tab goes back); only while their header shows.
          if (openThread || openGroup || listOnly || (accountsLoaded && accounts.length === 0)) return;
          const at = VIEWS.findIndex((candidate) => candidate.view === view);
          const step = event.shiftKey ? -1 : 1;
          changeView(VIEWS[(at + step + VIEWS.length) % VIEWS.length].view);
          setItemMenu(null);
          break;
        }
        case "ArrowDown":
        case "j":
          if (!openThread) moveSelection(1);
          break;
        case "ArrowUp":
        case "k":
          if (!openThread) moveSelection(-1);
          break;
        case "ArrowRight":
        case "ArrowLeft":
          // Vertical category cards sit side by side: left and right step between them.
          if (!openThread && selectedItem?.type === "group" && categoryLayout === "vertical") {
            moveSelection(event.key === "ArrowRight" ? 1 : -1);
          }
          break;
        case "Enter":
        case "o":
          if (openThread) return;
          if (selectedItem?.type === "group") showGroup(selectedItem.kind);
          else if (selectedThread) setOpenThreadId(selectedThread.id);
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
          else if (!openThread && selectedItem?.type === "group") {
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
    selectAll,
    openGroup,
    openMenuForSelection,
    openThread,
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
  );
  const senderPanelProps = {
    state: senderPanelState,
    senders,
    threads,
    selectedKey: activeSenderKey,
    selectedDomain: activeDomain,
    onSelect: pickSender,
    onSelectDomain: pickDomain,
    loading: loading && allThreads.length === 0,
  };

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
      {activeView === "sender" && !showNoAccounts && (!onDashboard || inDrill) && openThread && (
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
        ) : openThread ? (
          <ThreadView
            key={openThread.id}
            thread={openThread}
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
                accounts={accounts}
                scope={scope}
                onScopeChange={setScope}
                onManageAccounts={() => openAccounts(false)}
                {...headerActions}
              />
            )}
            <div className="flex min-h-0 flex-1">
              {activeView === "sender" && <SenderPanel {...senderPanelProps} />}
              <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
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
                      selectedKey={selectedKey}
                      checked={checked}
                      onSelect={selectRow}
                      onOpenThread={(thread) => setOpenThreadId(thread.id)}
                      onOpenGroup={showGroup}
                      onOpenThreadById={setOpenThreadId}
                      onToggleGroupRead={toggleGroupRead}
                      onThreadAction={actOnThread}
                      onItemMenu={openItemMenu}
                      onToggleSection={toggleSection}
                      minimized={dockGroups}
                    />
                  </>
                )}
                {bulkBar}
              </div>
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
                accounts={accounts}
                scope={scope}
                onScopeChange={setScope}
                onManageAccounts={() => openAccounts(false)}
                {...headerActions}
              />
            )}

            <div className="flex min-h-0 flex-1">
            {activeView === "sender" && !showNoAccounts && <SenderPanel {...senderPanelProps} />}
            <div className="relative flex min-w-0 flex-1 flex-col">
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
                  selectedKey={selectedKey}
                  checked={checked}
                  onSelect={selectRow}
                  onOpenThread={(thread) => setOpenThreadId(thread.id)}
                  onOpenGroup={showGroup}
                  onOpenThreadById={setOpenThreadId}
                  onToggleGroupRead={toggleGroupRead}
                  onThreadAction={actOnThread}
                  onItemMenu={openItemMenu}
                  onToggleSection={toggleSection}
                  minimized={dockGroups}
                />
              </>
            )}

            {bulkBar}
            </div>
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
            if (openThread) setOpenThreadId(null);
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

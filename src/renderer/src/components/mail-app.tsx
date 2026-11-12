import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ArrowUpRight, Check, Mail, MailOpen, Pin, Trash2, X } from "lucide-react";
import { toast } from "sonner";

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
import { conversationFolder, groupThreads, type Thread } from "@shared/threads";
import type { MailAction, MailFolder, ShownFolder, UiPrefs } from "@shared/types";

import { Composer } from "@/components/mail/composer";
import { AccountsDialog } from "@/components/mail/accounts-dialog";
import { CategoriesDialog } from "@/components/mail/categories-dialog";
import {
  Dashboard,
  DashboardDrillHeader,
  type DashboardSelection,
  type DrillFolder,
} from "@/components/mail/dashboard";
import { FocusedList } from "@/components/mail/focused-list";
import { LocalDrafts } from "@/components/mail/local-drafts";
import { ItemMenu, type MenuEntry } from "@/components/mail/item-menu";
import { GroupHeader, ListHeader, VIEWS, type MailView } from "@/components/mail/list-header";
import { Rail } from "@/components/mail/rail";
import { SenderHeading, SenderPanel } from "@/components/mail/sender-panel";
import { EmptyList, ErrorBanner, ListSkeleton, NoAccounts } from "@/components/mail/states";
import { ThreadView } from "@/components/mail/thread-view";
import { Button } from "@/components/ui/button";
import { useCategories } from "@/hooks/use-categories";
import { useDashboardMail } from "@/hooks/use-dashboard-mail";
import { useMailbox } from "@/hooks/use-mailbox";
import { api } from "@/lib/api";
import { newMessageSeed, type ComposeSeed } from "@/lib/compose";
import { refreshContacts } from "@/lib/contact-cache";
import { seedFromDraft, useDrafts } from "@/lib/drafts";
import { FOLDER_TITLES } from "@/lib/format";
import { isTypingTarget } from "@/lib/keyboard";
import { actionsForThread } from "@/lib/row-actions";

const NO_CHECKED: ReadonlySet<string> = new Set();

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
    undo,
    onSettled,
  } = useMailbox(shownFolders);
  /** The folder a conversation is in; in the Inbox list that can be Archive, Trash or Spam. */
  const threadFolder = useCallback(
    (thread: Thread): MailFolder => (folder === "inbox" ? conversationFolder(thread) : folder),
    [folder],
  );

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
  const threads = useMemo(
    () => (unreadOnly ? allThreads.filter((thread) => thread.unread) : allThreads),
    [allThreads, unreadOnly],
  );
  const [view, setView] = useState<MailView>("category");
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
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  /** The group whose own list is showing (Category view). */
  const [openGroupKind, setOpenGroupKind] = useState<GroupKind | null>(null);
  /** The sender picked in the Sender view's panel; the first one stands in until one is picked. */
  const [senderKey, setSenderKey] = useState<string | null>(null);
  /** A domain picked in the panel (grouped by domain); it lists the mail of all its senders. */
  const [senderDomain, setSenderDomain] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [searchOpen, setSearchOpen] = useState(false);
  const [compose, setCompose] = useState<ComposeState | null>(null);
  const savedDrafts = useDrafts();
  const [itemMenu, setItemMenu] = useState<ItemMenuState | null>(null);
  // Learn who the user writes to as soon as accounts are known, so the composer can suggest at once.
  useEffect(() => {
    if (accountsLoaded && accounts.length > 0) void refreshContacts();
  }, [accountsLoaded, accounts.length]);

  // --- Dashboard: statistics over Inbox, Archive, Spam and Trash, and the mail behind them -------
  const [screen, setScreen] = useState<"mail" | "dashboard">("mail");
  const onDashboard = screen === "dashboard";
  const [dashboardRange, setDashboardRange] = useState<DashboardRange>("30d");
  /** What a Dashboard click picked; its mail is listed instead of the charts. */
  const [drill, setDrill] = useState<DashboardSelection | null>(null);
  const [drillThreadId, setDrillThreadId] = useState<string | null>(null);
  const [drillSelectedKey, setDrillSelectedKey] = useState<string | null>(null);
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

  /** The folder tab of a Dashboard list. */
  const [drillFolder, setDrillFolder] = useState<DrillFolder>("all");

  /** Matching messages per folder tab, and each conversation's folder (see `conversationFolder`). */
  const drillByFolder = useMemo(() => {
    const matchedIn = new Map<string, number>();
    for (const message of drillMatches) {
      const key = `${message.accountId}:${message.threadId}`;
      matchedIn.set(key, (matchedIn.get(key) ?? 0) + 1);
    }
    const counts: Record<DrillFolder, number> = { all: 0, inbox: 0, archive: 0, trash: 0, spam: 0 };
    const folderOf = new Map<string, MailFolder>();
    for (const thread of drillThreads) {
      const folder = conversationFolder(thread);
      folderOf.set(thread.id, folder);
      const matched = matchedIn.get(thread.id) ?? 0;
      counts.all += matched;
      if (folder in counts) counts[folder as DrillFolder] += matched;
    }
    return { counts, folderOf };
  }, [drillMatches, drillThreads]);

  const shownDrillThreads = useMemo(
    () =>
      drillFolder === "all"
        ? drillThreads
        : drillThreads.filter((thread) => drillByFolder.folderOf.get(thread.id) === drillFolder),
    [drillFolder, drillThreads, drillByFolder],
  );

  const drillThread = useMemo(
    () => (drillThreadId ? drillThreads.find((thread) => thread.id === drillThreadId) : undefined),
    [drillThreadId, drillThreads],
  );
  useEffect(() => {
    if (drillThreadId && !drillThread) setDrillThreadId(null);
  }, [drillThreadId, drillThread]);

  const openDashboard = useCallback(() => {
    setScreen("dashboard");
    setDrill(null);
    setDrillThreadId(null);
  }, []);

  const navigateFolder = useCallback(
    (next: MailFolder) => {
      setScreen("mail");
      setFolder(next);
    },
    [setFolder],
  );

  const openDrill = useCallback((selection: DashboardSelection) => {
    setDrill(selection);
    setDrillThreadId(null);
    setDrillSelectedKey(null);
    setDrillFolder("all");
  }, []);

  const actOnDashboardThread = useCallback(
    (action: MailAction, thread: Thread) => {
      const ids = idsForAction(action, thread);
      if (ids.length === 0) return;
      // A move keeps the row with its new folder (every folder it can go to is loaded);
      // Undo puts it back through the reload above.
      applyToDashboard(action, ids);
      void act(action, ids);
    },
    [act, applyToDashboard],
  );

  const [pinnedCollapsed, setPinnedCollapsed] = useState(readPinnedCollapsed);
  const [accountsDialog, setAccountsDialog] = useState({ open: false, adding: false });

  // Section boundaries (Today / Yesterday) are recomputed whenever the data changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [threads]);

  // Categories collapse into group rows on the Inbox only; other folders list by date.
  const focused = view === "category" && folder === "inbox";

  // The group stays open while the unread filter hides all its mail (it then shows the empty state);
  // it only closes once it has no mail at all.
  const openGroup = useMemo(() => {
    if (!focused || openGroupKind === null) return null;
    const def = groupDefs(categories).find((candidate) => candidate.kind === openGroupKind);
    if (!def || threadsInGroup(allThreads, openGroupKind).length === 0) return null;
    return { def, threads: threadsInGroup(threads, openGroupKind) };
  }, [focused, openGroupKind, categories, allThreads, threads]);

  const senders = useMemo(() => (view === "sender" ? buildSenders(threads) : []), [view, threads]);
  const activeSender =
    view === "sender"
      ? (senders.find((sender) => sender.key === senderKey) ?? senders[0] ?? null)
      : null;
  const activeDomain = view === "sender" ? senderDomain : null;
  const activeSenderKey = activeDomain ? null : (activeSender?.key ?? null);

  /** The conversations the list on screen is made of. */
  const listThreads = useMemo(() => {
    if (openGroup) return openGroup.threads;
    if (view !== "sender") return threads;
    if (activeDomain) return threadsFromDomain(threads, activeDomain);
    return activeSenderKey ? threadsFromSender(threads, activeSenderKey) : [];
  }, [openGroup, view, threads, activeDomain, activeSenderKey]);

  const items: ListItem[] = useMemo(
    () =>
      focused && !openGroup
        ? buildFocusedList(threads, { now, categories, pinnedCollapsed })
        : buildFlatList(listThreads, now),
    [focused, openGroup, threads, listThreads, now, categories, pinnedCollapsed],
  );
  const navigable = useMemo(() => items.filter((item) => item.type !== "section"), [items]);
  const openThread = useMemo(
    // Looked up unfiltered: reading a conversation must not make it vanish from under the reader.
    () => (openThreadId ? allThreads.find((thread) => thread.id === openThreadId) : undefined),
    [openThreadId, allThreads],
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
    setSelectMode(false);
  }, [folder, scope]);

  // A group that emptied out (all trashed) or is gone hands the screen back to the folder's list.
  useEffect(() => {
    if (openGroupKind !== null && !openGroup) setOpenGroupKind(null);
  }, [openGroupKind, openGroup]);

  useEffect(() => {
    if (openThreadId && !openThread) setOpenThreadId(null);
  }, [openThreadId, openThread]);

  const selectedItem = navigable.find((item) => item.key === selectedKey);
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
      if (removesFromView(action, folder)) selectNeighbor(thread);
      void act(
        action,
        folder === "inbox" ? idsForAction(action, thread) : thread.messages.map((message) => message.id),
      );
    },
    [act, folder, selectNeighbor],
  );

  const actOnChecked = useCallback(
    (action: MailAction) => {
      const targets = threads.filter((thread) => checked.has(thread.id));
      void act(
        action,
        targets.flatMap((thread) => thread.messages.map((message) => message.id)),
      );
      setChecked(new Set());
    },
    [act, checked, threads],
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

  const toggleChecked = useCallback((threadId: string) => {
    setChecked((previous) => {
      const next = new Set(previous);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  }, []);

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
    setAccountsDialog({ open: true, adding });
  }, []);

  const moveSelection = useCallback(
    (delta: number) => {
      if (navigable.length === 0) return;
      const index = navigable.findIndex((item) => item.key === selectedKey);
      const next = Math.min(navigable.length - 1, Math.max(0, (index < 0 ? 0 : index) + delta));
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
    const item = itemMenu.key === null ? undefined : navigable.find((it) => it.key === itemMenu.key);
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
            actOnThread(action, thread);
            if (openThread && removesFromView(action, folder)) setOpenThreadId(null);
          },
        });
      }
      if (!openThread) {
        entries.push({
          id: "select",
          label: "Select",
          icon: Check,
          hint: "X",
          run: () => {
            setSelectMode(true);
            toggleChecked(thread.id);
          },
        });
      }
      return entries;
    }

    if (item?.type === "group") {
      return [
        {
          id: "open",
          label: `Open ${item.label}`,
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
      ];
    }
    return [];
  }, [itemMenu, navigable, openThread, folder, threadFolder, actOnThread, showGroup, toggleChecked, toggleGroupRead]);

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

  // Keyboard shortcuts, in the spirit of Spark: arrows/J/K move, Enter opens.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey) return;
      if (compose || accountsDialog.open || categoriesOpen) return;

      // The Dashboard has no list shortcuts: Esc steps back out, ⌘Z still takes back the last action.
      if (onDashboard) {
        if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
          if (!isTypingTarget(event.target) && undo()) event.preventDefault();
          return;
        }
        if (event.key === "Escape" && !isTypingTarget(event.target)) {
          if (drillThreadId) setDrillThreadId(null);
          else if (drill) setDrill(null);
          else return;
          event.preventDefault();
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
      if (event.metaKey || event.ctrlKey || isTypingTarget(event.target)) return;

      // Any other key (Shift and friends excepted) abandons a half-confirmed shortcut.
      const pressed = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (pendingConfirm.current && pressed !== pendingConfirm.current.key && pressed !== "Shift") {
        clearPendingConfirm();
      }

      const target = openThread ?? selectedThread;
      const targetFolder = target ? threadFolder(target) : folder;
      const act_ = (action: MailAction) => {
        if (!target) return;
        actOnThread(action, target);
        if (openThread && removesFromView(action, folder)) setOpenThreadId(null);
      };
      /** Archive, trash, spam and delete need the same key twice: the first press only asks. */
      const confirmThenAct = (action: MailAction, message: (key: string) => string) => {
        if (!target) return;
        const pending = pendingConfirm.current;
        if (pending && pending.key === pressed && pending.action === action && pending.threadId === target.id) {
          clearPendingConfirm();
          act_(action);
          return;
        }
        clearPendingConfirm();
        const label = event.key.length === 1 ? event.key.toUpperCase() : event.key;
        pendingConfirm.current = {
          key: pressed,
          action,
          threadId: target.id,
          timer: setTimeout(clearPendingConfirm, CONFIRM_WINDOW_MS),
        };
        toast(message(label), { id: CONFIRM_TOAST_ID, duration: CONFIRM_WINDOW_MS });
      };

      switch (event.key) {
        case "Escape":
          if (openThread) setOpenThreadId(null);
          else if (openGroup) closeGroup();
          else if (searchOpen) {
            setQuery("");
            setSearchOpen(false);
          } else if (selectMode) setSelectMode(false);
          return;
        case "Tab": {
          // Cycles the Smart / Sender / List tabs (Shift+Tab goes back); only while their header shows.
          if (openThread || openGroup || (accountsLoaded && accounts.length === 0)) return;
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
        case "t":
        case "Backspace":
        case "Delete":
          if (targetFolder === "trash" || targetFolder === "spam") {
            confirmThenAct("deleteForever", (key) => `Press ${key} again to delete forever`);
          } else {
            confirmThenAct("trash", (key) => `Press ${key} again to move to Trash`);
          }
          break;
        case "s":
          if (targetFolder === "inbox") confirmThenAct("spam", (key) => `Press ${key} again to report spam`);
          break;
        case "p":
          if (target) act_(target.pinned ? "unpin" : "pin");
          break;
        case "u":
          if (target) act_(target.unread ? "markRead" : "markUnread");
          else if (!openThread && selectedItem?.type === "group") {
            // A category row: same as clicking its dot, marks every conversation in it read or unread.
            toggleGroupRead(selectedItem.kind, selectedItem.hasUnread);
          }
          break;
        case "x":
          if (selectedThread) {
            setSelectMode(true);
            toggleChecked(selectedThread.id);
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
    accountsDialog.open,
    act,
    actOnThread,
    categoriesOpen,
    changeView,
    drill,
    drillThreadId,
    onDashboard,
    clearPendingConfirm,
    closeGroup,
    compose,
    folder,
    moveSelection,
    openGroup,
    openMenuForSelection,
    openThread,
    searchOpen,
    selectMode,
    selectedItem,
    selectedThread,
    setQuery,
    accountsLoaded,
    accounts.length,
    view,
    showGroup,
    startCompose,
    threadFolder,
    toggleChecked,
    toggleGroupRead,
    undo,
  ]);

  const changeSelectMode = (on: boolean) => {
    setSelectMode(on);
    if (!on) setChecked(new Set());
  };

  const headerActions = {
    unreadOnly,
    onUnreadOnlyChange: setUnreadOnly,
    // Only the Inbox list can show Archive, Trash and Spam mail.
    shownFolders: folder === "inbox" ? shownFolders : null,
    onToggleFolder: toggleShownFolder,
    selectMode,
    onSelectModeChange: changeSelectMode,
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

  return (
    <div className="flex h-full w-full bg-background text-foreground">
      <Rail
        folder={folder}
        dashboard={onDashboard}
        onOpenDashboard={openDashboard}
        accounts={accounts}
        onNavigate={navigateFolder}
        onOpenAccounts={() => openAccounts(false)}
        onAddAccount={() => openAccounts(true)}
        onManageCategories={() => setCategoriesOpen(true)}
        aiOff={ai !== null && !ai.configured}
      />

      {view === "sender" && !showNoAccounts && !onDashboard && (
        <SenderPanel
          senders={senders}
          threads={threads}
          selectedKey={activeSenderKey}
          selectedDomain={activeDomain}
          onSelect={pickSender}
          onSelectDomain={pickDomain}
          loading={loading && allThreads.length === 0}
        />
      )}

      <main className="relative flex min-w-0 flex-1 flex-col">
        {onDashboard && showNoAccounts ? (
          <NoAccounts demo={api.system.demo} onAdd={() => openAccounts(true)} />
        ) : onDashboard && drillThread ? (
          <ThreadView
            key={drillThread.id}
            thread={drillThread}
            folder={conversationFolder(drillThread)}
            accounts={accounts}
            onBack={() => setDrillThreadId(null)}
            onAction={(action) => {
              actOnDashboardThread(action, drillThread);
              if (MOVE_ACTIONS.has(action)) setDrillThreadId(null);
            }}
            onCompose={startCompose}
            shortcutsDisabled={compose !== null || accountsDialog.open || categoriesOpen}
          />
        ) : onDashboard && drill ? (
          <>
            <DashboardDrillHeader
              selection={drill}
              count={drillByFolder.counts[drillFolder]}
              onBack={() => setDrill(null)}
              folder={drillFolder}
              onFolderChange={setDrillFolder}
              folderCounts={drillByFolder.counts}
            />
            {shownDrillThreads.length === 0 ? (
              <EmptyList folder={drillFolder === "all" ? "inbox" : drillFolder} query="" />
            ) : (
              <FocusedList
                items={buildFlatList(shownDrillThreads, new Date())}
                folder="inbox"
                showFolder
                accounts={accounts}
                selectedKey={drillSelectedKey}
                selectMode={false}
                checked={NO_CHECKED}
                onSelect={setDrillSelectedKey}
                onOpenThread={(thread) => setDrillThreadId(thread.id)}
                onOpenGroup={() => undefined}
                onOpenThreadById={setDrillThreadId}
                onToggleGroupRead={() => undefined}
                onToggleChecked={() => undefined}
                onThreadAction={actOnDashboardThread}
                onItemMenu={(key) => setDrillSelectedKey(key)}
                onToggleSection={() => undefined}
              />
            )}
          </>
        ) : onDashboard ? (
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
              if (removesFromView(action, folder)) setOpenThreadId(null);
            }}
            onCompose={startCompose}
            shortcutsDisabled={compose !== null || accountsDialog.open || categoriesOpen}
          />
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
                onViewChange={changeView}
                accounts={accounts}
                scope={scope}
                onScopeChange={setScope}
                onManageAccounts={() => openAccounts(false)}
                {...headerActions}
              />
            )}

            <ErrorBanner
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
                  selectMode={selectMode}
                  checked={checked}
                  onSelect={setSelectedKey}
                  onOpenThread={(thread) => setOpenThreadId(thread.id)}
                  onOpenGroup={showGroup}
                  onOpenThreadById={setOpenThreadId}
                  onToggleGroupRead={toggleGroupRead}
                  onToggleChecked={toggleChecked}
                  onThreadAction={actOnThread}
                  onItemMenu={openItemMenu}
                  onToggleSection={toggleSection}
                />
              </>
            )}

            {selectMode && checked.size > 0 && (
              <div className="corner-squircle absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-popover px-3 py-2 shadow-lg">
                <span className="mr-2 text-sm text-muted-foreground">{checked.size} selected</span>
                <Button size="sm" variant="ghost" onClick={() => actOnChecked("pin")}>
                  <Pin /> Pin
                </Button>
                <Button size="sm" variant="ghost" onClick={() => actOnChecked("markRead")}>
                  <MailOpen /> Read
                </Button>
                <Button size="sm" variant="ghost" onClick={() => actOnChecked("markUnread")}>
                  <Mail /> Unread
                </Button>
                <Button size="sm" variant="ghost" onClick={() => actOnChecked("trash")}>
                  <Trash2 /> Trash
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Clear selection"
                  className="size-8"
                  onClick={() => setChecked(new Set())}
                >
                  <X />
                </Button>
              </div>
            )}
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

      {compose && (
        <Composer
          key={compose.id}
          seed={compose.seed}
          accounts={accounts}
          onClose={() => setCompose(null)}
        />
      )}

      <CategoriesDialog
        open={categoriesOpen}
        onOpenChange={setCategoriesOpen}
        categories={categories}
        ai={ai}
        onState={setCategoryState}
      />

      <AccountsDialog
        open={accountsDialog.open}
        startAdding={accountsDialog.adding}
        accounts={accounts}
        onOpenChange={(open) => setAccountsDialog((previous) => ({ ...previous, open }))}
        onChanged={() => void reloadAccounts()}
      />
    </div>
  );
}

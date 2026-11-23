import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  ArrowLeft,
  Check,
  CheckCheck,
  ChevronDown,
  Mail,
  MailOpen,
  RefreshCw,
  Search,
  SquarePen,
  X,
} from "lucide-react";

import { accountLabel } from "@shared/accounts";
import type { GroupDef } from "@shared/focus-list";
import type { Account, Category, MailView, ShownFolder } from "@shared/types";

import { Input } from "@/components/ui/input";
import { FLAT_KEY } from "@/components/ui/keys";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShortcutHint } from "@/components/ui/keyboard-shortcut-badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SHOWN_FOLDERS, type AccountScope } from "@/hooks/use-mailbox";
import type { HiddenFolderMatches } from "@/lib/hidden-folder-matches";
import { FOLDER_STYLE, raisedActive } from "@/lib/folder-style";
import { cn } from "@/lib/utils";

import { AccountMark } from "./account-mark";
import { GroupTile } from "./group-row";
import { SearchBox } from "./search-box";

/**
 * How the mail of a folder is laid out: `category` (the "Smart" tab) collapses each category into one row (on the
 * Inbox), `sender` lists the mail of one sender picked in a side panel, `list` is plain and by date.
 */
export type { MailView };

/** The view tabs in display order; Tab cycles through them in this order. */
export const VIEWS: readonly { view: MailView; label: string }[] = [
  { view: "category", label: "Smart" },
  { view: "sender", label: "Sender" },
  { view: "list", label: "List" },
];

interface ListHeaderProps extends HeaderActionsProps {
  title: string;
  view: MailView;
  /** False where the list is always plain (Drafts, Sent): no Smart / Sender / List tabs. */
  showViews?: boolean;
  onViewChange: (view: MailView) => void;
  /** Sits right after the view tabs (the Sender view's grouping toggle). */
  viewExtra?: ReactNode;
  accounts: readonly Account[];
  scope: AccountScope;
  onScopeChange: (scope: AccountScope) => void;
  onManageAccounts: () => void;
  /** Reloads the list. */
  onRefresh: () => void;
  /** Whether a reload is running: the refresh icon spins. */
  refreshing: boolean;
}

function HeaderIconButton({
  label,
  tooltip = label,
  hint,
  pressed,
  activeClassName,
  className,
  badge,
  disabled,
  onClick,
  children,
}: {
  label: string;
  /** Text of the tooltip when it should say more than the label. */
  tooltip?: string;
  /** Keyboard shortcut, shown muted beside the tooltip text like everywhere else. */
  hint?: string;
  /** Makes it a toggle: whether it is on. */
  pressed?: boolean;
  /** Replaces the blue "on" look of a toggle. */
  activeClassName?: string;
  /** Extra classes, e.g. to size the button down inside a group. */
  className?: string;
  /** A small number on the corner of the button (matches waiting behind it). */
  badge?: number;
  /** Greyed out and inert (nothing to act on). */
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            "electron-no-drag relative flex size-9 items-center justify-center rounded-xl disabled:pointer-events-none disabled:opacity-40",
            FLAT_KEY,
            pressed && [
              // Latched on a key sinks, unless the caller brings its own shadow (the folder keys are raised).
              !activeClassName?.includes("shadow-") && "shadow-pressed",
              activeClassName ?? "text-sidebar-primary hover:text-sidebar-primary",
            ],
            className,
          )}
        >
          {children}
          {badge ? (
            <span
              aria-hidden
              className="pointer-events-none absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-sidebar-primary px-1 text-[10px] font-semibold leading-none text-sidebar-primary-foreground tabular-nums"
            >
              {badge > 99 ? "99+" : badge}
            </span>
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {tooltip}
        {hint ? <ShortcutHint hint={hint} /> : null}
      </TooltipContent>
    </Tooltip>
  );
}

/** How long a half turn of the refresh icon takes (`duration-300` below). */
const TURN_MS = 300;

/**
 * Reloads the mail on screen. The icon turns half a turn at a time: it keeps turning while a reload
 * runs, and a half turn that has started always finishes, even when the reload ends first.
 */
export function RefreshButton({
  onRefresh,
  refreshing,
  className,
}: {
  onRefresh: () => void;
  refreshing: boolean;
  /** Extra classes, e.g. a negative margin to sit closer to a neighbor. */
  className?: string;
}) {
  const [halfTurns, setHalfTurns] = useState(0);
  const turning = useRef(false);
  const refreshingNow = useRef(refreshing);
  refreshingNow.current = refreshing;
  const guard = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const finish = () => {
    clearTimeout(guard.current);
    turning.current = false;
    // Still reloading: the next half turn follows at once.
    if (refreshingNow.current) turn();
  };

  const turn = () => {
    if (turning.current) return;
    turning.current = true;
    setHalfTurns((count) => count + 1);
    // A half turn that starts before the icon was ever painted (the first load) has nothing to
    // transition from, so `transitionend` never comes; this timer ends it just after it would.
    guard.current = setTimeout(finish, TURN_MS + 60);
  };

  // A reload that starts without a click here (a shortcut, a poll) turns the icon too.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `turn` only touches refs and a setter.
  useEffect(() => {
    if (refreshing) turn();
  }, [refreshing]);

  // Leaving (or React replaying the mount in development) drops the timer, so it must drop the flag too.
  useEffect(
    () => () => {
      clearTimeout(guard.current);
      turning.current = false;
    },
    [],
  );

  return (
    <HeaderIconButton
      label="Refresh"
      className={className}
      onClick={() => {
        turn();
        onRefresh();
      }}
    >
      <RefreshCw
        className="size-[18px] transition-transform duration-300 ease-linear"
        style={{ transform: `rotate(${halfTurns * 180}deg)` }}
        onTransitionEnd={finish}
      />
    </HeaderIconButton>
  );
}

/**
 * The primary action: a blue circle with a soft drop shadow that brightens on hover and keyboard
 * focus. Round on purpose, so it stays out of the squircle family of the other header buttons.
 */
function ComposeButton({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Compose"
          onClick={onClick}
          className="electron-no-drag press-sink grain ml-1 flex size-10 items-center justify-center rounded-full bg-sidebar-primary text-sidebar-primary-foreground shadow-raise-1 outline-none transition-[box-shadow,transform,filter] hover:brightness-110"
        >
          <SquarePen className="size-[18px]" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Compose
        <ShortcutHint hint="C" />
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The accounts in view: two or three as a stack of overlapping chips, each lapping a third over
 * the one before it.
 */
function AccountMarks({
  accounts,
  size = 24,
}: {
  accounts: readonly Account[];
  size?: number;
}) {
  const shown = accounts.slice(0, 3);
  const overlap = Math.round(size / 3);
  // One account has nothing to lift off, so it keeps its bare mark like everywhere else.
  if (shown.length === 1) return <AccountMark account={shown[0]} size={22} />;
  return (
    // Isolated so the chips' stacking order stays inside the stack.
    <span className="isolate flex shrink-0 items-center" aria-hidden>
      {shown.map((account, index) => (
        <span
          key={account.id}
          className="flex"
          style={{
            marginLeft: index > 0 ? -overlap : undefined,
            zIndex: index,
          }}
        >
          <AccountMark account={account} size={size} stacked />
        </span>
      ))}
    </span>
  );
}

/**
 * The account switcher: which account (or all of them) a page or list is about. Without
 * `onManageAccounts` the "Manage accounts…" entry is left out.
 */
export function AccountSwitcher({
  accounts,
  scope,
  onScopeChange,
  onManageAccounts,
  detail,
  menuAlign = "start",
}: {
  accounts: readonly Account[];
  scope: AccountScope;
  onScopeChange: (scope: AccountScope) => void;
  onManageAccounts?: () => void;
  /** A line under an account's name in the menu, in place of its address. */
  detail?: (account: Account) => string | undefined;
  /** Which edge of the button the menu lines up with; "end" for a button at the right of a page. */
  menuAlign?: "start" | "end";
}) {
  const selected =
    scope === "all"
      ? undefined
      : accounts.find((account) => account.id === scope);
  const scopeLabel = selected ? accountLabel(selected) : "All accounts";

  return (
    /* Non-modal: "Manage accounts" opens a dialog, and a modal menu would leave the page unclickable. */
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account: ${scopeLabel}. Change account`}
          className={`electron-no-drag flex h-9 min-w-0 items-center gap-2 rounded-xl px-3 text-sm outline-none ${FLAT_KEY}`}
        >
          <AccountMarks accounts={selected ? [selected] : accounts} />
          <span className="max-w-[280px] truncate font-medium">
            {scopeLabel}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={menuAlign} className="w-72">
        <DropdownMenuItem onSelect={() => onScopeChange("all")}>
          {/* Not boxed to the single-logo column below: the stack is wider and would run into the label. */}
          <span className="mr-2 flex shrink-0">
            <AccountMarks accounts={accounts} />
          </span>
          <span className="flex-1">All accounts</span>
          {scope === "all" && <Check className="size-4" />}
        </DropdownMenuItem>
        {accounts.length > 0 && <DropdownMenuSeparator />}
        {accounts.map((account) => (
          <DropdownMenuItem
            key={account.id}
            onSelect={() => onScopeChange(account.id)}
          >
            <span className="mr-2 flex w-6 shrink-0 justify-center">
              <AccountMark account={account} size={22} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{accountLabel(account)}</span>
              {(detail?.(account) ?? account.alias) && (
                <span className="block truncate text-xs text-muted-foreground">
                  {detail?.(account) ?? account.email}
                </span>
              )}
            </span>
            {scope === account.id && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
        {onManageAccounts && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onManageAccounts}>
              Manage accounts…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface HeaderActionsProps {
  unreadOnly: boolean;
  onUnreadOnlyChange: (on: boolean) => void;
  /** Marks every unread conversation of the list as read; null where the list has none to act on. */
  onMarkAllRead: (() => void) | null;
  /** The folders checked in the Inbox list; null when this list cannot show other folders. */
  shownFolders: readonly ShownFolder[] | null;
  onToggleFolder: (folder: ShownFolder) => void;
  /** Conversations matching the search in the folders that are off; shown as a number on their buttons. */
  hiddenMatches?: HiddenFolderMatches;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  /** Down in the search box: the keyboard moves on to the first item of the list. */
  onEnterList: () => void;
  /** What the search box can suggest for `category:` and `account:`. */
  searchCategories: readonly Category[];
  searchAccounts: readonly Account[];
  onCompose: () => void;
}

/**
 * One segmented group that checks which folders a list shows (Inbox, then Archive, Trash and Spam
 * in gray, red and amber).
 */
export function FolderFilterGroup({
  shownFolders,
  onToggleFolder,
  hiddenMatches,
}: {
  shownFolders: readonly ShownFolder[];
  onToggleFolder: (folder: ShownFolder) => void;
  /** While searching: how many conversations match in each folder that is off. */
  hiddenMatches?: HiddenFolderMatches;
}) {
  return (
    <div
      role="group"
      aria-label="Folders shown"
      className="corner-squircle electron-no-drag flex items-center gap-1 rounded-[15px] p-1 shadow-raise-1"
    >
      {SHOWN_FOLDERS.map((folder) => {
        const { label, icon: Icon } = FOLDER_STYLE[folder];
        const on = shownFolders.includes(folder);
        const matches = on ? 0 : (hiddenMatches?.[folder] ?? 0);
        const matchText = matches === 0 ? "" : ` (${matches} ${matches === 1 ? "match" : "matches"})`;
        return (
          <HeaderIconButton
            key={folder}
            label={`${on ? "Hide" : "Show"} ${label.toLowerCase()}${matchText}`}
            tooltip={
              on
                ? `Hide ${label.toLowerCase()} mail`
                : `Show ${label.toLowerCase()} mail${matches === 0 ? "" : `: ${matches} ${matches === 1 ? "match" : "matches"} for this search`}`
            }
            badge={matches}
            pressed={on}
            activeClassName={raisedActive(folder)}
            className="size-8 rounded-[10px]"
            onClick={() => onToggleFolder(folder)}
          >
            {/* Off, every folder button reads like the inbox's; the tint appears only while its folder is shown. */}
            <Icon className={cn("size-[18px]", !on && FOLDER_STYLE.inbox.text)} />
          </HeaderIconButton>
        );
      })}
    </div>
  );
}

/**
 * The list filters: the unread-only toggle on its own, then the folder group. The group only
 * exists where the list can show those folders.
 */
function FilterGroup({
  unreadOnly,
  onUnreadOnlyChange,
  onMarkAllRead,
  shownFolders,
  onToggleFolder,
  hiddenMatches,
}: Pick<
  HeaderActionsProps,
  "unreadOnly" | "onUnreadOnlyChange" | "onMarkAllRead" | "shownFolders" | "onToggleFolder" | "hiddenMatches"
>) {
  return (
    <>
      <HeaderIconButton
        label="Mark all as read"
        hint="⌘⇧U"
        disabled={!onMarkAllRead}
        onClick={() => onMarkAllRead?.()}
      >
        <CheckCheck className="size-[18px]" />
      </HeaderIconButton>
      <HeaderIconButton
        label="Show unread only"
        tooltip={unreadOnly ? "Showing unread only" : "Show unread only"}
        hint="⌘U"
        pressed={unreadOnly}
        activeClassName="text-sidebar-primary hover:text-sidebar-primary"
        onClick={() => onUnreadOnlyChange(!unreadOnly)}
      >
        {/* A closed envelope while only unread mail shows, an open one while everything does. */}
        {unreadOnly ? (
          <Mail className="size-[18px]" />
        ) : (
          <MailOpen className="size-[18px]" />
        )}
      </HeaderIconButton>
      {shownFolders && (
        <FolderFilterGroup
          shownFolders={shownFolders}
          onToggleFolder={onToggleFolder}
          hiddenMatches={hiddenMatches}
        />
      )}
    </>
  );
}

/** Sent on the window to put the cursor back in the open search box; `detail.select` also selects its text. */
export const FOCUS_SEARCH_EVENT = "minimail:focus-search";

/** The buttons at the right of every list header: filters, select, search and compose. */
function HeaderActions({
  unreadOnly,
  onUnreadOnlyChange,
  onMarkAllRead,
  shownFolders,
  onToggleFolder,
  hiddenMatches,
  searchOpen,
  onSearchOpenChange,
  query,
  onQueryChange,
  onEnterList,
  searchCategories,
  searchAccounts,
  onCompose,
}: HeaderActionsProps) {
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  // Back into the open box: ⌘K selects what it holds, Up from the first row leaves the cursor where it was.
  useEffect(() => {
    const refocus = (event: Event) => {
      const input = searchRef.current;
      if (!input) return;
      input.focus();
      if ((event as CustomEvent<{ select: boolean }>).detail?.select) input.select();
      else {
        // Focusing from the keyboard can select the text; the cursor goes to the end instead.
        const end = input.value.length;
        input.setSelectionRange(end, end);
      }
    };
    window.addEventListener(FOCUS_SEARCH_EVENT, refocus);
    return () => window.removeEventListener(FOCUS_SEARCH_EVENT, refocus);
  }, []);

  return (
    <div className="flex shrink-0 items-center gap-2">
      <FilterGroup
        unreadOnly={unreadOnly}
        onUnreadOnlyChange={onUnreadOnlyChange}
        onMarkAllRead={onMarkAllRead}
        shownFolders={shownFolders}
        onToggleFolder={onToggleFolder}
        hiddenMatches={hiddenMatches}
      />
      {searchOpen ? (
        <SearchBox
          inputRef={searchRef}
          query={query}
          onQueryChange={onQueryChange}
          onClose={() => {
            onQueryChange("");
            onSearchOpenChange(false);
          }}
          onEnterList={onEnterList}
          categories={searchCategories}
          accounts={searchAccounts}
        />
      ) : (
        <>
          <HeaderIconButton
            label="Search"
            hint="⌘K"
            onClick={() => onSearchOpenChange(true)}
          >
            <Search className="size-[18px]" />
          </HeaderIconButton>
        </>
      )}
      <ComposeButton onClick={onCompose} />
    </div>
  );
}

/** Top bar of the list: folder title, the account switcher and the view tabs, then the header actions. */
export function ListHeader({
  title,
  view,
  showViews = true,
  onViewChange,
  viewExtra,
  accounts,
  scope,
  onScopeChange,
  onManageAccounts,
  onRefresh,
  refreshing,
  ...actions
}: ListHeaderProps) {
  return (
    <header className="electron-window-drag flex h-16 shrink-0 items-end justify-between px-8 pb-3 pt-3">
      <div className="electron-no-drag -ml-2 flex min-w-0 items-center gap-4 px-2">
        <h1 className="shrink-0 text-base font-semibold">{title}</h1>

        <AccountSwitcher
          accounts={accounts}
          scope={scope}
          onScopeChange={onScopeChange}
          onManageAccounts={onManageAccounts}
        />

        <RefreshButton className="-mx-2" onRefresh={onRefresh} refreshing={refreshing} />

        {showViews && (
          <ViewTabs view={view} onViewChange={onViewChange} extra={viewExtra} />
        )}
      </div>

      <HeaderActions {...actions} />
    </header>
  );
}

/** The Smart / Sender / List tabs. */
function ViewTabs({
  view,
  onViewChange,
  extra,
}: {
  view: MailView;
  onViewChange: (view: MailView) => void;
  extra?: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Tabs
        value={view}
        onValueChange={(next) => onViewChange(next as MailView)}
      >
        <TabsList aria-label="View" className="h-9 shrink-0">
          {VIEWS.map((option) => (
            <TabsTrigger
              key={option.view}
              value={option.view}
              className="h-7 py-0"
            >
              {option.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {extra}
    </div>
  );
}

interface GroupHeaderProps extends HeaderActionsProps {
  group: GroupDef;
  /** Conversations in the group. */
  count: number;
  onBack: () => void;
}

/**
 * Top bar of one group's own list: back to the folder and the group's name, then the same header
 * actions as the folder's list.
 */
export function GroupHeader({
  group,
  count,
  onBack,
  ...actions
}: GroupHeaderProps) {
  return (
    <header className="electron-window-drag flex h-16 shrink-0 items-end justify-between px-8 pb-3 pt-3">
      <div className="electron-no-drag -ml-2 flex min-w-0 items-center gap-3 px-2">
        <HeaderIconButton label="Back" tooltip="Back (Esc)" onClick={onBack}>
          <ArrowLeft className="size-[18px]" />
        </HeaderIconButton>
        <GroupTile group={group} />
        <h1 className="min-w-0 shrink-0 truncate text-base font-semibold">
          {group.label}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {count}
          </span>
        </h1>
      </div>

      <HeaderActions {...actions} />
    </header>
  );
}

interface DrillHeaderProps extends HeaderActionsProps {
  /** What the Dashboard click picked, e.g. "Last 7 days". */
  title: string;
  onBack: () => void;
  view: MailView;
  onViewChange: (view: MailView) => void;
  /** Sits right after the view tabs (the Sender view's grouping toggle). */
  viewExtra?: ReactNode;
  accounts: readonly Account[];
  scope: AccountScope;
  onScopeChange: (scope: AccountScope) => void;
  onManageAccounts: () => void;
  /** Reloads the list. */
  onRefresh: () => void;
  /** Whether a reload is running: the refresh icon spins. */
  refreshing: boolean;
}

/**
 * Top bar of the mail behind a Dashboard click: the Inbox's own bar (account switcher, view tabs
 * and header actions), with a way back to the Dashboard and what was picked in place of the title.
 */
export function DrillHeader({
  title,
  onBack,
  view,
  onViewChange,
  viewExtra,
  accounts,
  scope,
  onScopeChange,
  onManageAccounts,
  onRefresh,
  refreshing,
  ...actions
}: DrillHeaderProps) {
  return (
    <header className="electron-window-drag flex h-16 shrink-0 items-end justify-between px-8 pb-3 pt-3">
      <div className="electron-no-drag -ml-2 flex min-w-0 items-center gap-4 px-2">
        <HeaderIconButton label="Back to Dashboard" hint="Esc" onClick={onBack}>
          <ArrowLeft className="size-[18px]" />
        </HeaderIconButton>
        <h1 className="min-w-0 max-w-64 shrink-0 truncate text-base font-semibold">
          {title}
        </h1>

        <AccountSwitcher
          accounts={accounts}
          scope={scope}
          onScopeChange={onScopeChange}
          onManageAccounts={onManageAccounts}
        />

        <RefreshButton className="-mx-2" onRefresh={onRefresh} refreshing={refreshing} />

        <ViewTabs view={view} onViewChange={onViewChange} extra={viewExtra} />
      </div>

      <HeaderActions {...actions} />
    </header>
  );
}

import { useEffect, useRef } from "react";

import { ArrowLeft, Check, ChevronDown, Mail, MailOpen, Search, SquarePen, X } from "lucide-react";

import { accountLabel } from "@shared/accounts";
import type { GroupDef } from "@shared/focus-list";
import type { Account, MailView, ShownFolder } from "@shared/types";

import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SHOWN_FOLDERS, type AccountScope } from "@/hooks/use-mailbox";
import { FOLDER_STYLE } from "@/lib/folder-style";
import { cn } from "@/lib/utils";

import { AccountMark } from "./account-mark";
import { GroupTile } from "./group-row";

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
  accounts: readonly Account[];
  scope: AccountScope;
  onScopeChange: (scope: AccountScope) => void;
  onManageAccounts: () => void;
}

function HeaderIconButton({
  label,
  tooltip = label,
  hint,
  pressed,
  activeClassName,
  className,
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
          onClick={onClick}
          className={cn(
            "corner-squircle electron-no-drag relative flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
            pressed && (activeClassName ?? "bg-accent text-sidebar-primary hover:text-sidebar-primary"),
            className,
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {tooltip}
        {hint ? <span className="ml-2 text-muted-foreground">{hint}</span> : null}
      </TooltipContent>
    </Tooltip>
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
          className="electron-no-drag ml-1 flex size-10 items-center justify-center rounded-full bg-sidebar-primary text-sidebar-primary-foreground shadow-[0_3px_10px_hsl(var(--sidebar-primary)/0.45),0_1px_3px_rgb(0_0_0/0.25)] outline-none transition-[filter,box-shadow] hover:brightness-125 focus-visible:brightness-125 focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:brightness-110"
        >
          <SquarePen className="size-[18px]" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Compose
        <span className="ml-2 text-muted-foreground">C</span>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The accounts in view: two or three as a stack of overlapping chips, each lapping a third over
 * the one before it.
 */
function AccountMarks({ accounts, size = 24 }: { accounts: readonly Account[]; size?: number }) {
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
          style={{ marginLeft: index > 0 ? -overlap : undefined, zIndex: index }}
        >
          <AccountMark account={account} size={size} stacked />
        </span>
      ))}
    </span>
  );
}

/** The account switcher: which account (or all of them) the list shows. */
function AccountSwitcher({
  accounts,
  scope,
  onScopeChange,
  onManageAccounts,
}: {
  accounts: readonly Account[];
  scope: AccountScope;
  onScopeChange: (scope: AccountScope) => void;
  onManageAccounts: () => void;
}) {
  const selected = scope === "all" ? undefined : accounts.find((account) => account.id === scope);
  const scopeLabel = selected ? accountLabel(selected) : "All accounts";

  return (
    /* Non-modal: "Manage accounts" opens a dialog, and a modal menu would leave the page unclickable. */
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account: ${scopeLabel}. Change account`}
          className="corner-squircle electron-no-drag flex h-9 min-w-0 items-center gap-2 rounded-lg border border-border bg-card/40 px-3 text-sm outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent/60"
        >
          <AccountMarks accounts={selected ? [selected] : accounts} />
          <span className="max-w-[280px] truncate font-medium">{scopeLabel}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
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
          <DropdownMenuItem key={account.id} onSelect={() => onScopeChange(account.id)}>
            <span className="mr-2 flex w-6 shrink-0 justify-center">
              <AccountMark account={account} size={22} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{accountLabel(account)}</span>
              {account.alias && (
                <span className="block truncate text-xs text-muted-foreground">
                  {account.email}
                </span>
              )}
            </span>
            {scope === account.id && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onManageAccounts}>Manage accounts…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface HeaderActionsProps {
  unreadOnly: boolean;
  onUnreadOnlyChange: (on: boolean) => void;
  /** The folders checked in the Inbox list; null when this list cannot show other folders. */
  shownFolders: readonly ShownFolder[] | null;
  onToggleFolder: (folder: ShownFolder) => void;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  onCompose: () => void;
}

/**
 * The list filters: the unread-only toggle on its own, then one segmented group that checks which
 * folders the list shows (Inbox, then Archive, Trash and Spam in gray, red and amber). The group
 * only exists where the list can show those folders.
 */
function FilterGroup({
  unreadOnly,
  onUnreadOnlyChange,
  shownFolders,
  onToggleFolder,
}: Pick<
  HeaderActionsProps,
  "unreadOnly" | "onUnreadOnlyChange" | "shownFolders" | "onToggleFolder"
>) {
  return (
    <>
      <HeaderIconButton
        label="Show unread only"
        tooltip={unreadOnly ? "Showing unread only" : "Show unread only"}
        pressed={unreadOnly}
        activeClassName="bg-accent text-foreground hover:text-foreground"
        onClick={() => onUnreadOnlyChange(!unreadOnly)}
      >
        {/* A closed envelope while only unread mail shows, an open one while everything does. */}
        {unreadOnly ? <Mail className="size-[18px]" /> : <MailOpen className="size-[18px]" />}
      </HeaderIconButton>
      {shownFolders && (
        <div
          role="group"
          aria-label="Folders shown"
          className="corner-squircle electron-no-drag flex items-center gap-0.5 rounded-lg border border-border bg-card/40 p-0.5"
        >
          {SHOWN_FOLDERS.map((folder) => {
            const { label, icon: Icon, text, active } = FOLDER_STYLE[folder];
            const on = shownFolders.includes(folder);
            return (
              <HeaderIconButton
                key={folder}
                label={`${on ? "Hide" : "Show"} ${label.toLowerCase()}`}
                tooltip={on ? `Hide ${label.toLowerCase()} mail` : `Show ${label.toLowerCase()} mail`}
                pressed={on}
                activeClassName={active}
                className="size-8 rounded-md"
                onClick={() => onToggleFolder(folder)}
              >
                <Icon className={cn("size-[18px]", !on && text)} />
              </HeaderIconButton>
            );
          })}
        </div>
      )}
    </>
  );
}

/** The buttons at the right of every list header: filters, select, search and compose. */
function HeaderActions({
  unreadOnly,
  onUnreadOnlyChange,
  shownFolders,
  onToggleFolder,
  searchOpen,
  onSearchOpenChange,
  query,
  onQueryChange,
  onCompose,
}: HeaderActionsProps) {
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  return (
    <div className="flex shrink-0 items-center gap-2">
      <FilterGroup
        unreadOnly={unreadOnly}
        onUnreadOnlyChange={onUnreadOnlyChange}
        shownFolders={shownFolders}
        onToggleFolder={onToggleFolder}
      />
      {searchOpen ? (
        <div className="electron-no-drag relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={query}
            placeholder="Search mail"
            aria-label="Search mail"
            className="h-9 w-72 pl-8 pr-8"
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                onQueryChange("");
                onSearchOpenChange(false);
              }
            }}
          />
          <button
            type="button"
            aria-label="Close search"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => {
              onQueryChange("");
              onSearchOpenChange(false);
            }}
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <>
          <HeaderIconButton label="Search" hint="⌘K" onClick={() => onSearchOpenChange(true)}>
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
  accounts,
  scope,
  onScopeChange,
  onManageAccounts,
  ...actions
}: ListHeaderProps) {
  return (
    <header className="electron-window-drag flex h-[88px] shrink-0 items-end justify-between px-8 pb-3 pt-10">
      <div className="electron-no-drag -ml-2 flex min-w-0 items-center gap-4 px-2">
        <h1 className="shrink-0 text-base font-semibold">{title}</h1>

        <AccountSwitcher
          accounts={accounts}
          scope={scope}
          onScopeChange={onScopeChange}
          onManageAccounts={onManageAccounts}
        />

        {showViews && <ViewTabs view={view} onViewChange={onViewChange} />}
      </div>

      <HeaderActions {...actions} />
    </header>
  );
}

/** The Smart / Sender / List tabs. */
function ViewTabs({ view, onViewChange }: { view: MailView; onViewChange: (view: MailView) => void }) {
  return (
    <Tabs value={view} onValueChange={(next) => onViewChange(next as MailView)}>
      <TabsList aria-label="View" className="h-9 shrink-0">
        {VIEWS.map((option) => (
          <TabsTrigger key={option.view} value={option.view} className="h-7 py-0">
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
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
    <header className="electron-window-drag flex h-[88px] shrink-0 items-end justify-between px-8 pb-3 pt-10">
      <div className="electron-no-drag -ml-2 flex min-w-0 items-center gap-3 px-2">
        <HeaderIconButton label="Back" tooltip="Back (Esc)" onClick={onBack}>
          <ArrowLeft className="size-[18px]" />
        </HeaderIconButton>
        <GroupTile group={group} />
        <h1 className="min-w-0 shrink-0 truncate text-base font-semibold">
          {group.label}
          <span className="ml-2 text-xs font-normal text-muted-foreground">{count}</span>
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
  accounts: readonly Account[];
  scope: AccountScope;
  onScopeChange: (scope: AccountScope) => void;
  onManageAccounts: () => void;
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
  accounts,
  scope,
  onScopeChange,
  onManageAccounts,
  ...actions
}: DrillHeaderProps) {
  return (
    <header className="electron-window-drag flex h-[88px] shrink-0 items-end justify-between px-8 pb-3 pt-10">
      <div className="electron-no-drag -ml-2 flex min-w-0 items-center gap-4 px-2">
        <HeaderIconButton label="Back to Dashboard" hint="Esc" onClick={onBack}>
          <ArrowLeft className="size-[18px]" />
        </HeaderIconButton>
        <h1 className="min-w-0 max-w-64 shrink-0 truncate text-base font-semibold">{title}</h1>

        <AccountSwitcher
          accounts={accounts}
          scope={scope}
          onScopeChange={onScopeChange}
          onManageAccounts={onManageAccounts}
        />

        <ViewTabs view={view} onViewChange={onViewChange} />
      </div>

      <HeaderActions {...actions} />
    </header>
  );
}

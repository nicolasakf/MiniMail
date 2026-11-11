import { useEffect, useRef } from "react";

import { ArrowLeft, Check, ChevronDown, Search, Settings2, SquarePen, X } from "lucide-react";

import { accountLabel } from "@shared/accounts";
import type { GroupDef } from "@shared/focus-list";
import type { Account, AiStatus } from "@shared/types";

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
import type { AccountScope } from "@/hooks/use-mailbox";
import { cn } from "@/lib/utils";

import { AccountMark } from "./account-mark";
import { GroupTile } from "./group-row";

/**
 * How the mail of a folder is laid out: `category` collapses each category into one row (on the
 * Inbox), `sender` lists the mail of one sender picked in a side panel, `list` is plain and by date.
 */
export type MailView = "category" | "sender" | "list";

const VIEWS: readonly { view: MailView; label: string }[] = [
  { view: "category", label: "Category" },
  { view: "sender", label: "Sender" },
  { view: "list", label: "List" },
];

interface ListHeaderProps {
  title: string;
  view: MailView;
  onViewChange: (view: MailView) => void;
  accounts: readonly Account[];
  scope: AccountScope;
  onScopeChange: (scope: AccountScope) => void;
  onManageAccounts: () => void;
  selectMode: boolean;
  onSelectModeChange: (on: boolean) => void;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  /** Null until the classifier state has loaded. */
  ai: AiStatus | null;
  onManageCategories: () => void;
  onCompose: () => void;
}

/** Pill switch with a check in its thumb: toggles multi-select on the list. */
function SelectSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Select multiple conversations"
          onClick={() => onChange(!on)}
          className={cn(
            "electron-no-drag relative h-6 w-10 rounded-full transition-colors",
            on ? "bg-sidebar-primary" : "bg-muted",
          )}
        >
          <span
            className={cn(
              "absolute left-0.5 top-0.5 flex size-5 items-center justify-center rounded-full bg-background text-foreground shadow transition-transform",
              on && "translate-x-4",
            )}
          >
            <Check className="size-3" />
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Select multiple</TooltipContent>
    </Tooltip>
  );
}

function HeaderIconButton({
  label,
  tooltip = label,
  hint,
  onClick,
  children,
}: {
  label: string;
  /** Text of the tooltip when it should say more than the label. */
  tooltip?: string;
  /** Keyboard shortcut, shown muted beside the tooltip text like everywhere else. */
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
          className="corner-squircle electron-no-drag relative flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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

/**
 * Top bar of the list: folder title, the account switcher and the view tabs, then select /
 * search / categories / compose.
 */
export function ListHeader({
  title,
  view,
  onViewChange,
  accounts,
  scope,
  onScopeChange,
  onManageAccounts,
  selectMode,
  onSelectModeChange,
  searchOpen,
  onSearchOpenChange,
  query,
  onQueryChange,
  ai,
  onManageCategories,
  onCompose,
}: ListHeaderProps) {
  const aiOff = ai !== null && !ai.configured;
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = scope === "all" ? undefined : accounts.find((account) => account.id === scope);
  const scopeLabel = selected ? accountLabel(selected) : "All accounts";

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  return (
    <header className="electron-window-drag flex h-[88px] shrink-0 items-end justify-between px-8 pb-3 pt-10">
      <div className="electron-no-drag -ml-2 flex min-w-0 items-center gap-4 px-2">
        <h1 className="shrink-0 text-base font-semibold">{title}</h1>

        {/* Non-modal: "Manage accounts" opens a dialog, and a modal menu would leave the page unclickable. */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Account: ${scopeLabel}. Change account`}
              className="corner-squircle flex h-9 min-w-0 items-center gap-2 rounded-lg border border-border bg-card/40 px-3 text-sm outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent/60"
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

        <Tabs value={view} onValueChange={(next) => onViewChange(next as MailView)}>
          <TabsList aria-label="View" className="h-9 shrink-0">
            {VIEWS.map((option) => (
              <TabsTrigger key={option.view} value={option.view} className="h-7 py-0">
                {option.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="flex shrink-0 items-center gap-2">
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
            <SelectSwitch on={selectMode} onChange={onSelectModeChange} />
            <HeaderIconButton label="Search" hint="⌘K" onClick={() => onSearchOpenChange(true)}>
              <Search className="size-[18px]" />
            </HeaderIconButton>
          </>
        )}
        <HeaderIconButton
          label="Manage categories"
          tooltip={
            aiOff
              ? "Edit categories. AI sorting is off: add a Vercel AI Gateway key."
              : "Edit categories and their criteria"
          }
          onClick={onManageCategories}
        >
          <Settings2 className="size-[18px]" />
          {aiOff && (
            <span
              className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-amber-400"
              aria-label="AI categorization is off"
            />
          )}
        </HeaderIconButton>
        <HeaderIconButton label="Compose" hint="C" onClick={onCompose}>
          <SquarePen className="size-[18px]" />
        </HeaderIconButton>
      </div>
    </header>
  );
}

interface GroupHeaderProps {
  group: GroupDef;
  /** Conversations in the group. */
  count: number;
  onBack: () => void;
  selectMode: boolean;
  onSelectModeChange: (on: boolean) => void;
  onCompose: () => void;
}

/** Top bar of one group's own list: back to the folder, the group's name, then select / compose. */
export function GroupHeader({
  group,
  count,
  onBack,
  selectMode,
  onSelectModeChange,
  onCompose,
}: GroupHeaderProps) {
  return (
    <header className="electron-window-drag flex h-[88px] shrink-0 items-end justify-between px-6 pb-3 pt-10">
      <div className="electron-no-drag flex min-w-0 items-center gap-3">
        <HeaderIconButton label="Back" tooltip="Back (Esc)" onClick={onBack}>
          <ArrowLeft className="size-[18px]" />
        </HeaderIconButton>
        <GroupTile group={group} />
        <h1 className="min-w-0 truncate text-base font-semibold">
          {group.label}
          <span className="ml-2 text-xs font-normal text-muted-foreground">{count}</span>
        </h1>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <SelectSwitch on={selectMode} onChange={onSelectModeChange} />
        <HeaderIconButton label="Compose" hint="C" onClick={onCompose}>
          <SquarePen className="size-[18px]" />
        </HeaderIconButton>
      </div>
    </header>
  );
}

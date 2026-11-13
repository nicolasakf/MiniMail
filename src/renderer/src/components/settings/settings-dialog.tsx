import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { Bell, Palette, Tags, Users, type LucideIcon } from "lucide-react";

import type { Account, AiStatus, Category, CategoryState } from "@shared/types";

import { AccountsPanel } from "@/components/mail/accounts-panel";
import { CategoriesPanel } from "@/components/mail/categories-panel";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { AppearanceTab } from "./appearance-tab";
import { NotificationsTab } from "./notifications-tab";

export const SETTINGS_TABS = ["appearance", "accounts", "categories", "notifications"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

const NAV: { id: SettingsTab; title: string; icon: LucideIcon }[] = [
  { id: "appearance", title: "Appearance", icon: Palette },
  { id: "accounts", title: "Accounts", icon: Users },
  { id: "categories", title: "Categories", icon: Tags },
  { id: "notifications", title: "Notifications", icon: Bell },
];

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The page to show when the dialog opens. */
  initialTab: SettingsTab;
  /** Open the Accounts page on the add-account picker. */
  startAdding: boolean;
  accounts: readonly Account[];
  categories: readonly Category[];
  ai: AiStatus | null;
  onAccountsChanged: () => void;
  onCategoryState: (state: CategoryState) => void;
}

function NavButton({
  title,
  icon: Icon,
  active,
  flag,
  onClick,
}: {
  title: string;
  icon: LucideIcon;
  active: boolean;
  /** A small amber dot with this accessible name, for a page that needs attention. */
  flag?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "corner-squircle flex h-8 w-full items-center gap-2 rounded-md p-2 text-left text-sm outline-none ring-sidebar-ring transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2",
        active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {flag && <span role="img" aria-label={flag} title={flag} className="size-2 shrink-0 rounded-full bg-amber-400" />}
    </button>
  );
}

/**
 * Everything that used to live in the account menu, on pages: appearance, accounts, categories,
 * and notifications. The layout follows Orion's settings dialog: a floating sidebar of pages
 * beside the page itself.
 */
export function SettingsDialog({
  open,
  onOpenChange,
  initialTab,
  startAdding,
  accounts,
  categories,
  ai,
  onAccountsChanged,
  onCategoryState,
}: SettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  /** Pages already opened stay mounted (hidden), so unsaved category edits survive a look at another page. */
  const [visited, setVisited] = useState<ReadonlySet<SettingsTab>>(() => new Set([initialTab]));
  const renaming = useRef(false);

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setVisited(new Set([initialTab]));
  }, [open, initialTab]);

  const setRenaming = useCallback((value: boolean) => {
    renaming.current = value;
  }, []);

  const show = (next: SettingsTab) => {
    setTab(next);
    setVisited((previous) => new Set(previous).add(next));
  };

  const page = (id: SettingsTab, content: ReactNode) =>
    visited.has(id) ? (
      <div key={id} hidden={tab !== id} className={tab === id ? "min-h-full" : undefined}>
        {content}
      </div>
    ) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[85vh] w-[90vw] max-w-4xl flex-col gap-0 overflow-hidden p-0"
        onEscapeKeyDown={(event) => {
          // Escape while an account alias is being edited cancels the edit; the dialog stays open.
          if (renaming.current) event.preventDefault();
        }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Appearance, accounts, categories and notifications.</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 gap-3 p-3">
          <nav
            aria-label="Settings pages"
            className="corner-squircle flex w-60 shrink-0 flex-col gap-2 overflow-hidden rounded-lg border border-sidebar-border bg-sidebar p-2 text-sidebar-foreground shadow"
          >
            <div className="flex h-12 items-center px-2 text-sm font-semibold">Settings</div>
            <div className="flex flex-col gap-1">
              {NAV.map((item) => (
                <NavButton
                  key={item.id}
                  title={item.title}
                  icon={item.icon}
                  active={tab === item.id}
                  flag={item.id === "categories" && ai !== null && !ai.configured ? "AI sorting is off" : undefined}
                  onClick={() => show(item.id)}
                />
              ))}
            </div>
          </nav>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            {page("appearance", <AppearanceTab />)}
            {page(
              "accounts",
              <AccountsPanel
                startAdding={startAdding}
                accounts={accounts}
                onChanged={onAccountsChanged}
                onRenamingChange={setRenaming}
              />,
            )}
            {page("categories", <CategoriesPanel categories={categories} ai={ai} onState={onCategoryState} />)}
            {page("notifications", <NotificationsTab accounts={accounts} categories={categories} />)}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

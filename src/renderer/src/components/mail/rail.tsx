import {
  FileText,
  Inbox,
  LayoutDashboard,
  Monitor,
  Moon,
  Send,
  Settings2,
  Sun,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useTheme } from "next-themes";

import { accountDetail, accountLabel } from "@shared/accounts";
import type { Account, MailFolder } from "@shared/types";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLogoSettings } from "@/hooks/use-logo-settings";
import { FOLDER_TITLES } from "@/lib/format";
import { cn } from "@/lib/utils";

import { AccountMark } from "./account-mark";

interface RailButtonProps {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick?: () => void;
}

function RailButton({ icon: Icon, label, active = false, onClick }: RailButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-current={active ? "page" : undefined}
          onClick={onClick}
          className={cn(
            "corner-squircle electron-no-drag flex size-10 items-center justify-center rounded-xl transition-colors",
            active
              ? "bg-sidebar-primary text-sidebar-primary-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
        >
          <Icon className="size-5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

const FOLDER_BUTTONS: { folder: MailFolder; icon: LucideIcon }[] = [
  { folder: "drafts", icon: FileText },
  { folder: "sent", icon: Send },
];

interface RailProps {
  folder: MailFolder;
  /** The Dashboard is on screen instead of a folder. */
  dashboard: boolean;
  onOpenDashboard: () => void;
  accounts: readonly Account[];
  onNavigate: (folder: MailFolder) => void;
  onOpenAccounts: () => void;
  onAddAccount: () => void;
  /** The category editor opens from the menu. */
  onManageCategories: () => void;
  /** AI sorting is off (no key); flagged on the menu button and its item. */
  aiOff: boolean;
}

/** Slim left navigation: inbox, folder shortcuts, and the account/theme menu. */
export function Rail({
  folder,
  dashboard,
  onOpenDashboard,
  accounts,
  onNavigate,
  onOpenAccounts,
  onAddAccount,
  onManageCategories,
  aiOff,
}: RailProps) {
  const { theme, setTheme } = useTheme();
  const { settings: logoSettings, update: updateLogoSettings } = useLogoSettings();
  const primary = accounts[0];

  return (
    // The outer wrapper insets the card from the window edges (top clears the macOS traffic lights).
    <div className="electron-window-drag flex shrink-0 pb-3 pl-3 pr-1.5 pt-12">
      <nav
        aria-label="Folders"
        className="corner-squircle flex w-16 flex-col items-center overflow-hidden rounded-lg border border-sidebar-border bg-sidebar py-3 shadow"
      >
        <div className="flex flex-col items-center gap-2">
          <RailButton
            icon={LayoutDashboard}
            label="Dashboard"
            active={dashboard}
            onClick={onOpenDashboard}
          />
          <span aria-hidden className="my-1 h-px w-6 bg-sidebar-border" />
          <RailButton
            icon={Inbox}
            label="Inbox"
            active={!dashboard && folder === "inbox"}
            onClick={() => onNavigate("inbox")}
          />
          {FOLDER_BUTTONS.map(({ folder: target, icon }) => (
            <RailButton
              key={target}
              icon={icon}
              label={FOLDER_TITLES[target]}
              active={!dashboard && folder === target}
              onClick={() => onNavigate(target)}
            />
          ))}
        </div>

        <div className="mt-auto">
          {/* Non-modal: its items open dialogs, and a modal menu would leave the page unclickable afterwards. */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Accounts and settings"
                className="electron-no-drag relative rounded-full outline-none ring-offset-sidebar focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <Avatar className="size-9">
                  <AvatarFallback
                    className="text-xs font-semibold"
                    style={
                      primary
                        ? {
                            background: `hsl(${primary.hue} 45% 22%)`,
                            color: `hsl(${primary.hue} 80% 88%)`,
                          }
                        : undefined
                    }
                  >
                    {primary ? primary.displayName.slice(0, 1).toUpperCase() : "?"}
                  </AvatarFallback>
                </Avatar>
                {aiOff && (
                  <span
                    className="absolute right-0 top-0 size-2 rounded-full bg-amber-400 ring-2 ring-sidebar"
                    aria-label="AI categorization is off"
                  />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end" className="w-64">
              <DropdownMenuLabel>Accounts</DropdownMenuLabel>
              {accounts.length === 0 && (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">No accounts yet</div>
              )}
              {accounts.map((account) => (
                <div key={account.id} className="flex items-center gap-2.5 px-2 py-1.5 text-sm">
                  <AccountMark account={account} size={20} />
                  <span className="min-w-0 flex-1 truncate" title={accountDetail(account)}>
                    {accountLabel(account)}
                  </span>
                </div>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onAddAccount}>
                <UserPlus className="mr-2 size-4" />
                Add account
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onOpenAccounts}>
                <Users className="mr-2 size-4" />
                Manage accounts
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onManageCategories}>
                <Settings2 className="mr-2 size-4" />
                <span className="flex flex-col">
                  Manage categories…
                  {aiOff && (
                    <span className="text-xs font-normal text-muted-foreground">
                      AI sorting is off: add a Vercel AI Gateway key
                    </span>
                  )}
                </span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Logos</DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                checked={logoSettings?.companyLogos ?? true}
                disabled={!logoSettings}
                onCheckedChange={(checked) =>
                  void updateLogoSettings({ companyLogos: checked === true })
                }
                onSelect={(event) => event.preventDefault()}
              >
                <span className="flex flex-col">
                  Company logos
                  <span className="text-xs font-normal text-muted-foreground">
                    Fetched from each sender's own site
                  </span>
                </span>
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={logoSettings?.personPhotos ?? false}
                disabled={!logoSettings}
                onCheckedChange={(checked) =>
                  void updateLogoSettings({ personPhotos: checked === true })
                }
                onSelect={(event) => event.preventDefault()}
              >
                <span className="flex flex-col">
                  People's photos
                  <span className="text-xs font-normal text-muted-foreground">
                    Looked up on Gravatar; shares a hash of each sender's address
                  </span>
                </span>
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Appearance</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setTheme("light")}>
                <Sun className="mr-2 size-4" />
                Light{theme === "light" ? " ✓" : ""}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTheme("dark")}>
                <Moon className="mr-2 size-4" />
                Dark{theme === "dark" ? " ✓" : ""}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTheme("system")}>
                <Monitor className="mr-2 size-4" />
                System{theme === "system" ? " ✓" : ""}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </nav>
    </div>
  );
}

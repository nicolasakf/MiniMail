import { FileText, LayoutDashboard, LoaderCircle, Mail, Send, type LucideIcon } from "lucide-react";

import type { Account, MailFolder } from "@shared/types";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMac } from "@/hooks/use-platform";
import { FOLDER_TITLES } from "@/lib/format";
import { cn } from "@/lib/utils";

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
  /** The settings dialog opens from the button at the bottom. */
  onOpenSettings: () => void;
  /** AI sorting is off (no key); flagged on the settings button. */
  aiOff: boolean;
  /** Conversations the AI is still sorting; a spinner above Settings shows while this is above 0. */
  sorting?: number;
}

/** Slim left navigation: inbox, folder shortcuts, and the settings button. */
export function Rail({
  folder,
  dashboard,
  onOpenDashboard,
  accounts,
  onNavigate,
  onOpenSettings,
  aiOff,
  sorting = 0,
}: RailProps) {
  const isMac = useIsMac();
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
            icon={Mail}
            label={FOLDER_TITLES.inbox}
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

        <div className="mt-auto flex flex-col items-center gap-3">
          {sorting > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  role="status"
                  aria-label={`Sorting ${sorting} new ${sorting === 1 ? "email" : "emails"}`}
                  className="electron-no-drag relative flex size-9 items-center justify-center rounded-full text-sidebar-foreground/70"
                >
                  <LoaderCircle className="size-5 animate-spin" />
                  <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-sidebar-primary px-1 text-center text-[10px] font-semibold leading-4 text-sidebar-primary-foreground">
                    {sorting > 99 ? "99+" : sorting}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">
                Sorting {sorting} new {sorting === 1 ? "email" : "emails"} into your categories. They will appear
                there when done.
              </TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Settings"
                onClick={onOpenSettings}
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
            </TooltipTrigger>
            <TooltipContent side="right">Settings ({isMac ? "⌘," : "Ctrl+,"})</TooltipContent>
          </Tooltip>
        </div>
      </nav>
    </div>
  );
}

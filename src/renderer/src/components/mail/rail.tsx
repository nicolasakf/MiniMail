import { ChartColumn, LoaderCircle, Mail, NotebookPen, Send, Settings, type LucideIcon } from "lucide-react";

import type { AppEvent } from "@shared/events";
import type { Account, MailFolder } from "@shared/types";

import { LogPopover } from "@/components/mail/log-popover";
import { ShortcutHint } from "@/components/ui/keyboard-shortcut-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMac } from "@/hooks/use-platform";
import { useShortcutHints } from "@/hooks/use-shortcut-hints";
import { FOLDER_TITLES } from "@/lib/format";
import { cn } from "@/lib/utils";

interface RailButtonProps {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick?: () => void;
  /** The shortcut (⌘1…⌘4): named in the tooltip, and over the icon while the command key is held. */
  shortcut?: string;
  showHint?: boolean;
}

function RailButton({ icon: Icon, label, active = false, onClick, shortcut, showHint = false }: RailButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-current={active ? "page" : undefined}
          onClick={onClick}
          className={cn(
            "corner-squircle electron-no-drag relative flex size-9 items-center justify-center rounded-xl transition-colors",
            active
              ? "bg-sidebar-primary text-sidebar-primary-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
        >
          <Icon className={cn("size-5 transition-opacity", showHint && "opacity-25")} />
          {showHint && shortcut && (
            <span
              aria-hidden
              className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums"
            >
              {shortcut}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        {label}
        {shortcut && <ShortcutHint hint={shortcut} />}
      </TooltipContent>
    </Tooltip>
  );
}

const FOLDER_BUTTONS: { folder: MailFolder; icon: LucideIcon }[] = [
  { folder: "drafts", icon: NotebookPen },
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
  /**
   * The servers are still answering a list. `downloading`: nothing is on screen yet, the mail is
   * being downloaded; `checking`: the copy saved on this computer is shown meanwhile. The same
   * spinner as sorting, so there is one place to look.
   */
  syncing?: "downloading" | "checking";
  /** The Retry that belongs to an event raised by this page, if one is still available. */
  retryFor: (event: AppEvent) => (() => void) | undefined;
}

const SYNCING_TEXT = {
  downloading: "Downloading your mail from the server. It will appear here as it arrives.",
  checking: "Checking the server. What you see is the copy saved on this computer; it updates when the server answers.",
} as const;

function activityLabel(sorting: number, syncing: "downloading" | "checking" | undefined): string {
  const parts: string[] = [];
  if (syncing) parts.push(syncing === "downloading" ? "Downloading your mail" : "Checking for new mail");
  if (sorting > 0) parts.push(`Sorting ${sorting} new ${sorting === 1 ? "email" : "emails"}`);
  return parts.join(". ");
}

/** Slim left navigation: inbox, folder shortcuts, and the settings button. */
export function Rail({
  folder,
  dashboard,
  onOpenDashboard,
  onNavigate,
  onOpenSettings,
  aiOff,
  sorting = 0,
  syncing,
  retryFor,
}: RailProps) {
  const isMac = useIsMac();
  const hints = useShortcutHints(isMac);
  const shortcut = (digit: string) => `${isMac ? "⌘" : "Ctrl+"}${digit}`;

  return (
    // The outer wrapper insets the rail from the window edges (top clears the macOS traffic lights).
    <div className="electron-window-drag flex shrink-0 pb-3 pl-3 pr-0 pt-12">
      <nav aria-label="Folders" className="flex w-12 flex-col items-center py-3">
        <div className="flex flex-col items-center gap-1.5">
          <RailButton
            icon={ChartColumn}
            label="Dashboard"
            active={dashboard}
            onClick={onOpenDashboard}
            shortcut={shortcut("1")}
            showHint={hints}
          />
          <span aria-hidden className="my-1 h-px w-6 bg-sidebar-border" />
          <RailButton
            icon={Mail}
            label={FOLDER_TITLES.inbox}
            active={!dashboard && folder === "inbox"}
            onClick={() => onNavigate("inbox")}
            shortcut={shortcut("2")}
            showHint={hints}
          />
          {FOLDER_BUTTONS.map(({ folder: target, icon }, index) => (
            <RailButton
              key={target}
              icon={icon}
              label={FOLDER_TITLES[target]}
              active={!dashboard && folder === target}
              onClick={() => onNavigate(target)}
              shortcut={shortcut(String(index + 3))}
              showHint={hints}
            />
          ))}
        </div>

        <div className="mt-auto flex flex-col items-center gap-3">
          {(sorting > 0 || syncing) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  role="status"
                  aria-label={activityLabel(sorting, syncing)}
                  className="electron-no-drag relative flex size-9 items-center justify-center rounded-full text-sidebar-foreground/70"
                >
                  <LoaderCircle className="size-5 animate-spin" />
                  {sorting > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-sidebar-primary px-1 text-center text-[10px] font-semibold leading-4 text-sidebar-primary-foreground">
                      {sorting > 99 ? "99+" : sorting}
                    </span>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-64">
                {syncing && <p>{SYNCING_TEXT[syncing]}</p>}
                {sorting > 0 && (
                  <p>
                    Sorting {sorting} new {sorting === 1 ? "email" : "emails"} into your categories. They will appear
                    there when done.
                  </p>
                )}
              </TooltipContent>
            </Tooltip>
          )}
          <LogPopover retryFor={retryFor} />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Settings"
                onClick={onOpenSettings}
                className="electron-no-drag relative flex size-9 items-center justify-center rounded-xl text-sidebar-foreground/70 outline-none ring-offset-background transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <Settings className="size-5" />
                {aiOff && (
                  <span
                    className="absolute right-0 top-0 size-2 rounded-full bg-amber-400 ring-2 ring-background"
                    aria-label="AI categorization is off"
                  />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              Settings
              <ShortcutHint hint="⌘," />
            </TooltipContent>
          </Tooltip>
        </div>
      </nav>
    </div>
  );
}

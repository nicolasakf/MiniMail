import { Check, ChartColumn, CircleAlert, Download, LoaderCircle, Mail, NotebookPen, RefreshCw, Send, Settings, type LucideIcon } from "lucide-react";

import { accountLabel } from "@shared/accounts";
import type { AppEvent } from "@shared/events";
import type { Account, MailFolder } from "@shared/types";
import { updateButton } from "@shared/updates";

import { LogPopover } from "@/components/mail/log-popover";
import { FLAT_KEY } from "@/components/ui/keys";
import { ShortcutHint } from "@/components/ui/keyboard-shortcut-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMac } from "@/hooks/use-platform";
import { useShortcutHints } from "@/hooks/use-shortcut-hints";
import { useUpdateState } from "@/hooks/use-update-state";
import { FOLDER_TITLES } from "@/lib/format";
import { runUpdateStep } from "@/lib/updates";
import { cn } from "@/lib/utils";

/**
 * Shown only while an update is waiting, downloading or ready to restart: one button for the step it is at (the wording
 * of `updateButton`, the same as in Settings), in the full highlight color so it draws the eye.
 */
function UpdateButton() {
  const state = useUpdateState();
  const button = updateButton(state);
  if (!button || state.status === "idle" || state.status === "current" || state.status === "checking") return null;
  const busy = state.status === "downloading" || state.status === "installing";
  const Icon = busy ? LoaderCircle : state.status === "downloaded" ? RefreshCw : Download;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={button.label}
          disabled={button.disabled}
          onClick={() => void runUpdateStep(button.step)}
          className={cn(
            "electron-no-drag relative flex size-9 items-center justify-center rounded-full",
            FLAT_KEY,
            // A raised insert in the full highlight color, like the folder you are in and the Compose button.
            "grain bg-sidebar-primary text-sidebar-primary-foreground shadow-raise-1 hover:bg-sidebar-primary",
          )}
        >
          <Icon className={cn("size-5", busy && "animate-spin")} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{button.label}</TooltipContent>
    </Tooltip>
  );
}

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
            "electron-no-drag relative flex size-9 items-center justify-center rounded-full",
            FLAT_KEY,
            // The folder you are in is a raised insert in the full highlight color, like the Compose button.
            active && "grain bg-sidebar-primary text-sidebar-primary-foreground shadow-raise-1 hover:bg-sidebar-primary",
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
  /** While `syncing`: the accounts whose server has not answered yet. The others have. */
  pendingAccounts?: ReadonlySet<string>;
  /** The accounts whose last list failed; the spinner's card says they could not be reached. */
  failedAccounts?: ReadonlySet<string>;
  /** The Retry that belongs to an event raised by this page, if one is still available. */
  retryFor: (event: AppEvent) => (() => void) | undefined;
}

const SYNCING_TEXT = {
  downloading: "Downloading your mail from the server. It will appear here as it arrives.",
  checking: "Checking the server. What you see is the copy saved on this computer; it updates when the server answers.",
} as const;

/** One line per account in the spinner's card: waiting, answered, or failed. */
function AccountSyncList({
  accounts,
  pending,
  failed,
}: {
  accounts: readonly Account[];
  pending: ReadonlySet<string>;
  failed: ReadonlySet<string>;
}) {
  if (accounts.length < 2) return null;
  return (
    <ul className="mt-1.5 space-y-0.5">
      {accounts.map((account) => {
        const state = pending.has(account.id) ? "loading" : failed.has(account.id) ? "failed" : "loaded";
        return (
          <li key={account.id} className="flex items-center gap-1.5">
            {state === "loading" ? (
              <LoaderCircle aria-hidden className="size-3 shrink-0 animate-spin" />
            ) : state === "failed" ? (
              <CircleAlert aria-hidden className="size-3 shrink-0 text-amber" />
            ) : (
              <Check aria-hidden className="size-3 shrink-0 text-success" />
            )}
            <span className="min-w-0 flex-1 truncate">{accountLabel(account)}</span>
            <span className="shrink-0 opacity-70">
              {state === "loading" ? "Checking" : state === "failed" ? "Failed" : "Up to date"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

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
  pendingAccounts,
  failedAccounts,
  accounts,
  retryFor,
}: RailProps) {
  const isMac = useIsMac();
  const hints = useShortcutHints(isMac);
  const shortcut = (digit: string) => `${isMac ? "⌘" : "Ctrl+"}${digit}`;

  return (
    // The outer wrapper insets the rail from the window edges (top clears the macOS traffic lights).
    <div className="electron-window-drag flex shrink-0 pb-3 pl-3 pr-3 pt-12">
      <nav aria-label="Folders" className="flex w-[48px] flex-col items-center py-3">
        <div className="flex flex-col items-center gap-1.5">
          <RailButton
            icon={ChartColumn}
            label="Dashboard"
            active={dashboard}
            onClick={onOpenDashboard}
            shortcut={shortcut("1")}
            showHint={hints}
          />
          <span aria-hidden className="groove-h my-1.5 w-6" />
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
                  className="electron-no-drag relative flex size-9 items-center justify-center rounded-full text-sidebar-primary"
                >
                  <LoaderCircle className="size-5 animate-spin" />
                  {sorting > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-sidebar-primary px-1 text-center text-[10px] font-semibold leading-4 text-sidebar-primary-foreground shadow-raise-3">
                      {sorting > 99 ? "99+" : sorting}
                    </span>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-64">
                {syncing && <p>{SYNCING_TEXT[syncing]}</p>}
                {syncing && (
                  <AccountSyncList
                    accounts={accounts}
                    pending={pendingAccounts ?? new Set()}
                    failed={failedAccounts ?? new Set()}
                  />
                )}
                {sorting > 0 && (
                  <p>
                    Sorting {sorting} new {sorting === 1 ? "email" : "emails"} into your categories. They will appear
                    there when done.
                  </p>
                )}
              </TooltipContent>
            </Tooltip>
          )}
          <UpdateButton />
          <LogPopover retryFor={retryFor} />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Settings"
                onClick={onOpenSettings}
                className={`electron-no-drag relative flex size-9 items-center justify-center rounded-full outline-none ${FLAT_KEY}`}
              >
                <Settings className="size-5" />
                {aiOff && (
                  <span
                    className="absolute right-0 top-0 size-2.5 rounded-full bg-amber shadow-raise-3 ring-2 ring-background"
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

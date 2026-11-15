import { useState } from "react";
import { Bell, ChartColumn, LoaderCircle, Mail, NotebookPen, Send, Settings, type LucideIcon } from "lucide-react";

import type { Account, MailFolder } from "@shared/types";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ShortcutHint } from "@/components/ui/keyboard-shortcut-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMac } from "@/hooks/use-platform";
import { useShortcutHints } from "@/hooks/use-shortcut-hints";
import type { MailEvent } from "@/lib/mail-actions";
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
  events: readonly MailEvent[];
  onClearEvents: () => void;
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
  events,
  onClearEvents,
}: RailProps) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(0);
  const latest = events[0]?.id ?? 0;
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
          <Popover open={open} onOpenChange={(next) => {
            setOpen(next);
            if (next || open) setSeen(latest);
          }}>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label={!open && latest > seen ? "Notifications, new events" : "Notifications"}
                    className="electron-no-drag relative flex size-9 items-center justify-center rounded-xl text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Bell className="size-5" />
                    {!open && latest > seen && (
                      <span aria-hidden className="absolute right-0 top-0 size-2 rounded-full bg-amber-400 ring-2 ring-background" />
                    )}
                  </button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="right">Notifications</TooltipContent>
            </Tooltip>
            <PopoverContent side="right" align="end" sideOffset={12} aria-label="Notifications" className="w-80 p-0">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <h2 className="text-sm font-semibold">Notifications</h2>
                {events.length > 0 && (
                  <button type="button" onClick={onClearEvents} className="text-xs text-muted-foreground hover:text-foreground">
                    Clear all
                  </button>
                )}
              </div>
              {events.length === 0 ? (
                <p className="px-4 py-5 text-sm text-muted-foreground">No notifications yet.</p>
              ) : (
                <ul className="max-h-[min(24rem,65vh)] divide-y overflow-y-auto">
                  {events.map((event) => (
                    <li key={event.id} className="space-y-1 px-4 py-3">
                      <p className="text-sm font-medium">{event.title}</p>
                      <p className="break-words text-xs text-muted-foreground">{event.detail}</p>
                      <div className="flex items-center justify-between gap-2">
                        <time dateTime={new Date(event.at).toISOString()} className="text-xs text-muted-foreground">
                          {new Date(event.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                        </time>
                        {event.retry && (
                          <button type="button" onClick={event.retry} className="text-xs font-medium text-primary hover:underline">
                            Retry
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </PopoverContent>
          </Popover>
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

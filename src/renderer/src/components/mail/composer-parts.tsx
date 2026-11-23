import { useRef, useState } from "react";

import { AlertCircle, CalendarClock, ChevronDown, Clock3, Ellipsis, Loader2, Paperclip, Send, X } from "lucide-react";

import type { DraftAttachment } from "@shared/types";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FileIcon } from "@/components/ui/file-icon";
import { attachmentBytes, formatBytes } from "@/lib/composer-state";
import { composeTimeLabel, joinMoment, sendLaterOptions, sendTimeHint, splitMoment } from "@/lib/send-later";
import { cn } from "@/lib/utils";

import { ToolButton } from "./composer-ui";

/** The times Send Later offers, worked out when the menu opens so "in one hour" is never stale. */
function SendLaterItems({ sendAt, onSchedule, onClear, onPick }: {
  sendAt: number | undefined;
  onSchedule: (time: number) => void;
  onClear: () => void;
  onPick: () => void;
}) {
  const now = new Date();
  return (
    <>
      <DropdownMenuLabel className="px-2 py-1.5 text-xs font-normal text-muted-foreground">Send later</DropdownMenuLabel>
      {sendLaterOptions(now).map((option) => (
        <DropdownMenuItem key={option.id} className="justify-between gap-6" onSelect={() => onSchedule(option.time)}>
          <span>{option.label}</span>
          <span className="text-xs text-muted-foreground">{sendTimeHint(option.time, now)}</span>
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onPick}><CalendarClock />Pick date &amp; time…</DropdownMenuItem>
      {sendAt !== undefined && <DropdownMenuItem onSelect={onClear}><Send />Send right away instead</DropdownMenuItem>}
    </>
  );
}

/** Send (or Schedule), with the Send Later choices behind its arrow. */
export function SendButton({ sendAt, sending, disabled, canSchedule, onSend, onSchedule, onClear, onPick }: {
  sendAt: number | undefined;
  sending: boolean;
  disabled: boolean;
  canSchedule: boolean;
  onSend: () => void;
  onSchedule: (time: number) => void;
  onClear: () => void;
  /** Opens the date and time strip. Runs after the menu has closed, so focus can go to the strip. */
  onPick: () => void;
}) {
  const picking = useRef(false);
  const label = sendAt ? "Schedule" : "Send";
  return (
    <div className="corner-squircle grain inline-flex h-9 shrink-0 items-stretch overflow-hidden rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-raise-1">
      <button
        type="button"
        disabled={disabled}
        title={`${label} (⌘↵)`}
        onClick={onSend}
        className="inline-flex items-center gap-2 pl-3.5 pr-3 text-sm font-medium outline-none transition-colors hover:bg-white/10 focus-visible:bg-white/15 disabled:pointer-events-none disabled:opacity-60"
      >
        {sending ? <Loader2 className="size-4 animate-spin" /> : sendAt ? <Clock3 className="size-4" /> : <Send className="size-4" />}
        {label}
      </button>
      {canSchedule && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label="Send later options"
              title="Send later"
              className="grid w-8 place-items-center border-l border-black/15 outline-none transition-colors hover:bg-white/10 focus-visible:bg-white/15 disabled:pointer-events-none disabled:opacity-60 data-[state=open]:bg-white/15"
            >
              <ChevronDown className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            className="min-w-64"
            onCloseAutoFocus={(event) => {
              if (!picking.current) return;
              picking.current = false;
              event.preventDefault();
              onPick();
            }}
          >
            <SendLaterItems sendAt={sendAt} onSchedule={onSchedule} onClear={onClear}
              onPick={() => { picking.current = true; }} />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

const STRIP = "plate-2 mx-3 mb-2 flex items-center gap-2 rounded-2xl px-3 py-2 text-[13px]";

function SchedulePicker({ sendAt, onSet, onCancel }: { sendAt: number | undefined; onSet: (time: number) => void; onCancel: () => void }) {
  const initial = splitMoment(sendAt ?? Date.now() + 60 * 60_000);
  const [day, setDay] = useState(initial.day);
  const [clock, setClock] = useState(initial.clock);
  const time = joinMoment(day, clock);
  const valid = time !== undefined && time > Date.now();
  const today = splitMoment(Date.now()).day;
  return (
    <div
      className={`${STRIP} w-fit max-w-[calc(100%-1.5rem)] flex-col items-stretch gap-3 rounded-[20px] p-4`}
      onKeyDown={(event) => {
        // Escape inside the month or year list only closes that list.
        if (event.key === "Escape" && !(event.target as HTMLElement).closest('[role="listbox"]')) {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <Calendar value={day} onChange={setDay} min={today} />
      <span aria-hidden className="groove-h" />
      <div className="flex items-center gap-2">
        <label className="flex shrink-0 items-center gap-2 text-xs font-medium text-muted-foreground" htmlFor="send-later-time">
          <CalendarClock className="size-4 shrink-0" />
          Send at
        </label>
        <input
          id="send-later-time"
          type="time"
          value={clock}
          onChange={(event) => setClock(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.metaKey || event.ctrlKey) return;
            event.preventDefault();
            if (valid) onSet(time);
          }}
          className="h-9 min-w-0 flex-1 rounded-xl bg-transparent px-3 text-sm shadow-raise-3 outline-none focus-visible:shadow-raise-3-glow"
        />
        <Button type="button" disabled={!valid} onClick={() => time !== undefined && onSet(time)}
          className="h-9 rounded-xl bg-sidebar-primary px-4 text-sm text-sidebar-primary-foreground hover:bg-sidebar-primary/90">
          Set
        </Button>
        <Button type="button" variant="ghost" className="h-9 rounded-xl px-3 text-sm" onClick={onCancel}>Cancel</Button>
      </div>
      {!valid && <p className="text-xs text-muted-foreground">Pick a time in the future.</p>}
    </div>
  );
}

/** Where a message waits when it is set to go later, and the way to change or drop that. */
export function ScheduleNotice({ sendAt, picking, onChange, onSet, onCancelPick, onClear }: {
  sendAt: number | undefined;
  picking: boolean;
  onChange: () => void;
  onSet: (time: number) => void;
  onCancelPick: () => void;
  onClear: () => void;
}) {
  if (picking) return <SchedulePicker sendAt={sendAt} onSet={onSet} onCancel={onCancelPick} />;
  if (sendAt === undefined) return null;
  return (
    <div className={STRIP}>
      <Clock3 className="size-4 shrink-0 text-sidebar-primary" />
      <span className="min-w-0 flex-1 truncate">Sends {composeTimeLabel(sendAt)}</span>
      <button type="button" onClick={onChange}
        className="rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground">Change</button>
      <button type="button" aria-label="Send right away instead" title="Send right away instead" onClick={onClear}
        className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground">
        <X className="size-3.5" />
      </button>
    </div>
  );
}

/** What went wrong, where the user is looking, with room for a long message. */
export function ErrorNotice({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  if (!message) return null;
  return (
    <div role="alert" className="mx-3 mb-2 flex items-start gap-2 rounded-xl bg-red-500/10 px-3 py-2 text-[13px] text-destructive">
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0 flex-1 break-words">{message}</p>
      <button type="button" aria-label="Dismiss" onClick={onDismiss}
        className="rounded-full p-0.5 transition-colors hover:bg-destructive/15">
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export function AttachmentList({ files, onRemove }: { files: readonly DraftAttachment[]; onRemove: (index: number) => void }) {
  if (files.length === 0) return null;
  return (
    <ul aria-label="Attachments" className="flex max-h-28 shrink-0 flex-wrap gap-2 overflow-y-auto px-5 py-3">
      {files.map((file, index) => (
        <li
          key={`${file.filename}-${index}`}
          className="corner-squircle flex max-w-full items-center gap-2 rounded-xl plate-3 py-1.5 pl-2 pr-1.5 text-xs"
        >
          <FileIcon filename={file.filename} className="size-5" />
          <span className="min-w-0 truncate font-medium">{file.filename}</span>
          <span className="shrink-0 text-muted-foreground">{formatBytes(attachmentBytes(file))}</span>
          <button
            type="button"
            aria-label={`Remove ${file.filename}`}
            className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            onClick={() => onRemove(index)}
          >
            <X className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The quoted original of a reply, folded under an ellipsis and still editable. */
export function QuotedText({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="px-5 pb-4">
      <button
        type="button"
        aria-expanded={shown}
        aria-label={shown ? "Hide the quoted message" : "Show the quoted message"}
        title={shown ? "Hide the quoted message" : "Show the quoted message"}
        className="corner-squircle inline-flex h-5 items-center rounded-md bg-muted px-2 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setShown((previous) => !previous)}
      >
        <Ellipsis className="size-4" />
      </button>
      {shown && (
        <textarea
          value={value}
          aria-label="Quoted message"
          className="mt-2 block max-h-72 min-h-[72px] w-full resize-none border-0 border-l-2 border-border bg-transparent px-3 py-1 text-sm text-muted-foreground outline-none"
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}

/** Shown over the composer while files are dragged over it. */
export function DropOverlay() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-40 grid place-items-center rounded-[inherit] border-2 border-dashed border-sidebar-primary/60 bg-background/85 text-sm font-medium">
      <span className="flex items-center gap-2"><Paperclip className="size-4" />Drop files to attach</span>
    </div>
  );
}

/**
 * What is left of a minimized composer: a floating pill in the tray at the bottom right, sized to
 * its content. The subject sits on top and the first recipient below it, with a "+N" for any more,
 * so several can be told apart. While the message is on its way a spinner shows in front of it, and
 * if the send failed a red "!" does, with the pill outlined in red until the composer is reopened.
 */
export function MinimizedPill({ title, recipients, locked, status, onRestore, onClose }: {
  title: string;
  /** Where it is going: the first is shown, the rest as a "+N". */
  recipients: readonly string[];
  locked: boolean;
  /** "sending" while the message goes out, "failed" once it did not; nothing for a plain draft. */
  status?: "sending" | "failed" | null;
  onRestore: () => void;
  onClose: () => void;
}) {
  const failed = status === "failed";
  return (
    <div className={cn(
      "corner-squircle electron-no-drag plate-1 flex h-12 min-w-0 max-w-[260px] shrink items-center rounded-full pl-4 pr-1.5 shadow-overlay duration-150 animate-in fade-in-0 zoom-in-95",
      failed && "text-destructive",
      status && "pl-3",
    )}>
      {status === "sending" && <Loader2 aria-hidden className="mr-2 size-4 shrink-0 animate-spin text-muted-foreground" />}
      {failed && <AlertCircle aria-hidden className="mr-2 size-4 shrink-0 text-destructive" />}
      <button type="button"
        aria-label={`Restore ${title}${failed ? ". It could not be sent." : status === "sending" ? ". Sending." : ""}`}
        title={failed ? "Could not send. Click to see why." : status === "sending" ? "Sending…" : undefined}
        className="group min-w-0 flex-1 text-left outline-none"
        onClick={onRestore}>
        <span className="block truncate text-[13px] font-medium leading-tight group-hover:text-sidebar-primary group-focus-visible:text-sidebar-primary">{title}</span>
        <span className="flex text-[11px] leading-tight text-muted-foreground">
          <span className="min-w-0 truncate">{recipients[0] ?? "No recipients"}</span>
          {recipients.length > 1 && <span className="ml-1 shrink-0">+{recipients.length - 1}</span>}
        </span>
      </button>
      <ToolButton label="Close minimized draft" className="ml-1 size-7 shrink-0 rounded-full" disabled={locked} onClick={onClose}><X /></ToolButton>
    </div>
  );
}

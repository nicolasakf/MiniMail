import { useRef, useState } from "react";

import { AlertCircle, CalendarClock, ChevronDown, Clock3, Ellipsis, Loader2, Paperclip, Send, X } from "lucide-react";

import type { DraftAttachment } from "@shared/types";

import { Button } from "@/components/ui/button";
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
import { composeTimeLabel, fromDateTimeInput, sendLaterOptions, sendTimeHint, toDateTimeInput } from "@/lib/send-later";

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
    <div className="corner-squircle inline-flex h-9 shrink-0 items-stretch overflow-hidden rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
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
              className="grid w-8 place-items-center border-l border-white/20 outline-none transition-colors hover:bg-white/10 focus-visible:bg-white/15 disabled:pointer-events-none disabled:opacity-60 data-[state=open]:bg-white/15"
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

const STRIP = "mx-3 mb-2 flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2 text-[13px]";

function SchedulePicker({ sendAt, onSet, onCancel }: { sendAt: number | undefined; onSet: (time: number) => void; onCancel: () => void }) {
  const [value, setValue] = useState(() => toDateTimeInput(sendAt ?? Date.now() + 60 * 60_000));
  const time = fromDateTimeInput(value);
  const valid = time !== undefined && time > Date.now();
  return (
    <div
      className={`${STRIP} flex-wrap`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        } else if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
          event.preventDefault();
          if (valid) onSet(time);
        }
      }}
    >
      <CalendarClock className="size-4 shrink-0 text-muted-foreground" />
      <label className="sr-only" htmlFor="send-later-time">Send at</label>
      <input
        id="send-later-time"
        type="datetime-local"
        autoFocus
        value={value}
        min={toDateTimeInput(Date.now())}
        onChange={(event) => setValue(event.target.value)}
        className="h-8 rounded-lg border border-border bg-background px-2 text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <Button type="button" disabled={!valid} onClick={() => time !== undefined && onSet(time)}
        className="h-8 rounded-lg bg-sidebar-primary px-3 text-xs text-sidebar-primary-foreground hover:bg-sidebar-primary/90">
        Set
      </Button>
      <Button type="button" variant="ghost" className="h-8 rounded-lg px-2.5 text-xs" onClick={onCancel}>Cancel</Button>
      {!valid && value && <span className="text-xs text-muted-foreground">Pick a time in the future.</span>}
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
    <div role="alert" className="mx-3 mb-2 flex items-start gap-2 rounded-xl bg-red-500/10 px-3 py-2 text-[13px] text-red-600 dark:text-red-400">
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0 flex-1 break-words">{message}</p>
      <button type="button" aria-label="Dismiss" onClick={onDismiss}
        className="rounded-full p-0.5 transition-colors hover:bg-red-500/15">
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export function AttachmentList({ files, onRemove }: { files: readonly DraftAttachment[]; onRemove: (index: number) => void }) {
  if (files.length === 0) return null;
  return (
    <ul aria-label="Attachments" className="flex max-h-28 shrink-0 flex-wrap gap-2 overflow-y-auto border-t border-border/50 px-5 py-3">
      {files.map((file, index) => (
        <li
          key={`${file.filename}-${index}`}
          className="corner-squircle flex max-w-full items-center gap-2 rounded-xl border border-border/60 bg-muted/40 py-1.5 pl-2 pr-1.5 text-xs"
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

/** What is left of a minimized composer: a strip along the bottom edge. */
export function MinimizedBar({ title, locked, onRestore, onClose }: {
  title: string;
  locked: boolean;
  onRestore: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed bottom-0 right-6 z-40 flex h-11 w-[min(300px,calc(100vw-48px))] items-center rounded-t-2xl border border-b-0 border-border bg-background pl-4 pr-2 shadow-2xl animate-in fade-in-0 slide-in-from-bottom-2">
      <button type="button" aria-label={`Restore ${title}`}
        className="min-w-0 flex-1 truncate text-left text-[13px] font-medium outline-none hover:text-sidebar-primary focus-visible:text-sidebar-primary"
        onClick={onRestore}>
        {title}
      </button>
      <ToolButton label="Close minimized draft" className="size-7 rounded-lg" disabled={locked} onClick={onClose}><X /></ToolButton>
    </div>
  );
}

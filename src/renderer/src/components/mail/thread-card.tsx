import { useState, type ReactNode } from "react";

import {
  CalendarDays,
  CalendarX2,
  Check,
  CircleHelp,
  Download,
  ChevronDown,
  Loader2,
  MapPin,
  Paperclip,
  User,
  X,
  type LucideIcon,
} from "lucide-react";

import type { InvitationResponse } from "@shared/types";

import { FileIcon } from "@/components/ui/file-icon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { contactLabel } from "@/lib/format";
import {
  formatEventTime,
  formatSize,
  type ThreadArtifacts,
  type ThreadAttachment,
  type ThreadInvitation,
} from "@/lib/artifacts";
import { cn } from "@/lib/utils";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5 px-1">
      <h2 className="px-2 text-sm text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function AttachmentRow({
  attachment,
  showSender,
  onOpen,
  onSave,
}: {
  attachment: ThreadAttachment;
  showSender: boolean;
  onOpen: () => Promise<void>;
  onSave: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<"open" | "save" | null>(null);
  const run = async (kind: "open" | "save", action: () => Promise<void>) => {
    if (busy) return;
    setBusy(kind);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="group flex items-center rounded-lg hover:bg-muted/60">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => void run("open", onOpen)}
        aria-label={`Open ${attachment.filename}`}
      >
        <span className="flex size-8 shrink-0 items-center justify-center">
          {busy === "open" ? (
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          ) : (
            <FileIcon filename={attachment.filename} className="size-7" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{attachment.filename}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {formatSize(attachment.size)}
            {showSender ? ` · ${contactLabel(attachment.from)}` : ""}
          </span>
        </span>
      </button>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
            onClick={() => void run("save", onSave)}
            aria-label={`Save ${attachment.filename}`}
          >
            {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
          </button>
        </TooltipTrigger>
        <TooltipContent>Save as…</TooltipContent>
      </Tooltip>
    </div>
  );
}

const ANSWERS: { response: InvitationResponse; label: string; icon: LucideIcon }[] = [
  { response: "accepted", label: "Accept", icon: Check },
  { response: "tentative", label: "Maybe", icon: CircleHelp },
  { response: "declined", label: "Decline", icon: X },
];

function InvitationBlock({
  entry,
  onRespond,
}: {
  entry: ThreadInvitation;
  onRespond: (response: InvitationResponse) => Promise<void>;
}) {
  const { invitation } = entry;
  const [pending, setPending] = useState<InvitationResponse | null>(null);
  const when = formatEventTime(invitation.start, invitation.end, invitation.allDay);
  const cancelled = invitation.method === "CANCEL";

  const answer = async (response: InvitationResponse) => {
    if (pending || invitation.response === response) return;
    setPending(response);
    try {
      await onRespond(response);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="space-y-3 rounded-lg px-2 py-1.5">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md",
            cancelled ? "bg-red-500/10 text-destructive" : "bg-muted text-muted-foreground",
          )}
        >
          {cancelled ? <CalendarX2 className="size-4" /> : <CalendarDays className="size-4" />}
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className={cn("text-sm font-medium leading-snug", cancelled && "line-through decoration-1")}>{invitation.title}</p>
          {cancelled && <p className="text-xs font-medium text-destructive">This meeting was cancelled</p>}
          {when && <p className="text-xs text-muted-foreground">{when}</p>}
          {invitation.location && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="size-3 shrink-0" />
              <span className="truncate">{invitation.location}</span>
            </p>
          )}
          {invitation.organizer && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <User className="size-3 shrink-0" />
              <span className="truncate">{contactLabel(invitation.organizer)}</span>
            </p>
          )}
        </div>
      </div>
      {!cancelled && (
        <div className="grid grid-cols-3 gap-1.5" role="group" aria-label={`Answer ${invitation.title}`}>
          {ANSWERS.map(({ response, label, icon: Icon }) => {
            const chosen = invitation.response === response;
            const loading = pending === response;
            return (
              <button
                key={response}
                type="button"
                disabled={pending !== null}
                aria-pressed={chosen}
                onClick={() => void answer(response)}
                className={cn(
                  "corner-squircle inline-flex h-8 items-center justify-center gap-1 rounded-lg border text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
                  chosen
                    ? "border-transparent bg-primary text-primary-foreground"
                    : "border-border bg-background hover:bg-muted disabled:opacity-60",
                )}
              >
                {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface ThreadCardProps {
  /** What the conversation holds; null until it has downloaded. */
  artifacts: ThreadArtifacts | null;
  /** The summaries say the conversation has these, so the list holds their place while it downloads. */
  expecting: { attachments: boolean; invitations: boolean };
  onOpenAttachment: (attachment: ThreadAttachment) => Promise<void>;
  onSaveAttachment: (attachment: ThreadAttachment) => Promise<void>;
  onRespond: (entry: ThreadInvitation, response: InvitationResponse) => Promise<void>;
}

/** Whether the conversation holds (or, until it has downloaded, is expected to hold) anything to list. */
function hasThreadArtifacts(artifacts: ThreadArtifacts | null, expecting: ThreadCardProps["expecting"]): boolean {
  return artifacts
    ? artifacts.attachments.length > 0 || artifacts.invitations.length > 0
    : expecting.attachments || expecting.invitations;
}

/**
 * The toolbar's dropdown that gathers what is in the conversation: the meetings it invites to and the
 * files it carries. It sits left of Reply and renders nothing when there is nothing to list.
 */
export function ThreadCard({ artifacts, expecting, onOpenAttachment, onSaveAttachment, onRespond }: ThreadCardProps) {
  const [open, setOpen] = useState(false);
  const invitations = artifacts?.invitations ?? [];
  const attachments = artifacts?.attachments ?? [];
  const senders = new Set(attachments.map((attachment) => attachment.from.email.toLowerCase()));

  const waitingForInvitations = !artifacts && expecting.invitations;
  const waitingForAttachments = !artifacts && expecting.attachments;
  if (!hasThreadArtifacts(artifacts, expecting)) return null;

  const showInvitations = invitations.length > 0 || waitingForInvitations;
  const showAttachments = attachments.length > 0 || waitingForAttachments;
  // The trigger says what is inside: files get a paperclip, a conversation of meetings alone a calendar.
  const Icon = showAttachments ? Paperclip : CalendarDays;
  const count = artifacts ? attachments.length + invitations.length : null;
  const label = showAttachments && showInvitations ? "Attachments and invitations" : showAttachments ? "Attachments" : invitations.length > 1 ? "Invitations" : "Invitation";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip open={open ? false : undefined}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={label}
              className="corner-squircle electron-no-drag flex h-9 items-center gap-1 rounded-lg pl-2 pr-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
            >
              <Icon className="size-[18px]" />
              {count !== null && <span className="text-xs tabular-nums">{count}</span>}
              <ChevronDown className="size-3.5" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="max-h-[70vh] w-80 space-y-4 overflow-y-auto p-3">
        {showInvitations && (
          <Section title={invitations.length > 1 ? "Invitations" : "Invitation"}>
            {waitingForInvitations && <Skeleton className="h-24 w-full" />}
            {invitations.map((entry) => (
              <InvitationBlock key={entry.invitation.uid} entry={entry} onRespond={(response) => onRespond(entry, response)} />
            ))}
          </Section>
        )}

        {showAttachments && (
          <Section title="Attachments">
            {waitingForAttachments && (
              <div className="space-y-1.5 px-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            )}
            {attachments.map((attachment) => (
              <AttachmentRow
                key={`${attachment.messageId}|${attachment.id}`}
                attachment={attachment}
                showSender={senders.size > 1}
                onOpen={() => onOpenAttachment(attachment)}
                onSave={() => onSaveAttachment(attachment)}
              />
            ))}
          </Section>
        )}
      </PopoverContent>
    </Popover>
  );
}

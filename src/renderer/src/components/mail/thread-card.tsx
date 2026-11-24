import { useState, type ReactNode } from "react";

import {
  CalendarDays,
  CalendarX2,
  Check,
  CircleHelp,
  Download,
  ChevronDown,
  Link2,
  Loader2,
  MapPin,
  Paperclip,
  User,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";

import type { InvitationResponse } from "@shared/types";

import { FileIcon } from "@/components/ui/file-icon";
import { FLAT_KEY, FLAT_KEY_IN } from "@/components/ui/keys";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { contactLabel } from "@/lib/format";
import {
  formatEventTime,
  formatSize,
  linkify,
  shortUrl,
  type ThreadArtifacts,
  type ThreadAttachment,
  type ThreadInvitation,
  type ThreadLink,
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
    <div className={cn("group flex items-center rounded-xl", FLAT_KEY_IN)}>
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-1.5 text-left outline-none"
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
            className={cn("mr-1 flex size-7 shrink-0 items-center justify-center rounded-[10px] opacity-0 outline-none focus-visible:opacity-100 group-hover:opacity-100 hover:plate-3", FLAT_KEY)}
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

/**
 * The files of one message, as a dropdown on its header: the same rows as the toolbar's card, so it is clear who sent
 * which file (and which version of a document came with which message). `attachments` is null until the message has downloaded.
 */
export function MessageAttachments({
  attachments,
  onOpenAttachment,
  onSaveAttachment,
}: {
  attachments: ThreadAttachment[] | null;
  onOpenAttachment: (attachment: ThreadAttachment) => Promise<void>;
  onSaveAttachment: (attachment: ThreadAttachment) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const label = attachments && attachments.length === 1 ? "Attachment" : "Attachments";
  // The header toggles the message on click, and React events bubble out of the portal too.
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip open={open ? false : undefined}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={label}
              onClick={stop}
              className={cn("electron-no-drag flex h-7 shrink-0 items-center gap-0.5 rounded-[10px] pl-1.5 pr-1 text-muted-foreground hover:text-foreground", FLAT_KEY)}
            >
              <Paperclip className="size-4" />
              {attachments && attachments.length > 1 && <span className="text-xs tabular-nums">{attachments.length}</span>}
              <ChevronDown className="size-3" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="max-h-[70vh] w-80 overflow-y-auto p-3" onClick={stop} onKeyDown={stop}>
        <Section title={label}>
          {attachments === null ? (
            <div className="space-y-1.5 px-2">
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            attachments.map((attachment) => (
              <AttachmentRow
                key={attachment.id}
                attachment={attachment}
                showSender={false}
                onOpen={() => onOpenAttachment(attachment)}
                onSave={() => onSaveAttachment(attachment)}
              />
            ))
          )}
        </Section>
      </PopoverContent>
    </Popover>
  );
}

/** Text whose addresses can be clicked. */
function LinkedText({ text, onOpen }: { text: string; onOpen: (url: string) => void }) {
  return (
    <>
      {linkify(text).map((piece, index) =>
        "url" in piece ? (
          <button
            key={index}
            type="button"
            title={piece.url}
            className="inline cursor-pointer break-all text-left underline underline-offset-2 outline-none hover:text-foreground"
            onClick={() => onOpen(piece.url)}
          >
            {shortUrl(piece.url)}
          </button>
        ) : (
          <span key={index}>{piece.text}</span>
        ),
      )}
    </>
  );
}

function LinkRow({ link, showSender, onOpen }: { link: ThreadLink; showSender: boolean; onOpen: (url: string) => void }) {
  const Icon = link.kind === "meeting" ? Video : Link2;
  return (
    <button
      type="button"
      className={cn("flex w-full min-w-0 items-center gap-3 rounded-xl px-2 py-1.5 text-left outline-none", FLAT_KEY_IN)}
      onClick={() => onOpen(link.url)}
      aria-label={`Open ${link.label}`}
    >
      <span className="flex size-8 shrink-0 items-center justify-center">
        <Icon className="size-5 text-muted-foreground" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{link.label}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {link.host}
          {showSender ? ` · ${contactLabel(link.from)}` : ""}
        </span>
      </span>
    </button>
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
  onOpenLink,
}: {
  entry: ThreadInvitation;
  onRespond: (response: InvitationResponse) => Promise<void>;
  onOpenLink: (url: string) => void;
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
            "plate-2 flex size-8 shrink-0 items-center justify-center rounded-[10px]",
            cancelled ? "text-destructive" : "text-muted-foreground",
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
              <span className="truncate">
                <LinkedText text={invitation.location} onOpen={onOpenLink} />
              </span>
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
      {!cancelled && invitation.url && (
        <button
          type="button"
          title={invitation.url}
          onClick={() => onOpenLink(invitation.url!)}
          className={cn("flex h-8 w-full items-center justify-center gap-1.5 rounded-[10px] text-xs font-medium outline-none", FLAT_KEY_IN)}
        >
          <Video className="size-3.5" />
          Join call
          <span className="text-muted-foreground">{shortUrl(invitation.url).split("/")[0]}</span>
        </button>
      )}
      {invitation.notes && (
        <p className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words px-0.5 text-xs leading-relaxed text-muted-foreground">
          <LinkedText text={invitation.notes} onOpen={onOpenLink} />
        </p>
      )}
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
                  "inline-flex h-8 items-center justify-center gap-1 rounded-[10px] text-xs font-medium outline-none disabled:cursor-default",
                  FLAT_KEY_IN,
                  chosen
                    ? "grain shadow-raise-3 bg-sidebar-primary/15 text-sidebar-primary hover:bg-sidebar-primary/15"
                    : "disabled:opacity-60",
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
  onOpenLink: (url: string) => void;
  onRespond: (entry: ThreadInvitation, response: InvitationResponse) => Promise<void>;
}

/** Whether the conversation holds (or, until it has downloaded, is expected to hold) anything to list. */
function hasThreadArtifacts(artifacts: ThreadArtifacts | null, expecting: ThreadCardProps["expecting"]): boolean {
  return artifacts
    ? artifacts.attachments.length > 0 || artifacts.invitations.length > 0 || artifacts.links.length > 0
    : expecting.attachments || expecting.invitations;
}

/**
 * The toolbar's dropdown that gathers what is in the conversation: the meetings it invites to, the
 * files it carries and the links it holds to files kept online and to video calls. It sits left of Reply and renders nothing when there is nothing to list.
 */
export function ThreadCard({ artifacts, expecting, onOpenAttachment, onSaveAttachment, onOpenLink, onRespond }: ThreadCardProps) {
  const [open, setOpen] = useState(false);
  const invitations = artifacts?.invitations ?? [];
  const attachments = artifacts?.attachments ?? [];
  const links = artifacts?.links ?? [];
  const senders = new Set(attachments.map((attachment) => attachment.from.email.toLowerCase()));
  const linkSenders = new Set(links.map((link) => link.from.email.toLowerCase()));

  const waitingForInvitations = !artifacts && expecting.invitations;
  const waitingForAttachments = !artifacts && expecting.attachments;
  if (!hasThreadArtifacts(artifacts, expecting)) return null;

  const showInvitations = invitations.length > 0 || waitingForInvitations;
  const showAttachments = attachments.length > 0 || waitingForAttachments;
  const showLinks = links.length > 0;
  // The trigger says what is inside: files get a paperclip, a conversation of meetings alone a calendar, links alone a link.
  const Icon = showAttachments ? Paperclip : showInvitations ? CalendarDays : Link2;
  const count = artifacts ? attachments.length + invitations.length + links.length : null;
  const names = [
    showAttachments && "attachments",
    showInvitations && (invitations.length > 1 ? "invitations" : "invitation"),
    showLinks && "links",
  ].filter((name): name is string => !!name);
  const sentence = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]!;
  const label = sentence[0]!.toUpperCase() + sentence.slice(1);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip open={open ? false : undefined}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={label}
              className={cn("electron-no-drag flex h-9 items-center gap-1 rounded-xl pl-2 pr-1.5 text-muted-foreground hover:text-foreground", FLAT_KEY)}
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
              <InvitationBlock key={entry.invitation.uid} entry={entry} onRespond={(response) => onRespond(entry, response)} onOpenLink={onOpenLink} />
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

        {showLinks && (
          <Section title="Links">
            {links.map((link) => (
              <LinkRow key={link.url} link={link} showSender={linkSenders.size > 1} onOpen={onOpenLink} />
            ))}
          </Section>
        )}
      </PopoverContent>
    </Popover>
  );
}

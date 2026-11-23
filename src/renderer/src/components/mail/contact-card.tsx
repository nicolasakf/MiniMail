import { useState, type ReactNode } from "react";

import { BellOff, Check, Copy, PenLine, Search, ShieldBan, Zap } from "lucide-react";
import { toast } from "@/lib/toast";

import type { BlockKind } from "@shared/blocklist";
import type { LogoRequest } from "@shared/logos";
import type { Contact } from "@shared/types";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { blockChoices, emailTargets, muteChoices, useBlockList } from "@/lib/blocklist";
import { mutedCheck } from "@/lib/mute";
import { useNotificationSettings } from "@/hooks/use-notification-settings";
import { contactLabel } from "@/lib/format";
import { BLOCKED_TEXT } from "@/lib/highlight";
import { priorityCardChoices, togglePriority, usePriority } from "@/lib/priority";
import { cn } from "@/lib/utils";

import { SenderAvatar } from "./sender-avatar";

interface ContactCardProps {
  contact: Contact;
  /** What the person's name or address looks like in the message header; it opens the card. */
  children: ReactNode;
  className?: string;
  /** The user's own addresses: the card offers no priority or block for them. */
  own: readonly string[];
  /** Hides Priority and Block, as in Sent and Drafts, which hold the user's own mail. */
  hideFiltering?: boolean;
  /** The logo or photo the person qualifies for (known for a message's sender only). */
  logo?: LogoRequest | null;
  onCompose: (contact: Contact) => void;
  onSearch: (contact: Contact) => void;
  onBlock?: (kind: BlockKind, values: string[]) => void;
  /** Mutes (or unmutes) the person or their domain; needs the `accountId` whose notifications it concerns. */
  onMute?: (kind: BlockKind, values: string[]) => void;
  accountId?: string;
}

/** One row of the card: an icon, a label, and either a click action or a trailing control. */
function CardRow({
  icon,
  label,
  detail,
  onClick,
  danger,
  trailing,
}: {
  icon: ReactNode;
  label: string;
  detail?: string;
  onClick: () => void;
  danger?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "corner-squircle flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none [&_svg]:size-4 [&_svg]:shrink-0",
        danger ? BLOCKED_TEXT : "text-foreground [&_svg]:text-muted-foreground",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {detail && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}
      </span>
      {trailing}
    </button>
  );
}

/**
 * A name or address in a message header that opens a card about that person: write to them, see
 * everything from them, copy the address, mark them as priority or block them. Priority and Block
 * are the same ones the toolbar offers, so the lists they change are shared.
 */
export function ContactCard({ contact, children, className, own, hideFiltering = false, logo, onCompose, onSearch, onBlock, onMute, accountId }: ContactCardProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const priority = usePriority();
  const blocks = useBlockList();
  const { settings } = useNotificationSettings();

  const mine = own.some((email) => email.trim().toLowerCase() === contact.email.trim().toLowerCase());
  const filtering = !hideFiltering && !mine;
  const choices = filtering && onBlock ? blockChoices(blocks, emailTargets([contact.email], own)) : [];
  const muteChoicesShown =
    filtering && onMute && accountId !== undefined
      ? muteChoices(mutedCheck(settings, [accountId]), emailTargets([contact.email], own))
      : [];
  const priorityChoices = filtering ? priorityCardChoices(priority, contact.email, own) : [];

  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  const copy = () => {
    navigator.clipboard.writeText(contact.email).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => toast.error("Couldn't copy the address"),
    );
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setCopied(false);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          title={contact.email}
          // The header around it is a button too; opening the card must not also fold the message.
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          className={cn(
            "electron-no-drag cursor-pointer rounded-sm text-left hover:underline hover:underline-offset-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:underline",
            className,
          )}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-fit min-w-64 max-w-[min(28rem,calc(100vw-2rem))] p-0" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-3 edge-b p-4">
          <SenderAvatar contact={contact} size={44} logo={logo} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{contactLabel(contact)}</div>
            <button
              type="button"
              onClick={copy}
              aria-label={`Copy ${contact.email}`}
              className="group flex max-w-full items-center gap-1.5 text-sm text-sidebar-ring hover:underline hover:underline-offset-2"
            >
              <span className="truncate">{contact.email}</span>
              {copied ? <Check className="size-3.5 shrink-0" /> : <Copy className="size-3.5 shrink-0 opacity-70 group-hover:opacity-100" />}
            </button>
          </div>
        </div>
        <div className="space-y-0.5 p-1.5">
          <CardRow icon={<PenLine />} label="Compose an email" onClick={() => run(() => onCompose(contact))} />
          <CardRow
            icon={<Search />}
            label="Search emails from"
            detail={contact.email}
            onClick={() => run(() => onSearch(contact))}
          />
          {priorityChoices.map((choice) => (
            <CardRow
              key={choice.kind}
              icon={<Zap />}
              label={choice.label}
              onClick={() => run(() => togglePriority(choice.kind, choice.value))}
            />
          ))}
          {muteChoicesShown.map((choice) => (
            <CardRow
              key={choice.kind}
              icon={<BellOff />}
              label={choice.label}
              onClick={() => run(() => onMute?.(choice.kind, choice.values))}
            />
          ))}
          {choices.map((choice) => (
            <CardRow
              key={choice.kind}
              danger
              icon={<ShieldBan />}
              label={choice.label}
              onClick={() => run(() => onBlock?.(choice.kind, choice.values))}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

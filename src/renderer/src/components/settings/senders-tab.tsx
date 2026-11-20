import { useEffect, useId, useMemo, useRef, useState } from "react";

import { BellOff, CircleAlert, Search, ShieldBan, X, Zap, type LucideIcon } from "lucide-react";
import { toast } from "@/lib/toast";

import { MAX_BLOCK_ENTRIES, isBlockedEntry, type BlockKind } from "@shared/blocklist";
import { senderDomain } from "@shared/categories";
import { currentToken, entryLabel, searchContacts, type ContactEntry } from "@shared/contacts";
import {
  isFreemail,
  isPlausibleDomain,
  isSendingService,
  logoRequestFor,
  type LogoRequest,
} from "@shared/logos";
import { MAX_MUTED_SENDERS, mutedKey } from "@shared/notifications";
import { MAX_PRIORITY_ENTRIES, isPriorityEntry } from "@shared/priority";
import {
  SENDER_STATUSES,
  buildSenderRows,
  countSenderRows,
  filterSenderRows,
  parseSenderList,
  senderLabel,
  type SenderEntry,
  type SenderEntryKind,
  type SenderFilter,
  type SenderRow,
  type SenderStatus,
} from "@shared/senders";
import type { Account, Contact } from "@shared/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useNotificationSettings } from "@/hooks/use-notification-settings";
import { useBlockList } from "@/lib/blocklist";
import { cachedContacts, refreshContacts } from "@/lib/contact-cache";
import { countedTargets, recordAction } from "@/lib/events";
import { allMutedKeys, withMutedEverywhere } from "@/lib/mute";
import { setBlockedClearingPriority, setPriority, usePriority } from "@/lib/priority";
import { newUndoRef, undoStack } from "@/lib/undo-stack";
import { cn } from "@/lib/utils";

import { SenderAvatar } from "../mail/sender-avatar";

import { SettingsPageHeader } from "./fields";

/** Rows drawn at first, and added by each "Show more": a long list stays quick to open. */
const PAGE_SIZE = 40;

interface StatusInfo {
  /** The button and switch name. */
  name: string;
  /** How the entry is described once it is on the list ("ana@example.com is already priority"). */
  adjective: string;
  icon: LucideIcon;
  /** What being on the list does. */
  info: string;
  /** Colors of a switch that is on. */
  on: string;
}

const STATUS: Record<SenderStatus, StatusInfo> = {
  priority: {
    name: "Priority",
    adjective: "priority",
    icon: Zap,
    info: "Mail from these senders and domains shows on the Priority card while it is unread. Marking one here unblocks it.",
    on: "border-amber-500/50 bg-amber-500/15 text-amber-600 dark:text-amber-300",
  },
  muted: {
    name: "Mute",
    adjective: "muted",
    icon: BellOff,
    info: "Mail from these senders and domains never notifies, in any account. It is still filed where it always was.",
    on: "border-sky-500/50 bg-sky-500/15 text-sky-600 dark:text-sky-300",
  },
  blocked: {
    name: "Block",
    adjective: "blocked",
    icon: ShieldBan,
    info: "Mail from these senders and domains goes to the Trash. Blocking one takes its priority mark off.",
    on: "border-red-500/50 bg-red-500/15 text-red-600 dark:text-red-300",
  },
};

/** The filter chips name the lists, not the actions: "Muted", not "Mute". */
const FILTERS: readonly { id: SenderFilter; name: string }[] = [
  { id: "all", name: "All" },
  { id: "priority", name: "Priority" },
  { id: "muted", name: "Muted" },
  { id: "blocked", name: "Blocked" },
];

type Signals = ReadonlyMap<string, ContactEntry["signal"]>;

/** Whether mail from each address looks like a person's or a company's, to pick a photo or a logo. */
function signalsOf(contacts: readonly ContactEntry[]): Signals {
  return new Map(contacts.map((contact) => [contact.email.toLowerCase(), contact.signal]));
}

/** The logo a domain qualifies for: a company's, never a mailbox provider's or a sending service's. */
function domainLogo(domain: string): LogoRequest | null {
  const brand = isPlausibleDomain(domain) && !isFreemail(domain) && !isSendingService(domain);
  return brand ? { kind: "brand", domain } : null;
}

/** The avatar of an address (a person's photo or a company's logo) or of a whole domain (its logo). */
function EntryAvatar({ entry, signals, size }: { entry: SenderEntry; signals: Signals; size: number }) {
  const { contact, logo } = useMemo((): { contact: Contact; logo: LogoRequest | null } => {
    if (entry.kind === "domains") return { contact: { name: entry.value, email: senderLabel(entry) }, logo: domainLogo(entry.value) };
    return {
      contact: { name: "", email: entry.value },
      logo: logoRequestFor({ from: { name: "", email: entry.value }, signal: signals.get(entry.value) ?? "person", authenticated: true }),
    };
  }, [entry, signals]);
  return <SenderAvatar contact={contact} size={size} logo={logo} />;
}

/** One line of the suggestion list: an address we have exchanged mail with, or a whole domain. */
interface Suggestion {
  entry: SenderEntry;
  /** Shown as the main line. */
  title: string;
  /** Shown under it, when it adds something. */
  detail: string;
  contact: Contact;
  logo: LogoRequest | null;
}

/** Suggestions for what was typed: addresses first, then the domains of the matching contacts. Those already in the box are left out. */
function suggestionsFor(contacts: readonly ContactEntry[], text: string, chosen: ReadonlySet<string>): Suggestion[] {
  const query = text.trim().toLowerCase();
  if (!query) return [];
  const domainOnly = query.startsWith("@");
  const needle = domainOnly ? query.slice(1) : query;
  if (!needle) return [];

  const result: Suggestion[] = [];
  if (!domainOnly) {
    for (const contact of searchContacts(contacts, needle, chosen, 40)) {
      const title = entryLabel(contact);
      result.push({
        entry: { kind: "senders", value: contact.email },
        title,
        detail: title === contact.email ? "" : contact.email,
        contact: { name: contact.name, email: contact.email },
        logo: logoRequestFor({ from: contact, signal: contact.signal, authenticated: true }),
      });
      if (result.length >= 5) break;
    }
  }

  const counts = new Map<string, number>();
  for (const contact of contacts) {
    const domain = senderDomain(contact.email);
    if (domain === "unknown" || !domain.includes(needle) || chosen.has(`@${domain}`)) continue;
    counts.set(domain, (counts.get(domain) ?? 0) + contact.sentTo + contact.receivedFrom);
  }
  const domains = [...counts.entries()]
    .sort((a, b) => Number(b[0].startsWith(needle)) - Number(a[0].startsWith(needle)) || b[1] - a[1])
    .map(([domain]) => domain)
    .slice(0, domainOnly ? 6 : 3);
  for (const domain of domains) {
    result.push({
      entry: { kind: "domains", value: domain },
      title: `@${domain}`,
      detail: "Everyone at this domain",
      contact: { name: domain, email: `@${domain}` },
      logo: domainLogo(domain),
    });
  }
  return result;
}

/** One entry waiting in the add box: an address or a domain, or text that is neither (shown in red). */
interface Chip {
  /** What the chip shows; also its identity. */
  label: string;
  entry: SenderEntry | null;
}

function chipsFrom(text: string): Chip[] {
  const { entries, invalid } = parseSenderList(text);
  return [...entries.map((entry) => ({ label: senderLabel(entry), entry })), ...invalid.map((raw) => ({ label: raw, entry: null }))];
}

/** The chips with these added, once each. */
function mergeChips(chips: readonly Chip[], more: readonly Chip[]): Chip[] {
  const seen = new Set(chips.map((chip) => chip.label.toLowerCase()));
  const result = [...chips];
  for (const chip of more) {
    if (seen.has(chip.label.toLowerCase())) continue;
    seen.add(chip.label.toLowerCase());
    result.push(chip);
  }
  return result;
}

/**
 * The box for new senders and domains, with one button per list. Like the composer's recipient box it
 * turns each address into a chip (a comma, space, Enter or Tab ends one; pasting a list makes one chip
 * each; text that is not an address becomes a red chip), and one click on a button puts all the chips on
 * that list. Chips the list refuses stay in the box with the reason.
 */
function AddBox({
  contacts,
  onAdd,
}: {
  /** Everyone we have exchanged mail with, to suggest from. */
  contacts: readonly ContactEntry[];
  /** Puts the entries on that list; returns the reason for each one it could not add, by its label. */
  onAdd: (status: SenderStatus, entries: SenderEntry[]) => Record<string, string>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [chips, setChips] = useState<Chip[]>([]);
  const [text, setText] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(0);
  /** Hidden by Esc until the next keystroke changes the text. */
  const [dismissed, setDismissed] = useState(false);

  const signals = useMemo(() => signalsOf(contacts), [contacts]);
  const chosen = useMemo(() => new Set(chips.map((chip) => chip.label.toLowerCase())), [chips]);
  const token = currentToken(text);
  const suggestions = useMemo(() => suggestionsFor(contacts, token, chosen), [contacts, token, chosen]);
  const open = focused && !dismissed && suggestions.length > 0;
  const active = Math.min(highlight, suggestions.length - 1);

  /**
   * Turns everything in `input` into chips; with `keepTail`, only what comes before the last comma, and
   * what follows it is handed back to stay in the box. Returns what is left to type.
   */
  const commit = (input: string, keepTail = false): string => {
    const cut = keepTail ? Math.max(input.lastIndexOf(","), input.lastIndexOf(";")) : input.length;
    const found = chipsFrom(keepTail ? input.slice(0, cut) : input);
    if (found.length > 0) setChips((previous) => mergeChips(previous, found));
    return keepTail ? input.slice(cut + 1).trimStart() : "";
  };

  const pick = (suggestion: Suggestion) => {
    // Only the part after the last comma was being searched; anything before it stays as typed.
    const cut = Math.max(text.lastIndexOf(","), text.lastIndexOf(";"));
    setText(cut >= 0 ? text.slice(0, cut + 1).trimEnd() : "");
    setChips((previous) => mergeChips(previous, [{ label: senderLabel(suggestion.entry), entry: suggestion.entry }]));
    setProblems([]);
    setHighlight(0);
    setDismissed(false);
  };

  const removeAt = (index: number) => {
    setChips((previous) => previous.filter((_, position) => position !== index));
    setProblems([]);
    inputRef.current?.focus();
  };

  const submit = (status: SenderStatus) => {
    const all = mergeChips(chips, chipsFrom(text));
    if (all.length === 0) return;
    setText("");
    setHighlight(0);
    const unreadable = all.filter((chip) => chip.entry === null);
    if (unreadable.length > 0) {
      setChips(all);
      const names = unreadable.map((chip) => chip.label).join(", ");
      setProblems([
        `${names} ${unreadable.length === 1 ? "is" : "are"} not an address or a domain. Remove ${unreadable.length === 1 ? "it" : "them"} first, or write an address like news@example.com or a domain like @example.com.`,
      ]);
      return;
    }
    const failed = onAdd(
      status,
      all.map((chip) => chip.entry!),
    );
    setChips(all.filter((chip) => failed[chip.label] !== undefined));
    setProblems(Object.values(failed));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        if (!open) return;
        event.preventDefault();
        setHighlight((active + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length);
        return;
      case "Enter":
      case "Tab":
        if (open && !(event.key === "Tab" && event.shiftKey)) {
          event.preventDefault();
          pick(suggestions[active]!);
        } else if (text.trim()) {
          // No suggestion to take: make what was typed out in full into chips.
          event.preventDefault();
          setText(commit(text));
        } else if (event.key === "Enter") {
          event.preventDefault();
        }
        return;
      case " ":
        // Space ends an entry, like a comma. While suggestions are showing it is part of a name being
        // searched ("john smith"), and inside <...> it is part of the address.
        if (!open && text.trim() && !/[<>]/.test(text)) {
          event.preventDefault();
          setText(commit(text));
        }
        return;
      case "Escape":
        // Closing the suggestions is all this Esc does; the dialog around it must not also close.
        if (open) {
          event.preventDefault();
          setDismissed(true);
        }
        return;
      case "Backspace":
        if (text === "" && chips.length > 0) {
          event.preventDefault();
          setChips((previous) => previous.slice(0, -1));
          setProblems([]);
        }
        return;
    }
  };

  const empty = chips.length === 0 && text.trim() === "";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start gap-2">
        <div className="relative min-w-[16rem] flex-1">
          {/* Clicking the empty part of the box types into it, like a plain input would. */}
          <div
            className="corner-squircle flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1 focus-within:ring-2 focus-within:ring-ring"
            aria-invalid={problems.length > 0}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                event.preventDefault();
                inputRef.current?.focus();
              }
            }}
          >
            {chips.map((chip, index) => {
              const valid = chip.entry !== null;
              const element = (
                <span
                  tabIndex={0}
                  aria-invalid={!valid || undefined}
                  aria-label={valid ? `${chip.label}. Press Backspace to remove.` : `${chip.label}, not an address or a domain. Press Backspace to remove.`}
                  className={cn(
                    "corner-squircle inline-flex h-7 max-w-[260px] items-center gap-1.5 rounded-full bg-muted pl-1 pr-1.5 text-[13px] outline-none transition-colors focus-visible:bg-sidebar-primary/25 focus-visible:ring-1 focus-visible:ring-sidebar-ring",
                    !valid && "bg-destructive/15 text-destructive ring-1 ring-destructive/50 focus-visible:bg-destructive/25",
                  )}
                  onKeyDown={(event) => {
                    if (event.key === "Backspace" || event.key === "Delete") {
                      event.preventDefault();
                      event.stopPropagation();
                      removeAt(index);
                    } else if (event.key === "ArrowRight" || event.key === "Enter") {
                      event.preventDefault();
                      inputRef.current?.focus();
                    }
                  }}
                >
                  {chip.entry ? <EntryAvatar entry={chip.entry} signals={signals} size={20} /> : <CircleAlert className="ml-1 size-4 shrink-0" aria-hidden />}
                  <span className="min-w-0 truncate">{chip.label}</span>
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={`Remove ${chip.label}`}
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-foreground/15 hover:text-foreground",
                      valid ? "text-muted-foreground" : "text-destructive",
                    )}
                    onClick={() => removeAt(index)}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              );
              if (valid) return <span key={chip.label.toLowerCase()}>{element}</span>;
              return (
                <Tooltip key={chip.label.toLowerCase()}>
                  <TooltipTrigger asChild>{element}</TooltipTrigger>
                  <TooltipContent side="bottom">This is not an address or a domain.</TooltipContent>
                </Tooltip>
              );
            })}
            <input
              ref={inputRef}
              value={text}
              placeholder={chips.length === 0 ? "ana@example.com or @example.com" : undefined}
              role="combobox"
              aria-label="Senders or domains to add"
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={open ? `${listId}-${active}` : undefined}
              autoComplete="off"
              spellCheck={false}
              className="h-7 min-w-[8rem] flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
              onChange={(event) => {
                const raw = event.target.value;
                setProblems([]);
                setHighlight(0);
                setDismissed(false);
                // A comma or semicolon ends an entry: finished ones become chips, and what follows is searched from scratch.
                setText(/[,;]/.test(raw) ? commit(raw, true) : raw);
              }}
              onPaste={(event) => {
                // A pasted list (several addresses, or lines of them) becomes one chip each, at once.
                const pasted = event.clipboardData.getData("text");
                if (!/[\s,;]/.test(pasted.trim())) return;
                event.preventDefault();
                setProblems([]);
                setText(commit(`${text} ${pasted}`));
              }}
              onKeyDown={onKeyDown}
              onFocus={() => setFocused(true)}
              onBlur={() => {
                setFocused(false);
                const rest = commit(text);
                if (rest !== text) setText(rest);
              }}
            />
          </div>
          {open && (
            <ul
              id={listId}
              role="listbox"
              aria-label="Suggestions"
              className="corner-squircle absolute left-0 top-full z-50 mt-1 max-h-64 w-full min-w-[280px] overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-xl"
            >
              {suggestions.map((suggestion, index) => (
                <li
                  key={`${suggestion.entry.kind}:${suggestion.entry.value}`}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  className={cn(
                    "corner-squircle flex cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 text-sm",
                    index === active && "bg-accent",
                  )}
                  // Keep focus in the input, or its blur would turn the half-typed text into a chip.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => pick(suggestion)}
                >
                  <SenderAvatar contact={suggestion.contact} size={26} logo={suggestion.logo} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{suggestion.title}</span>
                    {suggestion.detail && <span className="block truncate text-xs text-muted-foreground">{suggestion.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div role="group" aria-label="Add to a list" className="flex gap-2">
          {SENDER_STATUSES.map((status) => {
            const { name, icon: Icon, info } = STATUS[status];
            return (
              <Tooltip key={status}>
                <TooltipTrigger asChild>
                  <Button type="button" variant="outline" disabled={empty} onClick={() => submit(status)}>
                    <Icon /> {name}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs text-xs leading-relaxed">
                  {info}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>
      {problems.length > 0 && (
        <div role="alert" className="space-y-0.5 text-xs text-red-300">
          {problems.map((problem) => (
            <p key={problem}>{problem}</p>
          ))}
        </div>
      )}
    </div>
  );
}

/** One switch of a row: lit when the sender or domain is on that list. */
function StatusSwitch({ row, status, onToggle }: { row: SenderRow; status: SenderStatus; onToggle: () => void }) {
  const { name, icon: Icon, info, on } = STATUS[status];
  const pressed = row[status];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-pressed={pressed}
          aria-label={`${name}: ${row.label}`}
          onClick={onToggle}
          className={cn(
            "corner-squircle inline-flex size-8 items-center justify-center rounded-md border text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            pressed ? on : "border-transparent opacity-60 hover:bg-accent hover:text-foreground hover:opacity-100",
          )}
        >
          <Icon className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
        {pressed ? `${name}: on. Click to turn it off.` : info}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Everyone marked as priority, muted or blocked, in one list: each sender or domain once, with a switch
 * for each of the three. It reads and writes the same lists as the Priority, Mute and Block commands,
 * so a change here shows everywhere at once, and priority and block keep excluding each other.
 * Muting here covers every account.
 */
export function SendersTab({ accounts }: { accounts: readonly Account[] }) {
  const priority = usePriority();
  const blocks = useBlockList();
  const { settings: notify, update: updateNotify } = useNotificationSettings();
  const [contacts, setContacts] = useState<readonly ContactEntry[]>(cachedContacts);
  const [filter, setFilter] = useState<SenderFilter>("all");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE_SIZE);
  /** The labels of what was just added, kept at the top of the list. */
  const [added, setAdded] = useState<readonly string[]>([]);

  // The address book is normally loaded at start-up; ask again in case it was still empty.
  useEffect(() => {
    let live = true;
    void refreshContacts().then((found) => {
      if (live) setContacts(found);
    });
    return () => {
      live = false;
    };
  }, []);

  const mutedKeys = useMemo(() => (notify ? allMutedKeys(notify) : []), [notify]);
  const rows = useMemo(() => buildSenderRows(priority, blocks, mutedKeys), [priority, blocks, mutedKeys]);
  const counts = useMemo(() => countSenderRows(rows), [rows]);
  const found = useMemo(() => {
    const matching = filterSenderRows(rows, filter, query);
    if (added.length === 0) return matching;
    // What was just added comes first, so the person sees where it went; the rest stay in their place.
    return [...matching.filter((row) => added.includes(row.label)), ...matching.filter((row) => !added.includes(row.label))];
  }, [rows, filter, query, added]);
  const visible = found.slice(0, shown);
  const accountIds = accounts.map((account) => account.id);
  const signals = useMemo(() => signalsOf(contacts), [contacts]);

  const setMuted = (kind: SenderEntryKind, values: readonly string[], muted: boolean) => {
    const keys = values.map((value) => mutedKey(kind, value));
    void updateNotify((current) => withMutedEverywhere(current, accountIds, keys, muted));
    const title = `${muted ? "Muted" : "Unmuted"} ${countedTargets(kind, values.length)}`;
    const context = values.map((value) => senderLabel({ kind, value })).join(", ");
    const ref = newUndoRef("mute");
    recordAction("notifications", title, "", { context, ref });
    undoStack.push({
      ref,
      label: title,
      context,
      run: () => void updateNotify((current) => withMutedEverywhere(current, accountIds, keys, !muted)),
    });
  };

  const setBlocked = (kind: SenderEntryKind, values: readonly string[], blocked: boolean) => {
    const blockKind: BlockKind = kind;
    const hadPriority = values.filter((value) => isPriorityEntry(priority, kind, value));
    setBlockedClearingPriority(blockKind, values, blocked);
    const title = `${blocked ? "Blocked" : "Unblocked"} ${countedTargets(kind, values.length)}`;
    const context = values.map((value) => senderLabel({ kind, value })).join(", ");
    const ref = newUndoRef("block");
    recordAction("mail", title, "", { context, ref });
    undoStack.push({ ref, label: title, context, run: () => setBlockedClearingPriority(blockKind, values, !blocked) });
    if (blocked && hadPriority.length > 0) {
      toast(
        hadPriority.length === 1
          ? `${senderLabel({ kind, value: hadPriority[0]! })} is no longer priority`
          : `${hadPriority.length} ${kind} are no longer priority`,
      );
    }
  };

  /** Whether the entry is on that list now. */
  const isOn = (status: SenderStatus, entry: SenderEntry): boolean => {
    if (status === "priority") return isPriorityEntry(priority, entry.kind, entry.value);
    if (status === "blocked") return isBlockedEntry(blocks, entry.kind, entry.value);
    return mutedKeys.includes(mutedKey(entry.kind, entry.value));
  };

  /**
   * Why the entry cannot go on that list, or null. `pending` counts what is already going on it of the
   * same kind in this batch, so a long paste cannot run past the cap.
   */
  const refusal = (status: SenderStatus, entry: SenderEntry, pending: number): string | null => {
    const label = senderLabel(entry);
    if (isOn(status, entry)) return `${label} is already ${STATUS[status].adjective}.`;
    if (status === "priority") {
      if (priority[entry.kind].length + pending >= MAX_PRIORITY_ENTRIES)
        return `You can mark up to ${MAX_PRIORITY_ENTRIES} ${entry.kind} as priority.`;
      if (entry.kind === "senders" && isBlockedEntry(blocks, "domains", senderDomain(entry.value)))
        return `${label} is not marked: @${senderDomain(entry.value)} is blocked. Unblock it first.`;
    } else if (status === "blocked") {
      if (blocks[entry.kind].length + pending >= MAX_BLOCK_ENTRIES) return `You can block up to ${MAX_BLOCK_ENTRIES} ${entry.kind}.`;
    } else {
      if (!notify) return "Your settings are still loading. Try again in a moment.";
      if (mutedKeys.length + pending >= MAX_MUTED_SENDERS) return `You can mute up to ${MAX_MUTED_SENDERS} senders.`;
    }
    return null;
  };

  /** Puts these on a list, or takes them off, one action (one Log row, one Undo) per kind. */
  const apply = (status: SenderStatus, kind: SenderEntryKind, values: readonly string[], on: boolean) => {
    if (values.length === 0) return;
    if (status === "priority") setPriority(kind, values, on);
    else if (status === "blocked") setBlocked(kind, values, on);
    else setMuted(kind, values, on);
  };

  /** Adds everything it can; returns the reason for each entry it could not, by label. */
  const add = (status: SenderStatus, entries: SenderEntry[]): Record<string, string> => {
    const failed: Record<string, string> = {};
    const accepted: SenderEntry[] = [];
    const pending = { senders: 0, domains: 0 };
    for (const entry of entries) {
      const problem = refusal(status, entry, status === "muted" ? accepted.length : pending[entry.kind]);
      if (problem) {
        failed[senderLabel(entry)] = problem;
      } else {
        accepted.push(entry);
        pending[entry.kind]++;
      }
    }
    for (const kind of ["domains", "senders"] as const) {
      apply(status, kind, accepted.filter((entry) => entry.kind === kind).map((entry) => entry.value), true);
    }
    // The filter and search stay as they were; what was added goes on top when they show it.
    if (accepted.length > 0) setAdded(accepted.map(senderLabel));
    return failed;
  };

  const toggle = (row: SenderRow, status: SenderStatus) => {
    if (row[status]) {
      apply(status, row.kind, [row.value], false);
      return;
    }
    const problem = refusal(status, row, 0);
    if (problem) toast.error(problem);
    else apply(status, row.kind, [row.value], true);
  };

  return (
    <div className="space-y-4">
      <SettingsPageHeader title="Senders" />

      <AddBox contacts={contacts} onAdd={add} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            placeholder="Search senders and domains"
            aria-label="Search senders and domains"
            autoComplete="off"
            spellCheck={false}
            className="pl-8"
            onChange={(event) => {
              setQuery(event.target.value);
              setShown(PAGE_SIZE);
            }}
          />
        </div>
        <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
          {FILTERS.map(({ id, name }) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => {
                setFilter(id);
                setShown(PAGE_SIZE);
              }}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                filter === id ? "border-transparent bg-primary text-primary-foreground" : "hover:bg-accent",
              )}
            >
              {name} <span className="tabular-nums opacity-70">{counts[id]}</span>
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No one is priority, muted or blocked yet. Add an address or a whole domain above.
        </p>
      ) : found.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Nothing matches.</p>
      ) : (
        <ul aria-label="Senders and domains" className="border-t">
          {visible.map((row) => (
            <li key={row.label} className="flex items-center gap-3 border-b py-2">
              <EntryAvatar entry={row} signals={signals} size={32} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.label}</p>
                <p className="truncate text-xs text-muted-foreground">{row.kind === "domains" ? "Everyone at this domain" : "Sender"}</p>
              </div>
              <div role="group" aria-label={`Lists of ${row.label}`} className="flex shrink-0 gap-1">
                {SENDER_STATUSES.map((status) => (
                  <StatusSwitch key={status} row={row} status={status} onToggle={() => toggle(row, status)} />
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      {found.length > shown && (
        <div className="flex justify-center">
          <Button type="button" variant="outline" size="sm" onClick={() => setShown(shown + 60)}>
            Show {Math.min(60, found.length - shown)} more
          </Button>
        </div>
      )}

      {priority.threads.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {priority.threads.length} marked conversation{priority.threads.length === 1 ? "" : "s"} not listed here.
        </p>
      )}
    </div>
  );
}

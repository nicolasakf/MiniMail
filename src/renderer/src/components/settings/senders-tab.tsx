import { useEffect, useId, useMemo, useState } from "react";

import { Plus, X } from "lucide-react";
import { toast } from "@/lib/toast";

import {
  MAX_BLOCK_ENTRIES,
  isBlockedEntry,
  type BlockKind,
} from "@shared/blocklist";
import { senderDomain } from "@shared/categories";
import {
  entryLabel,
  searchContacts,
  type ContactEntry,
} from "@shared/contacts";
import {
  isFreemail,
  isPlausibleDomain,
  isSendingService,
  logoRequestFor,
  type LogoRequest,
} from "@shared/logos";
import { normalizeMutedSender } from "@shared/notifications";
import { MAX_PRIORITY_ENTRIES, isPriorityEntry } from "@shared/priority";
import type { Contact } from "@shared/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useBlockList } from "@/lib/blocklist";
import { cachedContacts, refreshContacts } from "@/lib/contact-cache";
import { cn } from "@/lib/utils";
import {
  setBlockedClearingPriority,
  togglePriority,
  usePriority,
} from "@/lib/priority";

import { SenderAvatar } from "../mail/sender-avatar";

import { SettingsPageHeader, SettingsSectionTitle } from "./fields";

type EntryKind = "senders" | "domains";

interface Entry {
  kind: EntryKind;
  value: string;
}

/** Reads what the user typed: an address, or a whole domain written `@example.com`. */
function parseEntry(input: string): Entry | null {
  const normalized = normalizeMutedSender(input);
  if (!normalized) return null;
  if (normalized.startsWith("@"))
    return { kind: "domains", value: senderDomain(normalized) };
  return { kind: "senders", value: normalized };
}

const label = (entry: Entry) =>
  entry.kind === "domains" ? `@${entry.value}` : entry.value;

function EntryList({
  title,
  entries,
  onRemove,
}: {
  title: string;
  entries: readonly Entry[];
  onRemove: (entry: Entry) => void;
}) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No {title.toLowerCase()} yet.
      </p>
    );
  }
  return (
    <ul className="flex flex-wrap gap-2" aria-label={title}>
      {entries.map((entry) => (
        <li
          key={`${entry.kind}:${entry.value}`}
          className="corner-squircle flex items-center gap-1 rounded-md border bg-muted/40 py-1 pl-2.5 pr-1 text-xs"
        >
          <span className="max-w-[16rem] truncate">{label(entry)}</span>
          <span className="text-muted-foreground">
            {entry.kind === "domains" ? "domain" : "sender"}
          </span>
          <button
            type="button"
            aria-label={`Remove ${label(entry)} from ${title.toLowerCase()}`}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onRemove(entry)}
          >
            <X className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** One line of the suggestion list: an address we have exchanged mail with, or a whole domain. */
interface Suggestion {
  entry: Entry;
  /** Shown as the main line. */
  title: string;
  /** Shown under it, when it adds something. */
  detail: string;
  contact: Contact;
  logo: LogoRequest | null;
}

/** Suggestions for what was typed: addresses first, then the domains of the matching contacts. */
function suggestionsFor(
  contacts: readonly ContactEntry[],
  text: string,
  taken: (entry: Entry) => boolean,
): Suggestion[] {
  const query = text.trim().toLowerCase();
  if (!query) return [];
  const domainOnly = query.startsWith("@");
  const needle = domainOnly ? query.slice(1) : query;
  if (!needle) return [];

  const result: Suggestion[] = [];
  if (!domainOnly) {
    for (const contact of searchContacts(contacts, needle, new Set(), 40)) {
      const entry: Entry = { kind: "senders", value: contact.email };
      if (taken(entry)) continue;
      const title = entryLabel(contact);
      result.push({
        entry,
        title,
        detail: title === contact.email ? "" : contact.email,
        contact: { name: contact.name, email: contact.email },
        logo: logoRequestFor({
          from: contact,
          signal: contact.signal,
          authenticated: true,
        }),
      });
      if (result.length >= 5) break;
    }
  }

  const counts = new Map<string, number>();
  for (const contact of contacts) {
    const domain = senderDomain(contact.email);
    if (domain === "unknown" || !domain.includes(needle)) continue;
    counts.set(
      domain,
      (counts.get(domain) ?? 0) + contact.sentTo + contact.receivedFrom,
    );
  }
  const domains = [...counts.entries()]
    .sort(
      (a, b) =>
        Number(b[0].startsWith(needle)) - Number(a[0].startsWith(needle)) ||
        b[1] - a[1],
    )
    .map(([domain]) => domain)
    .filter((domain) => !taken({ kind: "domains", value: domain }))
    .slice(0, domainOnly ? 6 : 3);
  for (const domain of domains) {
    const brand =
      isPlausibleDomain(domain) &&
      !isFreemail(domain) &&
      !isSendingService(domain);
    result.push({
      entry: { kind: "domains", value: domain },
      title: `@${domain}`,
      detail: "Everyone at this domain",
      contact: { name: domain, email: `@${domain}` },
      logo: brand ? { kind: "brand", domain } : null,
    });
  }
  return result;
}

function AddForm({
  id,
  placeholder,
  action,
  contacts,
  taken,
  onAdd,
}: {
  id: string;
  placeholder: string;
  action: string;
  /** Everyone we have exchanged mail with, to suggest from. */
  contacts: readonly ContactEntry[];
  /** Whether an entry is already in this list (such suggestions are left out). */
  taken: (entry: Entry) => boolean;
  /** Returns a message when the entry cannot be added. */
  onAdd: (entry: Entry) => string | null;
}) {
  const listId = useId();
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(0);
  /** Hidden by Esc until the next keystroke changes the text. */
  const [dismissed, setDismissed] = useState(false);

  const suggestions = useMemo(
    () => suggestionsFor(contacts, text, taken),
    [contacts, text, taken],
  );
  const open = focused && !dismissed && suggestions.length > 0;
  const active = Math.min(highlight, suggestions.length - 1);

  const add = (entry: Entry | null) => {
    if (!entry) {
      setProblem(
        "Enter an address like news@example.com, or a whole domain like @example.com.",
      );
      return;
    }
    const error = onAdd(entry);
    if (error) {
      setProblem(error);
      return;
    }
    setText("");
    setProblem(null);
    setHighlight(0);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        if (!open) return;
        event.preventDefault();
        setHighlight(
          (active + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) %
            suggestions.length,
        );
        return;
      case "Tab":
        // Tab takes the highlighted suggestion into the box, to finish it or add it with Enter.
        if (open && !event.shiftKey) {
          event.preventDefault();
          const { entry } = suggestions[active]!;
          setText(label(entry));
          setHighlight(0);
        }
        return;
      case "Escape":
        // Closing the suggestions is all this Esc does; the dialog around it must not also close.
        if (open) {
          event.preventDefault();
          setDismissed(true);
        }
        return;
      case "Enter":
        if (open) {
          event.preventDefault();
          add(suggestions[active]!.entry);
        }
        return;
    }
  };

  return (
    <div className="space-y-2">
      <form
        className="relative flex max-w-xl items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          add(parseEntry(text));
        }}
      >
        <Input
          id={id}
          value={text}
          placeholder={placeholder}
          role="combobox"
          aria-label={`Sender to ${action.toLowerCase()}`}
          aria-invalid={problem !== null}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setText(event.target.value);
            setProblem(null);
            setHighlight(0);
            setDismissed(false);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        <Button type="submit" variant="outline" disabled={text.trim() === ""}>
          <Plus /> {action}
        </Button>
        {open && (
          <ul
            id={listId}
            role="listbox"
            aria-label={`${action} suggestions`}
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
                // Keep focus in the input, or the list would close before the click lands.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => add(suggestion.entry)}
              >
                <SenderAvatar
                  contact={suggestion.contact}
                  size={26}
                  logo={suggestion.logo}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {suggestion.title}
                  </span>
                  {suggestion.detail && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {suggestion.detail}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </form>
      {problem && (
        <p role="alert" className="text-xs text-red-300">
          {problem}
        </p>
      )}
    </div>
  );
}

/**
 * The senders and domains marked as priority or blocked, with a way to add and remove them. It
 * reads and writes the same lists as the Priority and Block commands, so a change here shows
 * everywhere at once, and priority and block keep excluding each other.
 */
export function SendersTab() {
  const priority = usePriority();
  const blocks = useBlockList();
  const [contacts, setContacts] =
    useState<readonly ContactEntry[]>(cachedContacts);

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

  const priorityEntries: Entry[] = [
    ...priority.domains.map((value) => ({ kind: "domains" as const, value })),
    ...priority.senders.map((value) => ({ kind: "senders" as const, value })),
  ];
  const blockedEntries: Entry[] = [
    ...blocks.domains.map((value) => ({ kind: "domains" as const, value })),
    ...blocks.senders.map((value) => ({ kind: "senders" as const, value })),
  ];

  const addPriority = (entry: Entry): string | null => {
    if (isPriorityEntry(priority, entry.kind, entry.value))
      return `${label(entry)} is already priority.`;
    if (priority[entry.kind].length >= MAX_PRIORITY_ENTRIES)
      return `You can mark up to ${MAX_PRIORITY_ENTRIES} ${entry.kind} as priority.`;
    if (
      entry.kind === "senders" &&
      isBlockedEntry(blocks, "domains", senderDomain(entry.value))
    ) {
      return `@${senderDomain(entry.value)} is blocked. Unblock it first.`;
    }
    togglePriority(entry.kind, entry.value);
    return null;
  };

  const addBlocked = (entry: Entry): string | null => {
    const kind: BlockKind = entry.kind;
    if (isBlockedEntry(blocks, kind, entry.value))
      return `${label(entry)} is already blocked.`;
    if (blocks[kind].length >= MAX_BLOCK_ENTRIES)
      return `You can block up to ${MAX_BLOCK_ENTRIES} ${kind}.`;
    const hadPriority = isPriorityEntry(priority, entry.kind, entry.value);
    setBlockedClearingPriority(kind, [entry.value], true);
    if (hadPriority) toast(`${label(entry)} is no longer priority`);
    return null;
  };

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Senders"
        description="Who you marked as priority and who you blocked. Add an address or a whole @domain."
      />

      <section className="space-y-3">
        <SettingsSectionTitle
          title="Priority"
          info="Mail from these senders and domains shows on the Priority card while it is unread. Marking a sender or domain here unblocks it."
        />
        <AddForm
          id="senders-priority"
          placeholder="ana@example.com or @example.com"
          action="Add"
          contacts={contacts}
          taken={(entry) => isPriorityEntry(priority, entry.kind, entry.value)}
          onAdd={addPriority}
        />
        <EntryList
          title="Priority senders"
          entries={priorityEntries}
          onRemove={(entry) => togglePriority(entry.kind, entry.value)}
        />
        {priority.threads.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {priority.threads.length} marked conversation
            {priority.threads.length === 1 ? "" : "s"} not listed here.
          </p>
        )}
      </section>

      <Separator />

      <section className="space-y-3">
        <SettingsSectionTitle
          title="Blocked"
          info="Mail from these senders and domains goes to the Trash. Blocking one takes its priority mark off."
        />
        <AddForm
          id="senders-blocked"
          placeholder="spam@example.com or @example.com"
          action="Block"
          contacts={contacts}
          taken={(entry) => isBlockedEntry(blocks, entry.kind, entry.value)}
          onAdd={addBlocked}
        />
        <EntryList
          title="Blocked senders"
          entries={blockedEntries}
          onRemove={(entry) =>
            setBlockedClearingPriority(entry.kind, [entry.value], false)
          }
        />
      </section>
    </div>
  );
}

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { CircleAlert, X } from "lucide-react";

import { currentToken, entryLabel, searchContacts, type ContactEntry } from "@shared/contacts";
import { logoRequestFor } from "@shared/logos";
import type { Contact } from "@shared/types";

import { contactLabel } from "@/lib/format";
import { isValidAddress, parseRecipients } from "@/lib/compose";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { SenderAvatar } from "./sender-avatar";

interface RecipientFieldProps {
  /** Accessible name, also the row's label. */
  label: string;
  /** The addresses already turned into chips. */
  value: readonly Contact[];
  onChange: (next: Contact[]) => void;
  /** What is typed and not a chip yet. Held by the parent so a draft or a send can include it. */
  text: string;
  onTextChange: (text: string) => void;
  /** Everyone we have exchanged mail with, to suggest from. */
  contacts: readonly ContactEntry[];
  autoFocus?: boolean;
  placeholder?: string;
  /** Shown at the right of the box (the Cc / Bcc toggle). */
  trailing?: React.ReactNode;
}

/** The avatar a recipient gets: their photo or company logo when the settings allow one, else initials. */
function RecipientAvatar({
  contact,
  entry,
  size,
}: {
  contact: Contact;
  entry?: ContactEntry;
  size: number;
}) {
  const logo = useMemo(
    () => logoRequestFor({ from: contact, signal: entry?.signal ?? "person", authenticated: true }),
    [contact, entry?.signal],
  );
  return <SenderAvatar contact={contact} size={size} logo={logo} />;
}

function hasEmail(list: readonly Contact[], email: string): boolean {
  const key = email.toLowerCase();
  return list.some((contact) => contact.email.toLowerCase() === key);
}

/**
 * A recipient box that turns addresses into chips. Typing suggests people we have exchanged mail
 * with (those we wrote to first); Enter or Tab takes the highlighted one, a comma or space starts the next
 * address from scratch (text that is not an address becomes a red chip), and Backspace on an empty box (or on a focused chip) removes a whole chip.
 */
export function RecipientField({
  label,
  value,
  onChange,
  text,
  onTextChange,
  contacts,
  autoFocus,
  placeholder,
  trailing,
}: RecipientFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(0);
  /** Hidden by Esc until the next keystroke changes the text. */
  const [dismissed, setDismissed] = useState(false);

  // A box focused by autoFocus (or by the dialog opening) never fires onFocus, so check once mounted.
  useEffect(() => {
    if (document.activeElement === inputRef.current) setFocused(true);
  }, []);

  const chosen = useMemo(() => new Set(value.map((contact) => contact.email.toLowerCase())), [value]);
  const token = currentToken(text);
  const suggestions = useMemo(
    () => searchContacts(contacts, token, chosen),
    [contacts, token, chosen],
  );
  const open = focused && !dismissed && suggestions.length > 0;
  const active = Math.min(highlight, suggestions.length - 1);
  const entryByEmail = useMemo(
    () => new Map(contacts.map((entry) => [entry.email, entry])),
    [contacts],
  );

  const add = (additions: readonly Contact[]): Contact[] => {
    const next = [...value];
    for (const contact of additions) {
      if (!hasEmail(next, contact.email)) next.push(contact);
    }
    onChange(next);
    return next;
  };

  /**
   * Turns everything in `input` into chips. Whatever is not an address becomes a chip too, shown in
   * red, so it can be seen and removed instead of staying stuck in the box.
   */
  const commitText = (input: string, keepTail = false): string => {
    const cut = keepTail ? Math.max(input.lastIndexOf(","), input.lastIndexOf(";")) : input.length;
    const head = keepTail ? input.slice(0, cut) : input;
    const tail = keepTail ? input.slice(cut + 1).trimStart() : "";
    const { contacts: found, invalid } = parseRecipients(head);
    const chips = [...found, ...invalid.map((text) => ({ name: "", email: text }))];
    if (chips.length > 0) add(chips);
    return tail;
  };

  const pick = (entry: ContactEntry) => {
    // Only the part after the last comma was being searched; anything before it stays as typed.
    const cut = Math.max(text.lastIndexOf(","), text.lastIndexOf(";"));
    onTextChange(cut >= 0 ? text.slice(0, cut + 1).trimEnd() : "");
    add([{ name: entry.name, email: entry.email }]);
    setHighlight(0);
    setDismissed(false);
  };

  const removeAt = (index: number) => {
    onChange(value.filter((_, position) => position !== index));
    inputRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        if (!open) return;
        event.preventDefault();
        setHighlight(
          (active + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length,
        );
        return;
      case "Enter":
      case "Tab":
        if (open && !(event.key === "Tab" && event.shiftKey)) {
          event.preventDefault();
          pick(suggestions[active]);
        } else if (text.trim()) {
          // No suggestion to take: make an address typed out in full into a chip.
          const rest = commitText(text);
          if (rest !== text) {
            event.preventDefault();
            onTextChange(rest);
          } else if (event.key === "Enter") {
            event.preventDefault();
          }
        }
        return;
      case " ":
        // Space ends an address, like a comma. While suggestions are showing it is part of a name
        // being searched ("john smith"), and inside <...> or quotes it is part of the address.
        if (!open && text.trim() && !/[<">]/.test(text)) {
          event.preventDefault();
          onTextChange(commitText(text));
        }
        return;
      case "Escape":
        // Closing the suggestions is all this Esc does; the composer around it must not also close.
        if (open) {
          event.preventDefault();
          setDismissed(true);
        }
        return;
      case "Backspace":
        if (text === "" && value.length > 0) {
          event.preventDefault();
          onChange(value.slice(0, -1));
        }
        return;
    }
  };

  return (
    // Clicking the empty part of the box types into it, like a plain input would.
    <div
      className="relative flex min-h-11 flex-wrap items-center gap-1.5 py-1.5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          inputRef.current?.focus();
        }
      }}
    >
      {value.map((contact, index) => {
        const valid = isValidAddress(contact.email);
        const chip = (
        <span
          key={valid ? contact.email.toLowerCase() : undefined}
          tabIndex={0}
          title={valid ? contact.email : undefined}
          aria-invalid={!valid || undefined}
          aria-label={
            valid
              ? `${contactLabel(contact)} <${contact.email}>. Press Backspace to remove.`
              : `${contact.email}, not a valid email address. Press Backspace to remove.`
          }
          className={cn(
            "corner-squircle group/chip inline-flex h-7 max-w-[260px] items-center gap-1.5 rounded-full plate-3 pl-1 pr-1.5 text-[13px] outline-none transition-colors focus-visible:shadow-raise-3-glow",
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
          {valid ? (
            <RecipientAvatar contact={contact} entry={entryByEmail.get(contact.email.toLowerCase())} size={20} />
          ) : (
            <CircleAlert className="ml-1 size-4 shrink-0" aria-hidden />
          )}
          <span className="min-w-0 truncate">
            {!valid
              ? contact.email
              : contact.name
                ? contactLabel(contact)
                : entryLabel(entryByEmail.get(contact.email.toLowerCase()) ?? contact)}
          </span>
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Remove ${contact.email}`}
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
        if (valid) return chip;
        return (
          <Tooltip key={contact.email.toLowerCase()}>
            <TooltipTrigger asChild>{chip}</TooltipTrigger>
            <TooltipContent side="bottom">This is not a valid email address.</TooltipContent>
          </Tooltip>
        );
      })}

      <input
        ref={inputRef}
        value={text}
        autoFocus={autoFocus}
        aria-label={label}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder={value.length === 0 ? placeholder : undefined}
        className="h-8 min-w-[8rem] flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        onChange={(event) => {
          const raw = event.target.value;
          // Typing proves the box has focus, even when it got it from autoFocus and never saw onFocus.
          setFocused(true);
          setHighlight(0);
          setDismissed(false);
          // A comma or semicolon ends an address: finished ones become chips, and what follows is
          // searched from scratch.
          onTextChange(/[,;]/.test(raw) ? commitText(raw, true) : raw);
        }}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          const rest = commitText(text);
          if (rest !== text) onTextChange(rest);
        }}
      />

      {trailing && <div className="ml-auto shrink-0">{trailing}</div>}

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} suggestions`}
          className="corner-squircle absolute left-0 top-full z-50 mt-1 max-h-64 w-full min-w-[280px] overflow-y-auto rounded-2xl plate-1 p-1.5 text-popover-foreground shadow-overlay"
        >
          {suggestions.map((entry, index) => {
            const contact = { name: entry.name, email: entry.email };
            return (
              <li
                key={entry.email}
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
                onClick={() => pick(entry)}
              >
                <RecipientAvatar contact={contact} entry={entry} size={26} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{entryLabel(entry)}</span>
                  {entryLabel(entry) !== entry.email && (
                    <span className="block truncate text-xs text-muted-foreground">{entry.email}</span>
                  )}
                </span>
                {entry.sentTo > 0 && (
                  <span className="shrink-0 text-[11px] text-muted-foreground">Contacted</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Search, X } from "lucide-react";

import { accountLabel } from "@shared/accounts";
import { entryLabel, searchContacts, searchOwnAddresses } from "@shared/contacts";
import {
  applySuggestion,
  chipText,
  joinSearch,
  splitSearch,
  suggestSearch,
  type SearchChip,
  type SearchField,
  type SearchValueDef,
} from "@shared/search-query";
import type { Account, Category } from "@shared/types";

import { useContactIndex } from "@/hooks/use-contact-index";
import { useRecentSearches } from "@/hooks/use-recent-searches";
import { cn } from "@/lib/utils";

/** One line of the list under the box: a field (`from:`) or a value for the field being typed. */
interface Choice {
  key: string;
  label: string;
  /** Smaller, muted text after the label. */
  hint: string;
  pick?: { field: SearchField; value?: string };
  /** A search typed before: picking it puts it back in the box. */
  recent?: string;
}

interface SearchBoxProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange: (query: string) => void;
  /** Esc, or the X: clear the search and close the box. */
  onClose: () => void;
  /** Down with no list open: the keyboard moves on to the first item of the list. */
  onEnterList: () => void;
  categories: readonly Category[];
  accounts: readonly Account[];
}

/**
 * The list's search box. Typing "/" opens the fields that can be searched (`from:`, `is:`, `after:`…),
 * and a field that is being typed offers its values: people for from and to, a fixed set or the
 * user's own names for the others. A finished filter (a space follows it) becomes a chip; click a
 * chip, or press Backspace in the empty box, to turn it back into text and edit it, and × removes it.
 *
 * Focusing the empty box lists the searches typed before (newest first, each once); one click puts it back.
 *
 * The text stays the one source of truth: the chips are read out of `query` (`splitSearch`) and written
 * back into it (`joinSearch`), so a search set from elsewhere shows up as chips too. See
 * `shared/search-query.ts` for how it is read.
 */
export function SearchBox({ inputRef, query, onQueryChange, onClose, onEnterList, categories, accounts }: SearchBoxProps) {
  const contacts = useContactIndex();
  const { chips, draft } = useMemo(() => splitSearch(query), [query]);
  const [caret, setCaret] = useState(draft.length);
  const [highlight, setHighlight] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [focused, setFocused] = useState(false);
  const { recent, remember } = useRecentSearches();
  /** The recent search the arrow keys are on; -1 until they are used, so Enter in the empty box does nothing. */
  const [recentHighlight, setRecentHighlight] = useState(-1);
  // The newest text of the box, for the searches that end without a blur (the box closing, Esc).
  const latestQuery = useRef(query);
  latestQuery.current = query;
  /** Where the cursor goes once the text a change wrote has been rendered. */
  const nextCaret = useRef<number | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  // Fields that depend on the mailbox are offered only when there is something to pick from.
  const extra = useMemo<Partial<Record<SearchField, readonly SearchValueDef[]>>>(
    () => ({
      category: [...categories.map((category) => ({ value: category.name, hint: "" })), { value: "none", hint: "No category" }],
      account: accounts.length > 1 ? accounts.map((account) => ({ value: account.email, hint: account.alias ? accountLabel(account) : "" })) : [],
    }),
    [categories, accounts],
  );

  const suggestions = useMemo(() => (focused && !dismissed ? suggestSearch(draft, caret, extra) : null), [focused, dismissed, draft, caret, extra]);

  const showRecent = focused && !dismissed && query.trim() === "" && recent.length > 0;

  const choices = useMemo<Choice[]>(() => {
    if (showRecent) return recent.map((text) => ({ key: text, label: text, hint: "", recent: text }));
    if (!suggestions) return [];
    if (suggestions.kind === "fields") {
      return suggestions.fields.map((field) => ({
        key: field.name,
        label: `${field.name}:`,
        hint: field.hint,
        pick: { field: field.name },
      }));
    }
    const { field, prefix } = suggestions;
    if (field === "from" || field === "to") {
      // The user's own accounts come first: the contact index leaves them out, yet mail from or to
      // one account of another is worth finding.
      const own = searchOwnAddresses(accounts, suggestions.typed).map((entry) => ({
        key: entry.email.toLowerCase(),
        label: entry.label,
        hint: entry.hint,
        pick: { field, value: prefix + entry.email },
      }));
      const ownKeys = new Set(own.map((choice) => choice.key));
      const people = searchContacts(contacts, suggestions.typed)
        .filter((entry) => !ownKeys.has(entry.email.toLowerCase()))
        .map((entry) => ({
          key: entry.email,
          label: entryLabel(entry),
          hint: entryLabel(entry) === entry.email ? "" : entry.email,
          pick: { field, value: prefix + entry.email },
        }));
      return [...own, ...people];
    }
    return suggestions.values.map((value) => ({
      key: value.value,
      label: value.value,
      hint: value.hint,
      pick: { field, value: prefix + value.value },
    }));
  }, [showRecent, recent, suggestions, contacts, accounts]);

  const open = choices.length > 0;
  const active = showRecent ? recentHighlight : Math.min(highlight, Math.max(choices.length - 1, 0));

  // A search that was typed is remembered when the box goes away without a blur (it closes, or the page leaves the list).
  useEffect(
    () => () => {
      remember(latestQuery.current);
    },
    [remember],
  );

  // The caret is read after every change of the text: the box may have rewritten it (a word that
  // became a chip leaves the rest of the text), and a suggestion says where the cursor should go.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const position = nextCaret.current;
    nextCaret.current = null;
    if (position !== null) input.setSelectionRange(position, position);
    setCaret(input.selectionStart ?? input.value.length);
  }, [query, inputRef]);

  // Keep the newest chips and the cursor in view when they outgrow the box.
  useEffect(() => {
    const row = rowRef.current;
    if (row) row.scrollLeft = row.scrollWidth;
  }, [chips.length]);

  /** Writes new chips and text. `position` is the cursor in `text`; text that became a chip leaves the cursor at the end of what remains. */
  const change = (nextChips: readonly SearchChip[], text: string, position: number, refocus: boolean) => {
    const joined = joinSearch(nextChips, text);
    nextCaret.current = splitSearch(joined).draft === text ? position : null;
    setHighlight(0);
    setRecentHighlight(-1);
    setDismissed(false);
    onQueryChange(joined);
    if (refocus) inputRef.current?.focus();
  };

  const pick = (choice: Choice) => {
    if (choice.recent !== undefined) {
      // The trailing space finishes the last word, so a filter at the end comes back as a chip.
      const text = `${choice.recent} `;
      change([], text, text.length, true);
      return;
    }
    if (!suggestions || !choice.pick) return;
    const next = applySuggestion(draft, suggestions.token, choice.pick);
    change(chips, next.text, next.caret, true);
  };

  /** Turns a chip back into text, after what is already typed, so it can be edited like any word. */
  const editChip = (index: number) => {
    const rest = chips.filter((_, i) => i !== index);
    const text = (draft.trim() === "" ? "" : draft.replace(/\s*$/, " ")) + chipText(chips[index]);
    change(rest, text, text.length, true);
  };

  return (
    // A fixed width, as the plain box had: the header has no room to spare, so chips scroll inside it.
    <div className="electron-no-drag relative w-72">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <div
        className="corner-squircle flex h-9 items-center rounded-xl bg-transparent pl-8 pr-8 text-sm shadow-raise-1 transition-shadow focus-within:shadow-raise-1-glow"
        // Clicking the empty part of the box types into it, like a plain input would.
        onMouseDown={(event) => {
          if (event.target === event.currentTarget || event.target === rowRef.current) {
            event.preventDefault();
            inputRef.current?.focus();
          }
        }}
      >
        <div ref={rowRef} className="scrollbar-hide flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {chips.map((chip, index) => (
            <span
              key={`${index}:${chipText(chip)}`}
              className="corner-squircle inline-flex h-6 max-w-[9rem] shrink-0 items-center rounded-full plate-3 pl-2 pr-1 text-[13px]"
            >
              <button
                type="button"
                tabIndex={-1}
                title={`${chip.field}: ${chip.value} (click to edit)`}
                aria-label={`Edit ${chip.field}: ${chip.value}`}
                className="flex min-w-0 items-center gap-1 outline-none"
                // Keep focus in the box, or its blur would end the word being typed.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => editChip(index)}
              >
                <span className="shrink-0 text-muted-foreground">{chip.field}:</span>
                <span className="truncate">{chip.value}</span>
              </button>
              <button
                type="button"
                tabIndex={-1}
                aria-label={`Remove ${chip.field}: ${chip.value}`}
                className="ml-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-shadow hover:shadow-pressed hover:text-foreground"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => change(chips.filter((_, i) => i !== index), draft, draft.length, true)}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            value={draft}
            placeholder={chips.length === 0 ? "Search mail, or / for filters" : undefined}
            aria-label="Search mail"
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            aria-controls="search-suggestions"
            aria-activedescendant={open ? `search-suggestion-${active}` : undefined}
            autoComplete="off"
            spellCheck={false}
            className="h-8 min-w-[4.5rem] flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
            onFocus={() => {
              setFocused(true);
              setDismissed(false);
            }}
            onBlur={() => {
              setFocused(false);
              remember(query);
              // The word being typed is finished: `from:alice` becomes a chip.
              const finished = splitSearch(`${query} `);
              if (finished.chips.length > chips.length) onQueryChange(`${query} `);
            }}
            onChange={(event) => change(chips, event.target.value, event.target.selectionStart ?? event.target.value.length, false)}
            // The cursor moving by arrow or click changes which word the list is for.
            onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
            onKeyDown={(event) => {
              const plain = !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
              if (event.key === "Escape") {
                event.stopPropagation();
                // With the list open Esc only closes it; the next one clears the search.
                if (open) {
                  event.preventDefault();
                  setDismissed(true);
                } else {
                  remember(query);
                  onClose();
                }
              } else if (showRecent && plain && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                event.preventDefault();
                setRecentHighlight(Math.max(-1, Math.min(active + (event.key === "ArrowDown" ? 1 : -1), choices.length - 1)));
              } else if (showRecent && plain && event.key === "Enter" && active >= 0) {
                event.preventDefault();
                pick(choices[active]);
              } else if (open && !showRecent && plain && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                event.preventDefault();
                setHighlight((active + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length);
              } else if (open && !showRecent && plain && (event.key === "Enter" || event.key === "Tab")) {
                event.preventDefault();
                pick(choices[active]);
              } else if (event.key === "Backspace" && plain && draft === "" && chips.length > 0) {
                // Backspace in the empty box takes the last chip back into the text to edit it.
                event.preventDefault();
                editChip(chips.length - 1);
              } else if (event.key === "ArrowDown" && plain) {
                // Leave the box (the search stays open and filtered) for the first row.
                event.preventDefault();
                event.currentTarget.blur();
                onEnterList();
              }
            }}
          />
        </div>
      </div>
      <button
        type="button"
        aria-label="Close search"
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        onClick={onClose}
      >
        <X className="size-4" />
      </button>

      {open && (
        <ul
          id="search-suggestions"
          role="listbox"
          aria-label={showRecent ? "Recent searches" : "Search filters"}
          className="corner-squircle absolute right-0 top-full z-50 mt-1 max-h-72 w-max min-w-80 max-w-[min(36rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl plate-1 p-1.5 text-popover-foreground shadow-overlay"
        >
          {showRecent && (
            <li role="presentation" className="px-2 pb-1 pt-0.5 text-xs font-medium text-muted-foreground">
              Recent searches
            </li>
          )}
          {choices.map((choice, index) => (
            <li
              key={choice.key}
              id={`search-suggestion-${index}`}
              role="option"
              aria-selected={index === active}
              className={cn(
                // The address sits beside the name while both fit, and under it when they do not.
                "corner-squircle flex cursor-default flex-wrap items-baseline gap-x-2 rounded-[10px] px-2 py-1.5 text-sm",
                index === active && "plate-2",
              )}
              // Keep focus in the box, or its blur would close the list before the click lands.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => (showRecent ? setRecentHighlight(index) : setHighlight(index))}
              onClick={() => pick(choice)}
            >
              <span className="max-w-full truncate font-medium">{choice.label}</span>
              {choice.hint && <span className="max-w-full truncate text-xs text-muted-foreground">{choice.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

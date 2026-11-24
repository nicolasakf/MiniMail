import type { MailFolder, MessageSummary } from "./types";

/**
 * The search box's field filters (`from:alice`, `is:unread`, `after:2026-01-01`), written by hand or
 * picked from the list that "/" opens. Plain words still match anywhere, as they always did.
 *
 * - Different fields must all match.
 * - The same text field twice (`from:alice from:bob`) means either one.
 * - `is`, `has`, `after` and `before` are conditions: each one that is given must hold.
 * - Commas inside a value list alternatives: `from:alice,bob` is either one, `is:unread,pinned` too.
 *   Quotes turn that off (`from:"Smith, John"`).
 * - A value may follow the colon after a space: `from: alice` is `from:alice`.
 * - A filter with no value yet (`from:`) or a half-typed command (`/fr`) changes nothing, so the
 *   list does not go blank while the person is still typing.
 *
 * In the search box a finished filter is shown as a chip; `splitSearch` and `joinSearch` turn the
 * text into chips and back, so the text stays the one source of truth.
 */

export type SearchField = "from" | "to" | "subject" | "has" | "is" | "in" | "category" | "account" | "after" | "before";

export interface SearchFieldDef {
  name: SearchField;
  /** What the field matches, shown beside its name in the "/" list. */
  hint: string;
  /** The values it accepts when they are a fixed set; absent for free text and for lists that depend on the mailbox. */
  values?: readonly SearchValueDef[];
}

export interface SearchValueDef {
  value: string;
  hint: string;
}

const FOLDERS: readonly (readonly [Exclude<MailFolder, "pinned">, string])[] = [
  ["inbox", "In the Inbox"],
  ["archive", "Archived"],
  ["sent", "Sent by you"],
  ["drafts", "Drafts"],
  ["spam", "Reported as spam"],
  ["trash", "In the Trash"],
];

const DATES: readonly SearchValueDef[] = [
  { value: "today", hint: "Since midnight" },
  { value: "yesterday", hint: "Since yesterday's midnight" },
  { value: "week", hint: "7 days ago" },
  { value: "month", hint: "A month ago" },
  { value: "year", hint: "A year ago" },
];

/** Every field, in the order the "/" list shows them. */
export const SEARCH_FIELDS: readonly SearchFieldDef[] = [
  { name: "from", hint: "Who sent it" },
  { name: "to", hint: "Who it was sent to" },
  { name: "subject", hint: "Words in the subject" },
  {
    name: "has",
    hint: "A file or an invitation",
    values: [
      { value: "file", hint: "A file is attached" },
      { value: "invitation", hint: "A calendar invitation" },
    ],
  },
  {
    name: "is",
    hint: "Unread, pinned, priority…",
    values: [
      { value: "unread", hint: "Not read yet" },
      { value: "read", hint: "Already read" },
      { value: "pinned", hint: "Pinned" },
      { value: "replied", hint: "You replied to it" },
      { value: "priority", hint: "From a priority sender or conversation" },
    ],
  },
  { name: "in", hint: "Which folder", values: FOLDERS.map(([value, hint]) => ({ value, hint })) },
  { name: "category", hint: "Which category" },
  { name: "account", hint: "Which account" },
  { name: "after", hint: "On or after a date", values: DATES },
  { name: "before", hint: "Before a date", values: DATES },
];

const FIELD_NAMES = new Set<string>(SEARCH_FIELDS.map((field) => field.name));

export function searchField(name: string): SearchFieldDef | undefined {
  return SEARCH_FIELDS.find((field) => field.name === name.toLowerCase());
}

/** One whitespace-separated piece of the box, with its place in the text. Quotes keep spaces together and are dropped from `text`. */
export interface SearchToken {
  start: number;
  end: number;
  text: string;
  /** The word had quotes: its commas are part of it. */
  quoted: boolean;
}

/** Splits the text into words. A field with no value (`from:`) takes the word after it (`from: alice`) as its value. */
export function tokenizeSearch(input: string): SearchToken[] {
  const words = splitWords(input);
  const tokens: SearchToken[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const next = words[i + 1];
    if (next && isEmptyFilter(word.text) && !next.text.startsWith("/") && !splitFilter(next.text)) {
      tokens.push({ start: word.start, end: next.end, text: word.text + next.text, quoted: word.quoted || next.quoted });
      i += 1;
    } else tokens.push(word);
  }
  return tokens;
}

function isEmptyFilter(text: string): boolean {
  const colon = text.indexOf(":");
  return colon > 0 && colon === text.length - 1 && FIELD_NAMES.has(text.slice(0, colon).toLowerCase());
}

function splitWords(input: string): SearchToken[] {
  const tokens: SearchToken[] = [];
  let i = 0;
  while (i < input.length) {
    if (/\s/.test(input[i])) {
      i += 1;
      continue;
    }
    const start = i;
    let text = "";
    let inQuotes = false;
    let quoted = false;
    while (i < input.length && (inQuotes || !/\s/.test(input[i]))) {
      if (input[i] === '"') {
        inQuotes = !inQuotes;
        quoted = true;
      } else text += input[i];
      i += 1;
    }
    tokens.push({ start, end: i, text, quoted });
  }
  return tokens;
}

export interface SearchFilter {
  field: SearchField;
  /** Lower case. The message passes when it matches any of them. */
  values: string[];
}

/** The alternatives a value stands for: `alice,bob` is two, unless it was quoted. */
function valueList(value: string, quoted: boolean): string[] {
  const parts = quoted ? [value] : value.split(",");
  return parts.map((part) => part.trim().toLowerCase()).filter(Boolean);
}

export interface SearchQuery {
  /** Plain words (or quoted phrases), lower case. Each must appear somewhere in the message. */
  words: string[];
  filters: SearchFilter[];
}

/** Splits `field:value` at the first colon; null when the part before it is not a field. */
function splitFilter(token: string): { field: SearchField; value: string } | null {
  const colon = token.indexOf(":");
  if (colon <= 0) return null;
  const name = token.slice(0, colon).toLowerCase();
  if (!FIELD_NAMES.has(name)) return null;
  return { field: name as SearchField, value: token.slice(colon + 1) };
}

export function parseSearch(input: string): SearchQuery {
  const query: SearchQuery = { words: [], filters: [] };
  for (const { text, quoted } of tokenizeSearch(input)) {
    if (/^\/[a-z]*$/i.test(text)) continue; // a command still being typed
    const filter = splitFilter(text);
    if (filter) {
      const values = valueList(filter.value, quoted);
      if (values.length > 0) query.filters.push({ field: filter.field, values });
      continue;
    }
    query.words.push(text.toLowerCase());
  }
  return query;
}

export function isEmptySearch(query: SearchQuery): boolean {
  return query.words.length === 0 && query.filters.length === 0;
}

/** What a filter needs to know about the mailbox; every part is optional, and a missing one matches nothing. */
export interface SearchLookups {
  /** The address of an account, for `account:`. */
  accountNames?: (accountId: string) => string;
  /** The name of a category, for `category:`. */
  categoryName?: (categoryId: string) => string;
  /** Whether the message counts as priority, for `is:priority`. */
  isPriority?: (message: MessageSummary) => boolean;
  /** The clock, for `after:today` and the like. */
  now?: Date;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * The moment (ms) a date value stands for, in local time: `today`, `yesterday`, `week`, `month`,
 * `year` (that long ago, from midnight) or `YYYY-MM-DD`. Null when it is not a date, such as
 * `2026-1` typed halfway.
 */
export function parseSearchDate(value: string, now: Date = new Date()): number | null {
  const today = startOfDay(now);
  switch (value.toLowerCase()) {
    case "today":
      return today.getTime();
    case "yesterday":
      return new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).getTime();
    case "week":
      return new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7).getTime();
    case "month":
      return new Date(today.getFullYear(), today.getMonth() - 1, today.getDate()).getTime();
    case "year":
      return new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()).getTime();
  }
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  // 2026-02-31 would roll over into March; it is not a date.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date.getTime();
}

function contactText(contact: { name: string; email: string }): string {
  return `${contact.name} ${contact.email}`.toLowerCase();
}

/** Whether a message passes one filter. A value the filter cannot read (a half-typed date) lets everything through. */
function passes(message: MessageSummary, filter: SearchFilter, lookups: SearchLookups): boolean {
  return filter.values.some((value) => passesValue(message, filter.field, value, lookups));
}

function passesValue(message: MessageSummary, field: SearchField, value: string, lookups: SearchLookups): boolean {
  switch (field) {
    case "from":
      return contactText(message.from).includes(value);
    case "to":
      return message.to.some((contact) => contactText(contact).includes(value));
    case "subject":
      return message.subject.toLowerCase().includes(value);
    case "has":
      // `attachment` is what the filter was first called, and is still read.
      if (value === "file" || value === "files" || value.startsWith("attach")) return message.hasAttachments;
      if (value.startsWith("invit")) return message.signal === "invitation";
      return true;
    case "is":
      switch (value) {
        case "unread":
          return message.unread;
        case "read":
          return !message.unread;
        case "pinned":
          return message.pinned;
        case "replied":
          return message.answered;
        case "priority":
          return lookups.isPriority?.(message) ?? false;
        default:
          return false;
      }
    case "in":
      return message.folder.startsWith(value);
    case "category":
      if (value === "none") return message.categoryId === null;
      return message.categoryId !== null && (lookups.categoryName?.(message.categoryId) ?? "").toLowerCase().includes(value);
    case "account":
      return (lookups.accountNames?.(message.accountId) ?? "").toLowerCase().includes(value);
    case "after":
    case "before": {
      const limit = parseSearchDate(value, lookups.now);
      if (limit === null) return true;
      const sent = Date.parse(message.date);
      return field === "after" ? sent >= limit : sent < limit;
    }
  }
}

/** Fields whose repeats are alternatives; for the others each filter given must hold. */
const ALTERNATIVES = new Set<SearchField>(["from", "to", "subject", "in", "category", "account"]);

export function matchesSearch(message: MessageSummary, query: SearchQuery, lookups: SearchLookups = {}): boolean {
  if (query.words.length > 0) {
    const haystack = [
      message.subject,
      message.from.name,
      message.from.email,
      message.snippet,
      ...message.to.map((contact) => `${contact.name} ${contact.email}`),
    ]
      .join(" ")
      .toLowerCase();
    if (!query.words.every((word) => haystack.includes(word))) return false;
  }

  const byField = new Map<SearchField, SearchFilter[]>();
  for (const filter of query.filters) byField.set(filter.field, [...(byField.get(filter.field) ?? []), filter]);
  for (const [field, filters] of byField) {
    const ok = ALTERNATIVES.has(field)
      ? filters.some((filter) => passes(message, filter, lookups))
      : filters.every((filter) => passes(message, filter, lookups));
    if (!ok) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// The suggestion list under the box
// ---------------------------------------------------------------------------------------------

/** What the list under the box offers for the word the cursor is in. */
export type SearchSuggestions =
  /** Typing "/…": the fields, narrowed by what follows the slash. */
  | { kind: "fields"; token: SearchToken; fields: SearchFieldDef[] }
  /** Typing `field:…`: values for that field. `free` fields (from, to, subject) get theirs from the caller. */
  | {
      kind: "values";
      token: SearchToken;
      field: SearchField;
      /** The value being typed: the part after the last comma. */
      typed: string;
      /** The values before it, with their comma (`alice,`), which a picked value goes after. */
      prefix: string;
      values: SearchValueDef[];
    };

/** The word the cursor is in, or null when it is between words. A cursor at the end of a word is in it. */
export function tokenAt(input: string, caret: number): SearchToken | null {
  return tokenizeSearch(input).find((token) => caret >= token.start && caret <= token.end) ?? null;
}

/**
 * What to suggest for the text in the box. `extra` supplies the values that depend on the mailbox
 * (category names, account addresses); a field that has none and no fixed values is left out of
 * the "/" list, so it never offers nothing.
 */
export function suggestSearch(
  input: string,
  caret: number,
  extra: Partial<Record<SearchField, readonly SearchValueDef[]>> = {},
): SearchSuggestions | null {
  const token = tokenAt(input, caret);
  if (!token) return null;
  const raw = input.slice(token.start, token.end);

  if (raw.startsWith("/")) {
    const typed = raw.slice(1).toLowerCase();
    const fields = SEARCH_FIELDS.filter((field) => {
      const dependent = field.name === "category" || field.name === "account";
      return (!dependent || (extra[field.name]?.length ?? 0) > 0) && field.name.startsWith(typed);
    });
    return fields.length > 0 ? { kind: "fields", token, fields } : null;
  }

  const filter = splitFilter(token.text);
  if (!filter) return null;
  // In `from:alice,bo` the list is for "bo"; a quoted value is one piece, commas and all.
  const comma = token.quoted ? -1 : filter.value.lastIndexOf(",");
  const prefix = filter.value.slice(0, comma + 1);
  const typed = filter.value.slice(comma + 1).trim();
  const fixed = searchField(filter.field)?.values ?? extra[filter.field] ?? [];
  const lower = typed.toLowerCase();
  const values = fixed.filter((value) => value.value.toLowerCase().startsWith(lower) && value.value.toLowerCase() !== lower);
  return { kind: "values", token, field: filter.field, typed, prefix, values };
}

/** The text of a field filter, quoted when the value has spaces (or was quoted, so its commas stay). */
export function filterText(field: SearchField, value: string, quoted = false): string {
  return quoted || /\s/.test(value) ? `${field}:"${value}"` : `${field}:${value}`;
}

/** A finished filter, as the search box shows it: a chip. */
export interface SearchChip {
  field: SearchField;
  /** As written, case and commas kept (`alice@x.com,bob`). */
  value: string;
  quoted: boolean;
}

export function chipText(chip: SearchChip): string {
  return filterText(chip.field, chip.value, chip.quoted);
}

/**
 * Splits the box's text into chips and what is still text. A filter is finished (a chip) once a
 * space follows it and it has a value; the word being typed at the end stays text, and so does
 * anything that is not a filter (plain words, `from:` with no value, a half-typed "/" command).
 * The text it returns is the original with the chips cut out, so typing in it is undisturbed.
 */
export function splitSearch(query: string): { chips: SearchChip[]; draft: string } {
  const chips: SearchChip[] = [];
  const spans: SearchToken[] = [];
  for (const token of tokenizeSearch(query)) {
    if (token.end === query.length) continue; // the word still being typed
    const filter = splitFilter(token.text);
    const value = filter?.value.trim();
    if (!filter || !value) continue;
    chips.push({ field: filter.field, value, quoted: token.quoted });
    spans.push(token);
  }
  if (chips.length === 0) return { chips, draft: query };

  let draft = query;
  for (const token of [...spans].reverse()) {
    let end = token.end;
    while (end < draft.length && /\s/.test(draft[end])) end += 1;
    draft = draft.slice(0, token.start) + draft.slice(end);
  }
  if (draft.trim() === "") return { chips, draft: "" };
  // "invoice from:x " leaves "invoice": the space the person typed after the word stays.
  if (/\s$/.test(query) && !/\s$/.test(draft)) draft += " ";
  return { chips, draft };
}

/** The text for chips followed by text: what `splitSearch` takes apart. */
export function joinSearch(chips: readonly SearchChip[], draft: string): string {
  return chips.length === 0 ? draft : `${chips.map(chipText).join(" ")} ${draft}`;
}

/**
 * The box's text after the user took a suggestion for `token`, and where the cursor goes. A field
 * becomes `from:` and waits for its value; a value becomes `from:alice@x.com ` and the cursor moves
 * on to the next word.
 */
export function applySuggestion(
  input: string,
  token: SearchToken,
  replacement: { field: SearchField; value?: string },
): { text: string; caret: number } {
  const piece = replacement.value === undefined ? `${replacement.field}:` : `${filterText(replacement.field, replacement.value)} `;
  const before = input.slice(0, token.start);
  // After a value the word is finished, so the space it brings replaces the one that was there.
  const rest = input.slice(token.end);
  const after = replacement.value === undefined ? rest : rest.replace(/^\s+/, "");
  const text = `${before}${piece}${after}`;
  return { text, caret: before.length + piece.length };
}

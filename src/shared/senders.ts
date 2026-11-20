import type { BlockList } from "./blocklist";
import { senderDomain } from "./categories";
import { normalizeMutedSender } from "./notifications";
import type { PriorityList } from "./priority";

/** The three lists a sender or a domain can be on. */
export type SenderStatus = "priority" | "muted" | "blocked";

export const SENDER_STATUSES: readonly SenderStatus[] = ["priority", "muted", "blocked"];

export type SenderEntryKind = "senders" | "domains";

/** A sender address or a whole domain, as the Senders page lists it. */
export interface SenderEntry {
  kind: SenderEntryKind;
  value: string;
}

/** One line of the Senders page: an address or a domain, with every list it is on. */
export interface SenderRow extends SenderEntry {
  /** What the row shows: the address, or `@domain`. */
  label: string;
  priority: boolean;
  muted: boolean;
  blocked: boolean;
}

export type SenderFilter = "all" | SenderStatus;

/** What a box on the Senders page shows for an entry: the address, or `@domain` for a whole domain. */
export function senderLabel(entry: SenderEntry): string {
  return entry.kind === "domains" ? `@${entry.value}` : entry.value;
}

/** Reads what the user typed: an address, or a whole domain written `@example.com`. Null when it is neither. */
export function parseSenderEntry(input: string): SenderEntry | null {
  const normalized = normalizeMutedSender(input);
  if (!normalized) return null;
  if (normalized.startsWith("@")) return { kind: "domains", value: senderDomain(normalized) };
  return { kind: "senders", value: normalized };
}

/**
 * Reads what was typed or pasted into the add box: any number of addresses or domains, separated by
 * commas, semicolons, spaces or lines. `Ana Silva <ana@example.com>` counts as `ana@example.com`. Each
 * entry comes once; text that is neither an address nor a domain is returned as it was written.
 */
export function parseSenderList(input: string): { entries: SenderEntry[]; invalid: string[] } {
  const entries = new Map<string, SenderEntry>();
  const invalid = new Map<string, string>();
  const plain = input
    .replace(/"/g, "")
    // A display name before an address in angle brackets goes; a name never contains an @ or starts inside an address.
    .replace(/(?<![^\s,;])[^\s,;<>@]+(?:[ \t]+[^\s,;<>@]+)*[ \t]*<([^<>]+)>/g, " $1 ");
  for (const raw of plain.split(/[\s,;]+/)) {
    const token = raw.replace(/^<+|>+$/g, "");
    if (!token) continue;
    const entry = parseSenderEntry(token);
    if (entry) entries.set(senderLabel(entry), entry);
    else if (!invalid.has(token.toLowerCase())) invalid.set(token.toLowerCase(), token);
  }
  // A few words with no address in them and no separator ("john smith") are one thing that is not an address.
  if (entries.size === 0 && invalid.size > 1 && !/[,;\n]/.test(input)) return { entries: [], invalid: [input.trim()] };
  return { entries: [...entries.values()], invalid: [...invalid.values()] };
}

/** The domain a row belongs to: its own for a domain, the address's for a sender. */
function rowDomain(entry: SenderEntry): string {
  return entry.kind === "domains" ? entry.value : (entry.value.split("@")[1] ?? "");
}

/**
 * Every sender and domain that is priority, muted or blocked, once each. They are sorted by domain, a
 * domain's own row ahead of the addresses at it, so a company and its people sit together and a row
 * never moves because something else changed (the lists keep no dates to sort by).
 * `muted` holds the muted entries as the notification settings store them (`a@b.c`, `@b.c`).
 */
export function buildSenderRows(
  priority: Pick<PriorityList, "senders" | "domains">,
  blocks: BlockList,
  muted: readonly string[],
): SenderRow[] {
  const rows = new Map<string, SenderRow>();

  const note = (entry: SenderEntry, status: SenderStatus) => {
    const label = senderLabel(entry);
    const row = rows.get(label) ?? { ...entry, label, priority: false, muted: false, blocked: false };
    row[status] = true;
    rows.set(label, row);
  };
  const walk = (values: readonly string[], kind: SenderEntryKind, status: SenderStatus) =>
    values.forEach((value) => note({ kind, value }, status));

  walk(priority.domains, "domains", "priority");
  walk(priority.senders, "senders", "priority");
  walk(blocks.domains, "domains", "blocked");
  walk(blocks.senders, "senders", "blocked");
  walk(muted.filter((key) => key.startsWith("@")).map((key) => key.slice(1)), "domains", "muted");
  walk(muted.filter((key) => !key.startsWith("@")), "senders", "muted");

  return [...rows.values()].sort(
    (a, b) =>
      rowDomain(a).localeCompare(rowDomain(b)) || Number(b.kind === "domains") - Number(a.kind === "domains") || a.label.localeCompare(b.label),
  );
}

/** The rows on one list (or all of them) whose name contains what was typed. */
export function filterSenderRows(rows: readonly SenderRow[], filter: SenderFilter, query: string): SenderRow[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => (filter === "all" || row[filter]) && (needle === "" || row.label.includes(needle)));
}

/** How many rows each filter shows. */
export function countSenderRows(rows: readonly SenderRow[]): Record<SenderFilter, number> {
  return {
    all: rows.length,
    priority: rows.filter((row) => row.priority).length,
    muted: rows.filter((row) => row.muted).length,
    blocked: rows.filter((row) => row.blocked).length,
  };
}

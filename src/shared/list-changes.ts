import type { AccountError, ListChange, MessageSummary } from "./types";

/**
 * What a fresh list changed compared to the copy kept before it: conversations downloaded now,
 * conversations whose read or pinned state moved, and conversations the server dropped. Only the
 * mail inside the fresh window can be dropped; older rows were never looked at.
 */
export function diffList(
  accountId: string,
  before: readonly MessageSummary[],
  after: readonly MessageSummary[],
): ListChange {
  const old = new Map(before.map((row) => [row.id, row]));
  const now = new Set(after.map((row) => row.id));
  let added = 0;
  let updated = 0;
  for (const row of after) {
    const previous = old.get(row.id);
    if (!previous) added += 1;
    else if (previous.unread !== row.unread || previous.pinned !== row.pinned) updated += 1;
  }
  const oldest = after.length > 0 ? Math.min(...after.map((row) => Date.parse(row.date))) : -Infinity;
  const removed = before.filter((row) => !now.has(row.id) && Date.parse(row.date) >= oldest).length;
  return { accountId, added, updated, removed };
}

type Counts = Pick<ListChange, "added" | "updated" | "removed">;

function describe(change: Counts): string {
  const parts = [
    change.added > 0 ? `${change.added} new` : "",
    change.updated > 0 ? `${change.updated} updated` : "",
    change.removed > 0 ? `${change.removed} removed` : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "nothing new";
}

/**
 * The one Log line for a refresh the person asked for. The title has the totals; the account
 * addresses are private, so the per-account breakdown goes in `context`.
 */
export function refreshSummary(
  changes: readonly ListChange[],
  errors: readonly AccountError[],
  labelOf: (accountId: string) => string,
): { title: string; context: string } {
  const perAccount = new Map<string, Counts>();
  const sum: Counts = { added: 0, updated: 0, removed: 0 };
  for (const change of changes) {
    const total = perAccount.get(change.accountId) ?? { added: 0, updated: 0, removed: 0 };
    for (const key of ["added", "updated", "removed"] as const) {
      total[key] += change[key];
      sum[key] += change[key];
    }
    perAccount.set(change.accountId, total);
  }
  const failed = new Set(errors.map((error) => error.accountId).filter(Boolean));
  const ids = [...new Set([...perAccount.keys(), ...failed])];
  const context = ids
    .map((id) => {
      const total = perAccount.get(id);
      const text = !failed.has(id) ? describe(total!) : total ? `${describe(total)}, then failed` : "could not sync";
      return `${labelOf(id)}: ${text}`;
    })
    .join(" · ");
  const noun = ids.length === 0 ? "" : ids.length === 1 ? " 1 account" : ` ${ids.length} accounts`;
  const failure = failed.size > 0 ? ` (${failed.size} could not sync)` : "";
  return { title: `Refreshed${noun}: ${describe(sum)}${failure}`, context };
}

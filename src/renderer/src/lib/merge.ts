import type { AccountError, MessageSummary } from "@shared/types";

/**
 * Combines per-account answers into one list while some accounts are still loading.
 *
 * Each target account contributes the first source that has it: usually the live answer, then
 * the copy from disk, and finally whatever was already on screen. So a slow or failing account
 * never makes the rows we already have disappear while the others arrive.
 */
export function mergeAccountRows(
  targets: readonly string[],
  sources: ReadonlyArray<ReadonlyMap<string, readonly MessageSummary[]>>,
  onScreen: readonly MessageSummary[],
): MessageSummary[] {
  const rows: MessageSummary[] = [];
  for (const accountId of targets) {
    const source = sources.find((candidate) => candidate.has(accountId));
    rows.push(...(source ? source.get(accountId)! : onScreen.filter((m) => m.accountId === accountId)));
  }
  return rows.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

/** Replaces the errors of the accounts that just answered and keeps those of the ones still pending. */
export function mergeErrors(
  previous: readonly AccountError[],
  answered: ReadonlyMap<string, readonly AccountError[]>,
): AccountError[] {
  return [
    ...previous.filter((error) => !answered.has(error.accountId)),
    ...[...answered.values()].flat(),
  ];
}

/** Groups rows by account, for seeding a source map from a list that mixes accounts. */
export function groupByAccount(rows: readonly MessageSummary[]): Map<string, MessageSummary[]> {
  const groups = new Map<string, MessageSummary[]>();
  for (const row of rows) {
    const bucket = groups.get(row.accountId);
    if (bucket) bucket.push(row);
    else groups.set(row.accountId, [row]);
  }
  return groups;
}

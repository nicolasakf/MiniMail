import { parseMessageId } from "@shared/ids";
import type { ListQuery, ListResult, MailFolder, MessageSummary } from "@shared/types";

/**
 * The list rows for message ids, in the order asked, with an id that is gone left out. Each folder of
 * each account is read once: from the copy on this computer first, and from the server only for ids
 * that copy does not have (a folder never opened here, or mail that has just arrived).
 */
export async function resolveRows(
  list: (query: ListQuery) => Promise<ListResult>,
  ids: readonly string[],
): Promise<MessageSummary[]> {
  const groups = new Map<string, { accountId: string; folder: MailFolder; wanted: Set<string> }>();
  for (const id of ids) {
    const ref = parseMessageId(id);
    if (!ref) continue;
    const key = `${ref.accountId}|${ref.folder}`;
    const group = groups.get(key) ?? { accountId: ref.accountId, folder: ref.folder, wanted: new Set<string>() };
    group.wanted.add(id);
    groups.set(key, group);
  }
  const found = new Map<string, MessageSummary>();
  await Promise.all(
    [...groups.values()].map(async ({ accountId, folder, wanted }) => {
      const take = (rows: readonly MessageSummary[]): void => {
        for (const row of rows) if (wanted.has(row.id)) found.set(row.id, row);
      };
      take((await list({ folder, accountIds: [accountId], cacheOnly: true })).messages);
      if ([...wanted].every((id) => found.has(id))) return;
      take((await list({ folder, accountIds: [accountId] })).messages);
    }),
  );
  return ids.flatMap((id) => {
    const row = found.get(id);
    return row ? [row] : [];
  });
}

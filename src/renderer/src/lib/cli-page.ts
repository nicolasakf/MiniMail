import { isBlockedEntry, type BlockKind } from "@shared/blocklist";
import type { ConfirmCard, ConfirmDecision, DraftChanges, DraftCompose, DraftInfo, PageRequest, PageResult, UnsubscribeOutcome } from "@shared/cli-page";
import type { NotificationSettings } from "@shared/notifications";
import type { PriorityKind } from "@shared/priority";
import type { Account, MailAction, MessageSummary, SavedDraft } from "@shared/types";

import type { ActResult } from "@/hooks/use-mailbox";
import { getBlockList } from "@/lib/blocklist";
import { buildReplySeed, newMessageSeed } from "@/lib/compose";
import { countedTargets, recordAction, recordInfo } from "@/lib/events";
import { mutedCheck, withMute } from "@/lib/mute";
import { setBlockedClearingPriority, setPriority } from "@/lib/priority";
import { newUndoRef, undoStack } from "@/lib/undo-stack";

/** How long to wait for the server to take a command before saying it is still waiting. */
const SETTLE_MS = 20_000;
const VIA = "CLI";

/** What the page offers the CLI: the same functions its buttons and menus use. */
export interface PageDeps {
  perform: (action: MailAction, ids: string[], rows: readonly MessageSummary[], options: { via: string }) => ActResult;
  settle: (batch: number, timeoutMs: number) => Promise<"applied" | "failed" | "undone" | "timeout">;
  assignCategory: (
    threadKeys: string[],
    categoryId: string | null,
    options: { known: ReadonlyMap<string, string | null>; via: "cli" },
  ) => Promise<string | undefined>;
  /** The notification settings (where muting lives), or null until they have loaded. */
  notifySettings: () => NotificationSettings | null;
  updateNotify: (change: (current: NotificationSettings) => NotificationSettings) => Promise<void>;
  /** Shows a card and waits for the person's answer. */
  ask: (card: ConfirmCard) => Promise<ConfirmDecision>;
  /** Unsubscribes from the lists behind these messages (the person was asked first). */
  unsubscribe: (rows: readonly MessageSummary[]) => Promise<UnsubscribeOutcome>;
  /** The connected accounts, for the composer's own rules about who a reply goes to. */
  accounts: () => Account[];
  /** The drafts kept on this computer. `save` and `remove` reject when the file could not be written. */
  drafts: {
    list: () => SavedDraft[];
    save: (draft: SavedDraft) => Promise<void>;
    remove: (id: string) => Promise<void>;
    newId: () => string;
  };
}

const NOTHING: PageResult = { outcome: "nothing", count: 0 };

async function block(request: Extract<PageRequest, { kind: "list" }>, deps: PageDeps): Promise<PageResult> {
  const kind = request.entry as BlockKind;
  const list = getBlockList();
  const changing = request.values.filter((value) => isBlockedEntry(list, kind, value) !== request.on);
  if (changing.length === 0) return NOTHING;
  setBlockedClearingPriority(kind, changing, request.on);
  const title = `${request.on ? "Blocked" : "Unblocked"} ${countedTargets(kind, changing.length)} via ${VIA}`;
  const ref = newUndoRef("block");
  const context = changing.join(", ");
  recordAction("mail", title, "", { context, ref });
  const entry = { ref, label: title, context, run: () => setBlockedClearingPriority(kind, changing, !request.on) };
  const moving = request.on ? request.trash : [];
  if (moving.length === 0) {
    undoStack.push(entry);
    return { outcome: "applied", count: changing.length, ref };
  }
  // One Undo takes back the block and the move to the Trash it caused (unblocking first, or the sweep would undo the restore).
  let batch: number | undefined;
  undoStack.group(entry, () => {
    batch = deps.perform("trash", moving.map((row) => row.id), moving, { via: VIA }).batch;
  });
  if (batch !== undefined) await deps.settle(batch, SETTLE_MS);
  return { outcome: "applied", count: changing.length, ref };
}

async function mute(request: Extract<PageRequest, { kind: "list" }>, deps: PageDeps): Promise<PageResult> {
  const settings = deps.notifySettings();
  if (!settings) throw new Error("The notification settings have not loaded yet. Try again in a moment.");
  const kind = request.entry;
  const isMuted = mutedCheck(settings, request.accountIds);
  const changing = request.values.filter((value) => isMuted(kind, value) !== request.on);
  if (changing.length === 0) return NOTHING;
  await deps.updateNotify((current) => withMute(current, request.accountIds, kind, changing, request.on));
  const title = `${request.on ? "Muted" : "Unmuted"} ${countedTargets(kind, changing.length)} via ${VIA}`;
  const ref = newUndoRef("mute");
  const context = changing.join(", ");
  recordAction("notifications", title, "", { context, ref });
  undoStack.push({
    ref,
    label: title,
    context,
    run: () => void deps.updateNotify((current) => withMute(current, request.accountIds, kind, changing, !request.on)),
  });
  return { outcome: "applied", count: changing.length, ref };
}

function infoOf(draft: SavedDraft): DraftInfo {
  return {
    id: draft.id,
    accountId: draft.accountId,
    to: draft.to.map((contact) => contact.email),
    cc: draft.cc.map((contact) => contact.email),
    bcc: draft.bcc.map((contact) => contact.email),
    subject: draft.subject,
    files: (draft.attachments ?? []).map((file) => file.filename),
  };
}

/** The draft a reply, forward or new message starts from, built the way the composer builds it. */
function draftFromCompose(compose: DraftCompose, deps: PageDeps): SavedDraft {
  const seed =
    compose.mode === "new" || !compose.original
      ? newMessageSeed(compose.accountId)
      : buildReplySeed(compose.original, compose.mode, deps.accounts());
  const written = compose.body ?? "";
  return {
    id: deps.drafts.newId(),
    savedAt: new Date().toISOString(),
    mode: seed.mode,
    accountId: seed.accountId,
    to: compose.to ?? seed.to,
    // A reply-all keeps the original's other recipients; anything given is added to them.
    cc: compose.mode === "replyAll" ? [...seed.cc, ...(compose.cc ?? [])] : (compose.cc ?? seed.cc),
    bcc: compose.bcc ?? [],
    pendingText: { to: "", cc: "", bcc: "" },
    subject: compose.subject ?? seed.subject,
    // A forward carries the original below what is written; a reply keeps its quote apart, as the composer does.
    body: compose.mode === "forward" ? `${written}${seed.body}` : written,
    ...(compose.attachments && compose.attachments.length > 0 ? { attachments: compose.attachments } : {}),
    ...(seed.quoted ? { quoted: seed.quoted } : {}),
    ...(seed.inReplyTo ? { inReplyTo: seed.inReplyTo } : {}),
  };
}

function changedDraft(previous: SavedDraft, changes: DraftChanges): SavedDraft {
  return {
    ...previous,
    savedAt: new Date().toISOString(),
    ...(changes.to ? { to: changes.to } : {}),
    ...(changes.cc ? { cc: changes.cc } : {}),
    ...(changes.bcc ? { bcc: changes.bcc } : {}),
    ...(changes.subject !== undefined ? { subject: changes.subject } : {}),
    ...(changes.body !== undefined ? { body: changes.body, bodyHtml: undefined } : {}),
    ...(changes.attachments && changes.attachments.length > 0 ? { attachments: [...(previous.attachments ?? []), ...changes.attachments] } : {}),
  };
}

async function draft(request: Extract<PageRequest, { kind: "draft" }>, deps: PageDeps): Promise<PageResult> {
  const ref = newUndoRef("draft");
  if (request.op === "create") {
    const created = draftFromCompose(request.compose, deps);
    await deps.drafts.save(created);
    recordAction("drafts", "Wrote a draft via CLI", "", { context: created.subject || "(no subject)", ref, accountId: created.accountId });
    undoStack.push({ ref, label: "Wrote a draft", context: created.subject, run: () => void deps.drafts.remove(created.id) });
    return { outcome: "applied", count: 1, ref, draft: infoOf(created) };
  }
  const previous = deps.drafts.list().find((candidate) => candidate.id === request.id);
  if (!previous) throw new Error("That draft is gone. It may have been sent or deleted in MiniMail.");
  if (request.op === "delete") {
    await deps.drafts.remove(previous.id);
    recordAction("drafts", "Deleted a draft via CLI", "", { context: previous.subject || "(no subject)", ref, accountId: previous.accountId });
    undoStack.push({ ref, label: "Deleted a draft", context: previous.subject, run: () => void deps.drafts.save(previous) });
    return { outcome: "applied", count: 1, ref, draft: infoOf(previous) };
  }
  const next = changedDraft(previous, request.changes);
  await deps.drafts.save(next);
  recordAction("drafts", "Changed a draft via CLI", "", { context: next.subject || "(no subject)", ref, accountId: next.accountId });
  undoStack.push({ ref, label: "Changed a draft", context: next.subject, run: () => void deps.drafts.save(previous) });
  return { outcome: "applied", count: 1, ref, draft: infoOf(next) };
}

/**
 * Does what the main process asked for the CLI, the way a click would: through the page's own
 * functions, so the Log gets a row "via CLI" and the undo stack gets an entry. Resolves with how it
 * ended; throws when it could not be done at all (the main process records and reports that).
 */
export async function handlePageRequest(request: PageRequest, deps: PageDeps): Promise<PageResult> {
  switch (request.kind) {
    case "mail": {
      const { batch, count, ref } = deps.perform(request.action, request.rows.map((row) => row.id), request.rows, { via: VIA });
      if (count === 0) return NOTHING;
      return { outcome: await deps.settle(batch, SETTLE_MS), count, ref };
    }
    case "category": {
      const changed = request.threads.filter((thread) => thread.before !== request.categoryId);
      if (changed.length === 0) return NOTHING;
      const known = new Map(request.threads.map((thread) => [thread.key, thread.before] as const));
      const ref = await deps.assignCategory(
        request.threads.map((thread) => thread.key),
        request.categoryId,
        { known, via: "cli" },
      );
      return ref ? { outcome: "applied", count: changed.length, ref } : { outcome: "failed", count: 0 };
    }
    case "list": {
      if (request.list === "block") return block(request, deps);
      if (request.list === "mute") return mute(request, deps);
      const { applied, ref } = setPriority(request.entry as PriorityKind, request.values, request.on, { via: VIA });
      return applied === 0 ? NOTHING : { outcome: "applied", count: applied, ref };
    }
    case "draft":
      return draft(request, deps);
    case "confirm":
      return { outcome: "applied", count: 0, decision: await deps.ask(request.card) };
    case "unsubscribe": {
      const outcome = await deps.unsubscribe(request.rows);
      if (outcome.done > 0) {
        recordInfo("unsubscribe", `Unsubscribed from ${outcome.done === 1 ? "a list" : `${outcome.done} lists`} via ${VIA}`, "", { context: request.rows.map((row) => row.from.email).join(", ") });
      }
      return { outcome: outcome.done > 0 ? "applied" : "nothing", count: outcome.done, unsubscribe: outcome };
    }
    case "undo": {
      const undone = undoStack.undo(request.ref);
      return undone ? { outcome: "applied", count: 1 } : NOTHING;
    }
  }
}

import { sameMessageKey } from "@shared/dashboard";
import { makeMessageId, parseMessageId } from "@shared/ids";
import { MOVE_DESTINATION, MOVE_FOLDERS } from "@shared/threads";
import type { MailAction, MailActionResult, MailFolder, MessageSummary } from "@shared/types";

import { recordAction, reportToJournal } from "@/lib/events";
import { SESSION_TAG } from "@/lib/undo-stack";
import { FOLDER_TITLES } from "@/lib/format";

const UNDO_MS = 6000;
const CONFIRM_MS = 30_000;
const WATCH_MS = 2 * 60_000;

type Field = "folder" | "unread" | "pinned" | "delete";
interface Intent {
  batch: number;
  action: MailAction;
  field: Field;
  ready: boolean;
  /** Set on a command that takes another back: how its Log event is worded (it is not undoable itself). */
  undoTitle?: string;
  /** Who asked, when it was not a click ("CLI"): the Log event says "... via CLI". */
  via?: string;
}
/** What a batch did, kept so it can be taken back: the rows as they were before, and where they ended up. */
interface History {
  action: MailAction;
  before: MessageSummary[];
}
interface Entry {
  row: MessageSummary;
  originalId: string;
  queued: Intent[];
  sending?: Intent;
  confirmed: Map<Field, { intent: Intent; at: number; from: MailFolder; unknown?: boolean }>;
  needsLocation: boolean;
}

/**
 * A failure the page can retry. The popover lists what the event journal holds; this keeps the
 * Retry button for the ones raised here, found again by `ref` (or by area and subject for
 * failures the main process recorded itself, like an unsubscribe).
 */
export interface MailEvent {
  id: number;
  at: number;
  title: string;
  detail: string;
  retry?: () => void;
  ref?: string;
  area?: string;
  subject?: string;
}

/** Where a failure is recorded, and how to find it again. */
interface ReportOptions {
  /** False when the main process already recorded this failure and only the Retry is kept here. */
  journal?: boolean;
  area?: string;
  subject?: string;
}

/** The `ref` of the Log event for a batch, which the undo stack uses to offer an Undo on that row. */
export const undoRef = (batch: number) => `undo-mail-${SESSION_TAG}-${batch}`;

/** The command that puts a row back as it was, or null when it cannot be (a draft's folder, "delete forever"). */
export function inverseOf(action: MailAction, before: MessageSummary): MailAction | null {
  switch (action) {
    case "archive":
    case "unarchive":
    case "trash":
    case "spam":
      switch (before.folder) {
        case "inbox": return "unarchive";
        case "archive": return "archive";
        case "trash": return "trash";
        case "spam": return "spam";
        default: return null;
      }
    case "markRead": return before.unread ? "markUnread" : null;
    case "markUnread": return before.unread ? null : "markRead";
    case "pin": return before.pinned ? null : "unpin";
    case "unpin": return before.pinned ? "pin" : null;
    default: return null;
  }
}

/** "archiving", "moving to Trash"...: the action as a noun, for "Undid archiving of a message". */
const ACTION_NOUN: Record<MailAction, string> = {
  markRead: "marking as read", markUnread: "marking as unread", pin: "pinning", unpin: "unpinning",
  archive: "archiving", unarchive: "moving to Inbox", trash: "moving to Trash", spam: "moving to Spam",
  deleteForever: "deleting",
};

export const undidTitle = (action: MailAction) => `Undid ${ACTION_NOUN[action]} of`;

const HISTORY_LIMIT = 100;

export const ACTION_LABEL: Record<MailAction, string> = {
  markRead: "mark as read", markUnread: "mark as unread",
  pin: "pin", unpin: "unpin", archive: "move to Archive", unarchive: "move to Inbox",
  trash: "move to Trash", spam: "move to Spam", deleteForever: "delete permanently",
};

const ACTION_DONE: Record<MailAction, string> = {
  markRead: "Marked as read", markUnread: "Marked as unread", pin: "Pinned", unpin: "Unpinned",
  archive: "Archived", unarchive: "Moved to Inbox", trash: "Moved to Trash", spam: "Moved to Spam",
  deleteForever: "Deleted permanently",
};

/** Subjects for the journal's private field: the first few, then a count. */
function describeSubjects(rows: readonly MessageSummary[]): string {
  const shown = [...new Set(rows.map((row) => row.subject || "(no subject)"))].slice(0, 3);
  const more = rows.length - shown.length;
  return more > 0 ? `${shown.join(" · ")} · and ${more} more` : shown.join(" · ");
}

function fieldOf(action: MailAction): Field {
  if (MOVE_DESTINATION[action]) return "folder";
  if (action === "deleteForever") return "delete";
  return action === "markRead" || action === "markUnread" ? "unread" : "pinned";
}

function canonical(row: MessageSummary): MessageSummary {
  if (row.folder !== "pinned") return row;
  const ref = parseMessageId(row.id);
  return ref ? { ...row, id: makeMessageId({ ...ref, folder: "inbox" }), folder: "inbox" } : row;
}

function changed(row: MessageSummary, intent: Intent): MessageSummary {
  switch (intent.field) {
    case "folder": return { ...row, folder: MOVE_DESTINATION[intent.action]! };
    case "unread": return { ...row, unread: intent.action === "markUnread" };
    case "pinned": return { ...row, pinned: intent.action === "pin" };
    default: return row;
  }
}

function sameIdentity(a: MessageSummary, b: MessageSummary): boolean {
  return a.accountId === b.accountId &&
    (a.internetId && b.internetId ? a.internetId === b.internetId : sameMessageKey(a) === sameMessageKey(b));
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Owns one-time commands. Refreshes can confirm commands or report conflicts, but never send them again. */
export class MailActions {
  private entries = new Map<string, Entry>();
  private timers = new Map<number, ReturnType<typeof setTimeout>>();
  private dismissed?: (batch: number) => void;
  private serial = 0;
  private scheduled = false;
  private busy = false;
  private manualUnread = new Map<string, number>();
  private notices: MailEvent[] = [];
  private expiry?: ReturnType<typeof setTimeout>;
  private recent = new Map<string, { row: MessageSummary; at: number; originalId: string; field: Field }>();
  private retryTargets = new WeakMap<() => void, { field: Field; row: MessageSummary }>();
  private watches = new Map<string, { row: MessageSummary; at: number; from: MailFolder }>();
  private history = new Map<number, History>();
  /** Per batch, the rows once the server moved them (their ids change with the folder). */
  private landed = new Map<number, Map<string, MessageSummary>>();

  /** Batches the CLI asked for and the server refused (kept so `whenSettled` can say so). */
  private failedBatches = new Set<number>();
  /** Called on every change; `whenSettled` listens here. */
  private waiters = new Set<() => void>();

  constructor(
    private send: (action: MailAction, ids: string[]) => Promise<MailActionResult[]>,
    private notify: () => void,
    private refresh: () => void,
  ) {}

  private update = (): void => {
    this.notify();
    for (const waiter of [...this.waiters]) waiter();
  };

  /** Whether any message of this batch is still waiting to be sent or being sent. */
  private pending(batch: number): boolean {
    for (const entry of this.entries.values()) {
      if (entry.sending?.batch === batch) return true;
      if (entry.queued.some((intent) => intent.batch === batch)) return true;
    }
    return false;
  }

  /**
   * Waits until every message of a batch has been answered by the server (or the batch was cancelled).
   * "failed" when the server refused any of them (the Log has the reason), "undone" when it was taken
   * back before it was sent, "timeout" when it is still waiting after `timeoutMs`.
   */
  whenSettled(batch: number, timeoutMs: number): Promise<"applied" | "failed" | "undone" | "timeout"> {
    return new Promise((resolve) => {
      const finish = (result: "applied" | "failed" | "undone" | "timeout"): void => {
        clearTimeout(timer);
        this.waiters.delete(check);
        resolve(result);
      };
      const check = (): void => {
        if (this.pending(batch)) return;
        finish(this.failedBatches.has(batch) ? "failed" : this.history.has(batch) ? "applied" : "undone");
      };
      const timer = setTimeout(() => finish("timeout"), timeoutMs);
      this.waiters.add(check);
      check();
    });
  }

  get events(): readonly MailEvent[] { return this.notices; }
  get manualVersion(): number { return this.serial; }
  manuallyUnreadSince(threadId: string, version: number): boolean {
    return (this.manualUnread.get(threadId) ?? 0) > version;
  }

  clearEvents() {
    this.notices = [];
    this.update();
  }

  private report(title: string, detail: string, retry?: () => void, subject?: string, options: ReportOptions = {}) {
    const id = ++this.serial;
    const ref = `ma-${id}`;
    const area = options.area ?? "mail";
    this.notices = [{ id, at: Date.now(), title, detail, retry, ref, area, subject: options.subject ?? subject }, ...this.notices];
    if (options.journal === false) return;
    // The subject is private: it goes in its own field, not in the text that reaches main.log.
    const text = subject ? detail.split(subject).join("").replace(/^\s*[—-]\s*/, "").trim() : detail;
    reportToJournal({ level: "error", area, title, detail: text, context: subject, ref });
  }

  /** The Retry that belongs to a journal event, if one is still available. */
  retryFor(event: { ref?: string; area: string; context?: string; at: number }): (() => void) | undefined {
    const exact = event.ref ? this.notices.find((notice) => notice.ref === event.ref) : undefined;
    if (exact) return exact.retry;
    return this.notices.find((notice) =>
      notice.retry && notice.area === event.area && notice.subject === event.context && Math.abs(notice.at - event.at) < 30_000,
    )?.retry;
  }

  /**
   * Adds an event to the Log popover for something that went wrong outside the move and
   * flag commands this class sends (an unsubscribe, for example). `retry` shows a Retry button.
   */
  reportEvent(title: string, detail: string, retry?: () => void, options: ReportOptions = {}) {
    this.report(title, detail, retry, options.subject, options);
    this.update();
  }

  enqueue(
    action: MailAction,
    rows: readonly MessageSummary[],
    undoable: boolean,
    dismiss?: (batch: number) => void,
    undoTitle?: string,
    via?: string,
  ) {
    const batch = ++this.serial;
    const field = fieldOf(action);
    const intent: Intent = { action, field, batch, ready: !undoable, undoTitle, via };
    let count = 0;
    const affected: MessageSummary[] = [];
    const seen = new Set<Entry>();
    for (const source of rows) {
      const row = canonical(source);
      let entry = this.entries.get(row.id) ?? [...this.entries.values()].find((item) => item.row.id === row.id);
      if (!entry) {
        if (field === "folder" && row.folder === MOVE_DESTINATION[action]) continue;
        entry = { row, originalId: row.id, queued: [], confirmed: new Map(), needsLocation: false };
        this.entries.set(row.id, entry);
      }
      if (seen.has(entry)) continue;
      seen.add(entry);
      if (field === "folder" || field === "delete") {
        for (const [id, watch] of this.watches) {
          if (id === entry.row.id || sameIdentity(watch.row, row)) this.watches.delete(id);
        }
      }
      this.notices = this.notices.map((notice) => {
        const target = notice.retry && this.retryTargets.get(notice.retry);
        if (target && (field === target.field || field === "folder" || field === "delete") &&
            (target.row.id === row.id || sameIdentity(target.row, row))) return { ...notice, retry: undefined };
        return notice;
      });
      if (entry.queued.some((item) => item.field === "delete") || entry.sending?.field === "delete" ||
          entry.confirmed.has("delete")) continue;
      if (action === "markUnread") this.manualUnread.set(`${row.accountId}:${row.threadId}`, batch);

      entry.queued = entry.queued.filter((item) => item.field !== field);
      const base = entry.sending?.field === field ? changed(entry.row, entry.sending) : entry.row;
      if (field !== "folder" || base.folder !== MOVE_DESTINATION[action] || entry.needsLocation) {
        entry.queued.push(intent);
      }
      count++;
      affected.push(row);
    }
    if (affected.length > 0) this.remember(batch, { action, before: affected });
    if (dismiss) this.dismissed = dismiss;
    if (undoable && [...this.entries.values()].some((entry) => entry.queued.includes(intent))) {
      this.timers.set(batch, setTimeout(() => this.commit(batch), UNDO_MS));
    }
    this.prune();
    this.update();
    this.schedule();
    return { batch, count, undoable: this.timers.has(batch) };
  }

  private remember(batch: number, record: History) {
    this.history.set(batch, record);
    for (const old of this.history.keys()) {
      if (this.history.size <= HISTORY_LIMIT) break;
      this.history.delete(old);
      this.landed.delete(old);
      this.failedBatches.delete(old);
    }
  }

  /** True when this batch can be taken back (at least one of its messages has an opposite command). */
  canRevert(batch: number): boolean {
    const record = this.history.get(batch);
    return !!record && record.before.some((row) => inverseOf(record.action, row) !== null);
  }

  /**
   * Takes a batch back: if it has not been sent yet it is simply cancelled, otherwise the opposite
   * commands go out for the messages that changed, from where the server put them. Either way it is
   * recorded in the Log. False when there is nothing to take back.
   */
  revert(batch: number): boolean {
    const record = this.history.get(batch);
    if (!record) return false;
    this.history.delete(batch);
    const groups = new Map<MailAction, MessageSummary[]>();
    for (const before of record.before) {
      const inverse = inverseOf(record.action, before);
      if (!inverse) continue;
      const live = [...this.entries.values()].find((entry) => entry.originalId === before.id);
      const now = live?.row ?? this.landed.get(batch)?.get(before.id) ?? before;
      groups.set(inverse, [...(groups.get(inverse) ?? []), now]);
    }
    this.landed.delete(batch);
    if (this.undo(batch)) {
      recordAction("mail", `${undidTitle(record.action)} ${record.before.length === 1 ? "a message" : `${record.before.length} messages`}`, "", {
        context: describeSubjects(record.before),
        accountId: record.before[0]!.accountId,
      });
      return true;
    }
    for (const [action, rows] of groups) this.enqueue(action, rows, false, undefined, undidTitle(record.action));
    return groups.size > 0;
  }

  undo(batch = [...this.timers.keys()].at(-1)): boolean {
    if (batch === undefined || !this.timers.has(batch)) return false;
    for (const entry of this.entries.values()) entry.queued = entry.queued.filter((intent) => intent.batch !== batch);
    this.prune();
    this.update();
    return true;
  }

  flush() {
    for (const batch of this.timers.keys()) this.commit(batch);
    void this.drain();
  }

  private commit(batch: number) {
    for (const entry of this.entries.values()) {
      for (const intent of entry.queued) if (intent.batch === batch) intent.ready = true;
    }
    this.closeTimer(batch);
    this.schedule();
  }

  private closeTimer(batch: number) {
    clearTimeout(this.timers.get(batch));
    this.timers.delete(batch);
    this.dismissed?.(batch);
  }

  private prune() {
    const waiting = new Set<number>();
    for (const [key, entry] of this.entries) {
      if (!entry.queued.length && !entry.sending && !entry.confirmed.size && !entry.needsLocation) this.entries.delete(key);
      for (const intent of entry.queued) if (!intent.ready) waiting.add(intent.batch);
    }
    for (const batch of this.timers.keys()) if (!waiting.has(batch)) this.closeTimer(batch);
  }

  private schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      void this.drain();
    });
  }

  private async drain() {
    if (this.busy) return;
    this.busy = true;
    try {
      const groups = new Map<MailAction, Entry[]>();
      for (const entry of this.entries.values()) {
        // Read/pin can pass an unsent move. Once a move starts, every action needs its new ID.
        if (entry.needsLocation) continue;
        entry.queued = entry.queued.filter(
          (item) => item.field !== "folder" || entry.row.folder !== MOVE_DESTINATION[item.action],
        );
        const intent = entry.queued.find((item) => item.ready);
        if (!intent) continue;
        entry.queued.splice(entry.queued.indexOf(intent), 1);
        entry.sending = intent;
        const group = groups.get(intent.action) ?? [];
        group.push(entry);
        groups.set(intent.action, group);
      }
      if (!groups.size) {
        this.prune();
        this.update();
        return;
      }
      await Promise.all([...groups].map(async ([action, entries]) => {
        for (let start = 0; start < entries.length; start += 500) {
          const batch = entries.slice(start, start + 500);
          const ids = batch.map((entry) => entry.row.id);
          let results: MailActionResult[];
          try {
            results = await this.send(action, ids);
          } catch (error) {
            // expected: turned into per-message results; each failure is recorded just below.
            results = ids.map((id) => ({ id, status: "unknown", error: errorText(error) }));
          }
          const byId = new Map(results.map((result) => [result.id, result]));
          const at = performance.now();
          // One Log event per batch, so each can offer its own Undo (see `undoRef`).
          const appliedByBatch = new Map<number, MessageSummary[]>();
          for (const entry of batch) {
            if (byId.get(entry.row.id)?.status !== "applied") continue;
            const id = entry.sending!.batch;
            appliedByBatch.set(id, [...(appliedByBatch.get(id) ?? []), entry.row]);
          }
          for (const [id, applied] of appliedByBatch) {
            const sent = batch.find((entry) => entry.sending?.batch === id)?.sending;
            const undoTitle = sent?.undoTitle;
            const count = applied.length === 1 ? "a message" : `${applied.length} messages`;
            const via = sent?.via ? ` via ${sent.via}` : "";
            recordAction("mail", `${undoTitle ? `${undoTitle} ${count}` : `${ACTION_DONE[action]} ${count}`}${via}`, "", {
              context: describeSubjects(applied),
              accountId: applied[0]!.accountId,
              ...(undoTitle ? {} : { ref: undoRef(id) }),
            });
          }
          for (const entry of batch) {
            const intent = entry.sending!;
            entry.sending = undefined;
            const result = byId.get(entry.row.id);
            const before = entry.row;
            if (result?.status === "applied") {
              entry.confirmed.set(intent.field, { intent, at, from: before.folder });
              entry.row = changed(before, intent);
              if (intent.field === "folder") {
                if (result.nextId) entry.row = { ...entry.row, id: result.nextId };
                else entry.needsLocation = true;
              }
              if (this.history.has(intent.batch)) {
                const landed = this.landed.get(intent.batch) ?? new Map<string, MessageSummary>();
                landed.set(entry.originalId, entry.row);
                this.landed.set(intent.batch, landed);
              }
            } else {
              this.failedBatches.add(intent.batch);
              const unknown = result?.status !== "failed";
              if (unknown) {
                if (intent.field === "folder") entry.needsLocation = true;
                entry.confirmed.set(intent.field, { intent, at, from: before.folder, unknown: true });
              }
              const newer = entry.queued.some((item) => item.field === intent.field);
              const retry = !newer && !unknown && action !== "deleteForever"
                ? this.retry(action, before)
                : undefined;
              this.report(unknown ? `Could not confirm ${ACTION_LABEL[action]}` : `Could not ${ACTION_LABEL[action]}`,
                `${before.subject} — ${result?.error ?? "The server returned no result for this message."}`, retry, before.subject);
            }
          }
          this.prune();
          this.update();
          this.refresh();
          this.scheduleExpiry();
        }
      }));
      this.schedule();
    } finally {
      this.busy = false;
    }
  }

  private retry(action: MailAction, row: MessageSummary) {
    let used = false;
    const retry = () => {
      if (used || !this.notices.some((notice) => notice.retry === retry)) return;
      used = true;
      this.notices = this.notices.map((notice) => notice.retry === retry ? { ...notice, retry: undefined } : notice);
      this.enqueue(action, [row], false);
    };
    this.retryTargets.set(retry, { field: fieldOf(action), row });
    return retry;
  }

  /** Live reads started after a write can supersede its result. Disk reads never confirm writes. */
  observe(rows: readonly MessageSummary[], folders: ReadonlySet<MailFolder>, accounts: ReadonlySet<string>, started: number) {
    let updated = false;
    for (const entry of this.entries.values()) {
      if (!accounts.has(entry.row.accountId) || entry.sending) continue;
      const exact = rows.find((row) => canonical(row).id === entry.row.id);
      const matching = rows.filter((row) => sameIdentity(row, entry.row));
      const move = entry.confirmed.get("folder");
      for (const [field, { intent, at, from, unknown }] of entry.confirmed) {
        if (started <= at) continue;
        if (field === "delete") {
          if (!folders.has(from)) continue;
          if (exact) this.report("Message still on server", exact.subject, undefined, exact.subject);
        } else if (field === "folder") {
          // A missing row in a bounded list is not proof that a rule moved it.
          if (!folders.has(from) || !folders.has(MOVE_DESTINATION[intent.action]!)) continue;
          const expected = MOVE_DESTINATION[intent.action]!;
          const inbox = matching.find((row) => row.folder === "inbox");
          const elsewhere = matching.filter((row) => row.folder !== "archive");
          const found = exact?.folder === expected && !entry.needsLocation
            ? (expected === "archive" ? inbox ?? exact : exact)
            : (elsewhere.length === 1 ? elsewhere[0] : matching.length === 1 ? matching[0] : undefined) ??
              (entry.needsLocation ? undefined : exact);
          if (!found) continue;
          const resolved = canonical(found);
          if ((entry.needsLocation || entry.queued.length > 0) && resolved.id !== entry.row.id &&
              (!resolved.internetId || resolved.internetId !== entry.row.internetId)) continue;
          entry.row = resolved;
          if (unknown && entry.row.folder === from && from !== expected &&
              !entry.queued.some((queued) => queued.field === "folder")) {
            this.report("Move was not confirmed", `${entry.row.subject} is still in ${FOLDER_TITLES[from]}.`,
              this.retry(intent.action, entry.row), entry.row.subject);
          }
          entry.needsLocation = false;
          if (entry.row.folder === expected) {
            if (!entry.queued.some((queued) => queued.field === "folder" || queued.field === "delete")) {
              this.watches.set(entry.row.id, { row: entry.row, at, from });
            }
          } else if (!unknown) {
            this.report("Server changed the message folder",
              `${entry.row.subject} is in ${FOLDER_TITLES[entry.row.folder]}. A mail rule or another client may have moved it.`,
              undefined, entry.row.subject);
            // A later explicit move may proceed from the confirmed location.
          }
        } else {
          if (!exact || (move && entry.confirmed.has("folder"))) continue;
          if (changed(entry.row, intent)[field] !== exact[field] && !entry.queued.some((queued) => queued.field === field)) {
            if (!unknown) this.report("Server changed a message flag", `${exact.subject} — ${ACTION_LABEL[intent.action]}.`, undefined, exact.subject);
            else {
              this.report("Change was not confirmed", `${exact.subject} — ${ACTION_LABEL[intent.action]}.`,
                this.retry(intent.action, canonical(exact)), exact.subject);
            }
          }
          entry.row = { ...entry.row, [field]: exact[field] };
        }
        this.recent.set(`${entry.originalId}:${field}`, { row: entry.row, at: started, originalId: entry.originalId, field });
        entry.confirmed.delete(field);
        updated = true;
      }
    }
    for (const [id, watch] of this.watches) {
      if (!accounts.has(watch.row.accountId) || !folders.has(watch.row.folder) || started <= watch.at) continue;
      const matching = rows.filter((row) => row.id === id || sameIdentity(row, watch.row));
      if (matching.some((row) => row.folder === watch.row.folder)) continue;
      const outsideArchive = matching.filter((row) => row.folder !== "archive");
      const moved = outsideArchive.length === 1 ? outsideArchive[0] : matching.length === 1 ? matching[0] : undefined;
      if (!moved || !folders.has(moved.folder)) continue;
      this.watches.delete(id);
      this.recent.set(`${id}:folder`, { row: canonical(moved), at: started, originalId: id, field: "folder" });
      this.report("Server changed the message folder",
        `${moved.subject} is in ${FOLDER_TITLES[moved.folder]}. A mail rule or another client may have moved it.`,
        undefined, moved.subject);
      updated = true;
    }
    if (updated) {
      this.prune();
      this.update();
      this.schedule();
    }
  }

  /** Folders required to verify a move even when hidden in the current view. */
  verification(): Map<string, Set<MailFolder>> {
    const accounts = new Map<string, Set<MailFolder>>();
    for (const entry of this.entries.values()) {
      if (!entry.confirmed.size) continue;
      const folders = accounts.get(entry.row.accountId) ?? new Set<MailFolder>();
      if (entry.confirmed.has("folder")) for (const folder of MOVE_FOLDERS) folders.add(folder);
      for (const { from } of entry.confirmed.values()) folders.add(from);
      folders.add(entry.row.folder);
      accounts.set(entry.row.accountId, folders);
    }
    for (const { row, from } of this.watches.values()) {
      const folders = accounts.get(row.accountId) ?? new Set<MailFolder>();
      for (const folder of MOVE_FOLDERS) folders.add(folder);
      folders.add(from);
      accounts.set(row.accountId, folders);
    }
    return accounts;
  }

  private scheduleExpiry() {
    if (this.expiry) return;
    this.expiry = setTimeout(() => {
      this.expiry = undefined;
      let remaining = false;
      for (const entry of this.entries.values()) {
        for (const [field, { at, intent }] of entry.confirmed) {
          if (performance.now() - at < CONFIRM_MS) { remaining = true; continue; }
          if (field === "folder") this.report("Could not verify the message location", entry.row.subject, undefined, entry.row.subject);
          if (field === "folder" && entry.needsLocation) {
            for (const queued of entry.queued) {
              this.report(`Could not ${ACTION_LABEL[queued.action]}`, `${entry.row.subject} — its new location is unknown.`, undefined, entry.row.subject);
            }
            entry.queued = [];
            entry.needsLocation = false;
          }
          entry.confirmed.delete(intent.field);
        }
      }
      for (const [id, item] of this.recent) {
        if (performance.now() - item.at >= CONFIRM_MS) this.recent.delete(id);
        else remaining = true;
      }
      for (const [id, item] of this.watches) {
        if (performance.now() - item.at >= WATCH_MS) this.watches.delete(id);
        else remaining = true;
      }
      this.prune();
      this.update();
      if (remaining) this.scheduleExpiry();
    }, CONFIRM_MS);
  }

  project(
    rows: readonly MessageSummary[],
    folders: ReadonlySet<MailFolder>,
    accounts?: ReadonlySet<string>,
    snapshotStarted = (_accountId: string) => Infinity,
  ): MessageSummary[] {
    const projected = [...rows];
    for (const { row, at, originalId, field } of this.recent.values()) {
      if (snapshotStarted(row.accountId) >= at || (accounts && !accounts.has(row.accountId))) continue;
      const matches = (item: MessageSummary) =>
        canonical(item).id === originalId || canonical(item).id === row.id ||
        (field === "folder" && sameIdentity(item, row));
      if (field === "folder" || field === "delete") {
        for (let i = projected.length - 1; i >= 0; i--) if (matches(projected[i])) projected.splice(i, 1);
        if (field === "folder" && (folders.has(row.folder) ||
            (folders.has("pinned") && row.folder === "inbox" && row.pinned))) projected.push(row);
      } else {
        for (let i = 0; i < projected.length; i++) {
          if (matches(projected[i])) projected[i] = { ...projected[i], [field]: row[field] };
        }
      }
    }
    if (!this.entries.size && !this.recent.size) return projected;
    for (const entry of this.entries.values()) {
      if (accounts && !accounts.has(entry.row.accountId)) continue;
      const intents = [
        ...[...entry.confirmed.values()].map(({ intent }) => intent),
        ...(entry.sending ? [entry.sending] : []),
        ...entry.queued,
      ];
      if (!intents.length) continue;
      const moving = intents.some((intent) => intent.field === "folder");
      const matching = projected.filter((row) => {
        const id = canonical(row).id;
        return id === entry.row.id || id === entry.originalId || (moving && sameIdentity(row, entry.row));
      });
      if (!moving && !matching.length) continue;
      const current = matching.find((row) => canonical(row).id === entry.row.id) ?? matching[0] ?? entry.row;
      let row = { ...canonical(current), id: entry.row.id };
      for (const intent of intents) row = changed(row, intent);
      const removed = new Set(matching);
      for (let i = projected.length - 1; i >= 0; i--) if (removed.has(projected[i])) projected.splice(i, 1);
      if (intents.some((intent) => intent.field === "delete")) continue;
      if (folders.has(row.folder)) projected.push(row);
      else if (folders.has("pinned") && row.folder === "inbox" && row.pinned) {
        const ref = parseMessageId(row.id);
        projected.push(ref ? { ...row, id: makeMessageId({ ...ref, folder: "pinned" }), folder: "pinned" } : row);
      }
    }
    const visible = folders.has("pinned") ? projected.filter((row) => row.pinned) : projected;
    return visible.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  }
}

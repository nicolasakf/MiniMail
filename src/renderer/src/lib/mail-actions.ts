import { sameMessageKey } from "@shared/dashboard";
import { makeMessageId, parseMessageId } from "@shared/ids";
import { MOVE_DESTINATION, MOVE_FOLDERS } from "@shared/threads";
import type { MailAction, MailActionResult, MailFolder, MessageSummary } from "@shared/types";

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
}
interface Entry {
  row: MessageSummary;
  originalId: string;
  queued: Intent[];
  sending?: Intent;
  confirmed: Map<Field, { intent: Intent; at: number; from: MailFolder; unknown?: boolean }>;
  needsLocation: boolean;
}

export interface MailEvent {
  id: number;
  at: number;
  title: string;
  detail: string;
  retry?: () => void;
}

export const ACTION_LABEL: Record<MailAction, string> = {
  markRead: "mark as read", markUnread: "mark as unread",
  pin: "pin", unpin: "unpin", archive: "move to Archive", unarchive: "move to Inbox",
  trash: "move to Trash", spam: "move to Spam", deleteForever: "delete permanently",
};

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

  constructor(
    private send: (action: MailAction, ids: string[]) => Promise<MailActionResult[]>,
    private update: () => void,
    private refresh: () => void,
  ) {}

  get events(): readonly MailEvent[] { return this.notices; }
  get manualVersion(): number { return this.serial; }
  manuallyUnreadSince(threadId: string, version: number): boolean {
    return (this.manualUnread.get(threadId) ?? 0) > version;
  }

  clearEvents() {
    this.notices = [];
    this.update();
  }

  private report(title: string, detail: string, retry?: () => void) {
    this.notices = [{ id: ++this.serial, at: Date.now(), title, detail, retry }, ...this.notices];
  }

  /**
   * Adds an event to the notifications popover for something that went wrong outside the move and
   * flag commands this class sends (an unsubscribe, for example). `retry` shows a Retry button.
   */
  reportEvent(title: string, detail: string, retry?: () => void) {
    this.report(title, detail, retry);
    this.update();
  }

  reportSyncError(account: string, detail: string) {
    const title = account ? `Could not sync ${account}` : "Could not sync mail";
    if (this.notices.some((notice) => notice.title === title && notice.detail === detail && Date.now() - notice.at < 60_000)) return;
    this.report(title, detail);
    this.update();
  }

  enqueue(action: MailAction, rows: readonly MessageSummary[], undoable: boolean, dismiss?: (batch: number) => void) {
    const batch = ++this.serial;
    const field = fieldOf(action);
    const intent: Intent = { action, field, batch, ready: !undoable };
    let count = 0;
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
    }
    if (dismiss) this.dismissed = dismiss;
    if (undoable && [...this.entries.values()].some((entry) => entry.queued.includes(intent))) {
      this.timers.set(batch, setTimeout(() => this.commit(batch), UNDO_MS));
    }
    this.prune();
    this.update();
    this.schedule();
    return { batch, count, undoable: this.timers.has(batch) };
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
            results = ids.map((id) => ({ id, status: "unknown", error: errorText(error) }));
          }
          const byId = new Map(results.map((result) => [result.id, result]));
          const at = performance.now();
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
            } else {
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
                `${before.subject} — ${result?.error ?? "The server returned no result for this message."}`, retry);
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
          if (exact) this.report("Message still on server", exact.subject);
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
              this.retry(intent.action, entry.row));
          }
          entry.needsLocation = false;
          if (entry.row.folder === expected) {
            if (!entry.queued.some((queued) => queued.field === "folder" || queued.field === "delete")) {
              this.watches.set(entry.row.id, { row: entry.row, at, from });
            }
          } else if (!unknown) {
            this.report("Server changed the message folder",
              `${entry.row.subject} is in ${FOLDER_TITLES[entry.row.folder]}. A mail rule or another client may have moved it.`);
            // A later explicit move may proceed from the confirmed location.
          }
        } else {
          if (!exact || (move && entry.confirmed.has("folder"))) continue;
          if (changed(entry.row, intent)[field] !== exact[field] && !entry.queued.some((queued) => queued.field === field)) {
            if (!unknown) this.report("Server changed a message flag", `${exact.subject} — ${ACTION_LABEL[intent.action]}.`);
            else {
              this.report("Change was not confirmed", `${exact.subject} — ${ACTION_LABEL[intent.action]}.`,
                this.retry(intent.action, canonical(exact)));
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
        `${moved.subject} is in ${FOLDER_TITLES[moved.folder]}. A mail rule or another client may have moved it.`);
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
          if (field === "folder") this.report("Could not verify the message location", entry.row.subject);
          if (field === "folder" && entry.needsLocation) {
            for (const queued of entry.queued) {
              this.report(`Could not ${ACTION_LABEL[queued.action]}`, `${entry.row.subject} — its new location is unknown.`);
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

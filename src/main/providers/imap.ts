import { ImapFlow, type FetchMessageObject, type MessageStructureObject } from "imapflow";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import nodemailer, { type SendMailOptions } from "nodemailer";

import { classifyMessage } from "@shared/classify";
import {
  buildReplyIcs,
  invitationFromIcs,
  parseIcs,
  replyRecipient,
  replyWording,
  type IcsEvent,
} from "@shared/ics";
import { firstHeader, isAuthenticated } from "@shared/logos";
import { makeMessageId } from "@shared/ids";
import { MAIL_WINDOW } from "@shared/mail-window";
import type {
  Account,
  Contact,
  Draft,
  Invitation,
  InvitationResponse,
  MailAction,
  MailFolder,
  MessageDetail,
  MessageSummary,
} from "@shared/types";

import { perfLog } from "../perf";
import { nativeIdOf, patchSummaries, type SummaryStore } from "./summary-cache";
import { describeError, makeSnippet, type AttachmentFile, type MailAuth, type MailProvider } from "./types";

/** Bytes of each message fetched for the list view (enough for headers + a preview). */
const PREVIEW_BYTES = 24 * 1024;
const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;
/**
 * Previews are downloaded in batches, with the mailbox lock released in between so opening a
 * message never waits for a whole refresh. Each batch is sized to take about this long, from
 * how fast the server just answered: a quick server gets big batches, a slow one small ones.
 */
const BATCH_TARGET_MS = 2500;
const BATCH_MIN = 3;
const BATCH_MAX = 25;
const BATCH_FIRST = 5;

/** How many previews to ask for next, given how long the last batch took per message. */
export function nextBatchSize(msPerMessage: number): number {
  const size = Math.round(BATCH_TARGET_MS / Math.max(msPerMessage, 1));
  return Math.min(BATCH_MAX, Math.max(BATCH_MIN, size));
}
/** Opened messages kept in memory so reopening a conversation is instant. */
const MAX_REMEMBERED = 60;
/** Messages per header-only command when backfilling sender authentication. */
const HEADER_BATCH = 50;

/**
 * The files a message lists as attachments, in the order `AttachmentInfo.id` counts them. Inline
 * images are part of the body, and the calendar part is shown as an invitation instead.
 */
export function listedAttachments(parsed: ParsedMail): ParsedMail["attachments"] {
  return parsed.attachments.filter(
    (attachment) => !attachment.related && !/^text\/calendar/i.test(attachment.contentType),
  );
}

/** The calendar event in a message, if it has a `text/calendar` part. */
function calendarEventOf(parsed: ParsedMail): IcsEvent | null {
  for (const attachment of parsed.attachments) {
    if (!/^text\/calendar/i.test(attachment.contentType)) continue;
    const event = parseIcs(attachment.content.toString("utf8"));
    if (event) return event;
  }
  return null;
}

const byNewest = (rows: Iterable<MessageSummary>): MessageSummary[] =>
  [...rows].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
const detailKey = (folder: MailFolder, nativeId: string): string => `${folder}|${nativeId}`;

interface Endpoints {
  imapHost: string;
  smtpHost: string;
}

/** Server hosts per provider. Zoho custom-domain (paid) orgs use the `*pro` hosts. */
export function endpointsFor(account: Account): Endpoints {
  if (account.provider === "gmail") {
    return { imapHost: "imap.gmail.com", smtpHost: "smtp.gmail.com" };
  }
  if (account.provider === "zoho") {
    const region = account.zohoRegion ?? "com";
    const prefix = account.zohoWorkplace ? "pro" : "";
    return {
      imapHost: `imap${prefix}.zoho.${region}`,
      smtpHost: `smtp${prefix}.zoho.${region}`,
    };
  }
  throw new Error(`${account.provider} is not an IMAP provider.`);
}

type FolderPaths = Partial<Record<Exclude<MailFolder, "pinned">, string>>;

const SPECIAL_USE: Record<string, Exclude<MailFolder, "pinned" | "inbox">> = {
  "\\Sent": "sent",
  "\\Drafts": "drafts",
  "\\Trash": "trash",
  "\\Junk": "spam",
  "\\Archive": "archive",
};

function contactsFrom(field: AddressObject | AddressObject[] | undefined): Contact[] {
  if (!field) return [];
  const groups = Array.isArray(field) ? field : [field];
  return groups.flatMap((group) =>
    group.value
      .filter((entry) => Boolean(entry.address))
      .map((entry) => ({ name: entry.name ?? "", email: entry.address ?? "" })),
  );
}

/** First `text/calendar` part's content-type line (with method), if the message has one. */
function findCalendarContentType(node: MessageStructureObject | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type?.toLowerCase() === "text/calendar") {
    const method = (node.parameters as Record<string, string> | undefined)?.method;
    return method ? `text/calendar; method=${method}` : "text/calendar";
  }
  for (const child of node.childNodes ?? []) {
    const found = findCalendarContentType(child);
    if (found) return found;
  }
  return undefined;
}

/** True if any non-calendar part is an attachment. */
function hasAttachmentPart(node: MessageStructureObject | undefined): boolean {
  if (!node) return false;
  const isCalendar = node.type?.toLowerCase() === "text/calendar";
  if (!isCalendar && node.disposition?.toLowerCase() === "attachment") return true;
  return (node.childNodes ?? []).some(hasAttachmentPart);
}

function normalizeReferences(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return (Array.isArray(value) ? value : value.split(/\s+/)).filter(Boolean);
}

function headerString(parsed: ParsedMail, name: string): string | undefined {
  const value = parsed.headers.get(name);
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "text" in value) {
    return String((value as { text: unknown }).text);
  }
  return undefined;
}

/** Replaces `cid:` image references with data URIs so inline images render offline. */
function inlineCidImages(html: string, parsed: ParsedMail): string {
  let result = html;
  for (const attachment of parsed.attachments) {
    if (!attachment.cid || !attachment.contentType.startsWith("image/")) continue;
    if (attachment.size > MAX_INLINE_IMAGE_BYTES) continue;
    const cid = attachment.cid.replace(/^<|>$/g, "");
    const dataUri = `data:${attachment.contentType};base64,${attachment.content.toString("base64")}`;
    result = result.split(`cid:${cid}`).join(dataUri);
  }
  return result;
}

/** True for the errors imapflow raises when the socket is gone (the server closed it, or it timed out). */
function isDroppedConnection(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  return code === "NoConnection" || code === "ECONNRESET" || code === "EPIPE" || code === "ETIMEDOUT";
}

/**
 * Owns one long-lived IMAP connection and reconnects (with a fresh token) when it
 * drops. Operations go through `use`, which retries once after a reconnect.
 */
class ImapConnection {
  private client: ImapFlow | null = null;
  private connecting: Promise<ImapFlow> | null = null;

  constructor(
    private readonly host: string,
    private readonly user: string,
    private readonly getAuth: () => Promise<MailAuth>,
  ) {}

  private async connect(): Promise<ImapFlow> {
    if (this.client?.usable) return this.client;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const auth = await this.getAuth();
      const client = new ImapFlow({
        host: this.host,
        port: 993,
        secure: true,
        auth: { user: this.user, ...auth },
        logger: false,
      });
      // Errors surface on the next command; without a listener Node would crash the app.
      client.on("error", () => {
        if (this.client === client) this.client = null;
      });
      client.on("close", () => {
        if (this.client === client) this.client = null;
      });
      await client.connect();
      this.client = client;
      return client;
    })();

    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async use<T>(task: (client: ImapFlow) => Promise<T>): Promise<T> {
    let used: ImapFlow | null = null;
    try {
      used = await this.connect();
      return await task(used);
    } catch (error) {
      // One retry covers a connection the server closed while we were idle. The close listener
      // clears `this.client` as soon as the socket drops, so judge the client this call used,
      // not the field: otherwise the retry never runs and "Connection not available" surfaces.
      if (used && (isDroppedConnection(error) || !used.usable)) {
        if (this.client === used) this.client = null;
        return task(await this.connect());
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client?.usable) await client.logout().catch(() => undefined);
  }
}

/** Waits before reconnecting a dropped watcher, growing with each failure in a row. */
const WATCH_BACKOFF_MS = [2_000, 10_000, 30_000, 120_000];
/** Gmail labels of mail that is not archived: still in the Inbox, sent by the user, or a draft. */
const NOT_ARCHIVED_LABELS = new Set(["\\inbox", "\\sent", "\\draft"]);
/** How far back an All Mail scan reads, in multiples of the window, looking for archived mail. */
const ALL_MAIL_SCAN_FACTOR = 4;
/** Messages read per command while scanning All Mail. */
const ALL_MAIL_CHUNK = 500;

/** True when a message in Gmail's All Mail is archived; no labels (not Gmail) counts as archived. */
export function isArchivedInGmail(labels: ReadonlySet<string> | undefined): boolean {
  if (!labels) return true;
  for (const label of labels) {
    if (NOT_ARCHIVED_LABELS.has(label.toLowerCase())) return false;
  }
  return true;
}

/** Rows one folder's copy holds at most: the list window plus older ones kept for the next full list. */
const MAX_KEPT = MAIL_WINDOW + 100;
/** Restarts IDLE this often so a connection a router silently dropped is noticed (limit is 29 min). */
const WATCH_IDLE_RESTART_MS = 5 * 60_000;
/** A burst of events (a batch arriving, many flags changing) is reported once. */
const WATCH_DEBOUNCE_MS = 250;

/**
 * Keeps a second IMAP connection parked in IDLE on the inbox, so the server tells us about new,
 * removed and re-flagged mail the moment it happens. It is separate from `ImapConnection`
 * because that one is busy with fetches and actions, and IDLE holds a connection for itself.
 * Reconnects with a fresh token when the connection drops, and reports a change after every
 * reconnect since anything could have happened in between.
 */
export class ImapWatcher {
  private client: ImapFlow | null = null;
  private live = false;
  private stopped = false;
  private everConnected = false;
  private failures = 0;
  private retry: NodeJS.Timeout | null = null;
  private notify: NodeJS.Timeout | null = null;

  constructor(
    private readonly host: string,
    private readonly user: string,
    private readonly getAuth: () => Promise<MailAuth>,
    private readonly onChange: () => void,
  ) {}

  /** True while the connection is open on the inbox and the server is able to push to us. */
  get connected(): boolean {
    return this.live;
  }

  start(): void {
    void this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.live = false;
    if (this.retry) clearTimeout(this.retry);
    if (this.notify) clearTimeout(this.notify);
    this.retry = null;
    this.notify = null;
    const client = this.client;
    this.client = null;
    if (client?.usable) await client.logout().catch(() => undefined);
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    let client: ImapFlow | null = null;
    try {
      const auth = await this.getAuth();
      client = new ImapFlow({
        host: this.host,
        port: 993,
        secure: true,
        auth: { user: this.user, ...auth },
        logger: false,
        maxIdleTime: WATCH_IDLE_RESTART_MS,
      });
      const opened = client;
      // Errors surface as a close; without a listener Node would crash the app.
      opened.on("error", () => undefined);
      opened.on("close", () => this.dropped(opened));
      opened.on("exists", () => this.changed());
      opened.on("expunge", () => this.changed());
      opened.on("flags", () => this.changed());
      this.client = opened;
      await opened.connect();
      // Read-only: watching must never mark anything as seen. imapflow idles once nothing is running.
      await opened.mailboxOpen("INBOX", { readOnly: true });
      if (this.stopped) {
        await opened.logout().catch(() => undefined);
        return;
      }
      this.live = true;
      this.failures = 0;
      if (this.everConnected) this.changed();
      this.everConnected = true;
    } catch {
      if (client) this.dropped(client);
    }
  }

  /** The connection ended (or never started): forget it and try again after a pause. */
  private dropped(client: ImapFlow): void {
    if (this.client !== client) return;
    this.client = null;
    this.live = false;
    if (client.usable) void client.close();
    if (this.stopped || this.retry) return;
    const wait = WATCH_BACKOFF_MS[Math.min(this.failures, WATCH_BACKOFF_MS.length - 1)];
    this.failures += 1;
    this.retry = setTimeout(() => {
      this.retry = null;
      void this.connect();
    }, wait);
  }

  private changed(): void {
    if (this.stopped || this.notify) return;
    this.notify = setTimeout(() => {
      this.notify = null;
      if (!this.stopped) this.onChange();
    }, WATCH_DEBOUNCE_MS);
  }
}

/** IMAP + SMTP provider used for Gmail (OAuth or app password) and Zoho (app password). */
export class ImapProvider implements MailProvider {
  private readonly connection: ImapConnection;
  private watcher: ImapWatcher | null = null;
  private readonly endpoints: Endpoints;
  private folderPaths: FolderPaths | null = null;
  /** The Archive tab is Gmail's All Mail, which also holds Inbox, sent and draft mail. */
  private archiveIsAllMail = false;
  /** folder -> uid -> summary, so polling only downloads new messages. */
  private readonly cache = new Map<MailFolder, Map<number, MessageSummary>>();
  /** UIDVALIDITY seen for each folder this session, saved next to the copy. */
  private readonly validity = new Map<MailFolder, string>();
  /** Tail of the list currently running (or last run) for each folder. */
  private readonly listQueue = new Map<MailFolder, Promise<undefined>>();
  /** Recently opened messages, oldest first. */
  private readonly details = new Map<string, MessageDetail>();

  constructor(
    private readonly account: Account,
    private readonly getAuth: () => Promise<MailAuth>,
    /** Keeps the last list between launches; omit for a memory-only cache. */
    private readonly persist?: SummaryStore,
  ) {
    this.endpoints = endpointsFor(account);
    this.connection = new ImapConnection(this.endpoints.imapHost, account.email, getAuth);
  }

  async verify(): Promise<void> {
    try {
      await this.connection.use(async (client) => {
        await this.resolveFolders(client);
      });
    } catch (error) {
      throw new Error(this.friendlyAuthError(error));
    }
  }

  /** The last list for this folder: this session's, else the copy from a previous launch. */
  cached(folder: MailFolder): MessageSummary[] {
    const rows = this.cache.get(folder)?.values() ?? this.persist?.load(folder)?.messages ?? [];
    return [...rows].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, MAIL_WINDOW);
  }

  /** Rebuilds a uid-keyed map from rows saved by an earlier launch. */
  private fromRows(rows: readonly MessageSummary[]): Map<number, MessageSummary> {
    const map = new Map<number, MessageSummary>();
    for (const row of rows) {
      const uid = Number(nativeIdOf(row));
      if (Number.isInteger(uid)) map.set(uid, row);
    }
    return map;
  }

  /**
   * Lists of one folder run one after another (as the mailbox lock used to enforce), so a second
   * list sees the first one's results instead of downloading the same previews again.
   */
  private serialized<T>(folder: MailFolder, task: () => Promise<T>): Promise<T> {
    const previous = this.listQueue.get(folder) ?? Promise.resolve();
    const run = previous.then(task, task);
    this.listQueue.set(
      folder,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  /** Resolves once every list that is running or queued has finished. */
  private async listsIdle(): Promise<void> {
    await Promise.all([...this.listQueue.values()]);
  }

  list(folder: MailFolder, limit: number): Promise<MessageSummary[]> {
    return this.serialized(folder, () => this.listNow(folder, limit));
  }

  private async listNow(folder: MailFolder, limit: number): Promise<MessageSummary[]> {
    const started = performance.now();
    const lap = (what: string, extra = "") =>
      perfLog(
        `imap ${this.account.provider} ${folder}: ${what}`,
        `${Math.round(performance.now() - started)}ms into list${extra}`,
      );

    // Step 1: which messages are in the window, with their current flags (cheap, one command).
    const window = await this.connection.use(async (client) => {
      const paths = await this.resolveFolders(client);
      lap("connected, folders resolved");
      const path = paths[folder === "pinned" ? "inbox" : folder];
      if (!path) return null;

      const lock = await client.getMailboxLock(path, { readOnly: true });
      try {
        const mailbox = client.mailbox || undefined;
        const exists = mailbox ? mailbox.exists : 0;
        const uidValidity = String(mailbox ? mailbox.uidValidity : "");
        const flags = new Map<number, Set<string>>();
        if (exists > 0 && folder === "pinned") {
          const found = await client.search({ flagged: true }, { uid: true });
          const uids = (found || []).slice(-limit);
          if (uids.length > 0) {
            for await (const message of client.fetch(uids, { uid: true, flags: true }, { uid: true })) {
              flags.set(message.uid, message.flags ?? new Set());
            }
          }
        } else if (exists > 0 && folder === "archive" && this.archiveIsAllMail) {
          await this.readArchivedWindow(client, exists, limit, flags);
        } else if (exists > 0) {
          const start = Math.max(1, exists - limit + 1);
          for await (const message of client.fetch(`${start}:*`, { uid: true, flags: true })) {
            flags.set(message.uid, message.flags ?? new Set());
          }
        }
        return { path, uidValidity, flags };
      } finally {
        lock.release();
      }
    });
    if (!window) return [];
    const { path, uidValidity, flags: windowFlags } = window;
    this.validity.set(folder, uidValidity);

    // This session's copy, else last launch's if the server still numbers messages the same way.
    let known = this.cache.get(folder);
    if (!known) {
      const stored = this.persist?.load(folder);
      known =
        stored && stored.uidValidity === uidValidity
          ? this.fromRows(stored.messages)
          : new Map<number, MessageSummary>();
    }
    if (windowFlags.size === 0) {
      this.cache.set(folder, new Map());
      this.persist?.save(folder, { uidValidity, messages: [] });
      return [];
    }

    // Step 2: download previews only for messages we have not seen, newest first and in small
    // batches. The mailbox lock is released between batches so opening a message never has to
    // wait for a whole refresh; on a slow server a refresh can take a minute.
    const fresh = [...windowFlags.keys()].filter((uid) => !known.has(uid)).sort((a, b) => b - a);
    lap("flags read", `, ${windowFlags.size} in window, ${fresh.length} new`);
    const working = new Map(known);

    // Rows saved before sender authentication was recorded get it from their headers alone: one
    // small command per 50 messages instead of downloading every preview again.
    const legacy = [...windowFlags.keys()].filter((uid) => working.get(uid)?.authenticated === undefined && working.has(uid));
    if (legacy.length > 0) {
      await this.backfillAuthentication(path, legacy, working);
      this.persist?.save(folder, { uidValidity, messages: byNewest(working.values()) });
      lap("authentication backfilled", `, ${legacy.length} messages`);
    }
    let downloaded = 0;
    let batchSize = BATCH_FIRST;
    for (let offset = 0; offset < fresh.length; ) {
      const batch = fresh.slice(offset, offset + batchSize);
      const batchStarted = performance.now();
      await this.connection.use(async (client) => {
        const lock = await client.getMailboxLock(path, { readOnly: true });
        try {
          for await (const message of client.fetch(
            batch,
            {
              uid: true,
              flags: true,
              envelope: true,
              internalDate: true,
              bodyStructure: true,
              threadId: true,
              source: { maxLength: PREVIEW_BYTES },
            },
            { uid: true },
          )) {
            downloaded += message.source?.length ?? 0;
            working.set(message.uid, await this.summarize(folder, message));
          }
        } finally {
          lock.release();
        }
      });
      offset += batch.length;
      batchSize = nextBatchSize((performance.now() - batchStarted) / batch.length);
      lap("previews batch", `, ${offset}/${fresh.length}, next ${batchSize}`);
      // Keep progress: a refresh cut short (quit, dropped connection) resumes from here.
      this.persist?.save(folder, { uidValidity, messages: byNewest(working.values()) });
    }
    if (fresh.length > 0) {
      lap("previews downloaded and parsed", `, ${Math.round(downloaded / 1024)} KB`);
    }

    const next = new Map<number, MessageSummary>();
    for (const [uid, flags] of windowFlags) {
      const row = working.get(uid);
      if (row) {
        next.set(uid, { ...row, unread: !flags.has("\\Seen"), pinned: flags.has("\\Flagged") });
      }
    }
    // A smaller list (a first page) must not throw away older mail a bigger one already
    // downloaded: rows older than this window stay cached for the next full list to check.
    // Rows inside the window that the server no longer has are gone (moved or deleted).
    // Pinned is a search, not a range, so anything outside its answer is simply unflagged.
    const kept = new Map(next);
    // In Gmail's All Mail the window skips Inbox, sent and draft mail, so an older row's labels
    // are unknown until a scan reaches it: only what the scan vouched for is kept.
    if (folder !== "pinned" && !(folder === "archive" && this.archiveIsAllMail)) {
      const oldestInWindow = Math.min(...windowFlags.keys());
      const older = [...working].filter(([uid]) => uid < oldestInWindow).sort(([a], [b]) => b - a);
      for (const [uid, row] of older.slice(0, Math.max(0, MAX_KEPT - kept.size))) kept.set(uid, row);
    }
    this.cache.set(folder, kept);
    this.persist?.save(folder, { uidValidity, messages: byNewest(kept.values()) });
    return byNewest(next.values());
  }

  /** Fills `authenticated` on cached rows from the Authentication-Results header alone. */
  private async backfillAuthentication(
    path: string,
    uids: readonly number[],
    working: Map<number, MessageSummary>,
  ): Promise<void> {
    for (let offset = 0; offset < uids.length; offset += HEADER_BATCH) {
      const batch = uids.slice(offset, offset + HEADER_BATCH);
      const answered = new Set<number>();
      await this.connection.use(async (client) => {
        const lock = await client.getMailboxLock(path, { readOnly: true });
        try {
          for await (const message of client.fetch(
            batch,
            { uid: true, headers: ["authentication-results"] },
            { uid: true },
          )) {
            const row = working.get(message.uid);
            if (!row) continue;
            answered.add(message.uid);
            const raw = message.headers ? message.headers.toString("latin1") : "";
            working.set(message.uid, {
              ...row,
              authenticated: isAuthenticated(firstHeader(raw, "authentication-results"), row.from.email),
            });
          }
        } finally {
          lock.release();
        }
      });
      // A message the server did not return (deleted meanwhile) is marked unverified so it is not asked again.
      for (const uid of batch) {
        const row = working.get(uid);
        if (row && !answered.has(uid) && row.authenticated === undefined) working.set(uid, { ...row, authenticated: false });
      }
    }
  }

  async get(folder: MailFolder, nativeIds: string[]): Promise<MessageDetail[]> {
    const started = performance.now();
    const lap = (what: string, extra = "") =>
      perfLog(
        `imap ${this.account.provider} get ${folder}: ${what}`,
        `${Math.round(performance.now() - started)}ms into get${extra}`,
      );

    // Messages never change once delivered, so one opened recently is served from memory.
    const found = new Map<string, MessageDetail>();
    const missing: number[] = [];
    for (const nativeId of nativeIds) {
      const remembered = this.details.get(detailKey(folder, nativeId));
      if (remembered) found.set(nativeId, remembered);
      else if (Number.isInteger(Number(nativeId))) missing.push(Number(nativeId));
    }
    lap("started", `, ${found.size} remembered, ${missing.length} to download`);

    if (missing.length > 0) {
      await this.connection.use(async (client) => {
        const paths = await this.resolveFolders(client);
        const path = paths[folder === "pinned" ? "inbox" : folder];
        if (!path) return;

        const lock = await client.getMailboxLock(path, { readOnly: true });
        lap("mailbox lock acquired");
        try {
          // One command for the whole conversation: servers with slow round trips pay once.
          for await (const message of client.fetch(
            missing,
            {
              uid: true,
              flags: true,
              envelope: true,
              internalDate: true,
              bodyStructure: true,
              threadId: true,
              source: true,
            },
            { uid: true },
          )) {
            if (!message.source) continue;
            const summary = await this.summarize(folder, message);
            const parsed = await simpleParser(message.source);
            const detail: MessageDetail = {
              ...summary,
              cc: contactsFrom(parsed.cc),
              replyTo: contactsFrom(parsed.replyTo)[0] ?? null,
              messageId: parsed.messageId ?? null,
              references: normalizeReferences(parsed.references),
              html: parsed.html ? inlineCidImages(parsed.html, parsed) : null,
              text: parsed.text ?? null,
              attachments: listedAttachments(parsed).map((attachment, index) => ({
                id: String(index),
                filename: attachment.filename ?? "attachment",
                contentType: attachment.contentType,
                size: attachment.size,
              })),
              invitation: this.invitationOf(parsed),
            };
            found.set(String(message.uid), detail);
            this.remember(folder, String(message.uid), detail);
          }
          lap("downloaded and parsed", `, ${found.size} message(s)`);
        } finally {
          lock.release();
        }
      });
    }
    return nativeIds.flatMap((nativeId) => found.get(nativeId) ?? []);
  }

  /** The invitation in a message; the user's answer is filled in later, from what they chose here. */
  private invitationOf(parsed: ParsedMail): Invitation | null {
    const event = calendarEventOf(parsed);
    return event ? invitationFromIcs(event) : null;
  }

  /** Downloads and parses one message in full. */
  private async fetchParsed(folder: MailFolder, nativeId: string): Promise<ParsedMail> {
    const uid = Number(nativeId);
    if (!Number.isInteger(uid)) throw new Error("This message is no longer available.");
    let source: Buffer | undefined;
    await this.connection.use(async (client) => {
      const paths = await this.resolveFolders(client);
      const path = paths[folder === "pinned" ? "inbox" : folder];
      if (!path) return;
      const lock = await client.getMailboxLock(path, { readOnly: true });
      try {
        const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (message) source = message.source;
      } finally {
        lock.release();
      }
    });
    if (!source) throw new Error("This message is no longer on the server.");
    return simpleParser(source);
  }

  async attachment(folder: MailFolder, nativeId: string, attachmentId: string): Promise<AttachmentFile> {
    const parsed = await this.fetchParsed(folder, nativeId);
    const file = listedAttachments(parsed)[Number(attachmentId)];
    if (!file) throw new Error("This attachment is no longer in the message.");
    return { filename: file.filename ?? "attachment", contentType: file.contentType, data: file.content };
  }

  async respondToInvitation(folder: MailFolder, nativeId: string, response: InvitationResponse): Promise<void> {
    const parsed = await this.fetchParsed(folder, nativeId);
    const event = calendarEventOf(parsed);
    if (!event) throw new Error("This message has no calendar invitation to answer.");
    const sender = contactsFrom(parsed.from)[0] ?? { name: "", email: "" };
    const recipient = replyRecipient(event, sender);
    if (!recipient.email) throw new Error("The invitation does not say who to reply to.");
    // The guest the user answers as: the account's address, or another address the invitation was sent to.
    const own = [this.account.email, ...contactsFrom(parsed.to).map((contact) => contact.email)];
    const name = this.account.displayName || this.account.email;
    const invitation = invitationFromIcs(event);
    const wording = replyWording(response, invitation?.title ?? parsed.subject ?? "Invitation", name);
    await this.sendMail({
      to: [{ name: recipient.name, address: recipient.email }],
      subject: wording.subject,
      text: wording.text,
      icalEvent: {
        method: "REPLY",
        content: buildReplyIcs(event, response, own, name),
      },
    });
  }

  private remember(folder: MailFolder, nativeId: string, detail: MessageDetail): void {
    const key = detailKey(folder, nativeId);
    this.details.delete(key);
    this.details.set(key, detail);
    // Oldest first: a Map iterates in insertion order.
    while (this.details.size > MAX_REMEMBERED) {
      const oldest = this.details.keys().next().value;
      if (oldest === undefined) break;
      this.details.delete(oldest);
    }
  }

  async act(action: MailAction, folder: MailFolder, nativeIds: string[]): Promise<void> {
    if (nativeIds.length === 0) return;
    const range = nativeIds.join(",");

    // Let a running refresh finish first: its snapshot of flags would otherwise put back what
    // this action is about to change. (Opening a message does not wait; only actions do.)
    await this.listsIdle();
    await this.connection.use(async (client) => {
      const paths = await this.resolveFolders(client);
      const path = paths[folder === "pinned" ? "inbox" : folder];
      if (!path) throw new Error(`This account has no ${folder} folder.`);

      const lock = await client.getMailboxLock(path);
      try {
        switch (action) {
          case "markRead":
            await client.messageFlagsAdd(range, ["\\Seen"], { uid: true });
            break;
          case "markUnread":
            await client.messageFlagsRemove(range, ["\\Seen"], { uid: true });
            break;
          case "pin":
            await client.messageFlagsAdd(range, ["\\Flagged"], { uid: true });
            break;
          case "unpin":
            await client.messageFlagsRemove(range, ["\\Flagged"], { uid: true });
            break;
          case "archive":
          case "unarchive":
          case "trash":
          case "spam": {
            const destination = paths[action === "unarchive" ? "inbox" : action];
            if (!destination) throw new Error(`This account has no ${action === "unarchive" ? "inbox" : action} folder.`);
            await client.messageMove(range, destination, { uid: true });
            break;
          }
          case "deleteForever":
            await client.messageDelete(range, { uid: true });
            break;
        }
      } finally {
        lock.release();
      }
    });

    // Patch the copies instead of dropping them: dropping would re-download every preview in
    // the window on the next refresh, which on a slow server takes tens of seconds per click.
    this.patchCache(action, folder, nativeIds);
    // Pinned is the flagged subset of the inbox, so the same messages live in both views.
    if (folder === "pinned") this.patchCache(action, "inbox", nativeIds);
    if (folder === "inbox") this.patchCache(action, "pinned", nativeIds);
  }

  /** Applies a successful action to the in-memory and saved copies of one folder. */
  private patchCache(action: MailAction, folder: MailFolder, nativeIds: string[]): void {
    const ids = new Set(nativeIds);
    // Opened messages follow along (a moved one is forgotten, a read one stops being unread).
    const remembered = [...this.details].filter(([key]) => key.startsWith(`${folder}|`));
    if (remembered.length > 0) {
      const patched = new Map(
        patchSummaries(
          remembered.map(([, detail]) => detail),
          action,
          folder,
          ids,
        ).map((detail) => [detailKey(folder, nativeIdOf(detail) ?? ""), detail] as const),
      );
      for (const [key] of remembered) this.details.delete(key);
      for (const [key, detail] of patched) this.details.set(key, detail);
    }
    const memory = this.cache.get(folder);
    const stored = this.persist?.load(folder);
    if (memory) {
      const rows = patchSummaries([...memory.values()], action, folder, ids);
      this.cache.set(folder, this.fromRows(rows));
      const uidValidity = this.validity.get(folder) ?? stored?.uidValidity;
      if (uidValidity !== undefined) this.persist?.save(folder, { uidValidity, messages: rows });
    } else if (stored) {
      this.persist?.save(folder, {
        uidValidity: stored.uidValidity,
        messages: patchSummaries(stored.messages, action, folder, ids),
      });
    }
  }

  /** Sends one message over this account's SMTP server. */
  private async sendMail(message: SendMailOptions): Promise<void> {
    const auth = await this.getAuth();
    const transport = nodemailer.createTransport({
      host: this.endpoints.smtpHost,
      port: 465,
      secure: true,
      auth: auth.accessToken
        ? { type: "OAuth2", user: this.account.email, accessToken: auth.accessToken }
        : { user: this.account.email, pass: auth.pass },
    });
    try {
      await transport.sendMail({ from: { name: this.account.displayName, address: this.account.email }, ...message });
    } catch (error) {
      throw new Error(`Could not send: ${describeError(error)}`);
    } finally {
      transport.close();
    }
  }

  async send(draft: Draft): Promise<void> {
    const toAddress = (contact: Contact) => ({ name: contact.name, address: contact.email });
    const mail = {
      to: draft.to.map(toAddress),
      cc: draft.cc.map(toAddress),
      bcc: draft.bcc.map(toAddress),
      subject: draft.subject,
      text: draft.text,
      attachments: (draft.attachments ?? []).map((file) => ({
        filename: file.filename,
        contentType: file.contentType || undefined,
        content: Buffer.from(file.contentBase64, "base64"),
      })),
      ...(draft.inReplyTo && draft.inReplyTo.mode !== "forward"
        ? {
            inReplyTo: draft.inReplyTo.messageId,
            references: [...draft.inReplyTo.references, draft.inReplyTo.messageId],
          }
        : {}),
    };

    await this.sendMail(mail);

    // Gmail and Zoho both file sent mail themselves (Zoho: Settings > Mail Accounts > SMTP >
    // "Save copy of sent emails", on by default), so nothing is appended to Sent here.
    this.cache.delete("sent");

    if (draft.inReplyTo && draft.inReplyTo.mode !== "forward") {
      await this.markAnswered(draft.inReplyTo.messageId);
    }
  }

  /**
   * SMTP does not tell the mailbox a message was replied to, so set `\Answered` on the original
   * ourselves; that is what the "Replied" filter reads. Best effort: the reply is already sent.
   */
  private async markAnswered(rfcMessageId: string): Promise<void> {
    try {
      await this.connection.use(async (client) => {
        const paths = await this.resolveFolders(client);
        if (!paths.inbox) return;
        const lock = await client.getMailboxLock(paths.inbox);
        try {
          const uids = await client.search({ header: { "message-id": rfcMessageId } }, { uid: true });
          if (uids && uids.length > 0) {
            await client.messageFlagsAdd(uids, ["\\Answered"], { uid: true });
          }
        } finally {
          lock.release();
        }
      });
      this.cache.delete("inbox");
    } catch (error) {
      console.error("[imap] could not mark the original as answered:", describeError(error));
    }
  }

  watch(onChange: () => void): void {
    if (this.watcher) return;
    this.watcher = new ImapWatcher(this.endpoints.imapHost, this.account.email, this.getAuth, onChange);
    this.watcher.start();
  }

  watching(): boolean {
    return this.watcher?.connected ?? false;
  }

  async close(): Promise<void> {
    const watcher = this.watcher;
    this.watcher = null;
    await Promise.all([watcher?.stop(), this.connection.close()]);
  }

  /** Maps logical folders to this server's paths using SPECIAL-USE flags (cached per connection). */
  /**
   * The Archive window when the Archive tab is Gmail's All Mail: the newest `limit` messages that
   * are really archived, read newest first in chunks. An email is in one place at a time, so mail
   * still in the Inbox (and the user's sent mail and drafts) is skipped by its Gmail labels; Spam
   * and Trash are never in All Mail. The scan stops after a bounded number of messages, so a
   * mailbox full of sent mail cannot stall it. A server that sends no labels is not filtered.
   */
  private async readArchivedWindow(
    client: ImapFlow,
    exists: number,
    limit: number,
    flags: Map<number, Set<string>>,
  ): Promise<void> {
    const floor = Math.max(1, exists - limit * ALL_MAIL_SCAN_FACTOR + 1);
    for (let end = exists; end >= floor && flags.size < limit; ) {
      const start = Math.max(floor, end - ALL_MAIL_CHUNK + 1);
      const archived: { uid: number; flags: Set<string> }[] = [];
      for await (const message of client.fetch(`${start}:${end}`, { uid: true, flags: true, labels: true })) {
        if (isArchivedInGmail(message.labels)) {
          archived.push({ uid: message.uid, flags: message.flags ?? new Set() });
        }
      }
      archived.sort((a, b) => b.uid - a.uid);
      for (const message of archived.slice(0, limit - flags.size)) flags.set(message.uid, message.flags);
      end = start - 1;
    }
  }

  private async resolveFolders(client: ImapFlow): Promise<FolderPaths> {
    if (this.folderPaths) return this.folderPaths;
    const mailboxes = await client.list();
    const paths: FolderPaths = { inbox: "INBOX" };
    for (const mailbox of mailboxes) {
      const folder = mailbox.specialUse ? SPECIAL_USE[mailbox.specialUse] : undefined;
      if (folder && !paths[folder]) paths[folder] = mailbox.path;
      // Gmail has no \Archive; "All Mail" is where archived messages live.
      if (mailbox.specialUse === "\\All" && !paths.archive) {
        paths.archive = mailbox.path;
        this.archiveIsAllMail = true;
      }
    }
    this.folderPaths = paths;
    return paths;
  }

  private async summarize(folder: MailFolder, message: FetchMessageObject): Promise<MessageSummary> {
    const envelope = message.envelope;
    const flags = message.flags ?? new Set<string>();
    let parsed: ParsedMail | null = null;
    if (message.source) {
      // Truncated previews can end mid-MIME; the parser copes, but never let it break the list.
      parsed = await simpleParser(message.source).catch(() => null);
    }

    const from: Contact = {
      name: envelope?.from?.[0]?.name ?? "",
      email: envelope?.from?.[0]?.address ?? "",
    };
    const subject = envelope?.subject ?? "(no subject)";
    const headers: Record<string, string | undefined> = {};
    for (const name of ["list-unsubscribe", "list-id", "precedence", "auto-submitted"]) {
      headers[name] = parsed ? headerString(parsed, name) : undefined;
    }

    const references = parsed ? normalizeReferences(parsed.references) : [];
    const root = references[0] ?? envelope?.inReplyTo ?? envelope?.messageId;
    const threadId = message.threadId ?? (root ? `m:${root}` : `u:${message.uid}`);

    const date = message.internalDate ?? envelope?.date ?? new Date(0);

    return {
      id: makeMessageId({
        accountId: this.account.id,
        folder,
        nativeId: String(message.uid),
      }),
      accountId: this.account.id,
      folder,
      threadId,
      from,
      to: (envelope?.to ?? [])
        .filter((entry) => Boolean(entry.address))
        .map((entry) => ({ name: entry.name ?? "", email: entry.address ?? "" })),
      subject,
      snippet: makeSnippet(parsed?.text),
      date: new Date(date).toISOString(),
      unread: !flags.has("\\Seen"),
      pinned: flags.has("\\Flagged"),
      answered: flags.has("\\Answered"),
      hasAttachments: hasAttachmentPart(message.bodyStructure),
      authenticated: message.source
        ? isAuthenticated(
            firstHeader(message.source.toString("latin1", 0, 32 * 1024), "authentication-results"),
            from.email,
          )
        : undefined,
      categoryId: null,
      signal: classifyMessage({
        fromEmail: from.email,
        fromName: from.name,
        subject,
        headers,
        contentType: findCalendarContentType(message.bodyStructure),
      }),
    };
  }

  /** Rewrites the cryptic server replies users actually hit when adding an account. */
  private friendlyAuthError(error: unknown): string {
    const detail = describeError(error);
    const lower = detail.toLowerCase();
    if (this.account.provider === "zoho" && /auth|login|credential|invalid/.test(lower)) {
      return `Zoho rejected the login (${detail}). Enable IMAP in Zoho Mail settings, use an application-specific password if 2FA is on, and check the region and Workplace options.`;
    }
    if (this.account.provider === "gmail" && /auth|login|credential|invalid|application-specific/.test(lower)) {
      return `Gmail rejected the login (${detail}). Use an app password (needs 2-Step Verification) or sign in with Google.`;
    }
    return detail;
  }
}

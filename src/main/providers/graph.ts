import { z } from "zod";

import { CALENDAR_ACCESS_REQUIRED } from "@shared/accounts";
import { classifyMessage } from "@shared/classify";
import { makeMessageId, parseMessageId } from "@shared/ids";
import { isAuthenticated } from "@shared/logos";
import { MAIL_WINDOW } from "@shared/mail-window";
import { parseUnsubscribe } from "@shared/unsubscribe";
import { MAX_ATTACHMENT_BYTES, MAX_INLINE_IMAGE_BYTES } from "@shared/types";
import type {
  Account,
  Contact,
  Draft,
  Invitation,
  InvitationResponse,
  MailAction,
  MailActionResult,
  MailFolder,
  MessageDetail,
  MessageSummary,
} from "@shared/types";

import { logEvent } from "../log";
import { reportError } from "../events";
import { RequestGate, type Lane } from "./request-gate";
import { nativeIdOf, patchSummaries, type DeltaState, type SummaryStore } from "./summary-cache";
import {
  describeError,
  detailFrom,
  makeSnippet,
  type AttachmentFile,
  type BodyView,
  type InlineRef,
  type MailProvider,
  type StoredBody,
} from "./types";

const GRAPH = "https://graph.microsoft.com/v1.0";

/** Graph well-known folder names. `pinned` is a filter over the inbox, not a folder. */
const WELL_KNOWN: Record<Exclude<MailFolder, "pinned">, string> = {
  inbox: "inbox",
  drafts: "drafts",
  sent: "sentitems",
  archive: "archive",
  spam: "junkemail",
  trash: "deleteditems",
};

const recipientSchema = z.object({
  emailAddress: z.object({
    name: z.string().nullish(),
    address: z.string().nullish(),
  }),
});

const headerSchema = z.object({ name: z.string(), value: z.string() });

const messageSchema = z.object({
  id: z.string(),
  conversationId: z.string().nullish(),
  subject: z.string().nullish(),
  from: recipientSchema.nullish(),
  toRecipients: z.array(recipientSchema).nullish(),
  ccRecipients: z.array(recipientSchema).nullish(),
  replyTo: z.array(recipientSchema).nullish(),
  receivedDateTime: z.string().nullish(),
  sentDateTime: z.string().nullish(),
  bodyPreview: z.string().nullish(),
  isRead: z.boolean().nullish(),
  hasAttachments: z.boolean().nullish(),
  flag: z.object({ flagStatus: z.string().nullish() }).nullish(),
  internetMessageId: z.string().nullish(),
  internetMessageHeaders: z.array(headerSchema).nullish(),
  singleValueExtendedProperties: z
    .array(z.object({ id: z.string(), value: z.string().nullish() }))
    .nullish(),
  body: z.object({ contentType: z.string(), content: z.string() }).nullish(),
  attachments: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().nullish(),
        contentType: z.string().nullish(),
        size: z.number().nullish(),
        isInline: z.boolean().nullish(),
      }),
    )
    .nullish(),
});

const eventTimeSchema = z.object({ dateTime: z.string(), timeZone: z.string().nullish() });

/** A meeting request or cancellation, with the calendar event it belongs to. */
const eventMessageSchema = z.object({
  meetingMessageType: z.string().nullish(),
  event: z
    .object({
      id: z.string(),
      subject: z.string().nullish(),
      start: eventTimeSchema.nullish(),
      end: eventTimeSchema.nullish(),
      isAllDay: z.boolean().nullish(),
      location: z.object({ displayName: z.string().nullish() }).nullish(),
      organizer: recipientSchema.nullish(),
      responseStatus: z.object({ response: z.string().nullish() }).nullish(),
    })
    .nullish(),
});

const attachmentFileSchema = z.object({
  name: z.string().nullish(),
  contentType: z.string().nullish(),
  contentBytes: z.string().nullish(),
  contentId: z.string().nullish(),
});

const listSchema = z.object({
  value: z.array(messageSchema),
  /** The next page, when there is more; Graph returns at most 100 messages per page. */
  "@odata.nextLink": z.string().nullish(),
});

/** One entry of a folder's change feed: what changed, or that the message left the folder. */
const changeSchema = z.object({
  id: z.string(),
  isRead: z.boolean().nullish(),
  flag: z.object({ flagStatus: z.string().nullish() }).nullish(),
  "@removed": z.object({ reason: z.string().nullish() }).nullish(),
});

const changesSchema = z.object({
  value: z.array(changeSchema),
  "@odata.nextLink": z.string().nullish(),
  /** Only on the last page: where to continue from next time. */
  "@odata.deltaLink": z.string().nullish(),
});

type Change = z.infer<typeof changeSchema>;

/** Graph's largest page of messages. */
const PAGE_MAX = 100;

type GraphMessage = z.infer<typeof messageSchema>;

const LIST_FIELDS = [
  "id",
  "conversationId",
  "internetMessageId",
  "subject",
  "from",
  "toRecipients",
  "receivedDateTime",
  "bodyPreview",
  "isRead",
  "hasAttachments",
  "flag",
  "internetMessageHeaders",
].join(",");

/** PidTagLastVerbExecuted: Outlook stores 102 (reply), 103 (reply all) or 104 (forward) here. */
const LAST_VERB_PROPERTY = "Integer 0x1081";

/** Asks Graph to include just the last-verb property with each message. */
const EXPAND_LAST_VERB = `singleValueExtendedProperties($filter=${encodeURIComponent(
  `id eq '${LAST_VERB_PROPERTY}'`,
)})`;

function wasRepliedTo(message: GraphMessage): boolean {
  const verb = message.singleValueExtendedProperties?.find(
    (property) => property.id.toLowerCase() === LAST_VERB_PROPERTY.toLowerCase(),
  )?.value;
  return verb === "102" || verb === "103";
}

function toContact(recipient: z.infer<typeof recipientSchema> | null | undefined): Contact {
  return {
    name: recipient?.emailAddress.name ?? "",
    email: recipient?.emailAddress.address ?? "",
  };
}

/** A failed Graph call, keeping the HTTP status so callers can tell "gone" from "refused". */
/** Graph accepts file attachments up to this size in a single request. */
const GRAPH_INLINE_ATTACHMENT_BYTES = 3 * 1024 * 1024;

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

const errorBodySchema = z.object({
  error: z.object({ code: z.string().optional(), message: z.string().optional() }),
});

/** The code and message of a Graph error body, when it has them. */
function readError(text: string): { code?: string; reason?: string } {
  let detail: unknown = null;
  try {
    detail = JSON.parse(text);
  } catch {
    // expected: the error body is optional detail (a gateway answers with HTML); the failure itself is thrown and recorded.
  }
  const parsed = errorBodySchema.safeParse(detail);
  return parsed.success ? { code: parsed.data.error.code, reason: parsed.data.error.message } : {};
}

/** A request path for the log: no query string, and message ids replaced. */
function describePath(path: string): string {
  return path.split("?")[0].replace(/\/(messages|attachments)\/[^/]+/g, "/$1/:id");
}

class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GraphError";
  }
}

/** Folders with a change feed. Pinned is a filter over the inbox, and a draft changes under it. */
type FeedFolder = Exclude<MailFolder, "pinned" | "drafts">;

const hasFeed = (folder: MailFolder): folder is FeedFolder => folder !== "pinned" && folder !== "drafts";

/** A folder kept up to date from its change feed. */
interface Tracked extends DeltaState {
  /** Empty until the feed's first round has been read. */
  link: string;
  /** The folder's rows by Graph id, the newest `TRACKED_MAX` at most. */
  rows: Map<string, MessageSummary>;
  /** Changed since it was last saved. */
  dirty: boolean;
  savedAt: number;
}

/** The id Graph knows a row by. */
const nativeOf = (row: MessageSummary): string => parseMessageId(row.id)?.nativeId ?? row.id;

const byId = (rows: readonly MessageSummary[]): Map<string, MessageSummary> =>
  new Map(rows.map((row) => [nativeOf(row), row]));

/** A row's date as a filter value: whole seconds, rounded down so the row itself is included. */
const feedTime = (date: string): string => date.replace(/\.\d+Z$/, "Z");

/** The feed's link is no longer good (it expired, or Graph lost its state): start a new feed. */
function isStaleFeed(error: unknown): boolean {
  return error instanceof GraphError && (error.status === 410 || (error.status === 400 && /delta|sync/i.test(error.message)));
}

/** Graph does not offer this feed (or this way of asking for it); asking again would fail the same way. */
function isRefusedFeed(error: unknown): boolean {
  return error instanceof GraphError && [400, 404, 501].includes(error.status);
}

/** Graph ids are stable until a message moves, so the saved copy never needs invalidating. */
const CACHE_VALIDITY = "graph";
/** Extra attempts after Graph throttles (429). */
const MAX_RETRIES = 4;
const MAX_RETRY_WAIT_MS = 8000;
/**
 * A read that meets a server fault (500/502/503/504) is tried again only briefly: these are often
 * a blip, but when Graph is down for the mailbox, a long retry loop leaves a message that is being
 * opened loading forever and adds load to a service that is already struggling.
 */
const MAX_SERVER_FAULT_RETRIES = 2;
const SERVER_FAULT_BUDGET_MS = 12_000;
/**
 * Rows kept per folder by the change feed: the list window and room for mail that is moved or
 * deleted before the folder is next downloaded in full.
 */
const TRACKED_MAX = MAIL_WINDOW + 100;
/** More new messages than this since the last answer are cheaper to download as a list than one by one. */
const MAX_NEW_BY_ID = 20;
/** A folder is downloaded in full at least this often: the feed does not carry a reply made in another app. */
const FULL_REFRESH_MS = 24 * 60 * 60_000;
/** The feed's position is saved this often when nothing changed; a change saves it at once. */
const SAVE_FEED_EVERY_MS = 5 * 60_000;
/** Ask for large pages of the feed: its default is small, and a first round covers a whole window. */
const FEED_PAGE = { Prefer: "odata.maxpagesize=100" };
/** One request that has not answered by now is abandoned, so nothing waits on it indefinitely. */
const REQUEST_TIMEOUT_MS = 20_000;
/** Messages of one conversation downloaded at a time. */
const GET_CONCURRENCY = 4;
/**
 * Requests in flight at once to one mailbox, reads and writes together. Exchange allows 4
 * concurrent connections per app and mailbox and answers more with HTTP 429
 * (ErrorTooManyObjectsOpened / ApplicationThrottled), so stay under it and leave one spare for
 * the same mailbox being open in another client.
 */
const MAX_CONCURRENT_REQUESTS = 3;
/** Writes in flight at once; they share the places above with the reads. */
const ACT_CONCURRENCY = MAX_CONCURRENT_REQUESTS;

const REPLY_ENDPOINT = {
  reply: "createReply",
  replyAll: "createReplyAll",
  forward: "createForward",
} as const;

const draftSchema = z.object({ id: z.string() });

/** Microsoft Graph provider for Outlook.com and work/school (Entra ID) mailboxes. */
export class GraphProvider implements MailProvider {
  /** This session's lists; the copy from an earlier launch lives in `persist`. */
  private readonly cache = new Map<MailFolder, MessageSummary[]>();
  /** Every call to this mailbox goes through here, so it never has more than Exchange allows open. */
  private readonly gate = new RequestGate(MAX_CONCURRENT_REQUESTS);
  /**
   * Lists being downloaded right now, by folder and size. Several parts of the app ask for the
   * same window at the same moment (the mailbox, an open conversation, the Dashboard, the address
   * book); they share one download instead of each making their own.
   */
  private readonly listing = new Map<string, Promise<MessageSummary[]>>();
  /** Folders kept up to date from Graph's change feed, by folder. */
  private readonly tracked = new Map<MailFolder, Tracked>();
  /** Folders whose feed Graph refused this session; they are downloaded in full each time. */
  private readonly feedOff = new Set<MailFolder>();
  /** The work queued per folder: one at a time, so a feed is never read twice at once. */
  private readonly queue = new Map<MailFolder, Promise<void>>();
  /** Counts finished writes, so a feed read that overlapped one can be read again. */
  private writeEpoch = 0;

  constructor(
    private readonly account: Account,
    private readonly getAccessToken: () => Promise<string>,
    private readonly persist?: SummaryStore,
    private readonly wait: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
    /** Keeps the text of downloaded messages between launches; omit to download a message each time it is opened. */
    private readonly bodies?: BodyView,
  ) {}

  async verify(): Promise<void> {
    await this.request("GET", "/me/mailFolders/inbox?$select=id");
  }

  async list(folder: MailFolder, limit: number): Promise<MessageSummary[]> {
    const key = `${folder}|${limit}`;
    const running = this.listing.get(key);
    // Each caller gets its own array, so one sorting or trimming its copy cannot change another's.
    if (running) return [...(await running)];

    const download = this.download(folder, limit);
    this.listing.set(key, download);
    try {
      return [...(await download)];
    } finally {
      // A write clears the table, and a newer download may have taken this key since.
      if (this.listing.get(key) === download) this.listing.delete(key);
    }
  }

  /**
   * The newest `limit` messages of a folder. A folder with a change feed (every one but Pinned
   * and Drafts) is downloaded in full once and then only asked what changed since; see `synced`.
   */
  private download(folder: MailFolder, limit: number): Promise<MessageSummary[]> {
    return this.serialized(folder, () => this.synced(folder, limit));
  }

  /** One folder's work at a time, so a second list of it starts from what the first learned. */
  private serialized<T>(folder: MailFolder, task: () => Promise<T>): Promise<T> {
    const previous = this.queue.get(folder) ?? Promise.resolve();
    const run = previous.then(task, task);
    // expected: whoever asked for `run` receives (and reports) its failure; the queue only needs to know it ended.
    this.queue.set(folder, run.then(() => undefined, () => undefined));
    return run;
  }

  /**
   * Lists a folder from its change feed when it has one. The first list of a full window downloads
   * it (`begin`); after that each list reads only what changed (`advance`), which is one small
   * request instead of the whole window. Anything the feed cannot answer falls back to a full download.
   */
  private async synced(folder: MailFolder, limit: number): Promise<MessageSummary[]> {
    if (!hasFeed(folder) || this.feedOff.has(folder)) return this.downloadFull(folder, limit);

    const state = this.trackedOf(folder);
    if (state) {
      // A write that finished while the feed was being read may be missing from what it said, so
      // that answer is read once more.
      for (let pass = 0; pass < 2; pass += 1) {
        const epoch = this.writeEpoch;
        if (!(await this.advance(folder, state))) {
          this.tracked.delete(folder);
          return this.begin(folder, limit);
        }
        if (epoch === this.writeEpoch) break;
      }
      // Mail left until less than a window remains: refill it now rather than show a short list.
      if (this.needsFullDownload(state)) {
        this.tracked.delete(folder);
        return this.begin(folder, limit);
      }
      return this.publish(folder, state, limit);
    }
    // A small peek (the notifier, a first page) never starts a feed; the whole window does.
    if (limit < MAIL_WINDOW) return this.downloadFull(folder, limit);
    return this.begin(folder, limit);
  }

  /** Downloads the folder in full and starts its change feed from there. */
  private async begin(folder: FeedFolder, limit: number): Promise<MessageSummary[]> {
    const rows = await this.fetchRows(folder, TRACKED_MAX);
    const state: Tracked = {
      link: "",
      // A full window means older mail may exist beyond it; fewer rows mean the folder is all here.
      since: rows.length >= TRACKED_MAX ? feedTime(rows[rows.length - 1].date) : null,
      syncedAt: Date.now(),
      savedAt: 0,
      dirty: true,
      rows: byId(rows),
    };
    this.tracked.set(folder, state);
    try {
      // So much arrived while the list downloaded that it is already out of date: it is shown as
      // it is, and the next list starts again.
      if (!(await this.catchUp(folder, state))) this.tracked.delete(folder);
    } catch (error) {
      // expected: the list itself succeeded and is shown; the feed's failure is recorded in `noteFeedFailure`.
      this.noteFeedFailure(folder, error);
    }
    if (this.tracked.get(folder) === state) return this.publish(folder, state, limit);
    return this.show(folder, this.newest(state), limit);
  }

  /**
   * Brings a folder up to date from its change feed. False means the feed cannot carry on (it
   * expired, too much arrived, or the window needs refilling) and the folder is downloaded in full.
   */
  private async advance(folder: FeedFolder, state: Tracked): Promise<boolean> {
    if (this.needsFullDownload(state)) return false;
    try {
      return await this.catchUp(folder, state);
    } catch (error) {
      if (!isStaleFeed(error)) throw error;
      logEvent("graph", `The change feed of ${folder} expired; downloading it in full`, "info");
      return false;
    }
  }

  private needsFullDownload(state: Tracked): boolean {
    if (Date.now() - state.syncedAt > FULL_REFRESH_MS) return true;
    // Mail was moved or deleted until less than a window is left, and older mail still exists.
    return state.since !== null && state.rows.size < MAIL_WINDOW;
  }

  /**
   * Reads the feed to its end and applies it to `state`: rows that left the folder go, read and
   * flag changes are copied over, and messages not seen before are downloaded by id.
   * False when more than `MAX_NEW_BY_ID` messages are new, or the link is not Graph's.
   */
  private async catchUp(folder: FeedFolder, state: Tracked): Promise<boolean> {
    const first = state.link === "";
    let next: string | null = first ? this.feedStart(folder, state.since) : this.relativeLink(state.link);
    if (next === null) return false;

    const changes = new Map<string, Change>();
    const gone = new Set<string>();
    let link: string | null = null;
    while (next !== null) {
      const page = changesSchema.parse(await this.request("GET", next, undefined, FEED_PAGE, "background"));
      for (const item of page.value) {
        if (item["@removed"]) {
          gone.add(item.id);
          changes.delete(item.id);
        } else {
          gone.delete(item.id);
          changes.set(item.id, item);
        }
      }
      link = page["@odata.deltaLink"] ?? link;
      next = this.relativeLink(page["@odata.nextLink"]);
    }
    if (link === null) throw new Error("Graph ended the change feed without a link to carry on from.");

    let dirty = first;
    for (const id of gone) if (state.rows.delete(id)) dirty = true;
    // The first round lists everything the feed covers, so a row missing from it has left the folder.
    if (first) {
      for (const id of [...state.rows.keys()]) if (!changes.has(id)) state.rows.delete(id);
    }
    const unknown: string[] = [];
    for (const [id, change] of changes) {
      const row = state.rows.get(id);
      if (!row) {
        unknown.push(id);
        continue;
      }
      const unread = change.isRead == null ? row.unread : !change.isRead;
      const pinned = change.flag?.flagStatus == null ? row.pinned : change.flag.flagStatus === "flagged";
      if (unread !== row.unread || pinned !== row.pinned) {
        state.rows.set(id, { ...row, unread, pinned });
        dirty = true;
      }
    }
    if (unknown.length > MAX_NEW_BY_ID) return false;

    const arrived = await Promise.all(unknown.map((id) => this.fetchSummary(folder, id)));
    for (const row of arrived) {
      if (!row) continue;
      state.rows.set(nativeOf(row), row);
      dirty = true;
    }
    state.link = link;
    state.dirty ||= dirty;
    return true;
  }

  /** The first request of a feed: only the fields that change, and only the part of the folder we keep. */
  private feedStart(folder: FeedFolder, since: string | null): string {
    const filter = since ? `&$filter=${encodeURIComponent(`receivedDateTime ge ${since}`)}` : "";
    return `/me/mailFolders/${WELL_KNOWN[folder]}/messages/delta?$select=id,isRead,flag${filter}`;
  }

  /** One message as the list shows it, or null when it is gone again by the time it is asked for. */
  private async fetchSummary(folder: FeedFolder, nativeId: string): Promise<MessageSummary | null> {
    try {
      const raw = await this.request(
        "GET",
        `/me/messages/${encodeURIComponent(nativeId)}?$select=${LIST_FIELDS}&$expand=${EXPAND_LAST_VERB}`,
        undefined,
        {},
        "background",
      );
      return this.summarize(messageSchema.parse(raw), folder);
    } catch (error) {
      // Moved or deleted again since the feed named it: the request was recorded, and the next feed round says so.
      if (error instanceof GraphError && error.status === 404) return null;
      throw error;
    }
  }

  /** What to do when a feed could not be started or read in `begin`. */
  private noteFeedFailure(folder: FeedFolder, error: unknown): void {
    if (isRefusedFeed(error)) {
      this.feedOff.add(folder);
      this.tracked.delete(folder);
      logEvent("graph", `Outlook did not accept a change feed for ${folder}; it is downloaded in full each time`, "info");
    }
    // A failed request was recorded where it happened; anything else (a timeout, an odd answer) is recorded here.
    if (!(error instanceof GraphError)) reportError("sync", `Could not read the change feed of ${folder}`, error);
  }

  /** The feed of a folder: this session's, else the one saved by a previous launch. */
  private trackedOf(folder: MailFolder): Tracked | undefined {
    const known = this.tracked.get(folder);
    if (known) return known;
    const saved = this.persist?.load(folder);
    if (!saved?.delta || saved.uidValidity !== CACHE_VALIDITY) return undefined;
    const state: Tracked = { ...saved.delta, savedAt: Date.now(), dirty: false, rows: byId(saved.messages) };
    this.tracked.set(folder, state);
    return state;
  }

  /** What a folder shows: the newest rows of the feed, with the feed trimmed to what it keeps. */
  private publish(folder: MailFolder, state: Tracked, limit: number): MessageSummary[] {
    const kept = this.newest(state);
    state.rows = byId(kept);
    const view = kept.slice(0, MAIL_WINDOW);
    if (state.dirty || Date.now() - state.savedAt > SAVE_FEED_EVERY_MS) {
      state.dirty = false;
      state.savedAt = Date.now();
      this.remember(folder, view);
    } else {
      this.cache.set(folder, view);
    }
    return view.slice(0, limit);
  }

  private show(folder: MailFolder, rows: MessageSummary[], limit: number): MessageSummary[] {
    const view = rows.slice(0, MAIL_WINDOW);
    this.remember(folder, view);
    return view.slice(0, limit);
  }

  private newest(state: Tracked): MessageSummary[] {
    return [...state.rows.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, TRACKED_MAX);
  }

  private async downloadFull(folder: MailFolder, limit: number): Promise<MessageSummary[]> {
    const rows = await this.fetchRows(folder, limit);
    this.remember(folder, rows);
    return rows;
  }

  /** The newest `limit` messages of a folder, newest first, read page by page. */
  private async fetchRows(folder: MailFolder, limit: number): Promise<MessageSummary[]> {
    const wellKnown = WELL_KNOWN[folder === "pinned" ? "inbox" : folder];
    const top = Math.min(limit, PAGE_MAX);
    // Graph rejects $orderby combined with a $filter on a different property.
    const query =
      folder === "pinned"
        ? `$filter=${encodeURIComponent("flag/flagStatus eq 'flagged'")}`
        : `$orderby=${encodeURIComponent("receivedDateTime desc")}`;
    const path = `/me/mailFolders/${wellKnown}/messages?$top=${top}&${query}&$select=${LIST_FIELDS}&$expand=${EXPAND_LAST_VERB}`;

    // Page through until the window is full: Graph never returns more than 100 at once.
    const value: GraphMessage[] = [];
    let next: string | null = path;
    while (next !== null && value.length < limit) {
      // A refresh nobody is waiting on lets what the person is looking at go first.
      const page = listSchema.parse(await this.request("GET", next, undefined, {}, "background"));
      value.push(...page.value);
      next = this.relativeLink(page["@odata.nextLink"]);
    }
    return value
      .slice(0, limit)
      .map((message) => this.summarize(message, folder))
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  }

  /**
   * A `@odata.nextLink` as a path for `request`. Only links back to Graph itself are followed:
   * the access token goes with every request.
   */
  private relativeLink(link: string | null | undefined): string | null {
    if (!link || !link.startsWith(`${GRAPH}/`)) return null;
    return link.slice(GRAPH.length);
  }

  /** The last list for this folder: this session's, else the copy from a previous launch. */
  cached(folder: MailFolder): MessageSummary[] {
    return (this.cache.get(folder) ?? this.persist?.load(folder)?.messages ?? []).slice(0, MAIL_WINDOW);
  }

  /** The list's row for a message: this session's, else the copy from a previous launch. */
  private rowOf(folder: MailFolder, nativeId: string): MessageSummary | undefined {
    const rows = this.cache.get(folder) ?? this.persist?.load(folder)?.messages ?? [];
    return rows.find((row) => nativeIdOf(row) === nativeId);
  }

  /** Runs `task` for each id, a few at a time and in the order asked for: a long conversation must not trip Graph's throttling. */
  private async inBatches<T>(nativeIds: readonly string[], task: (nativeId: string) => Promise<T>): Promise<T[]> {
    const results: T[] = [];
    for (let start = 0; start < nativeIds.length; start += GET_CONCURRENCY) {
      results.push(...(await Promise.all(nativeIds.slice(start, start + GET_CONCURRENCY).map(task))));
    }
    return results;
  }

  async get(folder: MailFolder, nativeIds: string[]): Promise<MessageDetail[]> {
    // A message downloaded before is read from the saved text, with the list's row for what changes (the flags).
    // An invitation is always asked for again: the answer to it can be given in another app.
    const opened = new Map<string, { summary: MessageSummary; body: StoredBody }>();
    const toDownload: string[] = [];
    for (const nativeId of nativeIds) {
      const row = this.rowOf(folder, nativeId);
      const saved = row ? this.bodies?.get(folder, nativeId, "") : undefined;
      if (row && saved && saved.invitation === null) opened.set(nativeId, { summary: row, body: saved });
      else toDownload.push(nativeId);
    }
    for (const [nativeId, found] of await this.downloaded(folder, toDownload)) opened.set(nativeId, found);

    // Images the text embeds are the only attachments ever downloaded for the page, and only when it is opened.
    return this.inBatches(
      nativeIds.filter((nativeId) => opened.has(nativeId)),
      async (nativeId) => {
        const { summary, body } = opened.get(nativeId)!;
        return detailFrom(summary, body, await this.embeddedImages(nativeId, body.html, body.inline));
      },
    );
  }

  /**
   * Downloads the text of these messages and keeps it (never the attachments or the embedded images,
   * which are only listed). Messages already kept are skipped.
   */
  async prefetch(folder: MailFolder, nativeIds: string[]): Promise<number> {
    if (!this.bodies) return 0;
    const wanted = this.bodies.missing(folder, nativeIds, "");
    return (await this.downloaded(folder, wanted, "background")).size;
  }

  /** Downloads and keeps these messages' text, answering with each one's row and text; an id Graph no longer has is left out. */
  private async downloaded(
    folder: MailFolder,
    nativeIds: readonly string[],
    lane: Lane = "foreground",
  ): Promise<Map<string, { summary: MessageSummary; body: StoredBody }>> {
    const found = new Map<string, { summary: MessageSummary; body: StoredBody }>();
    const select =
      `${LIST_FIELDS},body,ccRecipients,replyTo&$expand=attachments($select=id,name,contentType,size,isInline),${EXPAND_LAST_VERB}`;
    await this.inBatches(nativeIds, async (nativeId) => {
      const raw = await this.request(
        "GET",
        `/me/messages/${encodeURIComponent(nativeId)}?$select=${select}`,
        undefined,
        { Prefer: 'outlook.body-content-type="html"' },
        lane,
      );
      const message = messageSchema.parse(raw);
      const summary = this.summarize(message, folder);
      const references = (message.internetMessageHeaders ?? [])
        .find((header) => header.name.toLowerCase() === "references")
        ?.value.split(/\s+/)
        .filter(Boolean);

      const isHtml = message.body?.contentType.toLowerCase() === "html";
      const inline: InlineRef[] = (message.attachments ?? [])
        .filter(
          (file) =>
            file.isInline &&
            /^image\/(?:png|jpeg|gif|webp|bmp)$/i.test(file.contentType ?? "") &&
            file.size != null &&
            file.size <= MAX_INLINE_IMAGE_BYTES,
        )
        .slice(0, 25)
        .map((file) => ({ id: file.id, contentType: file.contentType ?? "", size: file.size ?? 0 }));
      const body: StoredBody = {
        cc: (message.ccRecipients ?? []).map(toContact),
        replyTo: message.replyTo?.[0] ? toContact(message.replyTo[0]) : null,
        messageId: message.internetMessageId ?? null,
        references: references ?? [],
        html: isHtml ? (message.body?.content ?? null) : null,
        text: isHtml ? null : (message.body?.content ?? null),
        attachments: (message.attachments ?? [])
          .filter((attachment) => !attachment.isInline)
          .map((attachment) => ({
            id: attachment.id,
            filename: attachment.name ?? "attachment",
            contentType: attachment.contentType ?? "application/octet-stream",
            size: attachment.size ?? 0,
          })),
        invitation: summary.signal === "invitation" ? await this.invitationOf(nativeId, summary.subject, lane) : null,
        inline,
      };
      this.bodies?.put(folder, nativeId, "", body, lane === "background" ? Date.parse(summary.date) : undefined);
      found.set(nativeId, { summary, body });
    });
    return found;
  }

  /** The text with the images it embeds by `cid:` put in, for the ones small enough to be worth it. */
  private async embeddedImages(nativeId: string, html: string | null, refs: readonly InlineRef[]): Promise<string | null> {
    if (!html || !/\bcid:/i.test(html) || refs.length === 0) return html;
    let result = html;
    let bytes = 0;
    for (const file of refs) {
      bytes += file.size;
      if (bytes > MAX_ATTACHMENT_BYTES) break;
      const path = `/me/messages/${encodeURIComponent(nativeId)}/attachments/${encodeURIComponent(file.id)}`;
      const parsed = attachmentFileSchema.safeParse(await this.request("GET", path).catch((error) => { reportError("sync", "Could not load an inline image of a message", error); return null; }));
      if (!parsed.success) continue;
      const { contentBytes, contentType, contentId } = parsed.data;
      if (!contentBytes || !contentId || !contentType || !/^image\/(?:png|jpeg|gif|webp|bmp)$/i.test(contentType)
        || !/^[a-z\d+/]+={0,2}$/i.test(contentBytes) || contentBytes.length > Math.ceil(MAX_INLINE_IMAGE_BYTES / 3) * 4) continue;
      const cid = contentId.replace(/^<|>$/g, "");
      result = result.replace(/(\bsrc\s*=\s*)(["'])cid:([^"']+)\2/gi, (match, prefix: string, quote: string, value: string) =>
        value === cid ? `${prefix}${quote}data:${contentType};base64,${contentBytes}${quote}` : match);
    }
    return result;
  }

  /** The meeting request or cancellation in a message, with its calendar event; null for any other message. */
  private async eventMessage(nativeId: string, lane: Lane = "foreground"): Promise<z.infer<typeof eventMessageSchema>> {
    const raw = await this.request(
      "GET",
      `/me/messages/${encodeURIComponent(nativeId)}?$expand=${encodeURIComponent("microsoft.graph.eventMessage/event")}`,
      undefined,
      { Prefer: 'outlook.timezone="UTC"' },
      lane,
    );
    return eventMessageSchema.parse(raw);
  }

  private async invitationOf(nativeId: string, subject: string, lane: Lane = "foreground"): Promise<Invitation | null> {
    let found: z.infer<typeof eventMessageSchema>;
    try {
      found = await this.eventMessage(nativeId, lane);
    } catch (error) {
      // Reading the event needs the calendar permission, which accounts added before it was asked for lack.
      // The message is still an invitation then, so the card shows it; answering explains what is missing.
      if (error instanceof GraphError && (error.status === 401 || error.status === 403)) {
        return { uid: nativeId, method: "REQUEST", title: subject, start: null, end: null, allDay: false, location: null, organizer: null, response: null };
      }
      reportError("sync", "Could not read the calendar event of an invitation", error);
      return null;
    }
    const method =
      found.meetingMessageType === "meetingRequest"
        ? "REQUEST"
        : found.meetingMessageType === "meetingCancelled"
          ? "CANCEL"
          : null;
    if (!method) return null;
    const event = found.event;
    const time = (value: z.infer<typeof eventTimeSchema> | null | undefined): string | null => {
      if (!value) return null;
      const iso = value.dateTime.replace(/(\.\d{3})\d+/, "$1");
      return new Date(`${iso}Z`).toISOString();
    };
    const allDay = Boolean(event?.isAllDay);
    const start = time(event?.start);
    const end = time(event?.end);
    const response = { accepted: "accepted", tentativelyAccepted: "tentative", declined: "declined" }[
      event?.responseStatus?.response ?? ""
    ] as Invitation["response"] | undefined;
    return {
      uid: event?.id ?? nativeId,
      method,
      title: event?.subject ?? subject,
      start: allDay && start ? start.slice(0, 10) : start,
      end: allDay && end ? end.slice(0, 10) : end,
      allDay,
      location: event?.location?.displayName || null,
      organizer: event?.organizer ? toContact(event.organizer) : null,
      response: response ?? null,
    };
  }

  async respondToInvitation(_folder: MailFolder, nativeId: string, response: InvitationResponse): Promise<void> {
    const endpoint = { accepted: "accept", tentative: "tentativelyAccept", declined: "decline" }[response];
    try {
      const { event } = await this.eventMessage(nativeId);
      if (!event) throw new Error("This invitation has no event on your calendar to answer.");
      await this.request("POST", `/me/events/${encodeURIComponent(event.id)}/${endpoint}`, { sendResponse: true });
    } catch (error) {
      if (error instanceof GraphError && (error.status === 401 || error.status === 403)) {
        throw new Error(CALENDAR_ACCESS_REQUIRED);
      }
      throw error;
    }
  }

  async attachment(_folder: MailFolder, nativeId: string, attachmentId: string): Promise<AttachmentFile> {
    const raw = await this.request(
      "GET",
      `/me/messages/${encodeURIComponent(nativeId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );
    const file = attachmentFileSchema.parse(raw);
    if (!file.contentBytes) throw new Error("This kind of attachment cannot be downloaded.");
    return {
      filename: file.name ?? "attachment",
      contentType: file.contentType ?? "application/octet-stream",
      data: Buffer.from(file.contentBytes, "base64"),
    };
  }

  private writes: Promise<unknown> = Promise.resolve();

  private runWrites<T>(run: () => Promise<T>): Promise<T> {
    const result = this.writes.then(run);
    this.writes = result.catch(() => undefined); // expected: the caller of the write receives (and reports) this error
    return result;
  }

  async act(action: MailAction, folder: MailFolder, nativeIds: string[]): Promise<MailActionResult[]> {
    const run = (nativeId: string): Promise<unknown> => {
      const base = `/me/messages/${encodeURIComponent(nativeId)}`;
      switch (action) {
        case "markRead":
          return this.request("PATCH", base, { isRead: true });
        case "markUnread":
          return this.request("PATCH", base, { isRead: false });
        case "pin":
          return this.request("PATCH", base, { flag: { flagStatus: "flagged" } });
        case "unpin":
          return this.request("PATCH", base, { flag: { flagStatus: "notFlagged" } });
        case "archive":
          return this.request("POST", `${base}/move`, { destinationId: WELL_KNOWN.archive });
        case "unarchive":
          return this.request("POST", `${base}/move`, { destinationId: WELL_KNOWN.inbox });
        case "trash":
          return this.request("POST", `${base}/move`, { destinationId: WELL_KNOWN.trash });
        case "spam":
          return this.request("POST", `${base}/move`, { destinationId: WELL_KNOWN.spam });
        case "deleteForever":
          return this.request("DELETE", base);
      }
    };

    // Share the worker pool across batches so concurrent requests respect the mailbox limit.
    return this.runWrites(async () => {
      let next = 0;
      const results: MailActionResult[] = new Array(nativeIds.length);
      const worker = async () => {
        while (next < nativeIds.length) {
          const index = next++;
          const id = nativeIds[index];
          try {
            const response = await run(id);
            const moved = z.object({ id: z.string() }).safeParse(response);
            results[index] = { id, status: "applied", nextId: moved.success ? moved.data.id : undefined };
          } catch (error) {
            // expected: returned as a per-message result, which the page records with the subject.
            const rejected = error instanceof GraphError && error.status < 500 && error.status !== 408;
            results[index] = { id, status: rejected ? "failed" : "unknown", error: describeError(error) };
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(ACT_CONCURRENCY, nativeIds.length) }, worker));
      const applied = new Set(results.filter((result) => result.status === "applied").map(({ id }) => id));
      if (applied.size) {
        // A moved message has another id where it went, and a deleted one has none: what was saved under it is of no use.
        if (action !== "markRead" && action !== "markUnread" && action !== "pin" && action !== "unpin") this.bodies?.remove(folder, [...applied]);
        this.patchCache(action, folder, applied);
        if (folder === "inbox") this.patchCache(action, "pinned", applied);
        if (folder === "pinned") this.patchCache(action, "inbox", applied);
      }
      return results;
    });
  }

  async send(draft: Draft): Promise<void> {
    const recipients = (contacts: Contact[]) =>
      contacts.map((contact) => ({
        emailAddress: { name: contact.name || undefined, address: contact.email },
      }));
    const message = {
      subject: draft.subject,
      body: draft.html ? { contentType: "HTML", content: draft.html } : { contentType: "Text", content: draft.text },
      toRecipients: recipients(draft.to),
      ccRecipients: recipients(draft.cc),
      bccRecipients: recipients(draft.bcc),
    };
    const files = draft.attachments ?? [];
    for (const file of files) {
      // Larger files need an upload session; say so instead of failing obscurely.
      if ((file.contentBase64.length * 3) / 4 > GRAPH_INLINE_ATTACHMENT_BYTES) {
        throw new Error(`"${file.filename}" is over 3 MB, the limit for attachments on this account.`);
      }
    }
    const attachments = files.map((file) => ({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: file.filename,
      contentType: file.contentType || "application/octet-stream",
      contentBytes: file.contentBase64,
      ...(file.contentId ? { contentId: file.contentId, isInline: true } : {}),
    }));

    if (draft.inReplyTo && (await this.sendAsReply(draft.inReplyTo, message, attachments))) return;
    await this.request("POST", "/me/sendMail", {
      message: attachments.length > 0 ? { ...message, attachments } : message,
      saveToSentItems: true,
    });
  }

  /**
   * Sends through a reply (or forward) draft of the original, so Exchange threads the message
   * and marks the original as replied to. Returns false when the original is gone (moved or
   * deleted since it was opened); the caller then sends it as a new message.
   */
  private async sendAsReply(
    inReplyTo: NonNullable<Draft["inReplyTo"]>,
    message: Record<string, unknown>,
    attachments: Record<string, unknown>[] = [],
  ): Promise<boolean> {
    // The composer passes the app's message id; Graph wants its own.
    const originalId = parseMessageId(inReplyTo.nativeId)?.nativeId ?? inReplyTo.nativeId;
    let draftId: string;
    try {
      const created = await this.request(
        "POST",
        `/me/messages/${encodeURIComponent(originalId)}/${REPLY_ENDPOINT[inReplyTo.mode]}`,
        {},
      );
      draftId = draftSchema.parse(created).id;
    } catch (error) {
      if (error instanceof GraphError && error.status === 404) return false;
      throw error;
    }

    const draftPath = `/me/messages/${encodeURIComponent(draftId)}`;
    try {
      // The composer already wrote the quoted original into the text, so it replaces Graph's own.
      await this.request("PATCH", draftPath, message);
      for (const attachment of attachments) {
        await this.request("POST", `${draftPath}/attachments`, attachment);
      }
      await this.request("POST", `${draftPath}/send`);
    } catch (error) {
      // Do not leave a half-written reply behind in Drafts.
      await this.request("DELETE", draftPath).catch((cleanup) => reportError("send", "Could not remove a half-written reply from Drafts", cleanup));
      throw error;
    }

    if (inReplyTo.mode !== "forward") this.markAnswered(originalId);
    return true;
  }

  /** Shows the reply mark at once instead of waiting for the next refresh. */
  private markAnswered(nativeId: string): void {
    const match = (row: MessageSummary) => nativeOf(row) === nativeId;
    for (const [folder, rows] of this.cache) {
      if (!rows.some(match)) continue;
      this.revise(folder, (all) => all.map((row) => (match(row) ? { ...row, answered: true } : row)));
    }
  }

  private remember(folder: MailFolder, rows: MessageSummary[]): void {
    this.cache.set(folder, rows);
    const state = this.tracked.get(folder);
    // A folder with a feed is saved with every row the feed tracks, not only the window shown, so
    // a later launch resumes with the same rows the feed's position belongs to.
    this.persist?.save(folder, {
      uidValidity: CACHE_VALIDITY,
      messages: state ? this.newest(state) : rows,
      delta: state && state.link !== "" ? { link: state.link, since: state.since, syncedAt: state.syncedAt } : undefined,
    });
  }

  /** Applies `change` to every copy of a folder's rows: the window shown and the rows its feed tracks. */
  private revise(folder: MailFolder, change: (rows: MessageSummary[]) => MessageSummary[]): void {
    const state = this.tracked.get(folder);
    if (state) state.rows = byId(change([...state.rows.values()]));
    const rows = this.cache.get(folder) ?? this.persist?.load(folder)?.messages;
    if (rows) this.remember(folder, change(rows));
  }

  /** Applies a finished action to the saved lists, so a moved message cannot reappear on launch. */
  private patchCache(action: MailAction, folder: MailFolder, nativeIds: ReadonlySet<string>): void {
    this.revise(folder, (rows) => patchSummaries(rows, action, folder, nativeIds));
  }

  async close(): Promise<void> {
    // Stateless HTTP: nothing to release.
  }

  private summarize(message: GraphMessage, folder: MailFolder): MessageSummary {
    const from = toContact(message.from);
    const subject = message.subject ?? "(no subject)";
    const headers: Record<string, string | undefined> = {};
    for (const header of message.internetMessageHeaders ?? []) {
      headers[header.name.toLowerCase()] = header.value;
    }
    return {
      id: makeMessageId({
        accountId: this.account.id,
        folder,
        nativeId: message.id,
      }),
      accountId: this.account.id,
      folder,
      threadId: message.conversationId ?? message.id,
      internetId: message.internetMessageId ?? undefined,
      from,
      to: (message.toRecipients ?? []).map(toContact),
      subject,
      snippet: makeSnippet(message.bodyPreview),
      date: new Date(message.receivedDateTime ?? message.sentDateTime ?? 0).toISOString(),
      unread: message.isRead === false,
      pinned: message.flag?.flagStatus === "flagged",
      answered: wasRepliedTo(message),
      hasAttachments: Boolean(message.hasAttachments),
      authenticated: message.internetMessageHeaders
        ? isAuthenticated(
            message.internetMessageHeaders.find(
              (header) => header.name.toLowerCase() === "authentication-results",
            )?.value,
            from.email,
          )
        : undefined,
      unsubscribe: message.internetMessageHeaders
        ? parseUnsubscribe(headers["list-unsubscribe"], headers["list-unsubscribe-post"], headers["list-id"])
        : undefined,
      categoryId: null,
      signal: classifyMessage({
        fromEmail: from.email,
        fromName: from.name,
        subject,
        headers,
        contentType: headers["content-type"],
      }),
    };
  }

  private async request(
    method: HttpMethod,
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
    lane: Lane = "foreground",
  ): Promise<unknown> {
    const started = Date.now();
    try {
      for (let attempt = 0; ; attempt += 1) {
        const token = await this.getAccessToken();
        // Only the call itself holds a place at the gate, not the wait before it is tried again.
        const { response, text } = await this.gate.run(lane, () =>
          this.exchange(method, path, body, extraHeaders, token),
        );
        // A throttled call was not carried out, so any method can go again; a failing server may
        // have carried it out, so only reads are repeated. Graph answers a transient backend fault
        // with a bare 500 `UnknownError`, so that is retried like a 502/503/504.
        const throttled = response.status === 429;
        const serverFault = method === "GET" && [500, 502, 503, 504].includes(response.status);
        const retryable =
          (throttled && attempt < MAX_RETRIES) ||
          (serverFault &&
            attempt < MAX_SERVER_FAULT_RETRIES &&
            Date.now() - started < SERVER_FAULT_BUDGET_MS);
        if (!retryable) return this.settle(method, path, response, text);

        const asked = Number(response.headers.get("retry-after"));
        const delay = Number.isFinite(asked) && asked > 0 ? asked * 1000 : 1000 * (attempt + 1);
        const waitMs = Math.min(delay, MAX_RETRY_WAIT_MS);
        const { code } = readError(text);
        // Not a failure yet: the request is tried again and usually goes through. The code tells
        // a limit on simultaneous connections from a limit on volume, and what the server asked
        // for shows whether the wait below is long enough.
        logEvent(
          "graph",
          `${method} ${describePath(path)} -> HTTP ${response.status}${code ? ` ${code}` : ""}, ` +
            `retry ${attempt + 1}/${throttled ? MAX_RETRIES : MAX_SERVER_FAULT_RETRIES} in ${waitMs / 1000}s` +
            (asked > 0 ? `, server asked for ${asked}s` : ""),
          "info",
        );
        await this.wait(waitMs);
      }
    } finally {
      // A write changes what a folder holds, so a list begun before it must not be handed to one
      // asked for after it.
      if (method !== "GET") {
        this.listing.clear();
        this.writeEpoch += 1;
      }
    }
  }

  /** One call to Graph, read to the end: the connection counts against the mailbox's limit until then. */
  private async exchange(
    method: HttpMethod,
    path: string,
    body: unknown,
    extraHeaders: Record<string, string>,
    token: string,
  ): Promise<{ response: Response; text: string }> {
    const response = await fetch(`${GRAPH}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return { response, text: await response.text() };
  }

  /** The answer that is final: its content, or the error it carries, which is recorded and thrown. */
  private settle(method: HttpMethod, path: string, response: Response, text: string): unknown {
    if (!response.ok) {
      const { code, reason } = readError(text);
      // Graph's 500 UnknownError arrives with an empty message; keep the status so it can be told apart.
      const message = reason
        ? [code, reason].filter(Boolean).join(": ")
        : `${code ?? "Error"} (HTTP ${response.status})`;
      reportError(
        "sync",
        `Outlook request failed: ${method} ${describePath(path)}`,
        `HTTP ${response.status} ${code ?? "no code"}${reason ? `: ${reason}` : ""}`,
      );
      throw new GraphError(this.explain(response.status, message), response.status);
    }
    if (response.status === 204 || response.status === 202) return undefined;
    return text ? (JSON.parse(text) as unknown) : undefined;
  }

  /** Adds guidance for the failures a university tenant tends to produce. */
  private explain(status: number, text: string): string {
    if (status === 403 || /MailboxNotEnabledForRESTAPI|ErrorAccessDenied/.test(text)) {
      return `${text}. This mailbox may not allow Microsoft Graph access; for a university account ask IT whether third-party mail apps are permitted.`;
    }
    return text;
  }
}

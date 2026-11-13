import { z } from "zod";

import { classifyMessage } from "@shared/classify";
import { makeMessageId, parseMessageId } from "@shared/ids";
import { isAuthenticated } from "@shared/logos";
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

import { logEvent } from "../log";
import { patchSummaries, type SummaryStore } from "./summary-cache";
import { makeSnippet, type AttachmentFile, type MailProvider } from "./types";

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
});

const listSchema = z.object({
  value: z.array(messageSchema),
  /** The next page, when there is more; Graph returns at most 100 messages per page. */
  "@odata.nextLink": z.string().nullish(),
});

/** Graph's largest page of messages. */
const PAGE_MAX = 100;

type GraphMessage = z.infer<typeof messageSchema>;

const LIST_FIELDS = [
  "id",
  "conversationId",
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
/** One request that has not answered by now is abandoned, so nothing waits on it indefinitely. */
const REQUEST_TIMEOUT_MS = 20_000;
/** Messages of one conversation downloaded at a time. */
const GET_CONCURRENCY = 4;
/**
 * Writes in flight at once. Graph allows 4 concurrent requests per mailbox (beyond that:
 * ApplicationThrottled / MailboxConcurrency), and reads may be running alongside, so stay under it.
 */
const ACT_CONCURRENCY = 3;

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

  constructor(
    private readonly account: Account,
    private readonly getAccessToken: () => Promise<string>,
    private readonly persist?: SummaryStore,
    private readonly wait: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  async verify(): Promise<void> {
    await this.request("GET", "/me/mailFolders/inbox?$select=id");
  }

  async list(folder: MailFolder, limit: number): Promise<MessageSummary[]> {
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
      const page = listSchema.parse(await this.request("GET", next));
      value.push(...page.value);
      next = this.relativeLink(page["@odata.nextLink"]);
    }
    const rows = value
      .slice(0, limit)
      .map((message) => this.summarize(message, folder))
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    this.remember(folder, rows);
    return rows;
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
    return this.cache.get(folder) ?? this.persist?.load(folder)?.messages ?? [];
  }

  async get(folder: MailFolder, nativeIds: string[]): Promise<MessageDetail[]> {
    const select =
      `${LIST_FIELDS},body,ccRecipients,replyTo,internetMessageId&$expand=attachments($select=id,name,contentType,size,isInline),${EXPAND_LAST_VERB}`;
    const fetchOne = async (nativeId: string): Promise<MessageDetail> => {
      const raw = await this.request(
        "GET",
        `/me/messages/${encodeURIComponent(nativeId)}?$select=${select}`,
        undefined,
        { Prefer: 'outlook.body-content-type="html"' },
      );
      const message = messageSchema.parse(raw);
      const summary = this.summarize(message, folder);
      const references = (message.internetMessageHeaders ?? [])
        .find((header) => header.name.toLowerCase() === "references")
        ?.value.split(/\s+/)
        .filter(Boolean);

      const isHtml = message.body?.contentType.toLowerCase() === "html";
      const invitation = summary.signal === "invitation" ? await this.invitationOf(nativeId, summary.subject) : null;
      return {
        ...summary,
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
        invitation,
      };
    };

    // A few at a time, in the order asked for: a long conversation must not trip Graph's throttling.
    const details: MessageDetail[] = [];
    for (let start = 0; start < nativeIds.length; start += GET_CONCURRENCY) {
      details.push(
        ...(await Promise.all(nativeIds.slice(start, start + GET_CONCURRENCY).map(fetchOne))),
      );
    }
    return details;
  }

  /** The meeting request or cancellation in a message, with its calendar event; null for any other message. */
  private async eventMessage(nativeId: string): Promise<z.infer<typeof eventMessageSchema>> {
    const raw = await this.request(
      "GET",
      `/me/messages/${encodeURIComponent(nativeId)}?$expand=${encodeURIComponent("microsoft.graph.eventMessage/event")}`,
      undefined,
      { Prefer: 'outlook.timezone="UTC"' },
    );
    return eventMessageSchema.parse(raw);
  }

  private async invitationOf(nativeId: string, subject: string): Promise<Invitation | null> {
    let found: z.infer<typeof eventMessageSchema>;
    try {
      found = await this.eventMessage(nativeId);
    } catch (error) {
      // Reading the event needs the calendar permission, which accounts added before it was asked for lack.
      // The message is still an invitation then, so the card shows it; answering explains what is missing.
      if (error instanceof GraphError && (error.status === 401 || error.status === 403)) {
        return { uid: nativeId, method: "REQUEST", title: subject, start: null, end: null, allDay: false, location: null, organizer: null, response: null };
      }
      logEvent("graph", `could not read the event of an invitation: ${error instanceof Error ? error.message : String(error)}`);
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
        throw new Error(
          "MiniMail does not have permission to answer invitations for this account yet. Remove the account and add it again to allow it.",
        );
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

  async act(action: MailAction, folder: MailFolder, nativeIds: string[]): Promise<void> {
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

    // A small pool rather than one request per message: marking a big group read must not trip
    // Graph's per-mailbox concurrency limit. After a failure no further requests start.
    let next = 0;
    let failure: { error: unknown } | undefined;
    const worker = async (): Promise<void> => {
      while (!failure && next < nativeIds.length) {
        const nativeId = nativeIds[next++]!;
        try {
          await run(nativeId);
        } catch (error) {
          failure ??= { error };
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(ACT_CONCURRENCY, nativeIds.length) }, worker),
    );
    if (failure) throw failure.error;
    this.patchCache(action, folder, new Set(nativeIds));
  }

  async send(draft: Draft): Promise<void> {
    const recipients = (contacts: Contact[]) =>
      contacts.map((contact) => ({
        emailAddress: { name: contact.name || undefined, address: contact.email },
      }));
    const message = {
      subject: draft.subject,
      body: { contentType: "Text", content: draft.text },
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
      await this.request("DELETE", draftPath).catch(() => undefined);
      throw error;
    }

    if (inReplyTo.mode !== "forward") this.markAnswered(originalId);
    return true;
  }

  /** Shows the reply mark at once instead of waiting for the next refresh. */
  private markAnswered(nativeId: string): void {
    for (const [folder, rows] of this.cache) {
      if (!rows.some((row) => parseMessageId(row.id)?.nativeId === nativeId)) continue;
      this.remember(
        folder,
        rows.map((row) =>
          parseMessageId(row.id)?.nativeId === nativeId ? { ...row, answered: true } : row,
        ),
      );
    }
  }

  private remember(folder: MailFolder, rows: MessageSummary[]): void {
    this.cache.set(folder, rows);
    this.persist?.save(folder, { uidValidity: CACHE_VALIDITY, messages: rows });
  }

  /** Applies a finished action to the saved lists, so a moved message cannot reappear on launch. */
  private patchCache(action: MailAction, folder: MailFolder, nativeIds: ReadonlySet<string>): void {
    const rows = this.cache.get(folder) ?? this.persist?.load(folder)?.messages;
    if (rows) this.remember(folder, patchSummaries(rows, action, folder, nativeIds));
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
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<unknown> {
    let response: Response;
    const started = Date.now();
    for (let attempt = 0; ; attempt += 1) {
      response = await fetch(`${GRAPH}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${await this.getAccessToken()}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...extraHeaders,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
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
      if (!retryable) break;
      const seconds = Number(response.headers.get("retry-after"));
      const delay = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000 * (attempt + 1);
      logEvent(
        "graph",
        `${method} ${describePath(path)} -> HTTP ${response.status}, retry ${attempt + 1}/${MAX_RETRIES}`,
      );
      await this.wait(Math.min(delay, MAX_RETRY_WAIT_MS));
    }

    if (!response.ok) {
      const detail: unknown = await response.json().catch(() => null);
      const message = z
        .object({ error: z.object({ code: z.string().optional(), message: z.string().optional() }) })
        .safeParse(detail);
      const code = message.success ? message.data.error.code : undefined;
      const reason = message.success ? message.data.error.message : undefined;
      // Graph's 500 UnknownError arrives with an empty message; keep the status so it can be told apart.
      const text = reason
        ? [code, reason].filter(Boolean).join(": ")
        : `${code ?? "Error"} (HTTP ${response.status})`;
      logEvent(
        "graph",
        `${method} ${describePath(path)} failed: HTTP ${response.status} ${code ?? "no code"}${reason ? `: ${reason}` : ""}`,
      );
      throw new GraphError(this.explain(response.status, text), response.status);
    }
    if (response.status === 204 || response.status === 202) return undefined;
    const text = await response.text();
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

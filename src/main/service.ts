import { randomUUID } from "node:crypto";

import { MAX_AVATAR_BYTES, normalizeAlias } from "@shared/accounts";
import { buildContactIndex, type ContactEntry } from "@shared/contacts";
import { makeMessageId, parseMessageId } from "@shared/ids";
import { diffList } from "@shared/list-changes";
import { MAIL_WINDOW } from "@shared/mail-window";
import { MOVE_DESTINATION } from "@shared/threads";
import type {
  Account,
  AccountError,
  AddAccountInput,
  Draft,
  InvitationResponse,
  ListChange,
  ListQuery,
  ListResult,
  MailAction,
  MailActionResult,
  MailFolder,
  MessageDetail,
  MessageSummary,
  UnsubscribeResult,
  SortCounts,
  SortFolder,
} from "@shared/types";

import {
  refreshAccessToken,
  signInWithGoogle,
  signInWithMicrosoft,
  type OAuthConfig,
  type OAuthIdentity,
  type OAuthTokens,
} from "./oauth";
import type { Categorizer } from "./categorizer";
import { sniffImage } from "./logos/icon-finder";
import type { InvitationAnswers } from "./invitation-answers";
import type { MailCache } from "./mail-cache";
import { GraphProvider } from "./providers/graph";
import { ImapProvider } from "./providers/imap";
import type { SummaryStore } from "./providers/summary-cache";
import { describeError, type AttachmentFile, type MailAuth, type MailProvider } from "./providers/types";
import { recordAction, recordInfo, reportError } from "./events";
import { perfLog, perfTime } from "./perf";
import { unsubscribeFrom } from "./unsubscribe";
import type { AccountSecret, AccountStore } from "./store";

const ACCOUNT_HUES = [210, 150, 30, 280, 340, 180];
/** Every list asks for the same window; see `MAIL_WINDOW`. */
const DEFAULT_LIMIT = MAIL_WINDOW;
/** How many recent messages of Sent and Inbox are read to learn who the user writes to. */
const CONTACT_SCAN_LIMIT = 300;
/** Refresh a little early so a token never expires mid-request. */
const TOKEN_SKEW_MS = 60_000;

/** Supplies fresh credentials for one account; passed to providers instead of raw secrets. */
interface CredentialSource {
  auth(): Promise<MailAuth>;
  accessToken(): Promise<string>;
}

/**
 * Owns the accounts and their providers, and fans requests out across accounts.
 * A failing account never blocks the others: errors are returned alongside results.
 */
export class MailService {
  private readonly providers = new Map<string, MailProvider>();
  private readonly refreshing = new Map<string, Promise<OAuthTokens>>();
  private readonly reconnecting = new Set<string>();
  /** Called when a provider pushes a change; set by `watch`. */
  private onPushed: (() => void) | null = null;

  constructor(
    private readonly store: AccountStore,
    private readonly oauthConfig: OAuthConfig,
    private readonly openExternal: (url: string) => Promise<void>,
    private readonly categorizer: Categorizer,
    /** Copies of recent lists kept between launches; omit to keep them in memory only. */
    private readonly mailCache?: MailCache,
    /** How the user answered invitations on accounts whose server does not record it; omit to forget them. */
    private readonly invitationAnswers?: InvitationAnswers,
  ) {}

  listAccounts(): Account[] {
    return this.store.list();
  }

  async addAccount(input: AddAccountInput): Promise<Account> {
    const authenticated = await this.authenticate(input);
    const { secret } = authenticated;
    const alias = normalizeAlias(input.alias);
    const account: Account = alias ? { ...authenticated.account, alias } : authenticated.account;

    this.checkDuplicate(account);
    await this.verifyAccount(account, secret);
    this.checkDuplicate(account);

    this.store.add(account, secret);
    this.startWatching(account);
    return account;
  }

  async reconnectAccount(accountId: string, calendarAccess: boolean): Promise<void> {
    const stored = this.store.get(accountId);
    if (!stored) throw new Error("That account no longer exists.");
    const { account } = stored;
    if (stored.secret.kind !== "oauth" || (account.provider !== "gmail" && account.provider !== "outlook")) {
      throw new Error("This account does not use browser sign-in.");
    }
    if (this.reconnecting.has(accountId)) {
      throw new Error("Sign-in for this account is already in progress.");
    }

    this.reconnecting.add(accountId);
    try {
      const identity = account.provider === "gmail"
        ? await signInWithGoogle(this.oauthConfig, this.openExternal, account.email)
        : await signInWithMicrosoft(
          this.oauthConfig,
          this.openExternal,
          {
            outlookKind: account.outlookKind,
            tenant: account.tenant,
            // Earlier builds requested calendar access when adding every Microsoft account.
            calendarAccess: calendarAccess || (stored.secret.calendarAccess ?? true),
          },
          account.email,
        );
      if (identity.email.toLowerCase() !== account.email.toLowerCase()) {
        throw new Error(`Sign in as ${account.email} to reconnect this account.`);
      }
      if (calendarAccess && account.provider === "outlook" && !identity.tokens.calendarAccess) {
        throw new Error("Microsoft did not grant calendar access. Your mail connection is still available.");
      }
      const secret = this.oauthSecret(identity.tokens);
      await this.verifyAccount(account, secret);
      if (!this.store.updateSecret(accountId, secret)) {
        throw new Error("That account no longer exists.");
      }

      const provider = this.providers.get(accountId);
      this.providers.delete(accountId);
      await provider?.close().catch((error: unknown) => {
        reportError("sync", "Could not close the old connection after reconnecting", `${account.provider}: ${describeError(error)}`, { accountId: account.id });
      });
      if (this.store.get(accountId)) this.startWatching(account);
    } finally {
      this.reconnecting.delete(accountId);
    }
  }

  private checkDuplicate(account: Account): void {
    const duplicate = this.store.list().some(
      (existing) =>
        (existing.provider === account.provider ||
          (existing.provider === "zoho" && account.provider === "imap") ||
          (existing.provider === "imap" && account.provider === "zoho")) &&
        existing.email.toLowerCase() === account.email.toLowerCase(),
    );
    if (duplicate) throw new Error(`${account.email} is already added.`);
  }

  /** Prove the credentials work before saving them. */
  private async verifyAccount(account: Account, secret: AccountSecret): Promise<void> {
    const probe = this.createProvider(account, this.staticCredentials(secret));
    try {
      await probe.verify();
    } finally {
      await probe.close();
    }
  }

  /**
   * Asks every account that can be pushed to for changes, now and for accounts added later.
   * `onChange` runs when any of them reports new, removed or re-flagged mail.
   */
  watch(onChange: () => void): void {
    this.onPushed = onChange;
    for (const account of this.store.list()) this.startWatching(account);
  }

  /** True when every account is being pushed to right now, so none needs to be polled. */
  allPushing(): boolean {
    return this.store.list().every((account) => this.providers.get(account.id)?.watching?.() === true);
  }

  private startWatching(account: Account): void {
    if (this.onPushed) this.providerFor(account).watch?.(this.onPushed);
  }

  /** Renames an account inside MiniMail only; nothing is sent to the provider. Blank clears it. */
  setAlias(accountId: string, alias: string): Account {
    const updated = this.store.setAlias(accountId, normalizeAlias(alias));
    if (!updated) throw new Error("That account no longer exists.");
    return updated;
  }

  /** Sets or removes the picture shown for an account; only real small images are accepted. */
  setAvatar(accountId: string, avatar: string | null): Account {
    if (avatar !== null) {
      const bytes = Buffer.from(avatar.slice(avatar.indexOf(",") + 1), "base64");
      const image = sniffImage(bytes);
      if (!image || !/^image\/(png|jpeg|webp)$/.test(image.mime) || bytes.length > MAX_AVATAR_BYTES) {
        throw new Error("That picture cannot be used. Choose a PNG, JPEG or WebP image under 60 KB.");
      }
    }
    const updated = this.store.setAvatar(accountId, avatar ?? undefined);
    if (!updated) throw new Error("That account no longer exists.");
    return updated;
  }

  async removeAccount(accountId: string): Promise<void> {
    const provider = this.providers.get(accountId);
    this.providers.delete(accountId);
    await provider?.close();
    this.store.remove(accountId);
    this.mailCache?.dropAccount(accountId);
  }

  async list(query: ListQuery): Promise<ListResult> {
    const wanted = query.accountIds ?? [];
    const accounts = this.store
      .list()
      .filter((account) => wanted.length === 0 || wanted.includes(account.id));

    if (query.cacheOnly) {
      // No network: whatever each provider last saw, so the page can paint while the live list loads.
      const cachedRows = accounts.flatMap((account) => this.providerFor(account).cached?.(query.folder) ?? []);
      cachedRows.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
      perfLog(`list ${query.folder} from cache`, `${cachedRows.length} messages`);
      return { messages: this.categorizer.apply(cachedRows, query.folder), errors: [] };
    }

    const listStarted = performance.now();
    // The copy kept before this list, read only for the refresh buttons (see `ListQuery.changes`).
    const before = query.changes
      ? accounts.map((account) => this.providerFor(account).cached?.(query.folder) ?? [])
      : null;
    const settled = await Promise.allSettled(
      accounts.map((account) =>
        perfTime(
          `list ${query.folder} ${account.provider}`,
          () => this.providerFor(account).list(query.folder, query.limit ?? DEFAULT_LIMIT),
          (found) => `${found.length} messages`,
        ),
      ),
    );

    const messages: MessageSummary[] = [];
    const errors: AccountError[] = [];
    const changes: ListChange[] = [];
    settled.forEach((outcome, index) => {
      if (outcome.status === "fulfilled") {
        messages.push(...outcome.value);
        if (before) changes.push(diffList(accounts[index].id, before[index], outcome.value));
      } else {
        const message = describeError(outcome.reason);
        reportError("sync", `Could not sync ${accounts[index].provider} (${query.folder})`, message, { accountId: accounts[index].id });
        errors.push({ accountId: accounts[index].id, message });
      }
    });
    messages.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    const categorized = this.categorizer.apply(messages, query.folder);
    perfLog(
      `list ${query.folder} done`,
      `${Math.round(performance.now() - listStarted)}ms for ${accounts.length} accounts, ${messages.length} messages`,
    );
    return { messages: categorized, errors, ...(before ? { changes } : {}) };
  }

  /**
   * Conversations a sort with these options would send to Jev, per folder. Counts what this
   * computer holds for each folder (the same window the lists show), so a folder never opened
   * here reads 0.
   */
  sortCounts(since: number | null): SortCounts {
    const accounts = this.store.list();
    const count = (folder: MailFolder): number =>
      this.categorizer.countToSort(
        accounts.flatMap((account) => this.providerFor(account).cached?.(folder) ?? []),
        since,
      );
    return {
      inbox: count("inbox"),
      archive: count("archive"),
      spam: count("spam"),
      trash: count("trash"),
    };
  }

  /** Lists these folders so a running "sort again" meets their mail (listing queues it). */
  async sortFolders(folders: readonly SortFolder[]): Promise<void> {
    await Promise.allSettled(folders.map((folder) => this.list({ folder })));
  }

  async get(ids: string[]): Promise<MessageDetail[]> {
    const byProvider = this.groupByProviderFolder(ids);
    const fetched = new Map<string, MessageDetail>();
    await Promise.all(
      [...byProvider.values()].map(async ({ accountId, folder, nativeIds }) => {
        const details = await perfTime(
          `get ${folder} ${nativeIds.length} message(s)`,
          () => this.providerForId(accountId).get(folder, nativeIds),
          (found) => `${found.length} returned`,
        );
        for (const detail of details) fetched.set(detail.id, this.withAnswer(detail));
      }),
    );
    return ids.flatMap((id) => {
      const detail = fetched.get(id);
      return detail ? [detail] : [];
    });
  }

  /** Fills in the user's answer to an invitation when the account's server does not report one. */
  private withAnswer(detail: MessageDetail): MessageDetail {
    const invitation = detail.invitation;
    if (!invitation || invitation.response || invitation.method !== "REQUEST") return detail;
    const answer = this.invitationAnswers?.get(detail.accountId, invitation.uid) ?? null;
    return answer ? { ...detail, invitation: { ...invitation, response: answer } } : detail;
  }

  /** Downloads one attachment of a message. */
  async attachment(id: string, attachmentId: string): Promise<AttachmentFile> {
    const ref = parseMessageId(id);
    if (!ref) throw new Error("That message no longer exists.");
    return this.providerForId(ref.accountId).attachment(ref.folder, ref.nativeId, attachmentId);
  }

  /** Answers the invitation in a message, and remembers the answer where the server will not. */
  async respondToInvitation(id: string, response: InvitationResponse): Promise<void> {
    const ref = parseMessageId(id);
    if (!ref) throw new Error("That message no longer exists.");
    const provider = this.providerForId(ref.accountId);
    const [detail] = await provider.get(ref.folder, [ref.nativeId]);
    const invitation = detail?.invitation;
    if (!invitation || invitation.method !== "REQUEST") throw new Error("This message has no invitation to answer.");
    await provider.respondToInvitation(ref.folder, ref.nativeId, response);
    this.invitationAnswers?.set(ref.accountId, invitation.uid, response);
  }

  async act(action: MailAction, ids: string[]): Promise<MailActionResult[]> {
    const destination = MOVE_DESTINATION[action];
    const groups = this.groupByProviderFolder([...new Set(ids)]);
    const batches = await Promise.all([...groups.values()].map(async ({ accountId, folder, nativeIds }) => {
      const source = folder === "pinned" ? "inbox" : folder;
      try {
        const results: MailActionResult[] = destination === source
          ? nativeIds.map((id) => ({ id, status: "applied", nextId: id }))
          : await this.providerForId(accountId).act(action, folder, nativeIds);
        return results.map((result): MailActionResult => {
          const id = makeMessageId({ accountId, folder, nativeId: result.id });
          if (result.status !== "applied") return { ...result, id };
          const nextId = destination && result.nextId
            ? makeMessageId({ accountId, folder: destination, nativeId: result.nextId })
            : undefined;
          return { id, status: "applied", nextId };
        });
      } catch (error) {
        // expected: returned as a per-message result, which the page records with the subject.
        return nativeIds.map((nativeId): MailActionResult => ({
          id: makeMessageId({ accountId, folder, nativeId }),
          status: "unknown",
          error: describeError(error),
        }));
      }
    }));
    return batches.flat();
  }

  /**
   * Unsubscribes from the list behind each message. The sender's address is read again from the
   * message on the server, never taken from the window. Each message stands alone: one that cannot
   * be read, or whose sender refuses, does not stop the others, and each failure is written to the
   * log (the sender's host and the reason, never the full address, which carries a personal token).
   */
  async unsubscribe(ids: string[]): Promise<UnsubscribeResult[]> {
    const wanted = [...new Set(ids)];
    const found = new Map<string, MessageDetail>();
    const unreadable = new Map<string, string>();
    await Promise.all(
      [...this.groupByProviderFolder(wanted).values()].map(async ({ accountId, folder, nativeIds }) => {
        try {
          for (const detail of await this.providerForId(accountId).get(folder, nativeIds)) found.set(detail.id, detail);
        } catch (error) {
          // expected: reported below, per message, with the reason (see `unreadable`).
          const reason = describeError(error);
          for (const nativeId of nativeIds) unreadable.set(makeMessageId({ accountId, folder, nativeId }), reason);
        }
      }),
    );
    return Promise.all(
      wanted.map(async (id): Promise<UnsubscribeResult> => {
        const detail = found.get(id);
        if (!detail) {
          const reason = unreadable.get(id);
          reportError("unsubscribe", "Could not unsubscribe: the message could not be read", reason ?? "the server did not return it");
          return {
            id,
            status: "failed",
            error: reason
              ? `The mail server could not give MiniMail this message (${reason}).`
              : "The mail server no longer has this message.",
          };
        }
        const result = await unsubscribeFrom(detail);
        if (result.status === "failed") {
          let host = "unknown host";
          try {
            host = new URL(detail.unsubscribe?.url ?? "").host || host;
          } catch {
            // expected: no usable address; the reason in the error below says why.
          }
          reportError("unsubscribe", "Could not unsubscribe", `${host}: ${result.error}`, {
            context: detail.subject,
            accountId: detail.accountId,
          });
        } else if (result.status === "done") {
          recordAction("unsubscribe", "Unsubscribed from a mailing list", "", { context: detail.subject, accountId: detail.accountId });
        } else {
          recordInfo("unsubscribe", "The sender needs the unsubscribe finished on its web page", "", { context: detail.subject, accountId: detail.accountId });
        }
        return result;
      }),
    );
  }

  async send(draft: Draft): Promise<void> {
    const context = draft.subject || "(no subject)";
    try {
      await this.providerForId(draft.accountId).send(draft);
    } catch (error) {
      reportError("send", "Could not send the message", error, { context, accountId: draft.accountId });
      throw error;
    }
    recordAction("send", "Sent a message", "", { context, accountId: draft.accountId });
  }

  /**
   * The address book behind recipient suggestions: who we sent mail to and who wrote to us, read
   * from every account's Sent and Inbox. A folder that cannot be listed falls back to the copy
   * kept on disk, and one that fails either way is skipped, so suggestions never block composing.
   */
  async contacts(): Promise<ContactEntry[]> {
    const accounts = this.store.list();
    const folders: MailFolder[] = ["sent", "inbox"];
    const batches = await Promise.all(
      accounts.flatMap((account) =>
        folders.map(async (folder): Promise<MessageSummary[]> => {
          const provider = this.providerFor(account);
          try {
            return await provider.list(folder, CONTACT_SCAN_LIMIT);
          } catch (error) {
            reportError("sync", `Could not read ${folder} to build the address book`, `${account.provider}: ${describeError(error)}`, { accountId: account.id });
            return provider.cached?.(folder) ?? [];
          }
        }),
      ),
    );
    const own = new Set(accounts.map((account) => account.email.toLowerCase()));
    return buildContactIndex(batches.flat(), own);
  }

  async dispose(): Promise<void> {
    await Promise.allSettled([...this.providers.values()].map((provider) => provider.close()));
    this.providers.clear();
  }

  /** Turns user input into an account record plus its secret, running OAuth when needed. */
  private async authenticate(
    input: AddAccountInput,
  ): Promise<{ account: Account; secret: AccountSecret }> {
    const hue = ACCOUNT_HUES[this.store.list().length % ACCOUNT_HUES.length];

    if (input.kind === "password") {
      const email = input.email.trim();
      return {
        account: {
          id: randomUUID(),
          provider: input.provider,
          email,
          displayName: (input.provider !== "imap" && input.displayName?.trim()) || email.split("@")[0],
          auth: "password",
          hue,
          zohoRegion: input.provider === "zoho" ? (input.zohoRegion ?? "com") : undefined,
          zohoWorkplace: input.provider === "zoho" ? Boolean(input.zohoWorkplace) : undefined,
          imapSettings: input.provider === "imap" ? input.imapSettings : undefined,
        },
        secret: { kind: "password", password: input.password },
      };
    }

    if (input.provider === "gmail") {
      const identity = await signInWithGoogle(this.oauthConfig, this.openExternal, input.email);
      return {
        account: this.oauthAccount("gmail", identity, hue),
        secret: this.oauthSecret(identity.tokens),
      };
    }

    const identity = await signInWithMicrosoft(
      this.oauthConfig,
      this.openExternal,
      { outlookKind: input.outlookKind, tenant: input.tenant },
      input.email,
    );
    return {
      account: {
        ...this.oauthAccount("outlook", identity, hue),
        outlookKind: input.outlookKind,
        tenant: input.outlookKind === "personal" ? undefined : input.tenant,
      },
      secret: this.oauthSecret(identity.tokens),
    };
  }

  private oauthAccount(provider: "gmail" | "outlook", identity: OAuthIdentity, hue: number): Account {
    return {
      id: randomUUID(),
      provider,
      email: identity.email,
      displayName: identity.name,
      auth: "oauth",
      hue,
    };
  }

  private oauthSecret(tokens: OAuthTokens): Extract<AccountSecret, { kind: "oauth" }> {
    return {
      kind: "oauth",
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresAt,
      calendarAccess: tokens.calendarAccess,
    };
  }

  private providerForId(accountId: string): MailProvider {
    const account = this.store.list().find((candidate) => candidate.id === accountId);
    if (!account) throw new Error("That account no longer exists.");
    return this.providerFor(account);
  }

  private providerFor(account: Account): MailProvider {
    let provider = this.providers.get(account.id);
    if (!provider) {
      provider = this.createProvider(
        account,
        this.storedCredentials(account),
        this.mailCache?.forAccount(account.id),
      );
      this.providers.set(account.id, provider);
    }
    return provider;
  }

  private createProvider(
    account: Account,
    credentials: CredentialSource,
    persist?: SummaryStore,
  ): MailProvider {
    return account.provider === "outlook"
      ? new GraphProvider(account, () => credentials.accessToken(), persist)
      : new ImapProvider(account, () => credentials.auth(), persist);
  }

  /** Credentials that are fixed for the duration of the sign-in probe. */
  private staticCredentials(secret: AccountSecret): CredentialSource {
    return {
      auth: async () =>
        secret.kind === "password"
          ? { pass: secret.password }
          : { accessToken: secret.accessToken },
      accessToken: async () => {
        if (secret.kind !== "oauth" || !secret.accessToken) {
          throw new Error("This account does not use an access token.");
        }
        return secret.accessToken;
      },
    };
  }

  /** Credentials read from the store on demand, refreshing OAuth tokens as they expire. */
  private storedCredentials(account: Account): CredentialSource {
    const accessToken = async (): Promise<string> => {
      const stored = this.store.get(account.id);
      if (!stored || stored.secret.kind !== "oauth") {
        throw new Error("This account does not use an access token.");
      }
      const { secret } = stored;
      if (secret.accessToken && secret.expiresAt && secret.expiresAt - TOKEN_SKEW_MS > Date.now()) {
        return secret.accessToken;
      }

      let pending = this.refreshing.get(account.id);
      if (!pending) {
        pending = refreshAccessToken(this.oauthConfig, account, secret.refreshToken)
          .then((tokens) => {
            // A browser reconnect may have replaced this token during the refresh.
            if (this.store.get(account.id)?.secret === secret) {
              this.store.updateSecret(account.id, {
                ...this.oauthSecret(tokens),
                calendarAccess: secret.calendarAccess,
              });
            }
            return tokens;
          })
          .finally(() => this.refreshing.delete(account.id));
        this.refreshing.set(account.id, pending);
      }
      return (await pending).accessToken;
    };

    return {
      accessToken,
      auth: async () => {
        const stored = this.store.get(account.id);
        if (!stored) throw new Error("That account no longer exists.");
        return stored.secret.kind === "password"
          ? { pass: stored.secret.password }
          : { accessToken: await accessToken() };
      },
    };
  }

  private groupByProviderFolder(
    ids: string[],
  ): Map<string, { accountId: string; folder: MailFolder; nativeIds: string[] }> {
    const groups = new Map<string, { accountId: string; folder: MailFolder; nativeIds: string[] }>();
    for (const id of ids) {
      const ref = parseMessageId(id);
      if (!ref) throw new Error(`Invalid message id: ${id}`);
      const key = `${ref.accountId}|${ref.folder}`;
      const group = groups.get(key);
      if (group) group.nativeIds.push(ref.nativeId);
      else groups.set(key, { accountId: ref.accountId, folder: ref.folder, nativeIds: [ref.nativeId] });
    }
    return groups;
  }
}

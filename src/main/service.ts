import { randomUUID } from "node:crypto";

import { MAX_AVATAR_BYTES, normalizeAlias } from "@shared/accounts";
import { buildContactIndex, type ContactEntry } from "@shared/contacts";
import { parseMessageId } from "@shared/ids";
import { MAIL_WINDOW } from "@shared/mail-window";
import type {
  Account,
  AccountError,
  AddAccountInput,
  Draft,
  ListQuery,
  ListResult,
  MailAction,
  MailFolder,
  MessageDetail,
  MessageSummary,
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
import type { MailCache } from "./mail-cache";
import { GraphProvider } from "./providers/graph";
import { ImapProvider } from "./providers/imap";
import type { SummaryStore } from "./providers/summary-cache";
import { describeError, type MailAuth, type MailProvider } from "./providers/types";
import { perfLog, perfTime } from "./perf";
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
  /** Called when a provider pushes a change; set by `watch`. */
  private onPushed: (() => void) | null = null;

  constructor(
    private readonly store: AccountStore,
    private readonly oauthConfig: OAuthConfig,
    private readonly openExternal: (url: string) => Promise<void>,
    private readonly categorizer: Categorizer,
    /** Copies of recent lists kept between launches; omit to keep them in memory only. */
    private readonly mailCache?: MailCache,
  ) {}

  listAccounts(): Account[] {
    return this.store.list();
  }

  async addAccount(input: AddAccountInput): Promise<Account> {
    const authenticated = await this.authenticate(input);
    const { secret } = authenticated;
    const alias = normalizeAlias(input.alias);
    const account: Account = alias ? { ...authenticated.account, alias } : authenticated.account;

    const duplicate = this.store
      .list()
      .some(
        (existing) =>
          existing.provider === account.provider &&
          existing.email.toLowerCase() === account.email.toLowerCase(),
      );
    if (duplicate) throw new Error(`${account.email} is already added.`);

    // Prove the credentials work before anything is saved.
    const probe = this.createProvider(account, this.staticCredentials(secret));
    try {
      await probe.verify();
    } finally {
      await probe.close();
    }

    this.store.add(account, secret);
    this.startWatching(account);
    return account;
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
    settled.forEach((outcome, index) => {
      if (outcome.status === "fulfilled") messages.push(...outcome.value);
      else errors.push({ accountId: accounts[index].id, message: describeError(outcome.reason) });
    });
    messages.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    const categorized = this.categorizer.apply(messages, query.folder);
    perfLog(
      `list ${query.folder} done`,
      `${Math.round(performance.now() - listStarted)}ms for ${accounts.length} accounts, ${messages.length} messages`,
    );
    return { messages: categorized, errors };
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
        for (const detail of details) fetched.set(detail.id, detail);
      }),
    );
    return ids.flatMap((id) => {
      const detail = fetched.get(id);
      return detail ? [detail] : [];
    });
  }

  async act(action: MailAction, ids: string[]): Promise<void> {
    const byProvider = this.groupByProviderFolder(ids);
    await Promise.all(
      [...byProvider.values()].map(({ accountId, folder, nativeIds }) =>
        this.providerForId(accountId).act(action, folder, nativeIds),
      ),
    );
  }

  async send(draft: Draft): Promise<void> {
    await this.providerForId(draft.accountId).send(draft);
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
          } catch {
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
          displayName: input.displayName?.trim() || email.split("@")[0],
          auth: "password",
          hue,
          zohoRegion: input.provider === "zoho" ? (input.zohoRegion ?? "com") : undefined,
          zohoWorkplace: input.provider === "zoho" ? Boolean(input.zohoWorkplace) : undefined,
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
        tenant: input.outlookKind === "work-school" ? input.tenant?.trim() || undefined : undefined,
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

  private oauthSecret(tokens: OAuthTokens): AccountSecret {
    return {
      kind: "oauth",
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresAt,
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
        pending = refreshAccessToken(this.oauthConfig, account, secret.refreshToken).finally(() => {
          this.refreshing.delete(account.id);
        });
        this.refreshing.set(account.id, pending);
      }
      const tokens = await pending;
      this.store.updateSecret(account.id, this.oauthSecret(tokens));
      return tokens.accessToken;
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

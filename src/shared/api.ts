import type {
  Account,
  AddAccountInput,
  Category,
  CategoryState,
  Draft,
  ListQuery,
  ListResult,
  MailAction,
  MessageDetail,
} from "./types";
import type { LogoRequest, LogoSettings } from "./logos";

/** Which sign-in methods this build can offer (OAuth needs client ids at build time). */
export interface AccountCapabilities {
  googleOAuth: boolean;
  microsoftOAuth: boolean;
}

/**
 * Everything the renderer may ask of the main process. The preload script exposes
 * exactly this object as `window.minimail`; in a plain browser (dev:web) the
 * renderer swaps in a demo implementation with the same shape.
 */
export interface MiniMailApi {
  accounts: {
    list(): Promise<Account[]>;
    add(input: AddAccountInput): Promise<Account>;
    remove(accountId: string): Promise<void>;
    /** Names the account in MiniMail only. A blank alias clears it. Returns the updated account. */
    setAlias(accountId: string, alias: string): Promise<Account>;
    /** Sets (a small image `data:` URL) or removes (null) the picture shown for the account. */
    setAvatar(accountId: string, avatar: string | null): Promise<Account>;
    capabilities(): Promise<AccountCapabilities>;
  };
  mail: {
    list(query: ListQuery): Promise<ListResult>;
    get(ids: string[]): Promise<MessageDetail[]>;
    act(action: MailAction, ids: string[]): Promise<void>;
    send(draft: Draft): Promise<void>;
    /** Fires when the main process thinks the mailbox changed (server push, poll tick, window focus). */
    onChanged(listener: () => void): () => void;
  };
  categories: {
    /** Categories plus the state of the AI classifier. */
    get(): Promise<CategoryState>;
    /** Replaces the whole list. Rejects invalid or duplicate names and empty criteria. */
    save(categories: Category[]): Promise<CategoryState>;
    /** Stores a Vercel AI Gateway key (encrypted) and turns AI classification on. */
    setGatewayKey(key: string): Promise<CategoryState>;
    clearGatewayKey(): Promise<CategoryState>;
    /** Makes one tiny classification call so a bad key or network problem shows up now. */
    testGateway(): Promise<void>;
    /** Forgets every classification so the next refresh sorts all mail again with current criteria. */
    reclassify(options?: { since?: string }): Promise<void>;
  };
  senders: {
    /** Addresses whose remote images load without asking (lowercase). */
    trusted(): Promise<string[]>;
    /** Remembers a sender; returns the updated list. */
    trust(email: string): Promise<string[]>;
    untrust(email: string): Promise<string[]>;
  };
  logos: {
    /**
     * Logos and photos for the given requests, as `data:` URLs keyed by `logoKey`; null where
     * there is none or the setting is off. Never fails: a lookup that errors answers null.
     */
    get(requests: LogoRequest[]): Promise<Record<string, string | null>>;
    settings(): Promise<LogoSettings>;
    setSettings(settings: LogoSettings): Promise<LogoSettings>;
  };
  system: {
    openExternal(url: string): Promise<void>;
    platform: string;
    /** True when running the demo backend instead of real accounts. */
    demo: boolean;
  };
}

declare global {
  interface Window {
    minimail?: MiniMailApi;
  }
}

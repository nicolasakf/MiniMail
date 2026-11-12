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
  SavedDraft,
  UiPrefs,
  SortCounts,
  SortFolder,
  SortOptions,
} from "./types";
import type { ContactEntry } from "./contacts";
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
    /**
     * One-time codes in verification mail, by message id: the code, or null when there is none.
     * An id is missing when the lookup failed and may be tried again later.
     */
    verificationCodes(ids: string[]): Promise<Record<string, string | null>>;
    /** Everyone we have sent mail to or received mail from, for recipient suggestions. */
    contacts(): Promise<ContactEntry[]>;
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
    /** Sets the gateway model that reads codes the rules cannot ("" turns the fallback off). */
    setCodeModel(model: string): Promise<CategoryState>;
    /** Chooses which folders' newly arrived mail is sorted automatically (none turns automatic sorting off). */
    setSortFolders(folders: SortFolder[]): Promise<CategoryState>;
    /** Makes one tiny classification call so a bad key or network problem shows up now. */
    testGateway(): Promise<void>;
    /** Forgets every classification so the next refresh sorts all mail again with current criteria. */
    reclassify(options?: SortOptions): Promise<void>;
    /** How many conversations a sort with these options would send to Jev, per folder. */
    sortCounts(options?: Pick<SortOptions, "since">): Promise<SortCounts>;
  };
  senders: {
    /** Addresses whose remote images load without asking (lowercase). */
    trusted(): Promise<string[]>;
    /** Remembers a sender; returns the updated list. */
    trust(email: string): Promise<string[]>;
    untrust(email: string): Promise<string[]>;
  };
  drafts: {
    /** Drafts kept on this computer, most recently saved first. */
    list(): Promise<SavedDraft[]>;
    /** Writes the draft to disk (replacing the one with the same id); rejects if it could not be saved. */
    save(draft: SavedDraft): Promise<SavedDraft[]>;
    remove(id: string): Promise<SavedDraft[]>;
  };
  prefs: {
    /** The view tab and list filters the app reopens with. */
    get(): Promise<UiPrefs>;
    /** Remembers the given choices (the others keep their value). */
    set(patch: Partial<UiPrefs>): Promise<void>;
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

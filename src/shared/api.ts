import type { ComposeLibrary } from "./compose-library";
import type { ImapSettings } from "./imap-settings";
import type {
  Account,
  AddAccountInput,
  Category,
  CategoryState,
  Draft,
  DraftAttachment,
  InvitationResponse,
  ListQuery,
  ListResult,
  MailAction,
  MailActionResult,
  MessageDetail,
  SavedDraft,
  ScheduledMessage,
  UiPrefs,
  SortCounts,
  SortFolder,
  SortOptions,
  UnsubscribeResult,
} from "./types";
import type { ContactEntry } from "./contacts";
import type { AppEvent, EventReport } from "./events";
import type { LogoRequest, LogoSettings } from "./logos";
import type { NotificationSettings, OpenConversationRequest } from "./notifications";

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
    discover(email: string): Promise<Account["provider"] | null>;
    discoverImap(email: string): Promise<ImapSettings | null>;
    add(input: AddAccountInput): Promise<Account>;
    reconnect(accountId: string, calendarAccess?: boolean): Promise<void>;
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
    act(action: MailAction, ids: string[]): Promise<MailActionResult[]>;
    /**
     * Unsubscribes from the list behind each message (one per sender): a one-click sender is told
     * right away; one that only has a web page comes back as `manual` with the page to open.
     */
    unsubscribe(ids: string[]): Promise<UnsubscribeResult[]>;
    send(draft: Draft): Promise<void>;
    /**
     * One-time codes in verification mail, by message id: the code, or null when there is none.
     * An id is missing when the lookup failed and may be tried again later.
     */
    verificationCodes(ids: string[]): Promise<Record<string, string | null>>;
    /** Downloads one attachment and opens it with the app the system picks (risky types are shown in their folder instead). */
    openAttachment(messageId: string, attachmentId: string): Promise<void>;
    /** Downloads one attachment to a place the user chooses; false when they cancel. */
    saveAttachment(messageId: string, attachmentId: string): Promise<boolean>;
    /** Downloads one attachment into the form a message being written carries (used to continue a server draft). */
    attachmentContent(messageId: string, attachmentId: string): Promise<DraftAttachment>;
    /** Answers the calendar invitation in a message; the organizer is told. */
    respondToInvitation(messageId: string, response: InvitationResponse): Promise<void>;
    /** Everyone we have sent mail to or received mail from, for recipient suggestions. */
    contacts(): Promise<ContactEntry[]>;
    /** Fires when the main process thinks the mailbox changed (server push, poll tick, window focus). */
    onChanged(listener: () => void): () => void;
    /** Fires when the user clicks a notification about one message: the page should open that conversation. */
    onOpenConversation(listener: (request: OpenConversationRequest) => void): () => void;
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
    /**
     * Files conversations (`accountId:threadId`) under a category by hand, or under none (null).
     * Sorting again leaves such conversations where the user put them.
     */
    /** `ref` goes on the Log event, so the page can offer an Undo on it. */
    assign(threads: string[], categoryId: string | null, ref?: string): Promise<void>;
  };
  senders: {
    /** Addresses whose remote images load without asking (lowercase). */
    trusted(): Promise<string[]>;
    /** Remembers a sender; returns the updated list. */
    trust(email: string): Promise<string[]>;
    untrust(email: string): Promise<string[]>;
  };
  composeLibrary: {
    get(): Promise<ComposeLibrary>;
    set(value: ComposeLibrary): Promise<ComposeLibrary>;
  };
  delivery: {
    list(): Promise<ScheduledMessage[]>;
    schedule(record: SavedDraft, draft: Draft, sendAt: number): Promise<void>;
    cancel(id: string): Promise<void>;
  };
  composerWindow: {
    open(draft: SavedDraft): Promise<void>;
    focus(draftId: string): Promise<boolean>;
    initialDraft(): Promise<SavedDraft | null>;
    finish(): Promise<void>;
    onCloseRequested(listener: () => void): () => void;
  };
  drafts: {
    onChanged(listener: () => void): () => void;
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
  notifications: {
    settings(): Promise<NotificationSettings>;
    /** Replaces the settings; answers with what was stored. Rejects invalid values. */
    setSettings(settings: NotificationSettings): Promise<NotificationSettings>;
    /** Shows a sample notification so the user can check that the system lets MiniMail show them. */
    test(): Promise<void>;
  };
  events: {
    /** The journal: every error and the newest other events from the last 30 days, newest first. */
    list(): Promise<AppEvent[]>;
    /** Marks every error so far as done: "Errors only" stops showing them; they stay listed until they age out. */
    markDone(): Promise<void>;
    /** Opens main.log with the computer's default app for it. Rejects when there is no log file to open. */
    openLog(): Promise<void>;
    /** Tells the journal something happened in the page. Fire and forget: never waits, never throws. */
    report(report: EventReport): void;
    /** New or changed events, batched; returns the way to stop listening. */
    onChanged(listener: (events: AppEvent[]) => void): () => void;
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

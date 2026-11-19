import { senderDomain } from "./categories";
import type { Thread } from "./threads";
import type { MessageSummary } from "./types";

/**
 * Notification settings and the rule that decides whether a new message notifies.
 * Pure on purpose: the main process applies it, the settings dialog describes it, and the tests
 * run it without Electron.
 */

/** Folders mail can arrive in and a notification can be asked for. */
export const NOTIFY_FOLDERS = ["inbox", "archive", "spam", "trash"] as const;
export type NotifyFolder = (typeof NOTIFY_FOLDERS)[number];

/** The conversation a clicked notification asks the page to open. */
export interface OpenConversationRequest {
  accountId: string;
  /** The provider's thread id (`MessageSummary.threadId`), not the page's `${accountId}:${threadId}`. */
  threadId: string;
  /** The folder the message arrived in. */
  folder: NotifyFolder;
}

/** Stands for mail that sits in no category, in the category filter. */
export const NO_CATEGORY = "__none__";

/** How the category filter reads its list: every category, only these, or all but these. */
export type CategoryFilterMode = "all" | "only" | "except";

/** What a notification shows of the message. */
export type NotificationContent = "full" | "sender" | "hidden";

/** The choices an account can set for itself instead of following the defaults for all accounts. */
export interface AccountNotificationSettings {
  /** Off means this account never notifies and stays out of the Dock badge. */
  enabled: boolean;
  /** Folders whose arriving mail notifies. Spam and Trash are left out by default. */
  folders: NotifyFolder[];
  categories: { mode: CategoryFilterMode; ids: string[] };
  /** Addresses (`jo@acme.com`) or whole domains (`@acme.com`) that never notify. */
  mutedSenders: string[];
  /** Show the sender, the subject and a preview; the sender only; or just "New mail". */
  content: NotificationContent;
  /** Play the system sound with each notification. */
  sound: boolean;
  /** Stay quiet while MiniMail is the window in front. */
  muteWhenFocused: boolean;
}

/** The keys an account can override, in the order the page lists them. */
export const ACCOUNT_SETTING_KEYS = [
  "enabled",
  "folders",
  "categories",
  "mutedSenders",
  "content",
  "sound",
  "muteWhenFocused",
] as const satisfies readonly (keyof AccountNotificationSettings)[];
export type AccountSettingKey = (typeof ACCOUNT_SETTING_KEYS)[number];

export interface NotificationSettings extends AccountNotificationSettings {
  /**
   * The fields above are what every account does unless it has its own say (`enabled` is the master
   * switch for accounts that have not overridden it). Here, per account, only the choices that differ.
   */
  accounts: Record<string, Partial<AccountNotificationSettings>>;
  /** Show the number of unread Inbox messages on the Dock icon. */
  dockBadge: boolean;
  /** Fold several messages that arrive together into one notification. */
  groupBursts: boolean;
  /**
   * Conversations (`accountId:threadId`) whose new messages never notify. Kept once for all
   * accounts, since the id already names the account.
   */
  mutedThreads: string[];
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  folders: ["inbox"],
  accounts: {},
  categories: { mode: "all", ids: [] },
  mutedSenders: [],
  content: "full",
  sound: true,
  dockBadge: true,
  muteWhenFocused: true,
  groupBursts: true,
  mutedThreads: [],
};

/** Most entries in each list, so a settings file cannot grow without bound. */
export const MAX_MUTED_SENDERS = 200;
export const MAX_NOTIFICATION_IDS = 200;
export const MAX_MUTED_THREADS = 1000;

/** Messages older than this never notify: a message dragged into a folder is not "arriving". */
export const FRESH_MS = 10 * 60_000;
/** Notify with one summary instead of one per message from this many at once. */
export const BURST_SIZE = 4;

/** What applies to one account: its own choices where it has any, the defaults everywhere else. */
export function settingsForAccount(
  settings: NotificationSettings,
  accountId: string,
): AccountNotificationSettings {
  const own = Object.hasOwn(settings.accounts, accountId) ? settings.accounts[accountId] : undefined;
  const pick = <K extends AccountSettingKey>(key: K): AccountNotificationSettings[K] =>
    own?.[key] ?? settings[key];
  return {
    enabled: pick("enabled"),
    folders: pick("folders"),
    categories: pick("categories"),
    mutedSenders: pick("mutedSenders"),
    content: pick("content"),
    sound: pick("sound"),
    muteWhenFocused: pick("muteWhenFocused"),
  };
}

/** Normalizes what the user typed into the muted list: lowercase `a@b.c` or `@b.c`, or null. */
export function normalizeMutedSender(input: string): string | null {
  const value = input.trim().toLowerCase();
  if (/^@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)) return value;
  if (/^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)) return value;
  return null;
}

/** Whether mail from this address is muted: the address, its exact host (`@mail.acme.com`) or its company domain (`@acme.com`). */
export function isSenderMuted(email: string, muted: readonly string[]): boolean {
  const address = email.trim().toLowerCase();
  const host = address.slice(address.lastIndexOf("@"));
  return muted.includes(address) || muted.includes(host) || muted.includes(`@${senderDomain(address)}`);
}

/** What the muted list stores for a sender address or for a domain (as `senderDomain` names it). */
export function mutedKey(kind: "senders" | "domains", value: string): string {
  const key = value.trim().toLowerCase();
  return kind === "domains" ? `@${key.replace(/^@/, "")}` : key;
}

/** The id a conversation is muted by: the same `accountId:threadId` form the priority list uses. */
export function mutedThreadId(message: Pick<MessageSummary, "accountId" | "threadId">): string {
  return `${message.accountId}:${message.threadId}`;
}

/** The settings with these conversations muted (or, with `muted` false, unmuted). Oldest drop past the cap. */
export function withMutedThreads(
  settings: NotificationSettings,
  threadIds: readonly string[],
  muted: boolean,
): NotificationSettings {
  const rest = settings.mutedThreads.filter((id) => !threadIds.includes(id));
  const next = muted ? [...rest, ...threadIds.filter((id, at) => threadIds.indexOf(id) === at)].slice(-MAX_MUTED_THREADS) : rest;
  return { ...settings, mutedThreads: next };
}

/**
 * The settings with these entries muted (or, with `muted` false, unmuted) for the accounts. An
 * account that keeps its own muted list changes that list; every other account follows the shared
 * one, which changes once.
 */
export function withMutedSenders(
  settings: NotificationSettings,
  accountIds: readonly string[],
  keys: readonly string[],
  muted: boolean,
): NotificationSettings {
  const edit = (list: readonly string[]): string[] => {
    const rest = list.filter((entry) => !keys.includes(entry));
    return muted ? [...rest, ...keys.filter((key, at) => keys.indexOf(key) === at)].slice(-MAX_MUTED_SENDERS) : rest;
  };
  const accounts = { ...settings.accounts };
  let shared = false;
  for (const id of accountIds) {
    const own = Object.hasOwn(accounts, id) ? accounts[id] : undefined;
    if (own?.mutedSenders) accounts[id] = { ...own, mutedSenders: edit(own.mutedSenders) };
    else shared = true;
  }
  return { ...settings, accounts, ...(shared ? { mutedSenders: edit(settings.mutedSenders) } : {}) };
}

/** Whether the entry is muted for every one of these accounts. */
export function isMutedForAccounts(settings: NotificationSettings, accountIds: readonly string[], key: string): boolean {
  return accountIds.length > 0 && accountIds.every((id) => settingsForAccount(settings, id).mutedSenders.includes(key));
}

/** Whether the category filter lets this message through. */
export function categoryAllowed(
  filter: NotificationSettings["categories"],
  categoryId: string | null,
): boolean {
  if (filter.mode === "all") return true;
  const listed = filter.ids.includes(categoryId ?? NO_CATEGORY);
  return filter.mode === "only" ? listed : !listed;
}

/** Whether the conversation is muted, itself or through its newest sender or that sender's domain (the name a list shows). */
export function isMutedThread(settings: NotificationSettings, thread: Pick<Thread, "id" | "accountId" | "latest">): boolean {
  if (settings.mutedThreads.includes(thread.id)) return true;
  return isSenderMuted(thread.latest.from.email, settingsForAccount(settings, thread.accountId).mutedSenders);
}

/**
 * Whether a message that just arrived notifies, by everything except the moment: the focus check
 * belongs to the delivery, not to the message.
 */
export function messageNotifies(message: MessageSummary, settings: NotificationSettings): boolean {
  const own = settingsForAccount(settings, message.accountId);
  if (!own.enabled || !message.unread) return false;
  if (settings.mutedThreads.includes(mutedThreadId(message))) return false;
  if (!(own.folders as readonly string[]).includes(message.folder)) return false;
  if (isSenderMuted(message.from.email, own.mutedSenders)) return false;
  return categoryAllowed(own.categories, message.categoryId);
}

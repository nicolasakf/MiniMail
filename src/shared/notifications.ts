import type { MessageSummary } from "./types";

/**
 * Notification settings and the rule that decides whether a new message notifies.
 * Pure on purpose: the main process applies it, the settings dialog describes it, and the tests
 * run it without Electron.
 */

/** Folders mail can arrive in and a notification can be asked for. */
export const NOTIFY_FOLDERS = ["inbox", "archive", "spam", "trash"] as const;
export type NotifyFolder = (typeof NOTIFY_FOLDERS)[number];

/** Stands for mail that sits in no category, in the category filter. */
export const NO_CATEGORY = "__none__";

/** How the category filter reads its list: every category, only these, or all but these. */
export type CategoryFilterMode = "all" | "only" | "except";

/** What a notification shows of the message. */
export type NotificationContent = "full" | "sender" | "hidden";

export interface NotificationSettings {
  /** Master switch. Off means no notification, badge or sound at all. */
  enabled: boolean;
  /** Folders whose arriving mail notifies. Spam and Trash are left out by default. */
  folders: NotifyFolder[];
  /** Accounts that stay silent. */
  mutedAccountIds: string[];
  categories: { mode: CategoryFilterMode; ids: string[] };
  /** Addresses (`jo@acme.com`) or whole domains (`@acme.com`) that never notify. */
  mutedSenders: string[];
  /** Show the sender, the subject and a preview; the sender only; or just "New mail". */
  content: NotificationContent;
  /** Play the system sound with each notification. */
  sound: boolean;
  /** Show the number of unread Inbox messages on the Dock icon. */
  dockBadge: boolean;
  /** Stay quiet while MiniMail is the window in front. */
  muteWhenFocused: boolean;
  /** Fold several messages that arrive together into one notification. */
  groupBursts: boolean;
  quietHours: {
    enabled: boolean;
    /** "HH:MM", 24-hour. A start later than the end spans midnight. */
    start: string;
    end: string;
  };
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  folders: ["inbox"],
  mutedAccountIds: [],
  categories: { mode: "all", ids: [] },
  mutedSenders: [],
  content: "full",
  sound: true,
  dockBadge: true,
  muteWhenFocused: true,
  groupBursts: true,
  quietHours: { enabled: false, start: "22:00", end: "07:00" },
};

/** Most entries in each list, so a settings file cannot grow without bound. */
export const MAX_MUTED_SENDERS = 200;
export const MAX_NOTIFICATION_IDS = 200;

/** Messages older than this never notify: a message dragged into a folder is not "arriving". */
export const FRESH_MS = 10 * 60_000;
/** Notify with one summary instead of one per message from this many at once. */
export const BURST_SIZE = 4;

/** The time as minutes since midnight, or null when `value` is not "HH:MM". */
export function parseClock(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** True when `now` falls inside the quiet hours (which may run past midnight). */
export function inQuietHours(quiet: NotificationSettings["quietHours"], now: Date): boolean {
  if (!quiet.enabled) return false;
  const start = parseClock(quiet.start);
  const end = parseClock(quiet.end);
  if (start === null || end === null || start === end) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/** Normalizes what the user typed into the muted list: lowercase `a@b.c` or `@b.c`, or null. */
export function normalizeMutedSender(input: string): string | null {
  const value = input.trim().toLowerCase();
  if (/^@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)) return value;
  if (/^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)) return value;
  return null;
}

export function isSenderMuted(email: string, muted: readonly string[]): boolean {
  const address = email.trim().toLowerCase();
  const domain = address.slice(address.lastIndexOf("@"));
  return muted.includes(address) || muted.includes(domain);
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

/**
 * Whether a message that just arrived notifies, by everything except time: the quiet hours and
 * focus checks belong to the moment of delivery, not to the message.
 */
export function messageNotifies(message: MessageSummary, settings: NotificationSettings): boolean {
  if (!settings.enabled || !message.unread) return false;
  if (!(settings.folders as readonly string[]).includes(message.folder)) return false;
  if (settings.mutedAccountIds.includes(message.accountId)) return false;
  if (isSenderMuted(message.from.email, settings.mutedSenders)) return false;
  return categoryAllowed(settings.categories, message.categoryId);
}

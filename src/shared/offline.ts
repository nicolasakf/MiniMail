/**
 * The Advanced page's choices about keeping mail on this computer. Pure on purpose: the main
 * process applies it, the settings page edits it, and the tests run it without Electron.
 */

/** The fewest and most days of mail the app may download ahead of time. */
export const MIN_LOOKBACK_DAYS = 1;
export const MAX_LOOKBACK_DAYS = 365;

/** The smallest and largest disk budget (in megabytes) a person can set for saved text. */
export const MIN_MEGABYTES = 50;
export const MAX_MEGABYTES = 51_200;

/** Folders whose mail may be downloaded ahead of time (the ones shown in the Inbox list's folder buttons). */
export const OFFLINE_FOLDERS = ["inbox", "archive", "trash", "spam"] as const;
export type OfflineFolder = (typeof OFFLINE_FOLDERS)[number];

/** What bounds the saved text: how old the mail is, how much disk it takes, or nothing. */
export const OFFLINE_LIMITS = ["days", "size", "unlimited"] as const;
export type OfflineLimit = (typeof OFFLINE_LIMITS)[number];

export interface OfflineSettings {
  /**
   * Download the text of recent mail in the background, as it arrives, so opening it needs no
   * network. Off means a message is downloaded when it is opened (and kept for next time).
   */
  prefetch: boolean;
  /** Which folders are downloaded ahead of time. At least one. */
  folders: OfflineFolder[];
  /** What bounds the saved text: `days` uses `lookbackDays`, `size` uses `maxMegabytes`, `unlimited` neither. */
  limit: OfflineLimit;
  /** With `limit: "days"`: how many days back, from today, mail is downloaded ahead of time. */
  lookbackDays: number;
  /** With `limit: "size"`: the disk the saved text may take, in megabytes. */
  maxMegabytes: number;
}

export const DEFAULT_OFFLINE_SETTINGS: OfflineSettings = {
  prefetch: true,
  folders: ["inbox"],
  limit: "days",
  lookbackDays: 30,
  maxMegabytes: 512,
};

/** With a limit in days the file still has a ceiling, so a long look-back cannot fill the disk by surprise. */
export const DAYS_LIMIT_CEILING_BYTES = 2 * 1024 * 1024 * 1024;

const DAY_MS = 24 * 60 * 60 * 1000;
const MEGABYTE = 1024 * 1024;

/** The oldest date (ms since the epoch) a message may have and still be downloaded ahead of time; null means any age. */
export function prefetchSince(settings: OfflineSettings, now: number): number | null {
  return settings.limit === "days" ? now - settings.lookbackDays * DAY_MS : null;
}

/** The most bytes the saved text may take, or null when there is no limit. */
export function storeLimitBytes(settings: OfflineSettings): number | null {
  if (settings.limit === "unlimited") return null;
  return settings.limit === "size" ? settings.maxMegabytes * MEGABYTE : DAYS_LIMIT_CEILING_BYTES;
}

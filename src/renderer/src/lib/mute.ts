import { isMutedForAccounts, mutedKey, withMutedSenders, withMutedThreads, type NotificationSettings } from "@shared/notifications";

import type { MuteKind } from "./blocklist";

/**
 * Whether a sender (or a domain) is muted for the accounts the conversations belong to, or a conversation (by its id) is muted. Muting only
 * silences notifications: it uses the muted senders of the Notifications page, so the two stay one list.
 * Until the settings have loaded nothing counts as muted.
 */
export function mutedCheck(
  settings: NotificationSettings | null,
  accountIds: readonly string[],
): (kind: MuteKind, value: string) => boolean {
  return (kind, value) => {
    if (settings === null) return false;
    if (kind === "threads") return settings.mutedThreads.includes(value);
    return isMutedForAccounts(settings, accountIds, mutedKey(kind, value));
  };
}

/** The settings with these senders, domains or conversations muted (or unmuted); senders and domains per account. */
export function withMute(
  settings: NotificationSettings,
  accountIds: readonly string[],
  kind: MuteKind,
  values: readonly string[],
  muted: boolean,
): NotificationSettings {
  if (kind === "threads") return withMutedThreads(settings, values, muted);
  return withMutedSenders(settings, accountIds, values.map((value) => mutedKey(kind, value)), muted);
}

/**
 * The settings with these entries (`a@b.c`, `@b.c`) muted, or unmuted, for every account: each account that keeps
 * its own list changes it, and so does the shared one. This is what the Senders page does, since it has no
 * account menu.
 */
export function withMutedEverywhere(
  settings: NotificationSettings,
  accountIds: readonly string[],
  keys: readonly string[],
  muted: boolean,
): NotificationSettings {
  const next = withMutedSenders(settings, accountIds, keys, muted);
  return muted ? next : { ...next, mutedSenders: next.mutedSenders.filter((key) => !keys.includes(key)) };
}

/** Every sender or domain muted for at least one account, in the form the muted lists store (`a@b.c`, `@b.c`). */
export function allMutedKeys(settings: NotificationSettings): string[] {
  const keys = new Set(settings.mutedSenders);
  for (const own of Object.values(settings.accounts)) for (const key of own.mutedSenders ?? []) keys.add(key);
  return [...keys];
}

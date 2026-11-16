import type { BlockKind } from "@shared/blocklist";
import { isMutedForAccounts, mutedKey, withMutedSenders, type NotificationSettings } from "@shared/notifications";

/**
 * Whether a sender (or a domain) is muted for the accounts the conversations belong to. Muting only
 * silences notifications: it uses the muted senders of the Notifications page, so the two stay one list.
 * Until the settings have loaded nothing counts as muted.
 */
export function mutedCheck(
  settings: NotificationSettings | null,
  accountIds: readonly string[],
): (kind: BlockKind, value: string) => boolean {
  return (kind, value) => settings !== null && isMutedForAccounts(settings, accountIds, mutedKey(kind, value));
}

/** The settings with these senders or domains muted (or unmuted) for the accounts. */
export function withMute(
  settings: NotificationSettings,
  accountIds: readonly string[],
  kind: BlockKind,
  values: readonly string[],
  muted: boolean,
): NotificationSettings {
  return withMutedSenders(settings, accountIds, values.map((value) => mutedKey(kind, value)), muted);
}

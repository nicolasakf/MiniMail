/**
 * Accounts that cannot be pushed to (Outlook), or whose push connection is down, are polled this
 * often. The rest rely on the server and only get the slow safety refresh below.
 */
export const POLL_INTERVAL_MS = 15_000;
/** Refresh at least this often even when every account is pushing, in case a push was missed. */
export const SAFETY_POLL_MS = 5 * 60_000;
/**
 * After the computer wakes, the network is often "up" before names resolve and connections open,
 * so a refresh right away only fails. Wait this long first.
 */
export const RESUME_GRACE_MS = 5_000;

/**
 * Decides when MiniMail asks the accounts for new mail on its own (the timer, the window coming
 * to the front). Offline, or just after waking, every request would only time out and log an
 * error, so it waits; the first chance after the network is back refreshes at once.
 */
export class Polling {
  /** What is on screen may be out of date: something wanted a refresh and could not have one. */
  private stale = false;
  private lastRefresh: number;
  private resumedAt = Number.NEGATIVE_INFINITY;
  private online = true;

  constructor(
    private readonly now: () => number = Date.now,
    /** Called once each time the network goes away or comes back. */
    private readonly onNetwork: (online: boolean) => void = () => undefined,
  ) {
    this.lastRefresh = now();
  }

  /** A refresh was sent, by whichever route (the timer, a push from a server). */
  refreshed(): void {
    this.lastRefresh = this.now();
    this.stale = false;
  }

  /** The computer woke up: what was loaded before is old, and the network needs a moment. */
  resumed(): void {
    this.stale = true;
    this.resumedAt = this.now();
  }

  /** The timer fired. True when accounts should be asked for new mail now. */
  tick(online: boolean, allPushing: boolean): boolean {
    if (!this.allowed(online)) return false;
    if (this.stale || !allPushing || this.now() - this.lastRefresh >= SAFETY_POLL_MS) return true;
    return false;
  }

  /** The window came to the front. True when it may refresh; if not, the next tick does. */
  focused(online: boolean): boolean {
    if (this.allowed(online)) return true;
    this.stale = true;
    return false;
  }

  /** Whether the network is usable right now; remembers that a refresh is owed when it is not. */
  private allowed(online: boolean): boolean {
    if (online !== this.online) {
      this.online = online;
      this.onNetwork(online);
    }
    if (!online) {
      this.stale = true;
      return false;
    }
    if (this.now() - this.resumedAt < RESUME_GRACE_MS) {
      this.stale = true;
      return false;
    }
    return true;
  }
}

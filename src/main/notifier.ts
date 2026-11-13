import {
  BURST_SIZE,
  FRESH_MS,
  inQuietHours,
  messageNotifies,
  NOTIFY_FOLDERS,
  type NotificationSettings,
  type NotifyFolder,
} from "@shared/notifications";
import type { ListResult, MessageSummary } from "@shared/types";

export interface ShownNotification {
  title: string;
  body: string;
  silent: boolean;
}

export interface NotifierDeps {
  settings: () => NotificationSettings;
  /** Lists a folder across every account, live. */
  list: (folder: NotifyFolder) => Promise<ListResult>;
  accountIds: () => string[];
  /** MiniMail is the window in front. */
  focused: () => boolean;
  show: (notification: ShownNotification) => void;
  /** Sets the Dock badge; 0 clears it. */
  setBadge: (count: number) => void;
  /** The AI sorter still has conversations to sort, so categories may be about to change. */
  sortingBusy: () => boolean;
  now?: () => Date;
}

/** How long a new message waits for the AI sorter before it is judged by the category it has. */
const SORT_GRACE_MS = 30_000;
/** Checks closer together than this are skipped: one push often fires several events. */
const MIN_GAP_MS = 4_000;
/** Most separate notifications for one check when grouping is off; the rest fold into one. */
const MAX_INDIVIDUAL = 6;

const FOLDER_NAMES: Record<NotifyFolder, string> = {
  inbox: "Inbox",
  archive: "Archive",
  spam: "Spam",
  trash: "Trash",
};

function senderName(message: MessageSummary): string {
  return message.from.name.trim() || message.from.email;
}

/**
 * Turns "a message appeared in a folder" into operating-system notifications. It remembers what
 * each account's folder held at the last check, so only mail that is new since then can notify:
 * the first look at an account or folder only learns what is already there.
 */
export class Notifier {
  /** `${accountId}|${folder}` → ids that folder held at the last check. */
  private known = new Map<string, Set<string>>();
  /** When a message first waited for the AI sorter. */
  private waiting = new Map<string, number>();
  private running = false;
  private rerun = false;
  private lastRun = 0;
  /** The user moved mail themselves, so what shows up in Archive, Spam or Trash is not "arriving". */
  private userMovedMail = false;

  constructor(private readonly deps: NotifierDeps) {}

  /** The user archived, trashed or otherwise moved mail: the next check learns the other folders silently. */
  userMoved(): void {
    this.userMovedMail = true;
  }

  /** Shows a sample so the user can see how notifications look and that the system allows them. */
  test(): void {
    const { content, sound } = this.deps.settings();
    this.deps.show({
      title: content === "hidden" ? "New mail" : "MiniMail",
      body: "This is how a notification will look.",
      silent: !sound,
    });
  }

  /** Looks for new mail and notifies. Safe to call as often as you like. */
  async check(force = false): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return;
    }
    const clock = this.deps.now ?? (() => new Date());
    if (!force && clock().getTime() - this.lastRun < MIN_GAP_MS) return;
    this.running = true;
    try {
      do {
        this.rerun = false;
        this.lastRun = clock().getTime();
        await this.run();
      } while (this.rerun);
    } catch (error) {
      console.error("[notifier] check failed:", error);
    } finally {
      this.running = false;
    }
  }

  private async run(): Promise<void> {
    const settings = this.deps.settings();
    const now = (this.deps.now ?? (() => new Date()))();

    if (!settings.enabled) {
      this.deps.setBadge(0);
      this.known.clear(); // Turning it back on must not announce what arrived meanwhile.
      this.waiting.clear();
      return;
    }

    const folders = new Set<NotifyFolder>(settings.folders);
    if (settings.dockBadge) folders.add("inbox");
    const accountIds = this.deps.accountIds();
    const fresh: MessageSummary[] = [];
    const movedByUser = this.userMovedMail;
    this.userMovedMail = false;
    let unread: number | null = null;

    for (const folder of NOTIFY_FOLDERS) {
      if (!folders.has(folder)) {
        for (const key of [...this.known.keys()]) if (key.endsWith(`|${folder}`)) this.known.delete(key);
        continue;
      }
      const result = await this.deps.list(folder);
      const failed = new Set(result.errors.map((error) => error.accountId));
      for (const accountId of accountIds) {
        if (failed.has(accountId)) continue; // Offline: keep what we knew rather than think it all vanished.
        const key = `${accountId}|${folder}`;
        const messages = result.messages.filter((message) => message.accountId === accountId);
        const before = this.known.get(key);
        const silent = !before || (movedByUser && folder !== "inbox");
        const arrived: MessageSummary[] = [];
        const nowKnown = new Set<string>();
        for (const message of messages) {
          const isNew = !silent && !before?.has(message.id);
          if (isNew && !this.sortedOrWaited(message, settings, now)) continue; // Looked at again next check.
          if (isNew) arrived.push(message);
          nowKnown.add(message.id);
        }
        this.known.set(key, nowKnown);
        fresh.push(...arrived);
      }
      if (folder === "inbox" && settings.dockBadge) {
        unread = result.messages.filter(
          (message) => message.unread && !settings.mutedAccountIds.includes(message.accountId),
        ).length;
      }
    }

    this.deps.setBadge(settings.dockBadge ? (unread ?? 0) : 0);

    const recent = fresh.filter((message) => now.getTime() - Date.parse(message.date) <= FRESH_MS);
    for (const message of fresh) this.waiting.delete(message.id);
    const wanted = recent
      .filter((message) => messageNotifies(message, settings))
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    if (wanted.length === 0) return;
    if (inQuietHours(settings.quietHours, now)) return;
    if (settings.muteWhenFocused && this.deps.focused()) return;
    this.deliver(wanted, settings);
  }

  /** False while a message should wait for the AI sorter (only when a category filter makes that matter). */
  private sortedOrWaited(message: MessageSummary, settings: NotificationSettings, now: Date): boolean {
    if (settings.categories.mode === "all" || !this.deps.sortingBusy()) return true;
    const since = this.waiting.get(message.id) ?? now.getTime();
    this.waiting.set(message.id, since);
    return now.getTime() - since >= SORT_GRACE_MS;
  }

  private deliver(messages: MessageSummary[], settings: NotificationSettings): void {
    const silent = !settings.sound;
    const grouped = settings.groupBursts ? messages.length >= BURST_SIZE : messages.length > MAX_INDIVIDUAL;
    if (!grouped) {
      for (const message of messages) this.deps.show({ ...this.describe(message, settings), silent });
      return;
    }
    const showBurst = (batch: MessageSummary[]) => {
      const names = [...new Set(batch.map(senderName))];
      const shown = names.slice(0, 2).join(", ");
      const more = names.length - 2;
      this.deps.show({
        title: `${batch.length} new messages`,
        body:
          settings.content === "hidden"
            ? ""
            : `From ${shown}${more > 0 ? ` and ${more} other${more === 1 ? "" : "s"}` : ""}`,
        silent,
      });
    };
    if (settings.groupBursts) return showBurst(messages);
    for (const message of messages.slice(-MAX_INDIVIDUAL)) {
      this.deps.show({ ...this.describe(message, settings), silent });
    }
    showBurst(messages.slice(0, -MAX_INDIVIDUAL));
  }

  private describe(message: MessageSummary, settings: NotificationSettings): Omit<ShownNotification, "silent"> {
    const place = message.folder === "inbox" ? "" : `${FOLDER_NAMES[message.folder as NotifyFolder]} · `;
    if (settings.content === "hidden") return { title: `${place}New mail`, body: "" };
    const title = `${place}${senderName(message)}`;
    if (settings.content === "sender") return { title, body: "New message" };
    const subject = message.subject.trim() || "(no subject)";
    const preview = message.snippet.trim();
    return { title, body: preview ? `${subject}\n${preview}` : subject };
  }
}

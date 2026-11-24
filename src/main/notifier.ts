import {
  BURST_SIZE,
  FRESH_MS,
  messageNotifies,
  NOTIFY_FOLDERS,
  settingsForAccount,
  type AccountNotificationSettings,
  type NotificationSettings,
  type NotificationTestResult,
  type NotifyFolder,
  type OpenConversationRequest,
} from "@shared/notifications";
import type { ListResult, MessageSummary } from "@shared/types";
import { reportError } from "./events";

export interface ShownNotification {
  title: string;
  body: string;
  silent: boolean;
  /** The conversation to open when the notification is clicked; absent for a group or a sample. */
  open?: OpenConversationRequest;
}

export interface NotifierDeps {
  settings: () => NotificationSettings;
  /** Lists a folder across every account, live. */
  list: (folder: NotifyFolder) => Promise<ListResult>;
  accountIds: () => string[];
  /** MiniMail is the window in front. */
  focused: () => boolean;
  /** Shows a system notification. The promise, when given, says how it ended (only the sample waits for it). */
  show: (notification: ShownNotification) => void | Promise<NotificationTestResult>;
  /**
   * Shows a toast in the window instead of a system notification. False when there is no page to
   * show it in, and the notification is used instead.
   */
  toast: (notification: ShownNotification) => boolean;
  /** Sets the Dock badge; 0 clears it. */
  setBadge: (count: number) => void;
  now?: () => Date;
}

/**
 * The longest a new message waits for the AI sorter before it is judged by the category it has.
 * Normally the sorter answers within a second or two and asks for a check, so this is only the limit.
 */
const SORT_GRACE_MS = 30_000;
/** Checks closer together than this are postponed to the end of the gap: one push often fires several events. */
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
  /** The check that is due later (the end of the gap, or when a message's wait for the sorter runs out). */
  private timer: { handle: ReturnType<typeof setTimeout>; at: number } | null = null;
  /** The user moved mail themselves, so what shows up in Archive, Spam or Trash is not "arriving". */
  private userMovedMail = false;

  constructor(private readonly deps: NotifierDeps) {}

  /** The user archived, trashed or otherwise moved mail: the next check learns the other folders silently. */
  userMoved(): void {
    this.userMovedMail = true;
  }

  /**
   * Shows a sample so the user can see how notifications look and that the system allows them.
   * Clicking it opens the newest Inbox conversation, so that click can be tried out too.
   */
  async test(): Promise<NotificationTestResult> {
    const { content, sound } = this.deps.settings();
    let open: OpenConversationRequest | undefined;
    try {
      const newest = (await this.deps.list("inbox")).messages.reduce<MessageSummary | undefined>(
        (best, message) => (!best || Date.parse(message.date) > Date.parse(best.date) ? message : best),
        undefined,
      );
      if (newest) open = { accountId: newest.accountId, threadId: newest.threadId, folder: "inbox" };
    } catch (error) {
      reportError("notifications", "Could not find a conversation for the sample notification to open", error);
    }
    const outcome = this.deps.show({
      title: content === "hidden" ? "New mail" : "MiniMail",
      body: "This is how a notification will look.",
      silent: !sound,
      ...(open ? { open } : {}),
    });
    return (await outcome) ?? { status: "shown" };
  }

  /** Looks for new mail and notifies. Safe to call as often as you like. */
  async check(force = false): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return;
    }
    const clock = this.deps.now ?? (() => new Date());
    const sinceLast = clock().getTime() - this.lastRun;
    if (!force && sinceLast < MIN_GAP_MS) {
      // Not dropped: the sorter often answers inside the gap, and that check must still happen.
      this.schedule(MIN_GAP_MS - sinceLast);
      return;
    }
    this.running = true;
    try {
      do {
        this.rerun = false;
        this.lastRun = clock().getTime();
        await this.run();
      } while (this.rerun);
    } catch (error) {
      reportError("notifications", "Checking for new mail to notify about failed", error);
    } finally {
      this.running = false;
    }
  }

  private async run(): Promise<void> {
    const settings = this.deps.settings();
    const now = (this.deps.now ?? (() => new Date()))();

    const accountIds = this.deps.accountIds();
    const own = new Map(accountIds.map((id) => [id, settingsForAccount(settings, id)]));
    if (![...own.values()].some((account) => account.enabled)) {
      this.deps.setBadge(0);
      this.known.clear(); // Turning it back on must not announce what arrived meanwhile.
      this.waiting.clear();
      return;
    }

    const wantsFolder = (accountId: string, folder: NotifyFolder) => {
      const account = own.get(accountId);
      return !!account?.enabled && account.folders.includes(folder);
    };
    const folders = new Set<NotifyFolder>(
      NOTIFY_FOLDERS.filter((folder) => accountIds.some((id) => wantsFolder(id, folder))),
    );
    if (settings.dockBadge) folders.add("inbox");
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
        if (!wantsFolder(accountId, folder)) {
          this.known.delete(key); // Turning it on later must not announce what is already there.
          continue;
        }
        const messages = result.messages.filter((message) => message.accountId === accountId);
        const before = this.known.get(key);
        const silent = !before || (movedByUser && folder !== "inbox");
        const arrived: MessageSummary[] = [];
        const nowKnown = new Set<string>();
        for (const message of messages) {
          const isNew = !silent && !before?.has(message.id);
          if (isNew && !this.sortedOrWaited(message, own.get(accountId)!, now)) continue; // Looked at again next check.
          if (isNew) arrived.push(message);
          nowKnown.add(message.id);
        }
        this.known.set(key, nowKnown);
        fresh.push(...arrived);
      }
      if (folder === "inbox" && settings.dockBadge) {
        unread = result.messages.filter(
          (message) => message.unread && own.get(message.accountId)?.enabled === true,
        ).length;
      }
    }

    this.deps.setBadge(settings.dockBadge ? (unread ?? 0) : 0);

    const recent = fresh.filter((message) => now.getTime() - Date.parse(message.date) <= FRESH_MS);
    for (const message of fresh) this.waiting.delete(message.id);
    const wanted = recent
      .filter((message) => messageNotifies(message, settings))
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const focused = this.deps.focused();
    const toasts: MessageSummary[] = [];
    const system = wanted.filter((message) => {
      if (!focused) return true;
      const { whenOpen } = settingsForAccount(settings, message.accountId);
      if (whenOpen === "toast") toasts.push(message);
      return whenOpen === "notification";
    });
    if (toasts.length > 0) this.deliver(toasts, settings, (notification) => this.deps.toast(notification));
    if (system.length > 0) this.deliver(system, settings);
  }

  /**
   * False while this message should wait for the AI sorter (only when a category filter makes that
   * matter). The sorter asks for a check when it answers; the check at the end of the wait is the limit.
   */
  private sortedOrWaited(message: MessageSummary, settings: AccountNotificationSettings, now: Date): boolean {
    if (settings.categories.mode === "all" || !message.sorting) return true;
    const since = this.waiting.get(message.id) ?? now.getTime();
    this.waiting.set(message.id, since);
    const left = SORT_GRACE_MS - (now.getTime() - since);
    if (left <= 0) return true;
    this.schedule(left);
    return false;
  }

  /** Checks again in `ms`, unless a check is already due sooner. */
  private schedule(ms: number): void {
    const at = (this.deps.now ?? (() => new Date()))().getTime() + ms;
    if (this.timer && this.timer.at <= at) return;
    if (this.timer) clearTimeout(this.timer.handle);
    const handle = setTimeout(() => {
      this.timer = null;
      void this.check();
    }, ms);
    handle.unref?.();
    this.timer = { handle, at };
  }

  /** Shows the messages as system notifications, or through `present` when it is given and takes them. */
  private deliver(
    messages: MessageSummary[],
    settings: NotificationSettings,
    present?: (notification: ShownNotification) => boolean,
  ): void {
    const show = (notification: ShownNotification): void => {
      if (!present?.(notification)) this.deps.show(notification);
    };
    const sounds = (batch: MessageSummary[]) =>
      batch.some((message) => settingsForAccount(settings, message.accountId).sound);
    const grouped = settings.groupBursts ? messages.length >= BURST_SIZE : messages.length > MAX_INDIVIDUAL;
    if (!grouped) {
      for (const message of messages) {
        show({ ...this.describe(message, settings), silent: !sounds([message]) });
      }
      return;
    }
    const showBurst = (batch: MessageSummary[]) => {
      const names = [...new Set(batch.map(senderName))];
      const shown = names.slice(0, 2).join(", ");
      const more = names.length - 2;
      show({
        title: `${batch.length} new messages`,
        body:
          batch.some((message) => settingsForAccount(settings, message.accountId).content === "hidden")
            ? ""
            : `From ${shown}${more > 0 ? ` and ${more} other${more === 1 ? "" : "s"}` : ""}`,
        silent: !sounds(batch),
      });
    };
    if (settings.groupBursts) return showBurst(messages);
    for (const message of messages.slice(-MAX_INDIVIDUAL)) {
      show({ ...this.describe(message, settings), silent: !sounds([message]) });
    }
    showBurst(messages.slice(0, -MAX_INDIVIDUAL));
  }

  private describe(message: MessageSummary, settings: NotificationSettings): Omit<ShownNotification, "silent"> {
    const { content } = settingsForAccount(settings, message.accountId);
    const open: OpenConversationRequest = {
      accountId: message.accountId,
      threadId: message.threadId,
      folder: message.folder as NotifyFolder,
    };
    const place = message.folder === "inbox" ? "" : `${FOLDER_NAMES[message.folder as NotifyFolder]} · `;
    if (content === "hidden") return { title: `${place}New mail`, body: "", open };
    const title = `${place}${senderName(message)}`;
    if (content === "sender") return { title, body: "New message", open };
    const subject = message.subject.trim() || "(no subject)";
    const preview = message.snippet.trim();
    return { title, body: preview ? `${subject}\n${preview}` : subject, open };
  }
}

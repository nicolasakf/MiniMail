import { categoryProblems, ruleBasedCategoryId } from "@shared/categories";
import type { Category, CategoryState, MailFolder, MessageSummary, SortFolder, SortProgress } from "@shared/types";

import { DEFAULT_CODE_MODEL } from "@shared/verification-code";

import type { CategoryStore } from "./category-store";
import { describeGatewayError, JEV_MODEL, type Classifier } from "./jev";

/** Classification calls running at once; the gateway handles more, but a mailbox sync should stay gentle. */
const CONCURRENCY = 4;
/** Conversations waiting at most; the rest are picked up by the next refresh. */
const MAX_QUEUE = 200;
const NOTIFY_DELAY_MS = 500;
/** How long to stop calling the gateway after repeated failures, growing each time. */
const BACKOFF_MS = [30_000, 120_000, 600_000];
/**
 * A "sort again" run ends once nothing has been waiting for this long: accounts list their mail
 * one after another, so the next account's conversations may still be about to arrive.
 */
const RUN_IDLE_MS = 4_000;
/** ...or this long when nothing at all was queued (nothing to sort, or the lists are slow). */
const RUN_EMPTY_MS = 15_000;

interface SortRun {
  done: number;
  total: number;
  accounts: Map<string, { done: number; total: number }>;
  timer: NodeJS.Timeout | null;
}

interface KeyStore {
  get(): string | undefined;
  set(key: string): void;
  clear(): void;
}

export interface CategorizerDeps {
  store: CategoryStore;
  keys: KeyStore;
  classify: Classifier;
  /** The model that reads verification codes; empty means rules only. */
  codeModel?: () => string;
  /** Folders whose newly arrived mail is sorted automatically; the Inbox when omitted. */
  sortFolders?: () => readonly SortFolder[];
  /** Called, debounced, when new answers are stored, so the UI can refresh its list. */
  onUpdated: () => void;
  now?: () => number;
}

interface QueueItem {
  key: string;
  message: MessageSummary;
}

/** The conversation a message belongs to; replies share it, which is how they inherit a category. */
function threadKey(message: MessageSummary): string {
  return `${message.accountId}:${message.threadId}`;
}

function snapshot(run: SortRun, finished: boolean, error: string | null): SortProgress {
  return {
    done: run.done,
    total: run.total,
    accounts: [...run.accounts].map(([accountId, counts]) => ({ accountId, ...counts })),
    finished,
    error,
  };
}

/**
 * Decides which of the user's categories each conversation belongs to.
 *
 * A conversation is classified once, when its first message arrives: Jev answers a Choice question
 * over the user's categories, the answer is stored per conversation, and every later message in
 * that conversation (a reply) simply inherits it, so replies never cost a model call. Until the
 * answer arrives, or when no AI key is set, a rule-based guess from the mail headers keeps the
 * list organized.
 */
export class Categorizer {
  private readonly queue = new Map<string, QueueItem>();
  private readonly running = new Set<string>();
  private lastError: string | null = null;
  private failures = 0;
  private pausedUntil = 0;
  private notifyTimer: NodeJS.Timeout | null = null;
  /** Bumped by `reclassify` so answers that were in flight are discarded rather than stored. */
  private generation = 0;
  /** The "sort all mail again" in progress, and how the last one ended. */
  private run: SortRun | null = null;
  private lastRun: SortProgress | null = null;
  /**
   * Set by a "sort again since a date": conversations with mail from `since` on are sorted once
   * more unless their answer is newer than `startedAt`. Their old answer stays visible meanwhile.
   */
  private resort: { since: number; startedAt: number } | null = null;
  /** Folders the current "sort again" run covers; outside a run, only the Inbox is classified. */
  private sortFolders = new Set<MailFolder>();

  constructor(private readonly deps: CategorizerDeps) {}

  private newMailFolders(): readonly SortFolder[] {
    return this.deps.sortFolders?.() ?? ["inbox"];
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  state(): CategoryState {
    return {
      categories: this.deps.store.categories(),
      ai: {
        configured: Boolean(this.deps.keys.get()),
        model: JEV_MODEL,
        codeModel: this.deps.codeModel?.() ?? DEFAULT_CODE_MODEL,
        sortFolders: [...this.newMailFolders()],
        lastError: this.lastError,
        pending: this.queue.size + this.running.size,
        sorting: this.run ? snapshot(this.run, false, null) : this.lastRun,
      },
    };
  }

  /** Replaces the categories. Throws the first problem found so the editor can show it. */
  saveCategories(categories: Category[]): CategoryState {
    const problems = categoryProblems(categories);
    if (problems.length > 0) throw new Error(problems[0]);
    this.deps.store.setCategories(categories);
    // A conversation the user put in a category that is now gone goes back to the classifier.
    this.deps.store.dropManualNotIn(new Set(categories.map((category) => category.id)));
    // Conversations filed under a deleted category are re-classified on the next refresh.
    this.queue.clear();
    this.scheduleUpdate();
    return this.state();
  }

  setKey(key: string): CategoryState {
    this.deps.keys.set(key);
    this.lastError = null;
    this.failures = 0;
    this.pausedUntil = 0;
    this.scheduleUpdate();
    return this.state();
  }

  clearKey(): CategoryState {
    this.deps.keys.clear();
    this.queue.clear();
    this.lastError = null;
    this.scheduleUpdate();
    return this.state();
  }

  /** One real classification call, so a wrong key or a network problem shows up immediately. */
  async test(): Promise<void> {
    try {
      await this.deps.classify(
        {
          from: { name: "Acme", email: "no-reply@acme.example" },
          subject: "Your Acme verification code",
          preview: "Use this code to finish signing in. It expires in ten minutes.",
          signal: "notification",
        },
        this.deps.store.categories(),
      );
      this.lastError = null;
      this.failures = 0;
      this.pausedUntil = 0;
    } catch (error) {
      this.lastError = describeGatewayError(error);
      throw new Error(this.lastError);
    }
  }

  /**
   * Sorts mail again with the current criteria on the next refresh: everything (answers are
   * forgotten), or only conversations with mail from `since` (epoch ms) on. `folders` are the
   * folders this run covers. Everything-in-the-Inbox forgets all answers; any other choice
   * keeps old answers visible and sorts the chosen folders' conversations once more.
   */
  reclassify(since: number | null = null, folders: readonly MailFolder[] = ["inbox"]): void {
    this.generation += 1;
    this.sortFolders = new Set(folders);
    this.queue.clear();
    if (since === null && this.sortFolders.has("inbox")) {
      this.deps.store.clearClassifications();
      this.resort = null;
    } else {
      this.resort = { since: since ?? 0, startedAt: this.now() };
    }
    this.pausedUntil = 0;
    this.finishRun(null);
    this.lastRun = null;
    this.run = { done: 0, total: 0, accounts: new Map(), timer: null };
    this.armRunTimer();
    this.scheduleUpdate();
  }

  /**
   * Files conversations (keys are `accountId:threadId`) under a category the user chose, or under
   * none (`null`). Such a choice is final: sorting again, new replies and a changed key leave it alone.
   */
  assign(keys: readonly string[], categoryId: string | null): CategoryState {
    if (categoryId !== null && !this.deps.store.categories().some((category) => category.id === categoryId)) {
      throw new Error("That category no longer exists.");
    }
    const at = this.now();
    for (const key of keys) {
      this.queue.delete(key);
      this.deps.store.setClassification(key, { categoryId, probability: 1, at, manual: true });
    }
    this.scheduleUpdate();
    return this.state();
  }

  /** Ends the current run, remembering how far it got so the UI can show the outcome. */
  private finishRun(error: string | null): void {
    const run = this.run;
    if (!run) return;
    if (run.timer) clearTimeout(run.timer);
    this.run = null;
    this.sortFolders.clear();
    this.lastRun = snapshot(run, true, error);
  }

  /** How many conversations in `messages` a sort since `since` (epoch ms, null for all) would classify. */
  countToSort(messages: readonly MessageSummary[], since: number | null): number {
    const keys = new Set<string>();
    for (const message of messages) {
      if (since !== null && Date.parse(message.date) < since) continue;
      const key = threadKey(message);
      if (this.deps.store.classification(key)?.manual) continue;
      keys.add(key);
    }
    return keys.size;
  }

  /** Starts the countdown to "finished"; any new queued conversation cancels it. */
  private armRunTimer(): void {
    const run = this.run;
    if (!run) return;
    if (run.timer) clearTimeout(run.timer);
    run.timer = setTimeout(() => {
      if (this.run === run) this.finishRun(null);
    }, run.total === 0 ? RUN_EMPTY_MS : RUN_IDLE_MS);
    run.timer.unref?.();
  }

  /**
   * Fills in `categoryId` for a freshly listed batch and queues whatever still needs the model.
   * New mail in the chosen folders (the Inbox by default) is classified, and so are the folders a running "sort again" covers;
   * other folders show answers that already exist.
   */
  apply(messages: MessageSummary[], folder: MailFolder): MessageSummary[] {
    if (folder === "sent" || folder === "drafts") return messages;

    const categories = this.deps.store.categories();
    const known = new Set(categories.map((category) => category.id));
    const ready = Boolean(this.deps.keys.get()) && this.now() >= this.pausedUntil;
    const inRun = this.run !== null && this.sortFolders.has(folder);
    // New mail is classified in the folders the user chose; others only while a run covers them.
    const canClassify = ready && ((this.newMailFolders() as readonly MailFolder[]).includes(folder) || inRun);
    const canRedo = ready && inRun;

    // Conversations a "since a date" run still has to redo: recent mail, answer older than the run.
    const redo = new Set<string>();
    const resort = canRedo ? this.resort : null;
    if (resort) {
      for (const message of messages) {
        if (Date.parse(message.date) < resort.since) continue;
        const key = threadKey(message);
        const stored = this.deps.store.classification(key);
        if (stored && !stored.manual && stored.at < resort.startedAt) redo.add(key);
      }
    }

    const oldestUnclassified = new Map<string, MessageSummary>();
    const wanted = (key: string, message: MessageSummary) => {
      const current = oldestUnclassified.get(key);
      if (!current || Date.parse(message.date) < Date.parse(current.date)) {
        oldestUnclassified.set(key, message);
      }
    };
    const result = messages.map((message) => {
      const key = threadKey(message);
      const stored = this.deps.store.classification(key);
      if (stored && (stored.categoryId === null || known.has(stored.categoryId))) {
        if (redo.has(key) && !stored.manual) wanted(key, message);
        return { ...message, categoryId: stored.categoryId };
      }
      if (canClassify) wanted(key, message);
      const sorting = canClassify || this.queue.has(key) || this.running.has(key);
      return {
        ...message,
        categoryId: ruleBasedCategoryId(message.signal, categories),
        ...(sorting ? { sorting: true } : {}),
      };
    });

    for (const [key, message] of oldestUnclassified) this.enqueue({ key, message });
    return result;
  }

  private enqueue(item: QueueItem): void {
    if (this.queue.has(item.key) || this.running.has(item.key)) return;
    if (this.queue.size >= MAX_QUEUE) return;
    this.queue.set(item.key, item);
    if (this.run) {
      this.run.total += 1;
      const accountId = item.message.accountId;
      const account = this.run.accounts.get(accountId) ?? { done: 0, total: 0 };
      account.total += 1;
      this.run.accounts.set(accountId, account);
      if (this.run.timer) clearTimeout(this.run.timer);
      this.run.timer = null;
    }
    this.pump();
  }

  private pump(): void {
    while (this.running.size < CONCURRENCY && this.queue.size > 0) {
      const next = this.queue.values().next().value as QueueItem;
      this.queue.delete(next.key);
      this.running.add(next.key);
      void this.classifyOne(next).finally(() => {
        this.running.delete(next.key);
        this.pump();
        if (this.queue.size === 0 && this.running.size === 0) this.armRunTimer();
      });
    }
  }

  private async classifyOne({ key, message }: QueueItem): Promise<void> {
    const generation = this.generation;
    const run = this.run;
    try {
      const outcome = await this.deps.classify(
        {
          from: message.from,
          subject: message.subject,
          preview: message.snippet,
          signal: message.signal,
        },
        this.deps.store.categories(),
      );
      if (generation !== this.generation) return;
      // The user may have chosen a category while the model was thinking: their choice wins.
      if (this.deps.store.classification(key)?.manual) return;
      this.deps.store.setClassification(key, {
        categoryId: outcome.categoryId,
        probability: outcome.probability,
        at: this.now(),
      });
      this.lastError = null;
      this.failures = 0;
      if (run) {
        run.done += 1;
        const account = run.accounts.get(message.accountId);
        if (account) account.done += 1;
      }
      this.scheduleUpdate();
    } catch (error) {
      if (generation !== this.generation) return;
      this.lastError = describeGatewayError(error);
      if (run && run === this.run) this.finishRun(this.lastError);
      this.pausedUntil = this.now() + BACKOFF_MS[Math.min(this.failures, BACKOFF_MS.length - 1)];
      this.failures += 1;
      // Stop spending calls on a key that is failing; the next refresh after the pause tries again.
      this.queue.clear();
      this.scheduleUpdate();
    }
  }

  private scheduleUpdate(): void {
    if (this.notifyTimer) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.deps.onUpdated();
    }, NOTIFY_DELAY_MS);
  }
}

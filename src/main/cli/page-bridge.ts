import type { PageReply, PageRequest, PageResult } from "@shared/cli-page";

export interface PageBridgeDeps {
  /** Sends a request to the page. False when there is no window to send it to. */
  send: (id: number, request: PageRequest) => boolean;
  /** Makes sure the page is on its way: opens a window, kept out of sight, when none is open. */
  ensurePage: () => void;
  /** How long to wait for a page that is still loading. */
  readyTimeoutMs?: number;
  /** How long the page may take to answer a request (more for one that waits for the person). */
  answerTimeoutMs?: number;
}

/** The page did not answer in time: what it was asked may still happen. */
export class PageTimeoutError extends Error {}

interface Pending {
  resolve: (result: PageResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * How the main process asks the page to do things. Bookkeeping only: it knows whether the page is
 * listening, which request an answer belongs to, and what to do when the page goes away or never answers.
 * The page is the one place where the app's lists, undo stack and Log rows live, so anything that must
 * behave like a click goes through here.
 */
export class PageBridge {
  private ready = false;
  private serial = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly waiting = new Set<() => void>();

  constructor(private readonly deps: PageBridgeDeps) {}

  /** The page says it is listening (and says it again after a reload). */
  pageReady(): void {
    this.ready = true;
    for (const wake of [...this.waiting]) wake();
  }

  /** The page went away or is reloading: what it was asked is lost, and the next request waits for it again. */
  pageGone(reason: string): void {
    this.ready = false;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(new Error(reason));
    }
  }

  /** The page's answer to a request. One that is not wanted any more (it timed out) is dropped. */
  reply(reply: PageReply): void {
    const pending = this.pending.get(reply.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(reply.id);
    if (reply.ok) pending.resolve(reply.result);
    else pending.reject(new Error(reply.error));
  }

  /** Asks the page and waits for its answer. Rejects when it cannot be reached or does not answer in time. */
  async request(request: PageRequest, answerTimeoutMs = this.deps.answerTimeoutMs ?? 30_000): Promise<PageResult> {
    if (!this.ready) {
      this.deps.ensurePage();
      await this.untilReady(this.deps.readyTimeoutMs ?? 30_000);
    }
    const id = ++this.serial;
    return new Promise<PageResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new PageTimeoutError("MiniMail's window did not answer in time. It may still have done it: check the Log."));
      }, answerTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      if (!this.deps.send(id, request)) {
        clearTimeout(timer);
        this.pending.delete(id);
        this.ready = false;
        reject(new Error("MiniMail has no window to do that in."));
      }
    });
  }

  private untilReady(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const wake = (): void => {
        clearTimeout(timer);
        this.waiting.delete(wake);
        resolve();
      };
      const timer = setTimeout(() => {
        this.waiting.delete(wake);
        reject(new Error("MiniMail's window did not load in time."));
      }, timeoutMs);
      this.waiting.add(wake);
      if (this.ready) wake();
    });
  }
}

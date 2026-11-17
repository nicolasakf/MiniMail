/** Who is waiting: something the person is looking at, or a refresh nobody is waiting on. */
export type Lane = "foreground" | "background";

/**
 * Lets only `limit` tasks run at once; the rest wait their turn. A waiting foreground task (opening
 * a message, moving mail) always goes before a waiting background one (refreshing a folder), so a
 * long refresh never makes the person wait behind it. Within a lane, tasks run in the order they asked.
 */
export class RequestGate {
  private active = 0;
  private readonly waiting: Record<Lane, Array<() => void>> = { foreground: [], background: [] };

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError("A gate needs room for at least one task.");
  }

  /** Runs `task` once a place is free; the place is given back when it settles, however it ends. */
  async run<T>(lane: Lane, task: () => Promise<T>): Promise<T> {
    await this.acquire(lane);
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(lane: Lane): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiting[lane].push(resolve));
  }

  private release(): void {
    const next = this.waiting.foreground.shift() ?? this.waiting.background.shift();
    // The place passes straight to the next waiter, so `active` stays full and nobody can slip in between.
    if (next) next();
    else this.active -= 1;
  }
}

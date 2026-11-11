/**
 * Startup and mail-loading timings, printed to the terminal as `[perf] +<ms since launch> label`.
 * On in dev builds, or anywhere with MINIMAIL_PERF=1; silent in a packaged app. Labels carry
 * counts and durations only, never addresses or message content.
 */
const enabled =
  process.env["MINIMAIL_PERF"] === "1" ||
  (process.env["NODE_ENV"] !== "production" && !process.env["VITEST"]);

export function perfLog(label: string, detail?: string): void {
  if (!enabled) return;
  const since = Math.round(performance.now());
  console.log(`[perf] +${since}ms ${label}${detail ? ` (${detail})` : ""}`);
}

/** Runs a task and logs how long it took, whether it succeeded or threw. */
export async function perfTime<T>(
  label: string,
  task: () => Promise<T>,
  describe?: (result: T) => string,
): Promise<T> {
  const started = performance.now();
  try {
    const result = await task();
    perfLog(label, `${Math.round(performance.now() - started)}ms${describe ? `, ${describe(result)}` : ""}`);
    return result;
  } catch (error) {
    perfLog(label, `${Math.round(performance.now() - started)}ms, failed`);
    throw error;
  }
}

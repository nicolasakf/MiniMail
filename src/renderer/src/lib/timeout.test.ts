import { afterEach, describe, expect, it, vi } from "vitest";

import { withTimeout } from "./timeout";

afterEach(() => vi.useRealTimers());

describe("withTimeout", () => {
  it("passes through a value that arrives in time", async () => {
    await expect(withTimeout(Promise.resolve(7), 50, "late")).resolves.toBe(7);
  });

  it("passes through an error that arrives in time", async () => {
    await expect(withTimeout(Promise.reject(new Error("boom")), 50, "late")).rejects.toThrow("boom");
  });

  it("gives up with the message when the promise is too slow", async () => {
    vi.useFakeTimers();
    const never = new Promise<number>(() => undefined);
    const result = withTimeout(never, 1000, "took too long");
    const assertion = expect(result).rejects.toThrow("took too long");
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("does not fire after the promise settled", async () => {
    vi.useFakeTimers();
    const value = await withTimeout(Promise.resolve("ok"), 1000, "late");
    await vi.advanceTimersByTimeAsync(5000);
    expect(value).toBe("ok");
  });
});

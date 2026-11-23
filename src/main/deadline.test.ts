import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { withDeadline } from "./deadline";

describe("withDeadline", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("passes the result through when the task is fast enough", async () => {
    const onExpire = vi.fn();
    await expect(withDeadline(Promise.resolve(7), 1000, "too slow", onExpire)).resolves.toBe(7);
    await vi.advanceTimersByTimeAsync(2000);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("passes the task's own failure through", async () => {
    await expect(withDeadline(Promise.reject(new Error("no")), 1000, "too slow")).rejects.toThrow("no");
  });

  it("rejects and calls onExpire when the task never settles", async () => {
    const onExpire = vi.fn();
    const result = withDeadline(new Promise<never>(() => undefined), 1000, "too slow", onExpire);
    const assertion = expect(result).rejects.toThrow("too slow");
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(onExpire).toHaveBeenCalledOnce();
  });

  it("still rejects when onExpire throws", async () => {
    const result = withDeadline(new Promise<never>(() => undefined), 10, "too slow", () => {
      throw new Error("close failed");
    });
    const assertion = expect(result).rejects.toThrow("too slow");
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
  });
});

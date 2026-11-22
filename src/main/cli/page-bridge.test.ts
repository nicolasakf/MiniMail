import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PageRequest } from "@shared/cli-page";

import { PageBridge, PageTimeoutError } from "./page-bridge";

const REQUEST: PageRequest = { kind: "undo", ref: "undo-x-1" };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(options: { sends?: boolean; readyTimeoutMs?: number; answerTimeoutMs?: number } = {}) {
  const sent: { id: number; request: PageRequest }[] = [];
  const ensurePage = vi.fn();
  const bridge = new PageBridge({
    send: (id, request) => {
      if (options.sends === false) return false;
      sent.push({ id, request });
      return true;
    },
    ensurePage,
    readyTimeoutMs: options.readyTimeoutMs ?? 1000,
    answerTimeoutMs: options.answerTimeoutMs ?? 1000,
  });
  return { bridge, sent, ensurePage };
}

describe("PageBridge", () => {
  it("sends a request to a page that is listening and returns its answer", async () => {
    const { bridge, sent, ensurePage } = setup();
    bridge.pageReady();
    const result = bridge.request(REQUEST);
    expect(sent).toEqual([{ id: 1, request: REQUEST }]);
    bridge.reply({ id: 1, ok: true, result: { outcome: "applied", count: 2, ref: "r" } });
    await expect(result).resolves.toEqual({ outcome: "applied", count: 2, ref: "r" });
    expect(ensurePage).not.toHaveBeenCalled();
  });

  it("opens the page when it is not there and sends once it says it is listening", async () => {
    const { bridge, sent, ensurePage } = setup();
    const result = bridge.request(REQUEST);
    expect(ensurePage).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([]);
    bridge.pageReady();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
    bridge.reply({ id: sent[0]!.id, ok: true, result: { outcome: "nothing", count: 0 } });
    await expect(result).resolves.toMatchObject({ outcome: "nothing" });
  });

  it("gives up on a page that never loads", async () => {
    const { bridge } = setup({ readyTimeoutMs: 500 });
    const result = bridge.request(REQUEST);
    const caught = expect(result).rejects.toThrow("did not load in time");
    await vi.advanceTimersByTimeAsync(500);
    await caught;
  });

  it("matches each answer to its own request, whatever order they come back in", async () => {
    const { bridge, sent } = setup();
    bridge.pageReady();
    const first = bridge.request({ kind: "undo", ref: "a" });
    const second = bridge.request({ kind: "undo", ref: "b" });
    bridge.reply({ id: sent[1]!.id, ok: true, result: { outcome: "applied", count: 2 } });
    bridge.reply({ id: sent[0]!.id, ok: true, result: { outcome: "applied", count: 1 } });
    expect(await first).toMatchObject({ count: 1 });
    expect(await second).toMatchObject({ count: 2 });
  });

  it("passes on an error the page reported", async () => {
    const { bridge, sent } = setup();
    bridge.pageReady();
    const result = bridge.request(REQUEST);
    bridge.reply({ id: sent[0]!.id, ok: false, error: "Could not do it" });
    await expect(result).rejects.toThrow("Could not do it");
  });

  it("says when the page did not answer in time, and ignores a late answer", async () => {
    const { bridge, sent } = setup({ answerTimeoutMs: 300 });
    bridge.pageReady();
    const result = bridge.request(REQUEST);
    const caught = expect(result).rejects.toThrow("check the Log");
    await vi.advanceTimersByTimeAsync(300);
    await caught;
    expect(() => bridge.reply({ id: sent[0]!.id, ok: true, result: { outcome: "applied", count: 1 } })).not.toThrow();
  });

  it("tells a request that ran out of time apart from one that could not be sent", async () => {
    const { bridge } = setup({ answerTimeoutMs: 300 });
    bridge.pageReady();
    const slow = bridge.request(REQUEST);
    const caught = slow.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(300);
    expect(await caught).toBeInstanceOf(PageTimeoutError);
    const { bridge: noWindow } = setup({ sends: false });
    noWindow.pageReady();
    expect(await noWindow.request(REQUEST).catch((error: unknown) => error)).not.toBeInstanceOf(PageTimeoutError);
  });

  it("lets a request that waits for the person ask for more time", async () => {
    const { bridge, sent } = setup({ answerTimeoutMs: 300 });
    bridge.pageReady();
    const result = bridge.request(REQUEST, 5000);
    await vi.advanceTimersByTimeAsync(4000);
    bridge.reply({ id: sent[0]!.id, ok: true, result: { outcome: "applied", count: 1 } });
    await expect(result).resolves.toMatchObject({ outcome: "applied" });
  });

  it("rejects what was asked when the page goes away, and waits for it again after that", async () => {
    const { bridge, sent, ensurePage } = setup();
    bridge.pageReady();
    const lost = bridge.request(REQUEST);
    const caught = expect(lost).rejects.toThrow("window was closed");
    bridge.pageGone("The window was closed.");
    await caught;
    const again = bridge.request(REQUEST);
    expect(ensurePage).toHaveBeenCalledTimes(1);
    bridge.pageReady();
    await vi.advanceTimersByTimeAsync(0);
    bridge.reply({ id: sent.at(-1)!.id, ok: true, result: { outcome: "applied", count: 1 } });
    await expect(again).resolves.toBeDefined();
  });

  it("says so when there is no window to send to", async () => {
    const { bridge } = setup({ sends: false });
    bridge.pageReady();
    await expect(bridge.request(REQUEST)).rejects.toThrow("no window");
  });
});

import { describe, expect, it } from "vitest";

import { POLL_INTERVAL_MS, Polling, RESUME_GRACE_MS, SAFETY_POLL_MS } from "./polling";

/** A polling with a clock the test moves by hand, and the network changes it reported. */
function setup() {
  let time = 1_000_000;
  const changes: boolean[] = [];
  const polling = new Polling(() => time, (online) => void changes.push(online));
  return {
    polling,
    changes,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe("Polling", () => {
  it("refreshes on every tick while an account has to be polled", () => {
    const { polling, advance } = setup();
    advance(POLL_INTERVAL_MS);
    expect(polling.tick(true, false)).toBe(true);
    polling.refreshed();
    advance(POLL_INTERVAL_MS);
    expect(polling.tick(true, false)).toBe(true);
  });

  it("leaves accounts that push alone until the safety refresh is due", () => {
    const { polling, advance } = setup();
    advance(POLL_INTERVAL_MS);
    expect(polling.tick(true, true)).toBe(false);
    advance(SAFETY_POLL_MS);
    expect(polling.tick(true, true)).toBe(true);
    polling.refreshed();
    advance(POLL_INTERVAL_MS);
    expect(polling.tick(true, true)).toBe(false);
  });

  it("does not ask while offline, and refreshes at once when the network is back", () => {
    const { polling, advance } = setup();
    advance(POLL_INTERVAL_MS);
    expect(polling.tick(false, true)).toBe(false);
    advance(POLL_INTERVAL_MS);
    expect(polling.tick(false, true)).toBe(false);
    // Every account pushes, so nothing would be due yet: the refresh is owed because of the gap.
    advance(POLL_INTERVAL_MS);
    expect(polling.tick(true, true)).toBe(true);
    polling.refreshed();
    advance(POLL_INTERVAL_MS);
    expect(polling.tick(true, true)).toBe(false);
  });

  it("waits out the moments after waking up, then refreshes once", () => {
    const { polling, advance } = setup();
    polling.resumed();
    advance(1_000);
    expect(polling.tick(true, true)).toBe(false);
    advance(RESUME_GRACE_MS);
    expect(polling.tick(true, true)).toBe(true);
    polling.refreshed();
    advance(POLL_INTERVAL_MS);
    expect(polling.tick(true, true)).toBe(false);
  });

  it("does not refresh when the window comes to the front offline or right after waking", () => {
    const { polling, advance } = setup();
    expect(polling.focused(false)).toBe(false);
    expect(polling.focused(true)).toBe(true);

    polling.resumed();
    advance(1_000);
    expect(polling.focused(true)).toBe(false);
    // The refresh it could not have is owed to the next tick.
    advance(RESUME_GRACE_MS);
    expect(polling.tick(true, true)).toBe(true);
  });

  it("lets the window refresh as usual otherwise", () => {
    const { polling } = setup();
    expect(polling.focused(true)).toBe(true);
  });

  it("reports the network going away and coming back once each", () => {
    const { polling, changes, advance } = setup();
    polling.tick(true, true);
    polling.tick(false, true);
    advance(POLL_INTERVAL_MS);
    polling.tick(false, true);
    polling.focused(false);
    polling.tick(true, true);
    polling.tick(true, true);
    expect(changes).toEqual([false, true]);
  });
});

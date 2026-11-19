import { describe, expect, it } from "vitest";

import { sendStatus } from "./composer-state";

describe("sendStatus (what the minimized pill shows)", () => {
  it("shows a spinner while the message goes out", () => {
    expect(sendStatus("sending", null, null)).toBe("sending");
  });

  it("is red while the error of the failed send is still shown", () => {
    expect(sendStatus("idle", "Connection lost", "Connection lost")).toBe("failed");
  });

  it("goes back to a plain pill once the error is dismissed or replaced", () => {
    expect(sendStatus("idle", "Connection lost", null)).toBeNull();
    expect(sendStatus("idle", "Connection lost", "Could not save the draft")).toBeNull();
  });

  it("shows nothing for a draft that never failed", () => {
    expect(sendStatus("idle", null, null)).toBeNull();
    expect(sendStatus("saving", null, null)).toBeNull();
  });
});

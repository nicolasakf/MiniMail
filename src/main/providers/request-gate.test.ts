import { describe, expect, it } from "vitest";

import { RequestGate } from "./request-gate";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1));

describe("RequestGate", () => {
  it("never runs more tasks at once than it has places", async () => {
    const gate = new RequestGate(3);
    let running = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 12 }, () =>
        gate.run("background", async () => {
          running += 1;
          peak = Math.max(peak, running);
          await tick();
          running -= 1;
        }),
      ),
    );
    expect(peak).toBe(3);
  });

  it("lets a waiting foreground task go before waiting background ones", async () => {
    const gate = new RequestGate(1);
    const order: string[] = [];
    let open!: () => void;
    const held = gate.run("background", () => new Promise<void>((resolve) => (open = resolve)));

    const waiting = [
      gate.run("background", async () => void order.push("background 1")),
      gate.run("background", async () => void order.push("background 2")),
      gate.run("foreground", async () => void order.push("foreground")),
    ];
    await tick(); // the first task starts a moment after it is asked for
    open();
    await Promise.all([held, ...waiting]);
    expect(order).toEqual(["foreground", "background 1", "background 2"]);
  });

  it("gives its place back when a task fails, and passes the failure on", async () => {
    const gate = new RequestGate(1);
    await expect(gate.run("foreground", () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(gate.run("foreground", async () => "next")).resolves.toBe("next");
  });

  it("refuses to be built without room for a task", () => {
    expect(() => new RequestGate(0)).toThrow(RangeError);
  });
});

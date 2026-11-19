import { describe, expect, it } from "vitest";

import { migrate, NewerFileError } from "./migrate";

describe("migrate", () => {
  const steps = {
    1: (payload: unknown) => ({ ...(payload as object), two: true }),
    2: (payload: unknown) => ({ ...(payload as object), three: true }),
  };

  it("runs every step from the saved version up, in order", () => {
    expect(migrate({ one: true }, 1, 3, steps)).toEqual({ one: true, two: true, three: true });
    expect(migrate({ two: true }, 2, 3, steps)).toEqual({ two: true, three: true });
  });

  it("returns a current payload as it is", () => {
    const payload = { fine: true };
    expect(migrate(payload, 3, 3, steps)).toBe(payload);
  });

  it("refuses a file from a newer app instead of reading it", () => {
    expect(() => migrate({}, 4, 3, steps)).toThrow(NewerFileError);
  });

  it("fails loudly when the change that bumped the version forgot its step", () => {
    expect(() => migrate({}, 1, 3, { 1: steps[1] })).toThrow("No migration from version 2 to 3");
  });
});

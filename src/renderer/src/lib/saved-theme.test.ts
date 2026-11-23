import { describe, expect, it } from "vitest";

import { migrateSavedTheme, THEME_STORAGE_KEY } from "./saved-theme";

function fakeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    values,
  };
}

describe("migrateSavedTheme", () => {
  it("turns a saved dimmed theme into dark", () => {
    const storage = fakeStorage({ [THEME_STORAGE_KEY]: "dimmed" });
    migrateSavedTheme(() => storage);
    expect(storage.values.get(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("leaves light, dark and system alone", () => {
    for (const choice of ["light", "dark", "system"]) {
      const storage = fakeStorage({ [THEME_STORAGE_KEY]: choice });
      migrateSavedTheme(() => storage);
      expect(storage.values.get(THEME_STORAGE_KEY)).toBe(choice);
    }
  });

  it("writes nothing when no theme was saved", () => {
    const storage = fakeStorage();
    migrateSavedTheme(() => storage);
    expect(storage.values.size).toBe(0);
  });

  it("does not throw when the storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => undefined,
    };
    expect(() => migrateSavedTheme(() => blocked)).not.toThrow();
  });
});

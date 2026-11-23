import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultUiPrefs } from "@shared/prefs";
import type { UiPrefs } from "@shared/types";

/**
 * The page's start: it reads the saved choices from the main process, takes over what its own
 * storage still holds from before they moved to `settings.json`, and mirrors the color mode.
 */
let local: Map<string, string>;
let fileHolds: UiPrefs;
let imported: unknown[];
let changed: ((prefs: UiPrefs) => void) | undefined;
let importFails = false;
let demo = false;

async function load() {
  vi.resetModules();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => local.get(key) ?? null,
      setItem: (key: string, value: string) => void local.set(key, value),
      removeItem: (key: string) => void local.delete(key),
    },
    addEventListener: () => undefined,
    minimail: {
      system: { demo },
      events: { report: () => undefined, onChanged: () => () => undefined },
      prefs: {
        get: async () => structuredClone(fileHolds),
        set: async () => undefined,
        importLegacy: async (legacy: unknown) => {
          if (importFails) throw new Error("disk full");
          imported.push(legacy);
          fileHolds = { ...fileHolds, blocklist: { senders: ["old@x.test"], domains: [] }, theme: "dark" };
          return structuredClone(fileHolds);
        },
        onChanged: (listener: (prefs: UiPrefs) => void) => {
          changed = listener;
          return () => undefined;
        },
      },
    },
  });
  return import("./saved-prefs");
}

beforeEach(() => {
  local = new Map();
  fileHolds = defaultUiPrefs();
  imported = [];
  changed = undefined;
  importFails = false;
  demo = false;
});

describe("loadSavedPrefs", () => {
  it("takes over the old values of the page's storage once, then removes them (the color mode stays as the library's copy)", async () => {
    local.set("minimail.blocklist", JSON.stringify({ senders: ["old@x.test"], domains: [] }));
    local.set("theme", "dark");
    const prefs = await load();
    await prefs.loadSavedPrefs();
    expect(imported).toEqual([{ blocklist: { senders: ["old@x.test"], domains: [] }, theme: "dark" }]);
    expect(prefs.savedPref("blocklist")).toEqual({ senders: ["old@x.test"], domains: [] });
    expect([...local.keys()]).toEqual(["theme"]);
    expect(local.get("theme")).toBe("dark");
  });

  it("does not ask again when there is nothing old, and puts the saved color mode where the library reads it", async () => {
    fileHolds = { ...defaultUiPrefs(), theme: "light" };
    local.set("theme", "dark"); // the page's own copy came from another address
    const prefs = await load();
    await prefs.loadSavedPrefs();
    expect(imported).toEqual([]);
    expect(local.get("theme")).toBe("light");
    expect(prefs.savedPref("theme")).toBe("light");
  });

  it("keeps the old values where they are when they could not be saved, so the next launch tries again", async () => {
    local.set("minimail.pinnedDomains", JSON.stringify(["acme.com"]));
    importFails = true;
    const prefs = await load();
    await prefs.loadSavedPrefs();
    expect(local.has("minimail.pinnedDomains")).toBe(true);
    expect(prefs.savedPref("pinnedDomains")).toEqual([]);
  });

  it("leaves the page's storage alone in the demo", async () => {
    demo = true;
    local.set("minimail.blocklist", JSON.stringify({ senders: ["x@x.test"], domains: [] }));
    const prefs = await load();
    await prefs.loadSavedPrefs();
    expect(imported).toEqual([]);
    expect(local.has("minimail.blocklist")).toBe(true);
  });

  it("follows a change made in another window, telling only what changed", async () => {
    const prefs = await load();
    await prefs.loadSavedPrefs();
    const blocks = vi.fn();
    const pins = vi.fn();
    prefs.subscribePref("blocklist", blocks);
    prefs.subscribePref("pinnedDomains", pins);
    const before = prefs.savedPref("pinnedDomains");
    changed!({ ...defaultUiPrefs(), blocklist: { senders: ["a@x.test"], domains: [] } });
    expect(blocks).toHaveBeenCalledTimes(1);
    expect(pins).not.toHaveBeenCalled();
    expect(prefs.savedPref("blocklist").senders).toEqual(["a@x.test"]);
    expect(prefs.savedPref("pinnedDomains")).toBe(before);
  });
});

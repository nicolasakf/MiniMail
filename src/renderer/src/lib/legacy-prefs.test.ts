import { describe, expect, it, vi } from "vitest";

import { findLegacyPrefs, forgetLegacyPrefs, LEGACY_KEYS } from "./legacy-prefs";

vi.stubGlobal("window", { minimail: { events: { report: () => undefined, onChanged: () => () => undefined } } });

function storage(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
  return { map, getItem: (key: string) => map.get(key) ?? null, removeItem: (key: string) => void map.delete(key) };
}

describe("findLegacyPrefs", () => {
  it("finds the old choices by their keys, parsed, and says which keys to remove once they are saved", () => {
    const old = storage({
      [LEGACY_KEYS.blocklist]: JSON.stringify({ senders: ["a@x.test"], domains: [] }),
      [LEGACY_KEYS.minimizedCategories]: JSON.stringify(["news"]),
      "minimail.composerLayout": "{}", // the state of the screen stays where it is
    });
    const found = findLegacyPrefs(old);
    expect(found.prefs).toEqual({ blocklist: { senders: ["a@x.test"], domains: [] }, minimizedCategories: ["news"] });
    expect(found.keys.sort()).toEqual([LEGACY_KEYS.blocklist, LEGACY_KEYS.minimizedCategories].sort());
    forgetLegacyPrefs(old, found.keys);
    expect([...old.map.keys()]).toEqual(["minimail.composerLayout"]);
  });

  it("reads the color mode as plain text and never marks it for removal", () => {
    const found = findLegacyPrefs(storage({ theme: "dark" }));
    expect(found).toEqual({ prefs: { theme: "dark" }, keys: [] });
  });

  it("finds nothing in a page that never saved anything", () => {
    expect(findLegacyPrefs(storage({}))).toEqual({ prefs: {}, keys: [] });
  });

  it("drops a value that cannot be read instead of failing on it every launch, and still takes the rest", () => {
    const old = storage({ [LEGACY_KEYS.blocklist]: "{broken", [LEGACY_KEYS.pinnedDomains]: JSON.stringify(["acme.com"]) });
    const found = findLegacyPrefs(old);
    expect(found.prefs).toEqual({ pinnedDomains: ["acme.com"] });
    expect(old.map.has(LEGACY_KEYS.blocklist)).toBe(false);
  });
});

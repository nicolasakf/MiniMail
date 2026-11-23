import { describe, expect, it } from "vitest";

import { defaultUiPrefs, mergeLegacyPrefs, parseAppearanceValues } from "./prefs";

describe("mergeLegacyPrefs", () => {
  it("adds the old lists to the saved ones without losing or reordering what is saved", () => {
    const saved = { ...defaultUiPrefs(), blocklist: { senders: ["b@x.test"], domains: [] }, pinnedDomains: ["acme.com"], minimizedCategories: ["news"] };
    const merged = mergeLegacyPrefs(saved, {
      blocklist: { senders: ["a@x.test", "b@x.test"], domains: ["spam.test"] },
      pinnedDomains: ["zeta.com", "acme.com"],
      minimizedCategories: ["promotions"],
    });
    expect(merged.blocklist).toEqual({ senders: ["b@x.test", "a@x.test"], domains: ["spam.test"] });
    expect(merged.pinnedDomains).toEqual(["acme.com", "zeta.com"]);
    expect(merged.minimizedCategories).toEqual(["news", "promotions"]);
  });

  it("keeps the later time of a list unsubscribed from on both sides", () => {
    const saved = { ...defaultUiPrefs(), unsubscribed: { "list:a": 200, "list:b": 50 } };
    expect(mergeLegacyPrefs(saved, { unsubscribed: { "list:a": 100, "list:b": 90, "list:c": 10 } }).unsubscribed).toEqual({ "list:a": 200, "list:b": 90, "list:c": 10 });
  });

  it("never marks a sender whose domain is already marked, and a marked domain replaces the marked senders in it", () => {
    const saved = { ...defaultUiPrefs(), priority: { threads: ["a:t1"], senders: ["old@kept.test"], domains: ["acme.com"] } };
    const merged = mergeLegacyPrefs(saved, {
      priority: { threads: ["a:t2"], senders: ["ceo@acme.com", "new@other.test"], domains: ["kept.test"] },
    });
    expect(merged.priority).toEqual({ threads: ["a:t1", "a:t2"], senders: ["new@other.test"], domains: ["acme.com", "kept.test"] });
  });

  it("takes appearance and color mode only while none is saved", () => {
    const fresh = mergeLegacyPrefs(defaultUiPrefs(), { appearance: { textSize: "large" }, theme: "dark" });
    expect(fresh).toMatchObject({ appearance: { textSize: "large" }, theme: "dark" });
    const chosen = { ...defaultUiPrefs(), appearance: { textSize: "small" }, theme: "light" as const };
    expect(mergeLegacyPrefs(chosen, { appearance: { textSize: "large" }, theme: "dark" })).toMatchObject({ appearance: { textSize: "small" }, theme: "light" });
  });

  it("ignores values that are not what the page used to save, and leaves untouched what it was not given", () => {
    const saved = { ...defaultUiPrefs(), blocklist: { senders: ["a@x.test"], domains: [] }, theme: "dark" as const };
    const merged = mergeLegacyPrefs(saved, { blocklist: 7, priority: "x", unsubscribed: [1], pinnedDomains: { a: 1 }, theme: "dimmed", appearance: "big" });
    expect(merged).toEqual(saved);
  });

  it("does the same a second time (a second address is taken over the same way)", () => {
    const once = mergeLegacyPrefs(defaultUiPrefs(), { blocklist: { senders: ["a@x.test"], domains: [] } });
    expect(mergeLegacyPrefs(once, { blocklist: { senders: ["a@x.test"], domains: [] } })).toEqual(once);
  });
});

describe("parseAppearanceValues", () => {
  it("keeps plain values and drops nested or oversized ones", () => {
    expect(parseAppearanceValues({ a: "x", b: 1, c: true, d: null, e: { f: 1 }, g: "y".repeat(100), h: NaN })).toEqual({ a: "x", b: 1, c: true, d: null });
    expect(parseAppearanceValues([1])).toBeNull();
    expect(parseAppearanceValues(null)).toBeNull();
  });
});

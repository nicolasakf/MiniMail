import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defaultUiPrefs } from "@shared/prefs";

import { savedSection, sectionAt, seedSection } from "./test-settings";
import { UiPrefsStore } from "./ui-prefs";

let dir: string;
const path = () => join(dir, "settings.json");
const open = () => new UiPrefsStore(sectionAt(path(), "ui"));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "minimail-prefs-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("UiPrefsStore, the choices that used to be in the page's storage", () => {
  it("opens a version 2 file with everything it had, and the new choices empty", () => {
    seedSection(path(), "ui", { version: 2, view: "sender", unreadOnly: true, shownFolders: ["inbox", "spam"], pinnedDrafts: ["local-draft:d1"], onboarded: false });
    expect(open().get()).toEqual({
      ...defaultUiPrefs(),
      view: "sender",
      unreadOnly: true,
      shownFolders: ["inbox", "spam"],
      pinnedDrafts: ["local-draft:d1"],
      onboarded: false,
    });
  });

  it("writes the next change as version 3 and keeps what the older file held", () => {
    seedSection(path(), "ui", { version: 2, view: "list", onboarded: true });
    const store = open();
    store.set({ blocklist: { senders: ["spam@x.test"], domains: [] } });
    expect(savedSection(path(), "ui")).toMatchObject({ version: 3, view: "list", onboarded: true, blocklist: { senders: ["spam@x.test"], domains: [] } });
  });

  it("opens a version 3 file saved before recent searches existed, with none", () => {
    seedSection(path(), "ui", { version: 3, view: "list", pinnedDomains: ["acme.com"] });
    expect(open().get()).toMatchObject({ view: "list", pinnedDomains: ["acme.com"], recentSearches: [] });
  });

  it("remembers each of the choices across launches", () => {
    const store = open();
    store.set({ appearance: { textSize: "large", accentColor: null, showPreviews: false } });
    store.set({ theme: "light" });
    store.set({ blocklist: { senders: ["a@x.test"], domains: ["spam.test"] } });
    store.set({ priority: { threads: ["a:t1"], senders: ["ceo@acme.com"], domains: [] } });
    store.set({ unsubscribed: { "list:news.test": 1700000000000 } });
    store.set({ pinnedDomains: ["acme.com"] });
    store.set({ minimizedCategories: ["promotions"] });
    store.set({ recentSearches: ["from:bob", "invoice"] });
    expect(open().get()).toMatchObject({
      appearance: { textSize: "large", accentColor: null, showPreviews: false },
      theme: "light",
      blocklist: { senders: ["a@x.test"], domains: ["spam.test"] },
      priority: { threads: ["a:t1"], senders: ["ceo@acme.com"], domains: [] },
      unsubscribed: { "list:news.test": 1700000000000 },
      pinnedDomains: ["acme.com"],
      minimizedCategories: ["promotions"],
      recentSearches: ["from:bob", "invoice"],
    });
  });

  it("drops only a damaged choice, not the others", () => {
    seedSection(path(), "ui", {
      version: 3,
      view: "list",
      blocklist: "nope",
      priority: { threads: 4, senders: ["ok@x.test"], domains: [] },
      theme: "purple",
      appearance: [1, 2],
      pinnedDomains: [1, "acme.com", "acme.com"],
    });
    expect(open().get()).toMatchObject({
      view: "list",
      blocklist: { senders: [], domains: [] },
      priority: { threads: [], senders: ["ok@x.test"], domains: [] },
      theme: null,
      appearance: null,
      pinnedDomains: ["acme.com"],
    });
  });

  it("leaves a file of a newer app alone and refuses to overwrite it", () => {
    seedSection(path(), "ui", { version: 4, view: "list", somethingNew: true });
    const store = open();
    expect(store.get()).toEqual(defaultUiPrefs());
    expect(() => store.set({ view: "sender" })).toThrow(/newer version/);
    expect(savedSection(path(), "ui")).toMatchObject({ version: 4, view: "list", somethingNew: true });
  });

  it("takes over what the page found in its storage, adds it to what is saved, and writes it", () => {
    const store = open();
    store.set({ blocklist: { senders: ["a@x.test"], domains: [] }, theme: "dark" });
    const merged = store.importLegacy({
      blocklist: { senders: ["b@x.test", "a@x.test"], domains: ["spam.test"] },
      theme: "light",
      appearance: { textSize: "larger" },
      pinnedDomains: ["acme.com"],
    });
    expect(merged.blocklist).toEqual({ senders: ["a@x.test", "b@x.test"], domains: ["spam.test"] });
    expect(merged.theme).toBe("dark"); // one already saved is not replaced
    expect(merged.appearance).toEqual({ textSize: "larger" });
    expect(open().get()).toEqual(merged);
  });
});

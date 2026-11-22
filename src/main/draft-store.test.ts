import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_SAVED_DRAFTS, type SavedDraft } from "@shared/types";

import type { Cipher } from "./category-store";
import { DraftStore } from "./draft-store";
import { savedSection, sectionAt, seedSection } from "./test-settings";
import { UiPrefsStore } from "./ui-prefs";

function fakeCipher(available = true): Cipher {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(`sealed:${plain}`, "utf8").reverse(),
    decryptString(data) {
      const text = Buffer.from(data).reverse().toString("utf8");
      if (!text.startsWith("sealed:")) throw new Error("bad key");
      return text.slice("sealed:".length);
    },
  };
}

const draft = (id: string, savedAt = "2026-11-01T10:00:00.000Z", body = "Hello there"): SavedDraft => ({
  id,
  savedAt,
  mode: "new",
  accountId: "acc1",
  to: [{ name: "Ann", email: "ann@example.com" }],
  cc: [],
  bcc: [],
  pendingText: { to: "", cc: "", bcc: "" },
  subject: "Plans",
  body,
});

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "minimail-drafts-"));
  file = join(dir, "drafts.json");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("DraftStore", () => {
  it("is on disk the moment save returns, and a new instance (a relaunch) reads it back", () => {
    new DraftStore(file, fakeCipher()).save(draft("a"));
    expect(new DraftStore(file, fakeCipher()).list().map((d) => d.id)).toEqual(["a"]);
  });

  it("keeps the text encrypted at rest", () => {
    new DraftStore(file, fakeCipher()).save(draft("a", undefined, "secret plans"));
    expect(readFileSync(file, "utf8")).not.toContain("secret plans");
  });

  it("restores formatted bodies and attachments when the app reopens", () => {
    const rich = {
      ...draft("rich"),
      bodyHtml: "<p><strong>Hello there</strong></p>",
      attachments: [{ filename: "hello.txt", contentType: "text/plain", contentBase64: "aGVsbG8=" }],
    };
    new DraftStore(file, fakeCipher()).save(rich);
    expect(new DraftStore(file, fakeCipher()).list()).toEqual([rich]);
  });

  it("replaces a draft with the same id and lists the newest first", () => {
    const store = new DraftStore(file, fakeCipher());
    store.save(draft("a", "2026-11-01T10:00:00.000Z"));
    store.save(draft("b", "2026-11-02T10:00:00.000Z"));
    const list = store.save(draft("a", "2026-11-03T10:00:00.000Z", "edited"));
    expect(list.map((d) => d.id)).toEqual(["a", "b"]);
    expect(list[0].body).toBe("edited");
  });

  it("removes a draft and persists the removal", () => {
    const store = new DraftStore(file, fakeCipher());
    store.save(draft("a"));
    store.remove("a");
    expect(new DraftStore(file, fakeCipher()).list()).toEqual([]);
  });

  it("keeps only the newest drafts past the limit", () => {
    const store = new DraftStore(file, fakeCipher());
    for (let i = 0; i < MAX_SAVED_DRAFTS + 3; i += 1) {
      store.save(draft(`d${i}`, new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString()));
    }
    const list = store.list();
    expect(list).toHaveLength(MAX_SAVED_DRAFTS);
    expect(list[0].id).toBe(`d${MAX_SAVED_DRAFTS + 2}`);
  });

  it("fails loudly, and writes nothing, when encryption is unavailable", () => {
    const store = new DraftStore(file, fakeCipher(false));
    expect(() => store.save(draft("a"))).toThrow(/cannot be saved/);
    expect(store.list()).toEqual([]);
    expect(existsSync(file)).toBe(false);
  });

  it("does not touch an existing file while encryption is unavailable", () => {
    new DraftStore(file, fakeCipher()).save(draft("a"));
    const before = readFileSync(file, "utf8");
    const locked = new DraftStore(file, fakeCipher(false));
    expect(locked.list()).toEqual([]);
    expect(() => locked.save(draft("b"))).toThrow();
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("copies an unreadable file aside instead of losing it", () => {
    writeFileSync(file, "not json at all");
    expect(new DraftStore(file, fakeCipher()).list()).toEqual([]);
    expect(readFileSync(`${file}.unreadable`, "utf8")).toBe("not json at all");
  });

  it("drops one damaged draft but keeps the others", () => {
    const cipher = fakeCipher();
    const data = cipher.encryptString(JSON.stringify([draft("good"), { id: "bad" }])).toString("base64");
    writeFileSync(file, JSON.stringify({ version: 1, data }));
    expect(new DraftStore(file, cipher).list().map((d) => d.id)).toEqual(["good"]);
  });
});

describe("UiPrefsStore", () => {
  const path = () => join(dir, "settings.json");

  it("starts with Smart, no unread filter and only the inbox shown", () => {
    expect(new UiPrefsStore(sectionAt(path(), "ui")).get()).toEqual({ view: "category", unreadOnly: false, shownFolders: ["inbox"], pinnedDrafts: [], onboarded: null });
  });

  it("remembers the view tab and the filters across launches, each change on its own", () => {
    const store = new UiPrefsStore(sectionAt(path(), "ui"));
    store.set({ view: "sender" });
    store.set({ unreadOnly: true });
    store.set({ shownFolders: ["inbox", "trash", "spam"] });
    expect(new UiPrefsStore(sectionAt(path(), "ui")).get()).toEqual({
      view: "sender",
      unreadOnly: true,
      shownFolders: ["inbox", "trash", "spam"],
      pinnedDrafts: [],
      onboarded: null,
    });
  });

  it("remembers which drafts are pinned, and ignores a damaged list", () => {
    const store = new UiPrefsStore(sectionAt(path(), "ui"));
    store.set({ pinnedDrafts: ["acc|drafts|7", "local-draft:d1"] });
    expect(new UiPrefsStore(sectionAt(path(), "ui")).get().pinnedDrafts).toEqual(["acc|drafts|7", "local-draft:d1"]);
    seedSection(path(), "ui", { version: 1, view: "list", pinnedDrafts: "nope" });
    expect(new UiPrefsStore(sectionAt(path(), "ui")).get()).toMatchObject({ view: "list", pinnedDrafts: [] });
  });

  it("falls back to defaults for a broken file, and for a single bad value only", () => {
    seedSection(path(), "ui", "{broken");
    expect(new UiPrefsStore(sectionAt(path(), "ui")).get().view).toBe("category");
    seedSection(path(), "ui", { version: 1, view: "nope", unreadOnly: true, shownFolders: ["spam"] });
    expect(new UiPrefsStore(sectionAt(path(), "ui")).get()).toEqual({ view: "category", unreadOnly: true, shownFolders: ["spam"], pinnedDrafts: [], onboarded: true });
  });

  it("upgrades a version 1 file: the person used the app before, so the setup guide stays closed", () => {
    seedSection(path(), "ui", { version: 1, view: "sender", unreadOnly: true, shownFolders: ["inbox", "spam"], pinnedDrafts: ["local-draft:d1"] });
    const store = new UiPrefsStore(sectionAt(path(), "ui"));
    expect(store.get()).toEqual({
      view: "sender",
      unreadOnly: true,
      shownFolders: ["inbox", "spam"],
      pinnedDrafts: ["local-draft:d1"],
      onboarded: true,
    });
    // The next write is in the new format and keeps the upgraded answer.
    store.set({ view: "list" });
    expect(savedSection(path(), "ui")).toMatchObject({ version: 2, view: "list", onboarded: true });
    expect(new UiPrefsStore(sectionAt(path(), "ui")).get().onboarded).toBe(true);
  });

  it("remembers whether the setup guide was started or finished", () => {
    const store = new UiPrefsStore(sectionAt(path(), "ui"));
    expect(store.get().onboarded).toBeNull();
    store.set({ onboarded: false });
    expect(new UiPrefsStore(sectionAt(path(), "ui")).get().onboarded).toBe(false);
    store.set({ onboarded: true });
    expect(new UiPrefsStore(sectionAt(path(), "ui")).get().onboarded).toBe(true);
    seedSection(path(), "ui", { version: 2, onboarded: "yes" });
    expect(new UiPrefsStore(sectionAt(path(), "ui")).get().onboarded).toBeNull();
  });
});

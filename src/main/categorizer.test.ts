import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultCategories } from "@shared/categories";
import type { MessageSummary } from "@shared/types";

import { Categorizer } from "./categorizer";
import { CategoryStore, GatewayKeyStore, type Cipher } from "./category-store";
import { TrustedSenders } from "./trusted-senders";
import {
  buildClassificationRequest,
  describeGatewayError,
  MIN_PROBABILITY,
  readClassification,
  redactForClassification,
  type ClassificationInput,
  type Classifier,
} from "./jev";

function msg(overrides: Partial<MessageSummary> & { id: string }): MessageSummary {
  return {
    accountId: "a1",
    folder: "inbox",
    threadId: overrides.id,
    from: { name: "Sam", email: "sam@example.com" },
    to: [],
    subject: "Hello",
    snippet: "Hi there",
    date: new Date(2026, 10, 9, 12).toISOString(),
    unread: true,
    pinned: false,
    answered: false,
    hasAttachments: false,
    signal: "person",
    categoryId: null,
    ...overrides,
  };
}

describe("redactForClassification", () => {
  it("masks codes and link tokens but keeps the shape and the link's host", () => {
    const out = redactForClassification(
      "Your code is 482910. Or sign in: https://login.acme.com/magic/abc123XYZ789?token=s3cr3tvalue1234567890 now",
    );
    expect(out).toBe("Your code is [digits]. Or sign in: [link login.acme.com] now");
    expect(out).not.toMatch(/482910|s3cr3t|abc123/);
  });

  it("masks long mixed tokens and trims to a bounded preview", () => {
    expect(redactForClassification("key a1b2c3d4e5f6g7h8i9j0 done")).toBe("key [token] done");
    expect(redactForClassification("word ".repeat(1000)).length).toBeLessThanOrEqual(1000);
  });

  it("leaves ordinary words and short numbers alone", () => {
    expect(redactForClassification("Lunch at 12:30 on the 3rd?")).toBe("Lunch at 12:30 on the 3rd?");
  });
});

describe("Jev request", () => {
  const categories = defaultCategories();
  const input: ClassificationInput = {
    from: { name: "Acme", email: "no-reply@acme.example" },
    subject: "Your code",
    preview: "Code 123456",
    signal: "notification",
  };

  it("offers each category by name with its criteria, plus a none option", () => {
    const { questions, optionToId } = buildClassificationRequest(input, categories);
    const options = Object.keys(questions.category.criteria);
    expect(options).toEqual(["Invitations", "Newsletters", "Ads", "Notifications", "Verification codes", "None of these"]);
    expect(questions.category.criteria["Verification codes"]).toBe(categories[4].criteria);
    expect(optionToId.get("Newsletters")).toBe("newsletters");
    expect(optionToId.has("None of these")).toBe(false);
  });

  it("sends the redacted preview and header facts as state", () => {
    const { state } = buildClassificationRequest(input, categories);
    expect(state.email).toEqual({
      from: { name: "Acme", address: "no-reply@acme.example" },
      subject: "Your code",
      preview: "Code [digits]",
    });
    expect(state.headerFacts).toMatch(/automated sender/i);
  });

  it("maps the answer back to a category id", () => {
    const { optionToId } = buildClassificationRequest(input, categories);
    expect(
      readClassification({ choice: "Verification codes", probabilities: { "Verification codes": 0.93 } }, optionToId),
    ).toEqual({ categoryId: "verification-codes", probability: 0.93 });
  });

  it("treats 'none of these' and unsure answers as no category", () => {
    const { optionToId } = buildClassificationRequest(input, categories);
    expect(readClassification({ choice: "None of these", probabilities: { "None of these": 0.9 } }, optionToId).categoryId).toBeNull();
    const unsure = readClassification(
      { choice: "Newsletters", probabilities: { Newsletters: MIN_PROBABILITY - 0.01 } },
      optionToId,
    );
    expect(unsure.categoryId).toBeNull();
  });
});

describe("describeGatewayError", () => {
  it("explains the failures people can fix", () => {
    expect(describeGatewayError(Object.assign(new Error("Invalid API key or token."), { statusCode: 401 }))).toMatch(
      /rejected the API key/,
    );
    expect(describeGatewayError(Object.assign(new Error("x"), { statusCode: 402 }))).toMatch(/no credit/);
    expect(describeGatewayError(new Error("fetch failed"))).toMatch(/Could not reach/);
    expect(describeGatewayError(new Error("something else"))).toBe("something else");
  });
});

const fakeCipher: Cipher = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(`enc:${plain}`),
  decryptString: (buffer) => buffer.toString().replace(/^enc:/, ""),
};

describe("stores", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "minimail-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("starts with the default categories and persists edits and classifications", () => {
    const path = join(dir, "categories.json");
    const first = new CategoryStore(path);
    expect(first.categories().map((c) => c.name)).toContain("Verification codes");

    first.setCategories([{ id: "x", name: " Receipts ", criteria: " Purchase receipts. ", hue: 40 }]);
    first.setClassification("a1:t1", { categoryId: "x", probability: 0.9, at: 1 });
    first.flush();

    const second = new CategoryStore(path);
    expect(second.categories()).toEqual([{ id: "x", name: "Receipts", criteria: "Purchase receipts.", hue: 40 }]);
    expect(second.classification("a1:t1")).toEqual({ categoryId: "x", probability: 0.9, at: 1 });
  });

  it("falls back to the defaults when the file is corrupt", () => {
    const path = join(dir, "categories.json");
    writeFileSync(path, "{ not json");
    expect(new CategoryStore(path).categories()).toHaveLength(5);
  });

  it("keeps a category's chosen icon, and gives older saved built-ins theirs", () => {
    const path = join(dir, "categories.json");
    const legacy = [
      { id: "notifications", name: "Notifications", criteria: "Automated messages from apps.", hue: 150 },
      { id: "mine", name: "Mine", criteria: "Things that are mine.", hue: 40 },
    ];
    writeFileSync(path, JSON.stringify({ version: 1, categories: legacy, offered: defaultCategories().map((c) => c.id), classifications: {} }));
    const store = new CategoryStore(path);
    expect(store.categories().map((c) => c.icon)).toEqual(["Bell", undefined]);

    store.setCategories(store.categories().map((c) => (c.id === "mine" ? { ...c, icon: "Receipt" } : c)));
    expect(new CategoryStore(path).categories().find((c) => c.id === "mine")?.icon).toBe("Receipt");
  });

  it("adds Ads once to a file saved before it existed, and keeps it deleted afterwards", () => {
    const path = join(dir, "categories.json");
    const legacy = defaultCategories().filter((c) => c.id !== "ads");
    writeFileSync(path, JSON.stringify({ version: 1, categories: legacy, classifications: {} }));

    const upgraded = new CategoryStore(path);
    expect(upgraded.categories().map((c) => c.id)).toEqual([...legacy.map((c) => c.id), "ads"]);

    upgraded.setCategories(upgraded.categories().filter((c) => c.id !== "ads"));
    expect(new CategoryStore(path).categories().some((c) => c.id === "ads")).toBe(false);
  });

  it("adds only the new built-in to a customized file, leaving the user's own list alone", () => {
    const path = join(dir, "categories.json");
    const custom = [{ id: "x", name: "Receipts", criteria: "Purchase receipts.", hue: 40 }];
    writeFileSync(path, JSON.stringify({ version: 1, categories: custom, classifications: {} }));
    expect(new CategoryStore(path).categories().map((c) => c.id)).toEqual(["x", "ads"]);
  });

  it("remembers trusted senders encrypted, one entry per address, and forgets them on request", () => {
    const path = join(dir, "trusted.json");
    const trusted = new TrustedSenders(path, fakeCipher);
    trusted.add("News@Brand.com");
    trusted.add("news@brand.com");
    expect(trusted.list()).toEqual(["news@brand.com"]);
    expect(readFileSync(path, "utf8")).not.toContain("brand.com");

    expect(new TrustedSenders(path, fakeCipher).list()).toEqual(["news@brand.com"]);
    expect(new TrustedSenders(path, fakeCipher).remove("NEWS@brand.com")).toEqual([]);
    expect(new TrustedSenders(path, fakeCipher).list()).toEqual([]);
  });

  it("refuses to trust a sender without encryption, and ignores a corrupt file", () => {
    const locked = new TrustedSenders(join(dir, "a.json"), { ...fakeCipher, isEncryptionAvailable: () => false });
    expect(() => locked.add("a@b.com")).toThrow(/Secure storage is unavailable/);
    expect(locked.list()).toEqual([]);

    writeFileSync(join(dir, "b.json"), "{ nope");
    expect(new TrustedSenders(join(dir, "b.json"), fakeCipher).list()).toEqual([]);
  });

  it("stores the gateway key encrypted and refuses to store it without encryption", () => {
    const path = join(dir, "ai.json");
    const keys = new GatewayKeyStore(path, fakeCipher);
    keys.set("vck_secret_value");
    expect(readFileSync(path, "utf8")).not.toContain("vck_secret_value");
    expect(new GatewayKeyStore(path, fakeCipher).get()).toBe("vck_secret_value");

    keys.clear();
    expect(new GatewayKeyStore(path, fakeCipher).get()).toBeUndefined();

    const locked = new GatewayKeyStore(join(dir, "other.json"), { ...fakeCipher, isEncryptionAvailable: () => false });
    expect(() => locked.set("vck_secret_value")).toThrow(/Secure storage is unavailable/);
  });
});

describe("Categorizer", () => {
  let dir: string;
  let store: CategoryStore;
  let key: string | undefined;
  let classify: ReturnType<typeof vi.fn<Classifier>>;
  let updated: ReturnType<typeof vi.fn>;
  let categorizer: Categorizer;

  const keys = {
    get: () => key,
    set: (value: string) => {
      key = value;
    },
    clear: () => {
      key = undefined;
    },
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 9, 15));
    dir = mkdtempSync(join(tmpdir(), "minimail-"));
    store = new CategoryStore(join(dir, "categories.json"));
    key = "vck_test";
    classify = vi.fn<Classifier>(async () => ({ categoryId: "newsletters", probability: 0.95 }));
    updated = vi.fn();
    categorizer = new Categorizer({ store, keys, classify, onUpdated: updated });
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Lets queued classifications finish and the debounced "updated" notice fire. */
  const settle = () => vi.advanceTimersByTimeAsync(1000);

  it("uses the header-based guess and makes no model call without a key", async () => {
    key = undefined;
    const [result] = categorizer.apply([msg({ id: "1", signal: "newsletter" })], "inbox");
    await settle();
    expect(result.categoryId).toBe("newsletters");
    expect(classify).not.toHaveBeenCalled();
    expect(categorizer.state().ai.configured).toBe(false);
  });

  it("classifies a new conversation once and serves the answer from the cache afterwards", async () => {
    const first = categorizer.apply([msg({ id: "1", signal: "person" })], "inbox");
    expect(first[0].categoryId).toBeNull(); // fallback until Jev answers
    await settle();
    expect(classify).toHaveBeenCalledTimes(1);
    expect(classify.mock.calls[0][0]).toMatchObject({ subject: "Hello", preview: "Hi there", signal: "person" });
    expect(updated).toHaveBeenCalledTimes(1);

    const again = categorizer.apply([msg({ id: "1" })], "inbox");
    expect(again[0].categoryId).toBe("newsletters");
    await settle();
    expect(classify).toHaveBeenCalledTimes(1);
  });

  it("does not classify replies: a new message in a known conversation inherits its category", async () => {
    categorizer.apply([msg({ id: "1", threadId: "t" })], "inbox");
    await settle();

    const result = categorizer.apply(
      [
        msg({ id: "1", threadId: "t", date: new Date(2026, 10, 9, 9).toISOString() }),
        msg({ id: "2", threadId: "t", subject: "Re: Hello", date: new Date(2026, 10, 9, 14).toISOString() }),
      ],
      "inbox",
    );
    await settle();
    expect(result.map((m) => m.categoryId)).toEqual(["newsletters", "newsletters"]);
    expect(classify).toHaveBeenCalledTimes(1);
  });

  it("classifies the oldest message of an unclassified conversation, once", async () => {
    categorizer.apply(
      [
        msg({ id: "late", threadId: "t", subject: "Re: Plans", date: new Date(2026, 10, 9, 14).toISOString() }),
        msg({ id: "early", threadId: "t", subject: "Plans", date: new Date(2026, 10, 9, 9).toISOString() }),
      ],
      "inbox",
    );
    await settle();
    expect(classify).toHaveBeenCalledTimes(1);
    expect(classify.mock.calls[0][0].subject).toBe("Plans");
  });

  it("only classifies the Inbox", async () => {
    categorizer.apply([msg({ id: "1", folder: "archive" })], "archive");
    categorizer.apply([msg({ id: "2", folder: "spam" })], "spam");
    categorizer.apply([msg({ id: "3", folder: "sent" })], "sent");
    await settle();
    expect(classify).not.toHaveBeenCalled();
  });

  it("stores 'no category' answers so the conversation is not asked about again", async () => {
    classify.mockResolvedValue({ categoryId: null, probability: 0.8 });
    categorizer.apply([msg({ id: "1", signal: "newsletter" })], "inbox");
    await settle();
    const [result] = categorizer.apply([msg({ id: "1", signal: "newsletter" })], "inbox");
    await settle();
    expect(result.categoryId).toBeNull();
    expect(classify).toHaveBeenCalledTimes(1);
  });

  it("re-classifies conversations whose category was deleted", async () => {
    categorizer.apply([msg({ id: "1" })], "inbox");
    await settle();
    categorizer.saveCategories(store.categories().filter((c) => c.id !== "newsletters"));

    classify.mockResolvedValue({ categoryId: "notifications", probability: 0.9 });
    categorizer.apply([msg({ id: "1" })], "inbox");
    await settle();
    expect(classify).toHaveBeenCalledTimes(2);
    expect(categorizer.apply([msg({ id: "1" })], "inbox")[0].categoryId).toBe("notifications");
  });

  it("reports progress of a sort-again run and finishes when nothing is left waiting", async () => {
    expect(categorizer.state().ai.sorting).toBeNull();
    categorizer.reclassify();
    expect(categorizer.state().ai.sorting).toEqual({ done: 0, total: 0, accounts: [], finished: false, error: null });

    categorizer.apply([msg({ id: "1" }), msg({ id: "2" }), msg({ id: "3" })], "inbox");
    expect(categorizer.state().ai.sorting).toMatchObject({ total: 3, finished: false });
    await settle();
    expect(categorizer.state().ai.sorting).toMatchObject({ done: 3, total: 3, finished: false, error: null });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(categorizer.state().ai.sorting).toMatchObject({ done: 3, total: 3, finished: true, error: null });
  });

  it("keeps a run open while a later account's conversations are still arriving", async () => {
    categorizer.reclassify();
    categorizer.apply([msg({ id: "1", accountId: "a1" })], "inbox");
    await settle();
    await vi.advanceTimersByTimeAsync(2_000);
    categorizer.apply([msg({ id: "2", accountId: "a2" })], "inbox");
    await settle();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(categorizer.state().ai.sorting?.finished).toBe(false);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(categorizer.state().ai.sorting).toEqual({
      done: 2,
      total: 2,
      accounts: [
        { accountId: "a1", done: 1, total: 1 },
        { accountId: "a2", done: 1, total: 1 },
      ],
      finished: true,
      error: null,
    });
  });

  it("ends the run with the error when the gateway fails, and says so when nothing was queued", async () => {
    classify.mockRejectedValueOnce(Object.assign(new Error("Invalid API key or token."), { statusCode: 401 }));
    categorizer.reclassify();
    categorizer.apply([msg({ id: "1" }), msg({ id: "2" })], "inbox");
    await settle();
    expect(categorizer.state().ai.sorting).toMatchObject({ finished: true, done: 0, total: 2 });
    expect(categorizer.state().ai.sorting?.error).toMatch(/rejected the API key/);

    categorizer.reclassify();
    await vi.advanceTimersByTimeAsync(16_000);
    expect(categorizer.state().ai.sorting).toEqual({ done: 0, total: 0, accounts: [], finished: true, error: null });
  });

  it("sorts again only conversations with mail since the given date, keeping old answers meanwhile", async () => {
    const old = msg({ id: "old", date: new Date(2026, 9, 1).toISOString() });
    const recent = msg({ id: "recent", accountId: "a2", date: new Date(2026, 10, 9).toISOString() });
    categorizer.apply([old, recent], "inbox");
    await settle();
    expect(classify).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1_000);
    classify.mockResolvedValue({ categoryId: "notifications", probability: 0.9 });
    categorizer.reclassify(new Date(2026, 10, 1).getTime());
    const shown = categorizer.apply([old, recent], "inbox");
    expect(shown.map((message) => message.categoryId)).toEqual(["newsletters", "newsletters"]);
    await settle();

    expect(classify).toHaveBeenCalledTimes(3);
    expect(categorizer.state().ai.sorting).toMatchObject({
      done: 1,
      total: 1,
      accounts: [{ accountId: "a2", done: 1, total: 1 }],
    });
    const after = categorizer.apply([old, recent], "inbox");
    expect(after.map((message) => message.categoryId)).toEqual(["newsletters", "notifications"]);
    await settle();
    expect(classify).toHaveBeenCalledTimes(3);
  });

  it("rejects invalid category lists before saving anything", () => {
    const before = store.categories();
    expect(() => categorizer.saveCategories([{ id: "x", name: "Receipts", criteria: "", hue: 1 }])).toThrow(
      /describe what belongs/,
    );
    expect(store.categories()).toEqual(before);
  });

  it("stops calling the gateway after a failure, reports it, and retries after the pause", async () => {
    classify.mockRejectedValueOnce(Object.assign(new Error("Invalid API key or token."), { statusCode: 401 }));
    categorizer.apply([msg({ id: "1" })], "inbox");
    await settle();
    expect(categorizer.state().ai.lastError).toMatch(/rejected the API key/);

    categorizer.apply([msg({ id: "2" })], "inbox");
    await settle();
    expect(classify).toHaveBeenCalledTimes(1); // paused

    await vi.advanceTimersByTimeAsync(31_000);
    categorizer.apply([msg({ id: "2" })], "inbox");
    await settle();
    expect(classify).toHaveBeenCalledTimes(2);
    expect(categorizer.state().ai.lastError).toBeNull();
  });

  it("reclassify forgets answers and ignores calls that were already in flight", async () => {
    let release: (value: { categoryId: string; probability: number }) => void = () => undefined;
    classify.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    categorizer.apply([msg({ id: "1" })], "inbox");
    categorizer.reclassify();
    release({ categoryId: "notifications", probability: 1 });
    await settle();
    expect(store.classification("a1:1")).toBeUndefined();

    categorizer.apply([msg({ id: "1" })], "inbox");
    await settle();
    expect(store.classification("a1:1")?.categoryId).toBe("newsletters");
  });

  it("limits concurrent calls", async () => {
    let active = 0;
    let peak = 0;
    classify.mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 50));
      active -= 1;
      return { categoryId: null, probability: 1 };
    });
    categorizer.apply(
      Array.from({ length: 12 }, (_, i) => msg({ id: `m${i}` })),
      "inbox",
    );
    await vi.advanceTimersByTimeAsync(2000);
    expect(classify).toHaveBeenCalledTimes(12);
    expect(peak).toBe(4);
  });

  it("test() reports a failing key as a readable error", async () => {
    classify.mockRejectedValueOnce(Object.assign(new Error("Invalid API key or token."), { statusCode: 401 }));
    await expect(categorizer.test()).rejects.toThrow(/rejected the API key/);
    classify.mockResolvedValueOnce({ categoryId: "verification-codes", probability: 0.9 });
    await expect(categorizer.test()).resolves.toBeUndefined();
    expect(categorizer.state().ai.lastError).toBeNull();
  });

  it("setting a key turns AI on and clearing it turns it off", () => {
    key = undefined;
    expect(categorizer.setKey("vck_new_key").ai.configured).toBe(true);
    expect(categorizer.clearKey().ai.configured).toBe(false);
  });
});

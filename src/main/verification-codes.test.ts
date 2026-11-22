import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { DEFAULT_SORT_MODEL } from "@shared/ai-models";
import { DEFAULT_CODE_MODEL } from "@shared/verification-code";
import type { MessageDetail } from "@shared/types";

import { AiSettingsStore } from "./ai-settings";
import { buildCodePrompt } from "./code-fallback";
import { savedSection, sectionAt, seedSection } from "./test-settings";
import { VerificationCodes } from "./verification-codes";

const NOW = Date.parse("2026-11-10T12:00:00Z");

function message(id: string, subject: string, text: string, date = "2026-11-10T11:55:00Z"): MessageDetail {
  return {
    id,
    accountId: "a",
    folder: "inbox",
    threadId: id,
    from: { name: "Acme", email: "no-reply@acme.example" },
    to: [],
    subject,
    snippet: "",
    date,
    unread: true,
    pinned: false,
    answered: false,
    hasAttachments: false,
    signal: "notification",
    categoryId: "verification-codes",
    cc: [],
    replyTo: null,
    messageId: null,
    references: [],
    html: null,
    text,
    attachments: [],
  };
}

function setup(messages: MessageDetail[], fallback: (() => ((input: unknown) => Promise<string | null>) | null) | null) {
  const load = vi.fn(async (ids: string[]) => messages.filter((item) => ids.includes(item.id)));
  const codes = new VerificationCodes({
    load,
    fallback: (fallback ?? (() => null)) as never,
    now: () => NOW,
  });
  return { codes, load };
}

describe("VerificationCodes", () => {
  it("reads clear emails with the rules and never calls the model", async () => {
    const model = vi.fn(async () => "999999");
    const { codes } = setup([message("m1", "Your code", "Your verification code is 482913.")], () => model);
    expect(await codes.get(["m1"])).toEqual({ m1: "482913" });
    expect(model).not.toHaveBeenCalled();
  });

  it("asks the model when the rules cannot tell, and accepts an answer found in the email", async () => {
    const model = vi.fn(async () => "R7-K29X");
    const { codes } = setup([message("m1", "Welcome", "Please enter R7-K29X on the page to continue.")], () => model);
    expect(await codes.get(["m1"])).toEqual({ m1: "R7K29X" });
    expect(model).toHaveBeenCalledTimes(1);
  });

  it("drops a model answer that is not in the email", async () => {
    const model = vi.fn(async () => "123456");
    const { codes } = setup([message("m1", "Welcome", "Click the button to confirm your address.")], () => model);
    expect(await codes.get(["m1"])).toEqual({ m1: null });
  });

  it("does not send old mail to the model", async () => {
    const model = vi.fn(async () => "123456");
    const { codes } = setup([message("m1", "Welcome", "Enter 123456", "2026-11-09T09:00:00Z")], () => model);
    expect(await codes.get(["m1"])).toEqual({ m1: null });
    expect(model).not.toHaveBeenCalled();
  });

  it("leaves an id out when the model fails, so it can be retried, and pauses the model", async () => {
    const model = vi.fn(async () => {
      throw new Error("rate limit");
    });
    const { codes } = setup([message("m1", "Welcome", "Enter the thing")], () => model);
    const silence = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await codes.get(["m1"])).toEqual({});
    expect(await codes.get(["m1"])).toEqual({ m1: null }); // paused: rules said nothing, no new call
    expect(model).toHaveBeenCalledTimes(1);
    silence.mockRestore();
  });

  it("retries a message once a model becomes available", async () => {
    let available = false;
    const model = vi.fn(async () => "R7K29X");
    const { codes, load } = setup(
      [message("m1", "Welcome", "Please enter R7K29X to continue.")],
      () => (available ? model : null),
    );
    expect(await codes.get(["m1"])).toEqual({ m1: null });
    available = true;
    expect(await codes.get(["m1"])).toEqual({ m1: "R7K29X" });
    expect(await codes.get(["m1"])).toEqual({ m1: "R7K29X" });
    expect(load).toHaveBeenCalledTimes(2); // the third call came from the cache
  });
});

describe("VerificationCodes.carriesCode", () => {
  const OLD = "2025-01-01T09:00:00Z";

  it("finds a code by the rules at any age, where the code chip would not", async () => {
    const { codes } = setup([], null);
    const old = message("m1", "Security", "Your verification code is 482913.", OLD);
    expect(await codes.get(["m1"])).toEqual({});
    expect(await codes.carriesCode(old)).toBe(true);
  });

  it("says no for ordinary mail without asking a model that is not there", async () => {
    const { codes } = setup([], null);
    expect(await codes.carriesCode(message("m1", "Lunch", "Are you free on Friday?", OLD))).toBe(false);
  });

  it("asks the model about old mail the rules could not read, and accepts an answer found in the email", async () => {
    const model = vi.fn(async () => "R7K29X");
    const { codes } = setup([], () => model);
    expect(await codes.carriesCode(message("m1", "Welcome", "Please enter R7K29X to continue.", OLD))).toBe(true);
    expect(await codes.carriesCode(message("m1", "Welcome", "Please enter R7K29X to continue.", OLD))).toBe(true);
    expect(model).toHaveBeenCalledTimes(1); // the second answer came from memory
  });

  it("does not take a model answer that is not in the email", async () => {
    const { codes } = setup([], () => vi.fn(async () => "123456"));
    expect(await codes.carriesCode(message("m1", "Welcome", "Click the button.", OLD))).toBe(false);
  });

  it("asks again once a model becomes available, since a no without a model is not final", async () => {
    let available = false;
    const model = vi.fn(async () => "R7K29X");
    const { codes } = setup([], () => (available ? model : null));
    const mail = message("m1", "Welcome", "Please enter R7K29X to continue.", OLD);
    expect(await codes.carriesCode(mail)).toBe(false);
    available = true;
    expect(await codes.carriesCode(mail)).toBe(true);
  });

  it("does not share its answers with the code chip, which has its own age limit", async () => {
    const { codes } = setup([message("m1", "Security", "Your verification code is 482913.", OLD)], null);
    expect(await codes.carriesCode(message("m1", "Security", "Your verification code is 482913.", OLD))).toBe(true);
    expect(await codes.get(["m1"])).toEqual({ m1: null });
  });
});

describe("the model prompt", () => {
  it("names the sender and subject and masks links", () => {
    const prompt = buildCodePrompt({
      from: { name: "Acme", email: "no-reply@acme.example" },
      subject: "Welcome",
      text: "Open https://acme.example/v/secret to go on. Code R7K29X",
    });
    expect(prompt).toContain("From: Acme <no-reply@acme.example>");
    expect(prompt).toContain("[link acme.example]");
    expect(prompt).not.toContain("secret");
    expect(prompt).toContain("R7K29X");
  });
});

describe("AiSettingsStore", () => {
  it("defaults to gpt-4.1-nano, remembers a change and keeps an empty choice", () => {
    const file = join(mkdtempSync(join(tmpdir(), "minimail-ai-")), "settings.json");
    expect(new AiSettingsStore(sectionAt(file, "ai")).codeModel()).toBe(DEFAULT_CODE_MODEL);
    new AiSettingsStore(sectionAt(file, "ai")).setCodeModel(" other/model ");
    expect(new AiSettingsStore(sectionAt(file, "ai")).codeModel()).toBe("other/model");
    new AiSettingsStore(sectionAt(file, "ai")).setCodeModel("");
    expect(new AiSettingsStore(sectionAt(file, "ai")).codeModel()).toBe("");
  });

  it("sorts with Jev by default and remembers a change", () => {
    const file = join(mkdtempSync(join(tmpdir(), "minimail-ai-")), "settings.json");
    expect(new AiSettingsStore(sectionAt(file, "ai")).sortModel()).toBe(DEFAULT_SORT_MODEL);
    new AiSettingsStore(sectionAt(file, "ai")).setSortModel(" other/sorter ");
    expect(new AiSettingsStore(sectionAt(file, "ai")).sortModel()).toBe("other/sorter");
    expect(new AiSettingsStore(sectionAt(file, "ai")).codeModel()).toBe(DEFAULT_CODE_MODEL);
  });

  it("upgrades a version 1 file: keeps its choices and fills the sorting model with Jev", () => {
    const file = join(mkdtempSync(join(tmpdir(), "minimail-ai-")), "settings.json");
    seedSection(file, "ai", { version: 1, codeModel: "mine/own", sortFolders: ["inbox", "spam"] });
    const upgraded = new AiSettingsStore(sectionAt(file, "ai"));
    expect(upgraded.codeModel()).toBe("mine/own");
    expect(upgraded.sortFolders()).toEqual(["inbox", "spam"]);
    expect(upgraded.sortModel()).toBe(DEFAULT_SORT_MODEL);

    upgraded.setSortModel("other/sorter");
    expect(savedSection(file, "ai").version).toBe(4);
    const again = new AiSettingsStore(sectionAt(file, "ai"));
    expect(again.codeModel()).toBe("mine/own");
    expect(again.sortModel()).toBe("other/sorter");
  });

  it("sorts every folder by default and remembers the chosen folders in a fixed order", () => {
    const file = join(mkdtempSync(join(tmpdir(), "minimail-ai-")), "settings.json");
    expect(new AiSettingsStore(sectionAt(file, "ai")).sortFolders()).toEqual(["inbox", "archive", "trash", "spam"]);
    new AiSettingsStore(sectionAt(file, "ai")).setSortFolders(["trash", "inbox"]);
    expect(new AiSettingsStore(sectionAt(file, "ai")).sortFolders()).toEqual(["inbox", "trash"]);
    expect(new AiSettingsStore(sectionAt(file, "ai")).codeModel()).toBe(DEFAULT_CODE_MODEL);
    new AiSettingsStore(sectionAt(file, "ai")).setSortFolders([]);
    expect(new AiSettingsStore(sectionAt(file, "ai")).sortFolders()).toEqual([]);
  });

  it("keeps sorting only the Inbox for an install that already has a key but no settings file", () => {
    const file = join(mkdtempSync(join(tmpdir(), "minimail-ai-")), "settings.json");
    expect(new AiSettingsStore(sectionAt(file, "ai"), { keyAlreadySet: true }).sortFolders()).toEqual(["inbox"]);
    // It was written down, so it stays that way on the next launch, with or without the key.
    expect(savedSection(file, "ai")).toMatchObject({ version: 4, sortFolders: ["inbox"] });
    expect(new AiSettingsStore(sectionAt(file, "ai")).sortFolders()).toEqual(["inbox"]);
  });

  it("reads a saved file with no folder choice as the Inbox only, which is what it meant", () => {
    const file = join(mkdtempSync(join(tmpdir(), "minimail-ai-")), "settings.json");
    seedSection(file, "ai", { version: 2, codeModel: "mine/own", sortModel: DEFAULT_SORT_MODEL });
    expect(new AiSettingsStore(sectionAt(file, "ai")).sortFolders()).toEqual(["inbox"]);
  });
});

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { DEFAULT_CODE_MODEL } from "@shared/verification-code";
import type { MessageDetail } from "@shared/types";

import { AiSettingsStore } from "./ai-settings";
import { buildCodePrompt } from "./code-fallback";
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
  it("defaults to reflection/beam, remembers a change and keeps an empty choice", () => {
    const file = join(mkdtempSync(join(tmpdir(), "minimail-ai-")), "ai-settings.json");
    expect(new AiSettingsStore(file).codeModel()).toBe(DEFAULT_CODE_MODEL);
    new AiSettingsStore(file).setCodeModel(" other/model ");
    expect(new AiSettingsStore(file).codeModel()).toBe("other/model");
    new AiSettingsStore(file).setCodeModel("");
    expect(new AiSettingsStore(file).codeModel()).toBe("");
  });

  it("sorts only the Inbox by default and remembers the chosen folders in a fixed order", () => {
    const file = join(mkdtempSync(join(tmpdir(), "minimail-ai-")), "ai-settings.json");
    expect(new AiSettingsStore(file).sortFolders()).toEqual(["inbox"]);
    new AiSettingsStore(file).setSortFolders(["trash", "inbox"]);
    expect(new AiSettingsStore(file).sortFolders()).toEqual(["inbox", "trash"]);
    expect(new AiSettingsStore(file).codeModel()).toBe(DEFAULT_CODE_MODEL);
    new AiSettingsStore(file).setSortFolders([]);
    expect(new AiSettingsStore(file).sortFolders()).toEqual([]);
  });
});

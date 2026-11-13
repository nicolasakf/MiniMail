import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeMessageId } from "@shared/ids";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(text, "utf8"),
    decryptString: (data: Buffer) => data.toString("utf8"),
  },
}));

import type { Categorizer } from "./categorizer";
import { MailService } from "./service";
import { AccountStore } from "./store";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "minimail-act-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A service whose providers are one recording stub. */
function serviceWithStub() {
  const act = vi.fn(async () => undefined);
  const service = new MailService(
    new AccountStore(join(dir, "accounts.json")),
    {},
    async () => undefined,
    {} as Categorizer,
  );
  vi.spyOn(service as unknown as { providerForId: () => unknown }, "providerForId").mockReturnValue({ act });
  return { service, act };
}

const id = (folder: "inbox" | "archive" | "spam" | "trash", nativeId: string) =>
  makeMessageId({ accountId: "a", folder, nativeId });

describe("MailService.act", () => {
  it("does not move a message to the folder it is already in", async () => {
    const { service, act } = serviceWithStub();
    await service.act("spam", [id("spam", "1"), id("spam", "2")]);
    await service.act("archive", [id("archive", "3")]);
    await service.act("trash", [id("trash", "4")]);
    await service.act("unarchive", [id("inbox", "5")]);
    expect(act).not.toHaveBeenCalled();
  });

  it("still moves the messages of a mixed selection that are somewhere else", async () => {
    const { service, act } = serviceWithStub();
    await service.act("spam", [id("spam", "1"), id("trash", "2"), id("inbox", "3")]);
    expect(act.mock.calls).toEqual([
      ["spam", "trash", ["2"]],
      ["spam", "inbox", ["3"]],
    ]);
  });

  it("leaves flags and deletes alone", async () => {
    const { service, act } = serviceWithStub();
    await service.act("markRead", [id("spam", "1")]);
    await service.act("deleteForever", [id("spam", "2")]);
    expect(act).toHaveBeenCalledTimes(2);
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_OFFLINE_SETTINGS } from "@shared/offline";
import type { Account, MessageSummary } from "@shared/types";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(text, "utf8"),
    decryptString: (data: Buffer) => data.toString("utf8"),
  },
}));

import type { BodyPrefetcher } from "./body-prefetch";
import type { BodyStore } from "./body-store";
import type { Categorizer } from "./categorizer";
import { MailService } from "./service";
import { AccountStore } from "./store";

const account: Account = { id: "a", provider: "gmail", email: "me@example.com", displayName: "Me", auth: "password", hue: 1 };
const row = { id: "a|inbox|1", accountId: "a", folder: "inbox", date: "2026-11-20T10:00:00.000Z" } as MessageSummary;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "minimail-service-prefetch-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function build() {
  const schedule = vi.fn(async () => undefined);
  const scheduleCached = vi.fn();
  const setLimit = vi.fn();
  const forget = vi.fn();
  const dropAccount = vi.fn();
  const provider = { list: vi.fn(async () => [row]), cached: vi.fn(() => [row]), close: vi.fn(async () => undefined) };
  const accounts = new AccountStore(join(dir, "accounts.json"));
  accounts.add(account, { kind: "password", password: "x" });
  const service = new MailService(
    accounts,
    {},
    async () => undefined,
    { apply: (rows: MessageSummary[]) => rows } as unknown as Categorizer,
    undefined,
    undefined,
    { dropAccount, setLimit } as unknown as BodyStore,
    { schedule, scheduleCached, forget } as unknown as BodyPrefetcher,
  );
  vi.spyOn(service as unknown as { providerFor: () => unknown }, "providerFor").mockReturnValue(provider);
  vi.spyOn(service as unknown as { providerForId: () => unknown }, "providerForId").mockReturnValue(provider);
  return { service, schedule, scheduleCached, setLimit, forget, dropAccount, provider };
}

describe("MailService and mail downloaded ahead of time", () => {
  it("hands what a read of a folder shows to the prefetcher, which decides if the folder is chosen", async () => {
    const { service, schedule, provider } = build();
    for (const folder of ["inbox", "archive"] as const) await service.list({ folder });
    expect(schedule).toHaveBeenCalledWith("a", provider, "inbox", [row]);
    expect(schedule).toHaveBeenCalledWith("a", provider, "archive", [row]);
  });

  it("does nothing for a read from the saved copy", async () => {
    const { service, schedule } = build();
    await service.list({ folder: "inbox", cacheOnly: true });
    expect(schedule).not.toHaveBeenCalled();
  });

  it("applies a change on the Advanced page: the new limit, and what each account already shows", () => {
    const { service, scheduleCached, setLimit, provider } = build();
    service.offlineChanged({ ...DEFAULT_OFFLINE_SETTINGS, limit: "size", maxMegabytes: 100 });
    expect(setLimit).toHaveBeenCalledWith(100 * 1024 * 1024);
    expect(scheduleCached).toHaveBeenCalledWith("a", provider);
  });

  it("lifts the limit on the saved text when there is none", () => {
    const { service, setLimit } = build();
    service.offlineChanged({ ...DEFAULT_OFFLINE_SETTINGS, limit: "unlimited" });
    expect(setLimit).toHaveBeenCalledWith(null);
  });

  it("forgets an account's saved messages when it is removed", async () => {
    const { service, forget, dropAccount } = build();
    await service.removeAccount("a");
    expect(forget).toHaveBeenCalledWith("a");
    expect(dropAccount).toHaveBeenCalledWith("a");
  });
});

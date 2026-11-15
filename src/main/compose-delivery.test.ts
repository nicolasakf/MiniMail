import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Draft, SavedDraft } from "@shared/types";

import type { Cipher } from "./category-store";
import { ComposeDelivery } from "./compose-delivery";

const cipher: Cipher = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value),
  decryptString: (value) => value.toString(),
};

const record: SavedDraft = {
  id: "draft", savedAt: "2026-11-13T12:00:00.000Z", accountId: "test", mode: "new",
  subject: "Project update", body: "Hello", to: [{ name: "", email: "test@example.com" }],
  cc: [], bcc: [], pendingText: { to: "", cc: "", bcc: "" },
};
const draft: Draft = {
  accountId: record.accountId, subject: record.subject, text: record.body, to: record.to, cc: [], bcc: [],
};

let folder: string;
beforeEach(() => {
  vi.useFakeTimers();
  folder = mkdtempSync(join(tmpdir(), "minimail-delivery-"));
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(folder, { recursive: true, force: true });
});

function fixture() {
  const send = vi.fn(async (_message: Draft) => {});
  const restore = vi.fn();
  const remove = vi.fn();
  const notify = vi.fn();
  const make = () => new ComposeDelivery(join(folder, "delivery"), cipher, send, restore, remove, notify, () => {});
  return { send, restore, remove, notify, make };
}

describe("scheduled delivery", () => {
  it("sends legacy scheduled messages after restart without running old reminders", async () => {
    const { send, notify, make } = fixture();
    const now = Date.now();
    const remindAt = now + 30_000;
    const legacy = {
      pending: [{ record: { ...record, remindAt }, draft: { ...draft, remindAt }, sendAt: now + 15_000, status: "scheduled" }],
      reminders: [{ subject: draft.subject, remindAt }],
    };
    writeFileSync(join(folder, "delivery"), cipher.encryptString(JSON.stringify(legacy)).toString("base64"));

    const reopened = make();
    reopened.start();
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(send).toHaveBeenCalledExactlyOnceWith(draft);
    expect(reopened.list()).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(notify).not.toHaveBeenCalled();
    reopened.stop();
  });

  it("holds an unconfirmed delivery for review without sending it again", async () => {
    const { send, restore, make } = fixture();
    send.mockRejectedValueOnce(new Error("Connection closed"));
    const queue = make();
    queue.schedule(record, draft, Date.now() + 1);
    queue.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(send).toHaveBeenCalledOnce();
    expect(queue.list()).toEqual([expect.objectContaining({ status: "needsReview" })]);
    queue.stop();
    const reopened = make();
    reopened.cancel(record.id);
    expect(restore).toHaveBeenCalledWith(record);
    expect(reopened.list()).toEqual([]);
  });
});

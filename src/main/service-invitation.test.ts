import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeMessageId } from "@shared/ids";
import type { Invitation, MessageDetail } from "@shared/types";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(text, "utf8"),
    decryptString: (data: Buffer) => data.toString("utf8"),
  },
}));

import type { Categorizer } from "./categorizer";
import { InvitationAnswers } from "./invitation-answers";
import { MailService } from "./service";
import { AccountStore } from "./store";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "minimail-invite-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const invitation = (patch: Partial<Invitation> = {}): Invitation => ({
  uid: "uid-1",
  method: "REQUEST",
  title: "Sync",
  start: null,
  end: null,
  allDay: false,
  location: null,
  organizer: null,
  response: null,
  ...patch,
});

const messageId = makeMessageId({ accountId: "a", folder: "inbox", nativeId: "7" });
const detail = (patch: Partial<Invitation> | null): MessageDetail =>
  ({ id: messageId, accountId: "a", invitation: patch === null ? null : invitation(patch) }) as unknown as MessageDetail;

function setup(found: MessageDetail) {
  const respondToInvitation = vi.fn(async () => undefined);
  const get = vi.fn(async () => [found]);
  const answers = new InvitationAnswers(join(dir, "answers.json"));
  const service = new MailService(new AccountStore(join(dir, "accounts.json")), {}, async () => undefined, {} as Categorizer, undefined, answers);
  vi.spyOn(service as unknown as { providerForId: () => unknown }, "providerForId").mockReturnValue({ get, respondToInvitation });
  return { service, respondToInvitation, answers };
}

describe("MailService invitations", () => {
  it("sends the answer through the provider and remembers it", async () => {
    const { service, respondToInvitation, answers } = setup(detail({}));
    await service.respondToInvitation(messageId, "accepted");
    expect(respondToInvitation).toHaveBeenCalledWith("inbox", "7", "accepted");
    expect(answers.get("a", "uid-1")).toBe("accepted");
  });

  it("shows a remembered answer when the server reports none, and keeps the server's own when it has one", async () => {
    const { service, answers } = setup(detail({}));
    answers.set("a", "uid-1", "declined");
    expect((await service.get([messageId]))[0]!.invitation?.response).toBe("declined");

    const server = setup(detail({ response: "tentative" }));
    server.answers.set("a", "uid-1", "declined");
    expect((await server.service.get([messageId]))[0]!.invitation?.response).toBe("tentative");
  });

  it("does not answer a cancellation or a message without an invitation", async () => {
    const cancelled = setup(detail({ method: "CANCEL" }));
    await expect(cancelled.service.respondToInvitation(messageId, "accepted")).rejects.toThrow("no invitation");
    const none = setup(detail(null));
    await expect(none.service.respondToInvitation(messageId, "accepted")).rejects.toThrow("no invitation");
    expect(cancelled.respondToInvitation).not.toHaveBeenCalled();
    expect(none.respondToInvitation).not.toHaveBeenCalled();
  });

  it("does not remember an answer the provider failed to send", async () => {
    const { service, respondToInvitation, answers } = setup(detail({}));
    respondToInvitation.mockRejectedValueOnce(new Error("offline"));
    await expect(service.respondToInvitation(messageId, "accepted")).rejects.toThrow("offline");
    expect(answers.get("a", "uid-1")).toBeNull();
  });
});

describe("InvitationAnswers", () => {
  it("survives a restart", () => {
    const first = new InvitationAnswers(join(dir, "a.json"));
    first.set("acc", "u", "tentative");
    expect(new InvitationAnswers(join(dir, "a.json")).get("acc", "u")).toBe("tentative");
  });
});

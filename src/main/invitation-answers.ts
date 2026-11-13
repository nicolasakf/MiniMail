import { existsSync, readFileSync } from "node:fs";

import { z } from "zod";

import { invitationResponseSchema } from "@shared/schemas";
import type { InvitationResponse } from "@shared/types";

import { writePrivateFile } from "./category-store";

const fileSchema = z.object({
  version: z.literal(1),
  answers: z.record(z.string(), invitationResponseSchema),
});

/** The most answers kept; the oldest go first. */
const MAX_ANSWERS = 2000;

/**
 * How the user answered each invitation, for accounts whose server does not say (IMAP: the answer
 * goes out as an email and nothing on the mailbox records it). Keyed by account and event UID, so
 * an updated invitation for the same meeting still shows the answer. Holds no mail content.
 */
export class InvitationAnswers {
  private answers: Record<string, InvitationResponse> = {};

  constructor(private readonly filePath: string) {
    if (!existsSync(filePath)) return;
    try {
      this.answers = fileSchema.parse(JSON.parse(readFileSync(filePath, "utf8"))).answers;
    } catch (error) {
      console.error("[invitation-answers] starting empty:", error);
    }
  }

  private key(accountId: string, uid: string): string {
    return `${accountId}|${uid}`;
  }

  get(accountId: string, uid: string): InvitationResponse | null {
    return this.answers[this.key(accountId, uid)] ?? null;
  }

  set(accountId: string, uid: string, response: InvitationResponse): void {
    const key = this.key(accountId, uid);
    const { [key]: _old, ...rest } = this.answers;
    const next = { ...rest, [key]: response };
    const keys = Object.keys(next);
    for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_ANSWERS))) delete next[stale];
    this.answers = next;
    writePrivateFile(this.filePath, JSON.stringify({ version: 1, answers: this.answers }));
  }
}

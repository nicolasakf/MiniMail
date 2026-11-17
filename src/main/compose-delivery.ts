import { existsSync, readFileSync } from "node:fs";

import { z } from "zod";

import { draftSchema, savedDraftSchema } from "@shared/schemas";
import type { Draft, SavedDraft, ScheduledMessage } from "@shared/types";

import { writePrivateFile, type Cipher } from "./category-store";
import { reportError } from "./events";

const pendingSchema = z.object({
  record: savedDraftSchema,
  draft: draftSchema,
  sendAt: z.number(),
  status: z.enum(["scheduled", "sending", "needsReview"]),
});
const stateSchema = z.object({
  pending: z.array(pendingSchema),
});

export class ComposeDelivery {
  private state: z.infer<typeof stateSchema> = { pending: [] };
  private running = false;
  private timer?: NodeJS.Timeout;
  private loadError?: unknown;

  constructor(
    private readonly path: string,
    private readonly cipher: Cipher,
    private readonly send: (draft: Draft) => Promise<void>,
    private readonly restore: (record: SavedDraft) => void,
    private readonly removeDraft: (id: string) => void,
    private readonly notify: (title: string, body: string) => void,
    private readonly changed: () => void,
  ) {
    try {
      if (existsSync(path)) {
        this.state = stateSchema.parse(JSON.parse(cipher.decryptString(Buffer.from(readFileSync(path, "utf8"), "base64"))));
        // A previous process may have stopped after the provider accepted the message.
        this.state.pending = this.state.pending.map((entry) =>
          entry.status === "sending" ? { ...entry, status: "needsReview" } : entry,
        );
      }
    } catch (error) {
      this.loadError = error;
      reportError("send", "Could not read the scheduled messages; none will be sent until this is fixed", error);
    }
  }

  start(): void {
    this.timer = setInterval(() => void this.run(), 15_000);
    void this.run();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  list(): ScheduledMessage[] {
    return this.state.pending.map(({ record, sendAt, status }) => ({
      id: record.id, subject: record.subject, accountId: record.accountId, sendAt, status,
    }));
  }

  schedule(record: SavedDraft, draft: Draft, sendAt: number): void {
    if (sendAt <= Date.now()) throw new Error("Choose a send time in the future.");
    if (this.state.pending.length >= 50) throw new Error("You can schedule up to 50 messages.");
    if (this.state.pending.some((entry) => entry.record.id === record.id)) {
      throw new Error("This draft is already scheduled.");
    }
    const previous = this.state;
    this.commit({ ...previous, pending: [...previous.pending, { record, draft, sendAt, status: "scheduled" }] });
    try {
      this.removeDraft(record.id);
    } catch (error) {
      // The draft still exists. If we cannot roll back on disk, pause dispatch for this run.
      try { this.commit(previous); } catch (rollbackError) { this.loadError = error; reportError("send", "Could not undo a change to the scheduled messages", rollbackError); }
      throw error;
    }
  }

  cancel(id: string): void {
    const entry = this.state.pending.find((item) => item.record.id === id);
    if (!entry) return;
    if (entry.status === "sending") throw new Error("This message is already sending.");
    this.restore(entry.record);
    this.commit({ ...this.state, pending: this.state.pending.filter((item) => item.record.id !== id) });
  }

  private commit(next: z.infer<typeof stateSchema>): void {
    if (this.loadError || !this.cipher.isEncryptionAvailable()) {
      throw new Error("Secure storage for scheduled mail is unavailable.");
    }
    const encoded = this.cipher.encryptString(JSON.stringify(next)).toString("base64");
    writePrivateFile(this.path, encoded);
    this.state = next;
    this.changed();
  }

  private setStatus(id: string, status: ScheduledMessage["status"]): void {
    const pending = this.state.pending.map((entry) => entry.record.id === id ? { ...entry, status } : entry);
    this.commit({ ...this.state, pending });
  }

  private async run(): Promise<void> {
    if (this.running || this.loadError) return;
    this.running = true;
    try {
      for (;;) {
        const entry = this.state.pending.find((item) => item.status === "scheduled" && item.sendAt <= Date.now());
        if (!entry) break;
        const { draft, record } = entry;
        this.setStatus(record.id, "sending");
        try {
          await this.send(draft);
          this.commit({ pending: this.state.pending.filter((item) => item.record.id !== record.id) });
        } catch (error) {
          reportError("send", "A scheduled message could not be sent", error, {
            context: draft.subject || "(no subject)",
            accountId: draft.accountId,
          });
          this.setStatus(record.id, "needsReview");
          this.notify("Check scheduled message", draft.subject || "(no subject)");
        }
      }
    } catch (error) {
      reportError("send", "Could not update the scheduled messages queue", error);
    } finally {
      this.running = false;
    }
  }
}

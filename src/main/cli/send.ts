import { createHash } from "node:crypto";

import { composeText } from "@shared/compose-text";
import type { Draft, SavedDraft } from "@shared/types";

/** The message a saved draft turns into when it goes out: the same text the composer would send. */
export function draftToSend(saved: SavedDraft): Draft {
  return {
    accountId: saved.accountId,
    to: saved.to,
    cc: saved.cc,
    bcc: saved.bcc,
    subject: saved.subject.trim() || "(no subject)",
    text: composeText(saved.body, saved.quoted),
    ...(saved.attachments && saved.attachments.length > 0 ? { attachments: saved.attachments } : {}),
    ...(saved.inReplyTo ? { inReplyTo: saved.inReplyTo } : {}),
  };
}

/**
 * A fingerprint of everything that goes out: who it is from and to, what it says and what it carries. What
 * the person approves is this exact draft; if the fingerprint is different afterwards, it is not what
 * they saw, and it is not sent.
 */
export function draftDigest(saved: SavedDraft): string {
  const hash = createHash("sha256");
  hash.update(
    JSON.stringify({
      accountId: saved.accountId,
      to: saved.to.map((contact) => contact.email.toLowerCase()),
      cc: saved.cc.map((contact) => contact.email.toLowerCase()),
      bcc: saved.bcc.map((contact) => contact.email.toLowerCase()),
      subject: saved.subject,
      body: saved.body,
      quoted: saved.quoted ?? "",
      bodyHtml: saved.bodyHtml ?? "",
      inReplyTo: saved.inReplyTo?.messageId ?? "",
      files: (saved.attachments ?? []).map((file) => [file.filename, createHash("sha256").update(file.contentBase64).digest("hex")]),
    }),
  );
  return hash.digest("hex");
}

const MINUTE = 60_000;

/**
 * When to send, as `--at` says it: a time (`2026-11-22T09:00`, in this computer's time zone, or with an
 * offset) or a wait (`30m`, `2h`, `1d`). Throws an Error saying what is wrong; the time has to be at
 * least a minute away and within a year, like the composer's own scheduling.
 */
export function parseWhen(text: string, now: number): number {
  const wait = /^(\d+)\s*(m|h|d)$/i.exec(text.trim());
  let at: number;
  if (wait) {
    const unit = wait[2]!.toLowerCase() === "m" ? MINUTE : wait[2]!.toLowerCase() === "h" ? 60 * MINUTE : 24 * 60 * MINUTE;
    at = now + Number(wait[1]) * unit;
  } else if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text.trim())) {
    at = Date.parse(text.trim().replace(" ", "T"));
    if (!Number.isFinite(at)) throw new Error(`"${text}" is not a time. Write it like 2026-11-22T09:00, or 30m, 2h, 1d`);
  } else {
    throw new Error(`"${text}" is not a time. Write it like 2026-11-22T09:00, or 30m, 2h, 1d`);
  }
  if (at < now + MINUTE) throw new Error("Choose a send time at least a minute from now.");
  if (at > now + 365 * 24 * 60 * MINUTE) throw new Error("A message can be scheduled up to a year ahead.");
  return at;
}

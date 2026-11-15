import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { toast } from "sonner";

import {
  MAX_ATTACHMENT_BYTES,
  MAX_DRAFT_ATTACHMENTS,
  type Account,
  type Contact,
  type Draft,
  type DraftAttachment,
} from "@shared/types";

import { api } from "@/lib/api";
import { composeText, type ComposeSeed } from "@/lib/compose";
import {
  attachmentBytes,
  attachmentProblem,
  fieldsChanged,
  formatBytes,
  hasContent,
  resolveRecipients,
  sendProblem,
  toSavedDraft,
  type ComposerFields,
} from "@/lib/composer-state";
import { deleteDraft, newDraftId, saveDraft, showDraftSavedToast } from "@/lib/drafts";
import { plainBody, prepareRichBody } from "@/lib/rich-compose";
import { withTimeout } from "@/lib/timeout";

/**
 * What the composer is busy with. Only one thing happens at a time: every action starts by
 * claiming the phase, so a second click, a repeated shortcut or Esc during a save is ignored
 * instead of racing the first.
 */
export type ComposerPhase = "idle" | "attaching" | "saving" | "sending" | "detaching" | "closing";

/** A save, a send or a new window that takes longer than this has failed as far as the user is concerned. */
const SAVE_TIMEOUT_MS = 10_000;
const SEND_TIMEOUT_MS = 90_000;
const WINDOW_TIMEOUT_MS = 20_000;
const CLOSE_TIMEOUT_MS = 5_000;
const SLOW_SEND = "Sending is taking longer than expected. It may still go through, so check Sent before trying again.";

const messageOf = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason));

/** Reads a picked file into the base64 form a draft carries. */
function readAttachment(file: File): Promise<DraftAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
    reader.onload = () => {
      const url = String(reader.result);
      resolve({
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        contentBase64: url.slice(url.indexOf(",") + 1),
      });
    };
    reader.readAsDataURL(file);
  });
}

interface SessionOptions {
  seed: ComposeSeed;
  accounts: readonly Account[];
  /** Closes the composer once what it holds has been sent, saved or handed on. */
  onClose: () => void | Promise<void>;
}

/**
 * Everything the composer holds and does, apart from how it looks: the fields, the draft that
 * Esc keeps, sending (now or later), moving into its own window, and closing.
 */
export function useComposerSession({ seed, accounts, onClose }: SessionOptions) {
  const [accountId, setAccountId] = useState(seed.accountId || accounts[0]?.id || "");
  const [to, setTo] = useState<Contact[]>(seed.to);
  const [cc, setCc] = useState<Contact[]>(seed.cc);
  const [bcc, setBcc] = useState<Contact[]>(seed.bcc ?? []);
  const [toText, setToText] = useState(seed.pendingText?.to ?? "");
  const [ccText, setCcText] = useState(seed.pendingText?.cc ?? "");
  const [bccText, setBccText] = useState(seed.pendingText?.bcc ?? "");
  const [showCc, setShowCc] = useState(seed.cc.length > 0 || Boolean(seed.pendingText?.cc));
  const [showBcc, setShowBcc] = useState(Boolean(seed.bcc?.length || seed.pendingText?.bcc));
  const [subject, setSubject] = useState(seed.subject);
  const [sendAt, setSendAt] = useState(seed.sendAt);
  const [quoted, setQuoted] = useState(seed.quoted ?? "");
  const [attachments, setAttachments] = useState<DraftAttachment[]>(seed.attachments ?? []);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<ComposerPhase>("idle");

  /** The body lives in the editor; it is read here only when something needs it, never per keystroke. */
  const bodyHtml = useRef<string | undefined>(seed.bodyHtml);
  /** Identifies the draft: stays the same across saves of one opening, so each replaces the last. */
  const draftId = useRef(seed.draftId ?? newDraftId());

  // The handlers below run long after the render that created them (a save awaits the disk), so
  // they read the newest values from here instead of the ones they were created with.
  const current = { accountId, to, cc, bcc, toText, ccText, bccText, subject, quoted, sendAt, attachments };
  const latest = useRef(current);
  useLayoutEffect(() => {
    latest.current = current;
  });
  const readFields = useCallback((): ComposerFields => ({ ...latest.current, bodyHtml: bodyHtml.current }), []);
  const readBodyText = useCallback(
    () => (bodyHtml.current === undefined ? seed.body : plainBody(bodyHtml.current)),
    [seed.body],
  );

  /** What the form held when it opened, so closing an untouched form keeps nothing. */
  const opened = useRef<ComposerFields | null>(null);
  opened.current ??= readFields();
  const isChanged = useCallback(() => fieldsChanged(opened.current ?? readFields(), readFields()), [readFields]);

  const phaseRef = useRef<ComposerPhase>("idle");
  const enter = useCallback((next: Exclude<ComposerPhase, "idle">): boolean => {
    if (phaseRef.current !== "idle") return false;
    phaseRef.current = next;
    setPhase(next);
    return true;
  }, []);
  const leave = useCallback(() => {
    phaseRef.current = "idle";
    setPhase("idle");
  }, []);

  /** Set once the message has been sent, scheduled, discarded or moved to its own window. */
  const finished = useRef(false);
  /** Set when writing the draft failed: the next close discards it instead of failing again. */
  const saveFailed = useRef(false);

  const record = useCallback(
    () => toSavedDraft(readFields(), { id: draftId.current, mode: seed.mode, bodyText: readBodyText(), inReplyTo: seed.inReplyTo }),
    [readBodyText, readFields, seed.inReplyTo, seed.mode],
  );

  /**
   * Hands over to the owner, which removes the composer. If it cannot, or says it did and this is
   * still on screen a moment later, the composer unlocks instead of staying frozen.
   */
  const closeWatchdog = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(closeWatchdog.current), []);
  const finish = useCallback(async () => {
    phaseRef.current = "closing";
    setPhase("closing");
    try {
      await onClose();
    } catch (reason) {
      setError(`Could not close: ${messageOf(reason)}`);
      leave();
      return;
    }
    clearTimeout(closeWatchdog.current);
    closeWatchdog.current = setTimeout(() => {
      setError("This message could not be closed. Try again.");
      leave();
    }, CLOSE_TIMEOUT_MS);
  }, [leave, onClose]);

  /** Closes, keeping what was written as a draft (or removing the draft if it was emptied out). */
  const requestClose = useCallback(async () => {
    if (finished.current) {
      if (phaseRef.current === "idle") await finish();
      return;
    }
    if (!enter("saving")) return;
    if (!saveFailed.current && isChanged()) {
      const fields = readFields();
      try {
        if (hasContent(fields, readBodyText())) {
          const saved = record();
          await withTimeout(saveDraft(saved), SAVE_TIMEOUT_MS, "Saving took too long.");
          showDraftSavedToast(saved.id);
        } else {
          // Emptied out on purpose: nothing worth keeping, and an older save of it should go too.
          await deleteDraft(draftId.current);
        }
      } catch (reason) {
        saveFailed.current = true;
        setError(`Could not save the draft: ${messageOf(reason)} Close again to discard it.`);
        leave();
        return;
      }
    }
    await finish();
  }, [enter, finish, isChanged, leave, readBodyText, readFields, record]);

  /** Closes and forgets the draft. */
  const discard = useCallback(async () => {
    if (!enter("saving")) return;
    finished.current = true;
    await deleteDraft(draftId.current);
    await finish();
  }, [enter, finish]);

  const send = useCallback(async () => {
    if (phaseRef.current !== "idle") return;
    const fields = readFields();
    const recipients = resolveRecipients(fields);
    const problem = sendProblem(fields, recipients);
    if (problem) return setError(problem);

    const rich = fields.bodyHtml === undefined ? null : prepareRichBody(fields.bodyHtml, fields.quoted);
    const files = [...fields.attachments, ...(rich?.inline ?? [])];
    const fileProblem = attachmentProblem(files);
    if (fileProblem) return setError(fileProblem);
    const draft: Draft = {
      accountId: fields.accountId,
      to: recipients.to,
      cc: recipients.cc,
      bcc: recipients.bcc,
      subject: fields.subject.trim() || "(no subject)",
      text: composeText(readBodyText(), fields.quoted),
      ...(rich ? { html: rich.html } : {}),
      ...(files.length ? { attachments: files } : {}),
      inReplyTo: seed.inReplyTo,
    };

    if (!enter("sending")) return;
    setError(null);
    try {
      if (fields.sendAt) {
        await withTimeout(api.delivery.schedule(record(), draft, fields.sendAt), SEND_TIMEOUT_MS, SLOW_SEND);
        toast.success("Message scheduled");
      } else {
        await withTimeout(api.mail.send(draft), SEND_TIMEOUT_MS, SLOW_SEND);
        toast.success("Message sent");
        await deleteDraft(draftId.current);
      }
    } catch (reason) {
      setError(messageOf(reason));
      leave();
      return;
    }
    finished.current = true;
    await finish();
  }, [enter, finish, leave, readBodyText, readFields, record, seed.inReplyTo]);

  /** Moves the message into a window of its own; the draft continues there. */
  const detach = useCallback(async () => {
    if (!enter("detaching")) return;
    setError(null);
    try {
      const fields = readFields();
      const saved = record();
      if (isChanged() && hasContent(fields, saved.body)) {
        await withTimeout(saveDraft(saved), SAVE_TIMEOUT_MS, "Saving took too long.");
      }
      await withTimeout(api.composerWindow.open(saved), WINDOW_TIMEOUT_MS, "The new window did not open.");
    } catch (reason) {
      setError(messageOf(reason));
      leave();
      return;
    }
    finished.current = true;
    await finish();
  }, [enter, finish, isChanged, leave, readFields, record]);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (!files.length || !enter("attaching")) return;
      try {
        const have = latest.current.attachments;
        const bytes = have.reduce((sum, file) => sum + attachmentBytes(file), 0) + files.reduce((sum, file) => sum + file.size, 0);
        if (have.length + files.length > MAX_DRAFT_ATTACHMENTS || bytes > MAX_ATTACHMENT_BYTES) {
          setError(`Use up to ${MAX_DRAFT_ATTACHMENTS} attachments totaling ${formatBytes(MAX_ATTACHMENT_BYTES)}.`);
          return;
        }
        const added = await Promise.all(files.map(readAttachment));
        setError(null);
        setAttachments((previous) => [...previous, ...added]);
      } catch (reason) {
        setError(messageOf(reason));
      } finally {
        leave();
      }
    },
    [enter, leave],
  );

  const removeAttachment = useCallback((index: number) => {
    setAttachments((previous) => previous.filter((_, position) => position !== index));
  }, []);

  return {
    fields: { accountId, to, cc, bcc, toText, ccText, bccText, showCc, showBcc, subject, sendAt, quoted, attachments },
    set: { setAccountId, setTo, setCc, setBcc, setToText, setCcText, setBccText, setShowCc, setShowBcc, setSubject, setSendAt, setQuoted },
    bodyHtml,
    error,
    setError,
    phase,
    /** The form is locked while it saves, sends, moves or closes. Reading files in does not lock it. */
    locked: phase !== "idle" && phase !== "attaching",
    send,
    requestClose,
    discard,
    detach,
    addFiles,
    removeAttachment,
    hasContent: () => hasContent(readFields(), readBodyText()),
  };
}

export type ComposerSession = ReturnType<typeof useComposerSession>;

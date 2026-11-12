import { useEffect, useRef, useState } from "react";

import { Check, ChevronDown, Ellipsis, Loader2, Paperclip, Send, X } from "lucide-react";
import { toast } from "sonner";

import { accountLabel } from "@shared/accounts";
import type { ContactEntry } from "@shared/contacts";
import { MAX_ATTACHMENT_BYTES, type Account, type Contact, type Draft, type DraftAttachment } from "@shared/types";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { composeText, parseRecipients, type ComposeSeed } from "@/lib/compose";
import { cachedContacts, refreshContacts } from "@/lib/contact-cache";
import {
  deleteDraft,
  newDraftId,
  saveDraft,
  showDraftSavedToast,
  type SavedDraft,
} from "@/lib/drafts";
import { cn } from "@/lib/utils";

import { AccountMark } from "./account-mark";
import { RecipientField } from "./recipient-field";

const TITLES: Record<ComposeSeed["mode"], string> = {
  new: "New message",
  reply: "Reply",
  replyAll: "Reply all",
  forward: "Forward",
};

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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const attachmentBytes = (file: DraftAttachment) => Math.floor((file.contentBase64.length * 3) / 4);

interface ComposerProps {
  seed: ComposeSeed;
  accounts: readonly Account[];
  onClose: () => void;
}

/** A labelled borderless row, so the header fields read as one continuous form. */
function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-5">
      <span className="w-14 shrink-0 self-start pt-[13px] text-sm text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Borderless field that sits flush in its row; the ring offset would paint over the row divider. */
const BARE_INPUT =
  "h-11 rounded-none border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0";

/** The account to send from, in the same menu the account switcher uses, with each account's logo. */
function FromPicker({
  accounts,
  value,
  onChange,
}: {
  accounts: readonly Account[];
  value: string;
  onChange: (accountId: string) => void;
}) {
  const selected = accounts.find((account) => account.id === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`From: ${selected ? accountLabel(selected) : "none"}. Change account`}
          className="corner-squircle my-1.5 flex h-8 max-w-full items-center gap-2 rounded-lg px-2 -ml-2 text-sm outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent/60"
        >
          {selected ? (
            <>
              <AccountMark account={selected} size={20} />
              <span className="min-w-0 truncate font-medium">{accountLabel(selected)}</span>
              {selected.alias && (
                <span className="min-w-0 truncate text-xs text-muted-foreground">{selected.email}</span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">Choose account</span>
          )}
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {accounts.map((account) => (
          <DropdownMenuItem key={account.id} onSelect={() => onChange(account.id)}>
            <span className="mr-2 flex w-6 shrink-0 justify-center">
              <AccountMark account={account} size={22} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{accountLabel(account)}</span>
              {account.alias && (
                <span className="block truncate text-xs text-muted-foreground">{account.email}</span>
              )}
            </span>
            {value === account.id && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Everyone we have exchanged mail with: what is already known at once, refreshed when it opens. */
function useContactIndex(): ContactEntry[] {
  const [contacts, setContacts] = useState<ContactEntry[]>(cachedContacts);
  useEffect(() => {
    let cancelled = false;
    void refreshContacts().then((found) => {
      if (!cancelled) setContacts(found);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return contacts;
}

/**
 * Message composer in a dialog. Replies arrive with the quoted original folded under an ellipsis
 * and a forward carries the forwarded message in its body; everything stays editable before
 * sending. Closing it (the close button or Esc) keeps what was written as a draft.
 */
export function Composer({ seed, accounts, onClose }: ComposerProps) {
  const [accountId, setAccountId] = useState(seed.accountId || accounts[0]?.id || "");
  const [to, setTo] = useState<Contact[]>(seed.to);
  const [cc, setCc] = useState<Contact[]>(seed.cc);
  const [bcc, setBcc] = useState<Contact[]>(seed.bcc ?? []);
  const [toText, setToText] = useState(seed.pendingText?.to ?? "");
  const [ccText, setCcText] = useState(seed.pendingText?.cc ?? "");
  const [bccText, setBccText] = useState(seed.pendingText?.bcc ?? "");
  const [showCcBcc, setShowCcBcc] = useState(
    seed.cc.length > 0 || (seed.bcc?.length ?? 0) > 0 || Boolean(seed.pendingText?.cc || seed.pendingText?.bcc),
  );
  const [subject, setSubject] = useState(seed.subject);
  const [body, setBody] = useState(seed.body);
  const [quoted, setQuoted] = useState(seed.quoted ?? "");
  const [showQuoted, setShowQuoted] = useState(false);
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contacts = useContactIndex();

  /** Identifies the draft: stays the same across saves of one opening, so each replaces the last. */
  const draftId = useRef(seed.draftId ?? newDraftId());

  const snapshot = () =>
    JSON.stringify([accountId, to, cc, bcc, toText, ccText, bccText, subject, body, quoted]);
  /** What the form held when it opened; Esc on an untouched form keeps nothing. */
  const opened = useRef<string | null>(null);
  opened.current ??= snapshot();

  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      const added = await Promise.all(Array.from(files).map(readAttachment));
      const next = [...attachments, ...added];
      if (next.reduce((sum, file) => sum + attachmentBytes(file), 0) > MAX_ATTACHMENT_BYTES) {
        setError(`Attachments can total at most ${formatBytes(MAX_ATTACHMENT_BYTES)}.`);
        return;
      }
      setError(null);
      setAttachments(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const send = async () => {
    if (sending) return;
    const parsedTo = parseRecipients(toText);
    const parsedCc = parseRecipients(ccText);
    const parsedBcc = parseRecipients(bccText);
    const invalid = [...parsedTo.invalid, ...parsedCc.invalid, ...parsedBcc.invalid];
    const recipients = {
      to: [...to, ...parsedTo.contacts],
      cc: [...cc, ...parsedCc.contacts],
      bcc: [...bcc, ...parsedBcc.contacts],
    };

    if (!accountId) return setError("Choose an account to send from.");
    if (invalid.length > 0) return setError(`Not a valid address: ${invalid.join(", ")}`);
    if (recipients.to.length === 0) return setError("Add at least one recipient.");

    const draft: Draft = {
      accountId,
      ...recipients,
      subject: subject.trim() || "(no subject)",
      text: composeText(body, quoted),
      ...(attachments.length > 0 ? { attachments } : {}),
      inReplyTo: seed.inReplyTo,
    };

    setSending(true);
    setError(null);
    try {
      await api.mail.send(draft);
      void deleteDraft(draftId.current);
      toast.success("Message sent");
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSending(false);
    }
  };

  /** Set while a draft is being written, and after a write failed (a second Esc then discards). */
  const savingDraft = useRef(false);
  const saveFailed = useRef(false);

  /**
   * Esc and the close button: write what was typed to disk as a draft, say so, and get out of the
   * way. If the file cannot be written the composer stays open with the reason, so nothing is
   * lost silently; closing again after that discards the text on purpose.
   */
  const closeKeepingDraft = async () => {
    if (sending || savingDraft.current) return;
    if (!saveFailed.current && snapshot() !== opened.current) {
      const record: SavedDraft = {
        id: draftId.current,
        savedAt: new Date().toISOString(),
        mode: seed.mode,
        accountId,
        to,
        cc,
        bcc,
        pendingText: { to: toText, cc: ccText, bcc: bccText },
        subject,
        body,
        quoted: quoted || undefined,
        inReplyTo: seed.inReplyTo,
      };
      const empty =
        to.length + cc.length + bcc.length === 0 &&
        !toText.trim() &&
        !ccText.trim() &&
        !bccText.trim() &&
        !subject.trim() &&
        !body.trim();
      savingDraft.current = true;
      try {
        if (empty) {
          // Emptied out on purpose: nothing worth keeping, and an older save of it should go too.
          await deleteDraft(record.id);
        } else {
          await saveDraft(record);
          showDraftSavedToast(record.id);
        }
      } catch (reason) {
        saveFailed.current = true;
        setError(
          `Could not save the draft: ${reason instanceof Error ? reason.message : String(reason)} ` +
            "Close again to discard it.",
        );
        return;
      } finally {
        savingDraft.current = false;
      }
    }
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && void closeKeepingDraft()}>
      <DialogContent
        className="max-w-2xl gap-0 p-0"
        // Esc closes an open suggestion list first; a second Esc closes (and saves) the composer.
        onEscapeKeyDown={(event) => {
          const target = event.target;
          if (target instanceof HTMLElement && target.getAttribute("aria-expanded") === "true") {
            event.preventDefault();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void send();
          }
        }}
      >
        <div className="border-b border-border px-5 py-4">
          <DialogTitle className="text-base">{TITLES[seed.mode]}</DialogTitle>
          <DialogDescription className="sr-only">Write and send an email message.</DialogDescription>
        </div>

        {accounts.length > 1 && (
          <FieldRow label="From">
            <FromPicker accounts={accounts} value={accountId} onChange={setAccountId} />
          </FieldRow>
        )}

        <FieldRow label="To">
          <RecipientField
            label="To"
            value={to}
            onChange={setTo}
            text={toText}
            onTextChange={setToText}
            contacts={contacts}
            autoFocus={seed.to.length === 0}
            placeholder="name@example.com"
            trailing={
              !showCcBcc && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setShowCcBcc(true)}
                >
                  Cc / Bcc
                </button>
              )
            }
          />
        </FieldRow>

        {showCcBcc && (
          <>
            <FieldRow label="Cc">
              <RecipientField
                label="Cc"
                value={cc}
                onChange={setCc}
                text={ccText}
                onTextChange={setCcText}
                contacts={contacts}
              />
            </FieldRow>
            <FieldRow label="Bcc">
              <RecipientField
                label="Bcc"
                value={bcc}
                onChange={setBcc}
                text={bccText}
                onTextChange={setBccText}
                contacts={contacts}
              />
            </FieldRow>
          </>
        )}

        <FieldRow label="Subject">
          <Input
            value={subject}
            aria-label="Subject"
            className={BARE_INPUT}
            onChange={(event) => setSubject(event.target.value)}
          />
        </FieldRow>

        <Textarea
          autoFocus={seed.to.length > 0}
          value={body}
          aria-label="Message"
          placeholder="Write your message…"
          className={cn(
            "resize-none rounded-none border-0 bg-transparent px-5 py-4 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0",
            quoted ? "min-h-[180px]" : "min-h-[280px]",
          )}
          onChange={(event) => setBody(event.target.value)}
        />

        {quoted && (
          <div className="px-5 pb-4">
            <button
              type="button"
              aria-expanded={showQuoted}
              aria-label={showQuoted ? "Hide the quoted message" : "Show the quoted message"}
              title={showQuoted ? "Hide the quoted message" : "Show the quoted message"}
              className="corner-squircle inline-flex h-5 items-center rounded-md bg-muted px-2 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setShowQuoted((previous) => !previous)}
            >
              <Ellipsis className="size-4" />
            </button>
            {showQuoted && (
              <Textarea
                value={quoted}
                aria-label="Quoted message"
                className="mt-2 max-h-72 min-h-[72px] resize-none rounded-none border-0 border-l-2 border-border bg-transparent px-3 py-1 text-muted-foreground shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                onChange={(event) => setQuoted(event.target.value)}
              />
            )}
          </div>
        )}

        {attachments.length > 0 && (
          <ul className="flex flex-wrap gap-2 px-5 pb-3">
            {attachments.map((file, index) => (
              <li
                key={`${file.filename}-${index}`}
                className="corner-squircle flex max-w-full items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-xs"
              >
                <Paperclip className="size-3 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">{file.filename}</span>
                <span className="shrink-0 text-muted-foreground">{formatBytes(attachmentBytes(file))}</span>
                <button
                  type="button"
                  aria-label={`Remove ${file.filename}`}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => setAttachments((previous) => previous.filter((_, i) => i !== index))}
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              void addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Attach files"
            title="Attach files"
            disabled={sending}
            onClick={() => fileInput.current?.click()}
          >
            <Paperclip />
          </Button>
          <p className="min-w-0 flex-1 truncate text-sm text-red-400" role="alert">
            {error}
          </p>
          <Button disabled={sending} onClick={() => void send()}>
            {sending ? <Loader2 className="animate-spin" /> : <Send />}
            Send
            <span className="ml-1 text-xs opacity-60">⌘↵</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

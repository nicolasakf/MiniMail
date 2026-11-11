import { useState } from "react";

import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { accountDetail } from "@shared/accounts";
import type { Account, Draft } from "@shared/types";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { formatRecipients, parseRecipients, type ComposeSeed } from "@/lib/compose";

const TITLES: Record<ComposeSeed["mode"], string> = {
  new: "New message",
  reply: "Reply",
  replyAll: "Reply all",
  forward: "Forward",
};

interface ComposerProps {
  seed: ComposeSeed;
  accounts: readonly Account[];
  onClose: () => void;
}

/** A labelled borderless row, so the header fields read as one continuous form. */
function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-5">
      <span className="w-14 shrink-0 text-sm text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Borderless field that sits flush in its row; the ring offset would paint over the row divider. */
const BARE_INPUT =
  "h-11 rounded-none border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0";

/**
 * Message composer in a dialog. Replies and forwards arrive prefilled (the quoted
 * original is part of the body) and everything stays editable before sending.
 */
export function Composer({ seed, accounts, onClose }: ComposerProps) {
  const [accountId, setAccountId] = useState(seed.accountId || accounts[0]?.id || "");
  const [to, setTo] = useState(formatRecipients(seed.to));
  const [cc, setCc] = useState(formatRecipients(seed.cc));
  const [bcc, setBcc] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(seed.cc.length > 0);
  const [subject, setSubject] = useState(seed.subject);
  const [body, setBody] = useState(seed.body);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (sending) return;
    const parsedTo = parseRecipients(to);
    const parsedCc = parseRecipients(cc);
    const parsedBcc = parseRecipients(bcc);
    const invalid = [...parsedTo.invalid, ...parsedCc.invalid, ...parsedBcc.invalid];

    if (!accountId) return setError("Choose an account to send from.");
    if (invalid.length > 0) return setError(`Not a valid address: ${invalid.join(", ")}`);
    if (parsedTo.contacts.length === 0) return setError("Add at least one recipient.");

    const draft: Draft = {
      accountId,
      to: parsedTo.contacts,
      cc: parsedCc.contacts,
      bcc: parsedBcc.contacts,
      subject: subject.trim() || "(no subject)",
      text: body,
      inReplyTo: seed.inReplyTo,
    };

    setSending(true);
    setError(null);
    try {
      await api.mail.send(draft);
      toast.success("Message sent");
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSending(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !sending && onClose()}>
      <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
        <div className="border-b border-border px-5 py-4">
          <DialogTitle className="text-base">{TITLES[seed.mode]}</DialogTitle>
          <DialogDescription className="sr-only">Write and send an email message.</DialogDescription>
        </div>

        {accounts.length > 1 && (
          <FieldRow label="From">
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger className={`${BARE_INPUT} w-full justify-between`}>
                <SelectValue placeholder="Choose account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.alias ? accountDetail(account) : `${account.displayName} <${account.email}>`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
        )}

        <FieldRow label="To">
          <div className="flex items-center gap-2">
            <Input
              autoFocus={seed.to.length === 0}
              value={to}
              aria-label="To"
              placeholder="name@example.com"
              className={BARE_INPUT}
              onChange={(event) => setTo(event.target.value)}
            />
            {!showCcBcc && (
              <button
                type="button"
                className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowCcBcc(true)}
              >
                Cc / Bcc
              </button>
            )}
          </div>
        </FieldRow>

        {showCcBcc && (
          <>
            <FieldRow label="Cc">
              <Input
                value={cc}
                aria-label="Cc"
                className={BARE_INPUT}
                onChange={(event) => setCc(event.target.value)}
              />
            </FieldRow>
            <FieldRow label="Bcc">
              <Input
                value={bcc}
                aria-label="Bcc"
                className={BARE_INPUT}
                onChange={(event) => setBcc(event.target.value)}
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
          className="min-h-[280px] resize-none rounded-none border-0 bg-transparent px-5 py-4 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void send();
            }
          }}
        />

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <p className="min-w-0 flex-1 truncate text-sm text-red-400" role="alert">
            {error}
          </p>
          <Button variant="ghost" disabled={sending} onClick={onClose}>
            Discard
          </Button>
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

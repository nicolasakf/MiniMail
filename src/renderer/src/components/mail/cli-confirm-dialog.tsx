import { useRef } from "react";

import { Paperclip, SquareArrowOutUpRight, SquareTerminal } from "lucide-react";

import type { ConfirmCard } from "@shared/cli-page";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCliConfirm } from "@/lib/cli-confirm";

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** What the card is about, in words: the title, and one line under it. */
function wording(card: ConfirmCard): { title: string; description: string; always: string | null } {
  switch (card.action) {
    case "send":
      return {
        title: card.sendAt ? "Schedule this message?" : "Send this message?",
        description: card.sendAt ? "An AI agent using the MiniMail CLI wants to schedule this message. Once sent, it can't be taken back." : "An AI agent using the MiniMail CLI wants to send this message. Once sent, it can't be taken back.",
        always: card.canAlways ? "Always allow sending to these people" : null,
      };
    case "unsubscribe":
      return {
        title: card.lists.length > 1 ? `Unsubscribe from ${card.lists.length} lists?` : "Unsubscribe?",
        description: "An AI agent using the MiniMail CLI wants the sender to remove you from its list. You can't undo this.",
        always: "Always allow unsubscribing",
      };
    case "invitation":
      return {
        title: card.answer === "accept" ? "Accept this invitation?" : card.answer === "maybe" ? "Reply \"maybe\" to this invitation?" : "Decline this invitation?",
        description: "An AI agent using the MiniMail CLI wants to answer this invitation. The organizer is told.",
        always: "Always allow answering invitations",
      };
  }
}

function Body({ card }: { card: ConfirmCard }) {
  if (card.action === "send") {
    return (
      <dl className="min-w-0 space-y-2">
        <Row label="From">{card.from}</Row>
        <Row label="To">{card.to.join(", ") || "no one"}</Row>
        {card.cc.length > 0 && <Row label="Cc">{card.cc.join(", ")}</Row>}
        {card.bcc.length > 0 && <Row label="Bcc">{card.bcc.join(", ")}</Row>}
        {card.sendAt && <Row label="When">{new Date(card.sendAt).toLocaleString()}</Row>}
        <Row label="Subject">{card.subject || "(no subject)"}</Row>
        {card.preview && (
          <div className="corner-squircle max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-xl shadow-pressed p-3 font-mono text-xs">{card.preview}</div>
        )}
        {card.files.length > 0 && (
          <Row label="Files">
            <ul className="space-y-0.5">
              {card.files.map((file) => (
                <li key={file.filename} className="flex items-center gap-1.5">
                  <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{file.filename}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{size(file.size)}</span>
                </li>
              ))}
            </ul>
            {card.filesFromCli && <p className="mt-1 text-xs text-amber">The agent attached these files. A draft with files it added always asks first.</p>}
          </Row>
        )}
        {card.canAlways && card.newRecipients.length > 0 && (
          <p className="pt-1 text-xs text-muted-foreground">"Always allow" lets the agent send to {card.newRecipients.join(", ")} without asking.</p>
        )}
      </dl>
    );
  }
  if (card.action === "unsubscribe") {
    return (
      <ul className="space-y-1.5 text-sm">
        {card.lists.map((list) => (
          <li key={list.email} className="min-w-0">
            <span className="font-medium">{list.sender}</span> <span className="text-muted-foreground">{list.email}</span>
          </li>
        ))}
        {card.skipped > 0 && <li className="text-xs text-muted-foreground">{card.skipped} message{card.skipped === 1 ? "" : "s"} offer no way to unsubscribe and are left alone.</li>}
      </ul>
    );
  }
  return (
    <dl className="space-y-2">
      <Row label="Meeting">{card.title}</Row>
      {card.when && <Row label="When">{card.when}</Row>}
      {card.location && <Row label="Where">{card.location}</Row>}
      {card.organizer && <Row label="From">{card.organizer}</Row>}
    </dl>
  );
}

/**
 * The card that asks before the CLI does something that cannot be taken back. It shows exactly what will
 * happen. Reject is the way out (Escape and clicking outside mean the same), so an answer is never assumed.
 * A message can also be opened in the composer instead (`onOpenDraft`): the agent is told no and the person sends it.
 */
export function CliConfirmDialog({ onOpenDraft }: { onOpenDraft: (draftId: string) => void }) {
  const { card, answer } = useCliConfirm();
  const reject = useRef<HTMLButtonElement>(null);
  if (!card) return null;
  const { title, description, always } = wording(card);
  return (
    <Dialog open onOpenChange={(open) => !open && answer("reject")}>
      <DialogContent
        // A grid column grows to its widest child; pin it to the dialog's width so long lines wrap instead of spilling out.
        className="max-w-xl grid-cols-[minmax(0,1fr)]"
        onInteractOutside={(event) => event.preventDefault()}
        // Saying no is the safe answer, so it is the one with the focus.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          reject.current?.focus();
        }}
      >
        <DialogHeader>
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <SquareTerminal className="size-3.5" /> via CLI
          </div>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Body card={card} />
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end sm:gap-2">
          <Button ref={reject} type="button" variant="outline" onClick={() => answer("reject")}>
            Reject
          </Button>
          <Button type="button" onClick={() => answer("once")}>
            Allow once
          </Button>
          {card.action === "send" && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                // The agent is told no; the person now owns the draft and sends it from the composer.
                answer("review");
                onOpenDraft(card.draftId);
              }}
            >
              <SquareArrowOutUpRight /> Open in composer
            </Button>
          )}
          {always && (
            <Button type="button" variant="outline" onClick={() => answer("always")}>
              {always}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

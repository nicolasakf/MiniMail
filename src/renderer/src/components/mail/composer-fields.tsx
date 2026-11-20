import { useState, type ReactNode } from "react";

import { Check, ChevronDown } from "lucide-react";

import { accountLabel } from "@shared/accounts";
import type { Account } from "@shared/types";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useContactIndex } from "@/hooks/use-contact-index";

import { AccountMark } from "./account-mark";
import type { ComposerSession } from "./composer-session";
import { RecipientField } from "./recipient-field";

/** One labelled line of the header. Tall enough for a single line; a long recipient list wraps below it. */
export function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-border/50 px-5">
      <span className="flex h-11 w-12 shrink-0 items-center text-[13px] text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** The account to send from, in the same menu the account switcher uses, with each account's logo. */
function FromPicker({ accounts, value, onChange }: {
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
          className="corner-squircle -ml-2 my-1.5 flex h-8 max-w-full items-center gap-2 rounded-lg px-2 text-[13px] outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent/60"
        >
          {selected ? (
            <>
              <AccountMark account={selected} size={18} />
              <span className="min-w-0 truncate font-medium">{accountLabel(selected)}</span>
              {selected.alias && <span className="min-w-0 truncate text-xs text-muted-foreground">{selected.email}</span>}
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
              {account.alias && <span className="block truncate text-xs text-muted-foreground">{account.email}</span>}
            </span>
            {value === account.id && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const LINK_BUTTON = "rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground";

/** From, To, Cc, Bcc and Subject. Suggestions drop over the body, so this sits above it and clips nothing. */
export function ComposerFields({ session, accounts, focusTo }: {
  session: ComposerSession;
  accounts: readonly Account[];
  /** Whether the To box takes focus when the composer opens (a reply starts in the body instead). */
  focusTo: boolean;
}) {
  const { fields, set } = session;
  const contacts = useContactIndex();
  // Cc and Bcc take focus when the user asks for them, not when a restored draft already shows them.
  const [revealed, setRevealed] = useState<"cc" | "bcc" | null>(null);

  return (
    <div className="relative z-20 shrink-0 border-t border-border/50">
      {accounts.length > 1 && (
        <FieldRow label="From">
          <FromPicker accounts={accounts} value={fields.accountId} onChange={set.setAccountId} />
        </FieldRow>
      )}

      <FieldRow label="To">
        <RecipientField
          label="To"
          value={fields.to}
          onChange={set.setTo}
          text={fields.toText}
          onTextChange={set.setToText}
          contacts={contacts}
          autoFocus={focusTo}
          placeholder="name@example.com"
          trailing={
            <span className="flex gap-0.5">
              {!fields.showCc && (
                <button type="button" className={LINK_BUTTON} onClick={() => { setRevealed("cc"); set.setShowCc(true); }}>Cc</button>
              )}
              {!fields.showBcc && (
                <button type="button" className={LINK_BUTTON} onClick={() => { setRevealed("bcc"); set.setShowBcc(true); }}>Bcc</button>
              )}
            </span>
          }
        />
      </FieldRow>

      {fields.showCc && (
        <FieldRow label="Cc">
          <RecipientField label="Cc" value={fields.cc} onChange={set.setCc} text={fields.ccText}
            onTextChange={set.setCcText} contacts={contacts} autoFocus={revealed === "cc"} />
        </FieldRow>
      )}
      {fields.showBcc && (
        <FieldRow label="Bcc">
          <RecipientField label="Bcc" value={fields.bcc} onChange={set.setBcc} text={fields.bccText}
            onTextChange={set.setBccText} contacts={contacts} autoFocus={revealed === "bcc"} />
        </FieldRow>
      )}

      <FieldRow label="Subject">
        <input
          aria-label="Subject"
          value={fields.subject}
          autoComplete="off"
          className="h-11 w-full bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground"
          onChange={(event) => set.setSubject(event.target.value)}
        />
      </FieldRow>
    </div>
  );
}

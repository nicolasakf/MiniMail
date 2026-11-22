import { COMPLETION_LIMITS, type CompletionContext, type CompletionMessage } from "@shared/completion";
import type { Account, Contact, MessageDetail, MessageSummary } from "@shared/types";

import { isValidAddress, messageToText, type ComposeMode } from "./compose";

/** The earlier messages of a conversation, as much of them as the model should read. */
export function earlierMessages(
  messages: readonly MessageSummary[],
  details: readonly MessageDetail[],
  answeredId: string,
): CompletionMessage[] {
  const full = new Map(details.map((message) => [message.id, message]));
  const answered = messages.findIndex((message) => message.id === answeredId);
  const older = (answered < 0 ? messages : messages.slice(0, answered)).slice(-COMPLETION_LIMITS.earlierMessages);
  return older
    .map((message) => {
      const detail = full.get(message.id);
      const written = (detail ? messageToText(detail) : message.snippet)
        .split("\n")
        // Lines that quote the message before it are already in the list.
        .filter((line) => !line.startsWith(">"))
        .join("\n")
        .trim();
      return { from: message.from, date: message.date, text: written.slice(0, COMPLETION_LIMITS.earlierText) };
    })
    .filter((message) => message.text !== "");
}

/** What the composer knows about the message, other than the text, in the size the model is sent. */
export function buildCompletionContext(input: {
  mode: ComposeMode;
  accountId: string;
  accounts: readonly Account[];
  to: readonly Contact[];
  cc: readonly Contact[];
  subject: string;
  quoted: string;
  earlier?: readonly CompletionMessage[];
}): CompletionContext | null {
  const account = input.accounts.find((candidate) => candidate.id === input.accountId);
  if (!account) return null;
  const recipients = (contacts: readonly Contact[]) =>
    contacts.filter((contact) => isValidAddress(contact.email)).slice(0, COMPLETION_LIMITS.recipients);
  return {
    mode: input.mode,
    subject: input.subject.slice(0, COMPLETION_LIMITS.subject),
    me: { name: account.displayName, email: account.email },
    to: recipients(input.to),
    cc: recipients(input.cc),
    quoted: input.quoted.trim() ? input.quoted.slice(0, COMPLETION_LIMITS.quoted) : undefined,
    earlier: input.earlier?.length ? [...input.earlier] : undefined,
  };
}

/** The draft either side of the cursor, cut to what is sent: the words nearest the cursor matter most. */
export function clipAround(before: string, after: string): { before: string; after: string } {
  return {
    before: before.length > COMPLETION_LIMITS.before ? before.slice(-COMPLETION_LIMITS.before) : before,
    after: after.slice(0, COMPLETION_LIMITS.after),
  };
}

/** Not worth a call: the draft has hardly begun, so there is nothing to continue. */
export function worthSuggesting(before: string): boolean {
  return before.trim().length >= 2;
}

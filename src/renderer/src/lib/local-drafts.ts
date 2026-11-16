import { groupThreads, type Thread } from "@shared/threads";
import type { MessageSummary, SavedDraft } from "@shared/types";

/**
 * A draft written here is listed in Drafts as a conversation of one message, so it gets the same
 * row, selection, hover buttons and menu as a draft the mail server holds. Its message id starts
 * with this prefix so the actions can tell it apart: it is not on any server.
 */
const PREFIX = "local-draft:";

export const localDraftMessageId = (draftId: string): string => `${PREFIX}${draftId}`;

export const isLocalDraftId = (messageId: string): boolean => messageId.startsWith(PREFIX);

/** The saved draft a message id names, when it is one of these. */
export const draftIdOf = (messageId: string): string | null =>
  isLocalDraftId(messageId) ? messageId.slice(PREFIX.length) : null;

export const isLocalDraftThread = (thread: Pick<Thread, "latest">): boolean => isLocalDraftId(thread.latest.id);

/** The list entry for a saved draft; the recipients stand where a received message has its sender. */
export function draftMessage(draft: SavedDraft, owner: MessageSummary["from"]): MessageSummary {
  return {
    id: localDraftMessageId(draft.id),
    accountId: draft.accountId,
    folder: "drafts",
    threadId: localDraftMessageId(draft.id),
    from: owner,
    to: [...draft.to, ...draft.cc, ...draft.bcc],
    subject: draft.subject.trim() || "(no subject)",
    snippet: draft.body.replace(/\s+/g, " ").trim(),
    date: draft.savedAt,
    unread: false,
    pinned: false,
    answered: false,
    hasAttachments: Boolean(draft.attachments?.length),
    signal: "person",
    categoryId: null,
  };
}

/** The saved drafts as conversations, newest first. */
export function draftThreads(messages: readonly MessageSummary[]): Thread[] {
  return groupThreads(messages);
}

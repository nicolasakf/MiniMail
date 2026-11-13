import { useEffect, useState } from "react";

import { dropFolderDuplicates } from "@shared/dashboard";
import { MAIL_WINDOW } from "@shared/mail-window";
import type { MailFolder, MessageSummary } from "@shared/types";

import { api } from "@/lib/api";

/**
 * The folders a conversation's other messages live in: what the user sent, what they received
 * and kept in the Inbox, and what they archived. Trash and Spam are left out, so a message
 * thrown away does not come back into a conversation opened from elsewhere.
 */
const CONVERSATION_FOLDERS: readonly MailFolder[] = ["sent", "inbox", "archive"];

/**
 * The mail a conversation opened from any folder can be completed with: the user's replies sit in
 * Sent, the messages they received in the Inbox or Archive, and no folder list loads the others.
 * Loads only while `active` (a conversation is open): the copy on disk first, then the servers'
 * answer, and again whenever the main process reports changed mail. A folder that fails keeps
 * what is already there, since the conversation is readable without it.
 */
export function useConversationMail(active: boolean): MessageSummary[] {
  const [messages, setMessages] = useState<MessageSummary[]>([]);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    let ticket = 0;

    const load = async (cacheOnly: boolean) => {
      const current = ++ticket;
      const byFolder = new Map<MailFolder, MessageSummary[]>();
      await Promise.all(
        CONVERSATION_FOLDERS.map(async (folder) => {
          try {
            const result = await api.mail.list({ folder, limit: MAIL_WINDOW, cacheOnly });
            byFolder.set(folder, result.messages);
          } catch {
            // Keep what is known for this folder.
          }
        }),
      );
      // A newer request (or closing the conversation) supersedes this answer.
      if (cancelled || current !== ticket) return;
      setMessages((known) => {
        const rows = CONVERSATION_FOLDERS.flatMap(
          (folder) => byFolder.get(folder) ?? known.filter((message) => message.folder === folder),
        );
        // The copy on disk may be empty for a folder: never replace known mail with nothing.
        return cacheOnly && rows.length === 0 ? known : dropFolderDuplicates(rows);
      });
    };

    void load(true).then(() => load(false));
    const stopListening = api.mail.onChanged(() => void load(false));
    return () => {
      cancelled = true;
      stopListening();
    };
  }, [active]);

  return messages;
}

import type { UnsubscribeOutcome } from "@shared/cli-page";
import { groupThreads } from "@shared/threads";
import { planUnsubscribe, type UnsubscribedLists } from "@shared/unsubscribe";
import type { MessageSummary, UnsubscribeResult } from "@shared/types";

import { contactLabel } from "./format";

/** What unsubscribing needs from the app: the request to the senders, and the memory of lists already left. */
export interface UnsubscribeIo {
  unsubscribe: (ids: string[]) => Promise<UnsubscribeResult[]>;
  remember: (keys: readonly string[]) => void;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    // expected: a sender's address that is not a URL has no host to name; the sender is still named.
    return "";
  }
}

/**
 * Unsubscribes from the lists behind these messages, one request per list, the way the Unsubscribe button does, and
 * remembers the lists that accepted so every button for them greys out. A sender that only has a web page
 * is reported with its host and left alone: the person is the one to open it, never an agent.
 */
export async function unsubscribeForCli(rows: readonly MessageSummary[], lists: UnsubscribedLists, io: UnsubscribeIo): Promise<UnsubscribeOutcome> {
  const plan = planUnsubscribe(groupThreads([...rows]), lists);
  const outcome: UnsubscribeOutcome = { done: 0, manual: [], failed: [], skipped: plan.skipped, alreadyDone: plan.alreadyDone };
  if (plan.entries.length === 0) return outcome;
  const results = await io.unsubscribe(plan.entries.map((entry) => entry.messageId));
  const accepted: string[] = [];
  for (const entry of plan.entries) {
    const result = results.find((candidate) => candidate.id === entry.messageId);
    const sender = contactLabel(entry.sender);
    if (result?.status === "done") {
      accepted.push(entry.key);
      outcome.done += 1;
    } else if (result?.status === "manual") {
      outcome.manual.push({ sender, host: hostOf(result.url) });
    } else {
      outcome.failed.push({ sender, error: result?.status === "failed" ? result.error : "The mail server did not answer." });
    }
  }
  io.remember(accepted);
  return outcome;
}

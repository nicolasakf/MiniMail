import { messageUnsubscribe } from "@shared/unsubscribe";
import type { MessageSummary, UnsubscribeResult } from "@shared/types";

import { safeFetch, type FetchedResource, type FetchOptions } from "./logos/net-guard";
import { describeError } from "./providers/types";

type Fetcher = (url: string, options: FetchOptions) => Promise<FetchedResource>;

/** The body RFC 8058 says a one-click unsubscribe request carries. */
const ONE_CLICK_BODY = "List-Unsubscribe=One-Click";

/**
 * Unsubscribes from the list that sent this message, the way its headers allow.
 *
 * - One-click senders get the standard HTTPS POST here, through the guarded fetcher: the address
 *   comes from a stranger's mail, so private networks, odd ports and redirects are refused, and
 *   nothing about the user (no cookies, no account) is sent.
 * - Senders that only give a web page are not contacted at all; the page's address is handed back
 *   so the user finishes in their browser.
 */
export async function unsubscribeFrom(
  message: MessageSummary,
  fetcher: Fetcher = safeFetch,
): Promise<UnsubscribeResult> {
  const info = messageUnsubscribe(message);
  if (!info) return { id: message.id, status: "failed", error: "This message cannot be unsubscribed from." };
  if (!info.oneClick) return { id: message.id, status: "manual", url: info.url };
  try {
    const response = await fetcher(info.url, {
      postForm: ONE_CLICK_BODY,
      maxRedirects: 0,
      timeoutMs: 10_000,
      maxBytes: 16 * 1024,
      truncate: true,
    });
    if (response.status >= 200 && response.status < 300) return { id: message.id, status: "done" };
    return { id: message.id, status: "failed", error: statusProblem(response.status) };
  } catch (error) {
    return { id: message.id, status: "failed", error: connectionProblem(error) };
  }
}

/** Says in plain words why a sender's answer was not a success. */
function statusProblem(status: number): string {
  if (status >= 300 && status < 400) {
    return "The sender redirected the request instead of confirming it, which one-click unsubscribe does not allow. Use the unsubscribe link in the email itself.";
  }
  if (status === 404 || status === 410) return "The sender no longer has this unsubscribe link (it may have expired).";
  if (status === 405 || status === 415) return "The sender does not accept one-click requests at this address.";
  if (status === 429) return "The sender is limiting requests right now. Try again in a few minutes.";
  if (status >= 500) return `The sender's server had a problem (status ${status}). Try again later.`;
  return `The sender refused the request (status ${status}).`;
}

/** Says in plain words why the request never got an answer. */
function connectionProblem(error: unknown): string {
  const detail = describeError(error);
  if (/timed out/i.test(detail)) return "The sender did not answer in time.";
  if (/not a public address|only https|default port|credentials in urls/i.test(detail)) {
    return "MiniMail refused to contact this address because it is not a normal public website.";
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(detail)) return "The sender's website could not be found.";
  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH/i.test(detail)) return "Could not connect to the sender's website.";
  if (/certificate|ssl|tls/i.test(detail)) return "The sender's website has a certificate problem.";
  return detail;
}

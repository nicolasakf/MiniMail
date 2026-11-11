import type { SmartCategory } from "./types";

/** The slice of a message the classifier needs; providers fill what they can. */
export interface ClassifyInput {
  fromEmail: string;
  fromName?: string;
  subject: string;
  /** Lower-cased header name -> raw value. */
  headers: Record<string, string | undefined>;
  /** Value of `Content-Type` of the top-level message (to spot text/calendar). */
  contentType?: string;
}

/** Local parts that identify automated senders. */
const NOTIFICATION_LOCAL_PART =
  /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|notifications?|notify|alerts?|mailer[-_.]?daemon|postmaster|bounces?|automated|system|receipts?|billing|invoices?|security|accounts?|updates?|support-noreply)([-_.+].*)?$/i;

/** Well-known services whose mail is almost always an automated notification. */
const NOTIFICATION_DOMAINS =
  /(^|\.)(github|gitlab|bitbucket|atlassian|jira|slack|linear|vercel|netlify|stripe|paypal|amazon|amazonses|sentry|notion|figma|zoom|docker|cursor)\.(com|io|net|so|sh)$/i;

const INVITATION_SUBJECT = /^(updated )?invitation( from google calendar)?:/i;
const RESPONSE_SUBJECT = /^(accepted|declined|tentatively accepted|tentative):/i;

/** Splits "a@b.com" into its parts; returns empty strings when malformed. */
function splitAddress(email: string): { local: string; domain: string } {
  const at = email.lastIndexOf("@");
  if (at < 0) return { local: email.toLowerCase(), domain: "" };
  return {
    local: email.slice(0, at).toLowerCase(),
    domain: email.slice(at + 1).toLowerCase(),
  };
}

/** Reads the `method=` parameter of a text/calendar content type, upper-cased. */
function calendarMethod(contentType: string | undefined): string | null {
  if (!contentType || !/text\/calendar/i.test(contentType)) return null;
  const match = /method\s*=\s*"?([a-z]+)"?/i.exec(contentType);
  return match ? match[1].toUpperCase() : "REQUEST";
}

/**
 * Decides which Smart Inbox bucket a message belongs to, using only headers and
 * the sender, so it works the same for IMAP and Graph and needs no body fetch.
 *
 * Order matters: calendar traffic wins, then automated-sender signals, then bulk
 * headers (newsletters), and anything left is mail from a real person.
 */
export function classifyMessage(input: ClassifyInput): SmartCategory {
  const method = calendarMethod(input.contentType);
  if (method === "REPLY") return "invitation-response";
  if (method === "REQUEST" || method === "CANCEL") return "invitation";
  if (RESPONSE_SUBJECT.test(input.subject)) return "invitation-response";
  if (INVITATION_SUBJECT.test(input.subject)) return "invitation";

  const { local, domain } = splitAddress(input.fromEmail);
  const autoSubmitted = input.headers["auto-submitted"]?.trim().toLowerCase();
  const precedence = input.headers["precedence"]?.trim().toLowerCase();
  const isBulk =
    Boolean(input.headers["list-unsubscribe"]) ||
    Boolean(input.headers["list-id"]) ||
    precedence === "bulk" ||
    precedence === "list" ||
    precedence === "junk";

  const looksAutomated =
    (autoSubmitted !== undefined && autoSubmitted !== "no") ||
    NOTIFICATION_LOCAL_PART.test(local) ||
    NOTIFICATION_DOMAINS.test(domain);

  if (isBulk) {
    return looksAutomated ? "notification" : "newsletter";
  }
  return looksAutomated ? "notification" : "person";
}

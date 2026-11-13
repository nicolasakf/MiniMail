import type { AttachmentInfo, Contact, Invitation, InvitationResponse, MessageDetail } from "@shared/types";

/** A file from some message of the conversation, with where it came from. */
export interface ThreadAttachment extends AttachmentInfo {
  messageId: string;
  from: Contact;
  date: string;
}

/** An invitation from some message of the conversation. */
export interface ThreadInvitation {
  messageId: string;
  invitation: Invitation;
}

export interface ThreadArtifacts {
  attachments: ThreadAttachment[];
  invitations: ThreadInvitation[];
}

/**
 * Everything in a conversation the card lists. Attachments come from every message, oldest first.
 * A meeting that was updated or cancelled is invited to several times; only the newest message
 * about it counts, since that is the one to answer.
 */
export function collectArtifacts(details: readonly MessageDetail[]): ThreadArtifacts {
  const ordered = [...details].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const attachments = ordered.flatMap((message) =>
    message.attachments.map((attachment) => ({ ...attachment, messageId: message.id, from: message.from, date: message.date })),
  );
  const newest = new Map<string, ThreadInvitation>();
  for (const message of ordered) {
    if (message.invitation) newest.set(message.invitation.uid, { messageId: message.id, invitation: message.invitation });
  }
  return { attachments, invitations: [...newest.values()] };
}

/** The conversation's details with the user's answer recorded on every message about that meeting. */
export function withAnswer(details: readonly MessageDetail[], uid: string, response: InvitationResponse): MessageDetail[] {
  return details.map((message) =>
    message.invitation?.uid === uid ? { ...message, invitation: { ...message.invitation, response } } : message,
  );
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const DAY_FORMAT = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });
const DAY_YEAR_FORMAT = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const TIME_FORMAT = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** `YYYY-MM-DD` as a local date. */
function localDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year!, month! - 1, day!);
}

/** When a meeting is, for one line of the card ("Thu, Nov 12 · 3:00 – 3:30 PM"); null when the invitation gives no start. */
export function formatEventTime(
  start: string | null,
  end: string | null,
  allDay: boolean,
  now: Date = new Date(),
): string | null {
  if (!start) return null;
  const dayFormat = (date: Date) => (date.getFullYear() === now.getFullYear() ? DAY_FORMAT : DAY_YEAR_FORMAT).format(date);
  if (allDay) {
    const first = localDate(start);
    // An all-day event ends the day after its last day.
    const last = end ? new Date(localDate(end).getTime() - 86_400_000) : first;
    const lastDay = new Date(last.getFullYear(), last.getMonth(), last.getDate());
    return sameDay(first, lastDay) || lastDay < first ? `${dayFormat(first)} · All day` : `${dayFormat(first)} – ${dayFormat(lastDay)}`;
  }
  const from = new Date(start);
  const to = end ? new Date(end) : null;
  if (!to || to.getTime() <= from.getTime()) return `${dayFormat(from)} · ${TIME_FORMAT.format(from)}`;
  if (sameDay(from, to)) return `${dayFormat(from)} · ${TIME_FORMAT.format(from)} – ${TIME_FORMAT.format(to)}`;
  return `${dayFormat(from)}, ${TIME_FORMAT.format(from)} – ${dayFormat(to)}, ${TIME_FORMAT.format(to)}`;
}

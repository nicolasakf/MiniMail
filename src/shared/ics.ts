import type { Contact, Invitation, InvitationResponse } from "./types";

/** One `NAME;PARAM=value:value` line of an iCalendar file. */
export interface IcsLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** The first event of an iCalendar file, with its lines kept so a reply can quote them back. */
export interface IcsEvent {
  /** The calendar's METHOD (REQUEST, CANCEL, REPLY, ...), upper-cased, or null. */
  method: string | null;
  uid: string;
  sequence: number;
  lines: IcsLine[];
}

/** Undoes RFC 5545 line folding: a line that starts with a space or tab continues the one before. */
function unfold(text: string): string[] {
  const lines: string[] = [];
  for (const raw of text.split(/\r\n|\n|\r/)) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && lines.length > 0) lines[lines.length - 1] += raw.slice(1);
    else lines.push(raw);
  }
  return lines;
}

/** Splits at the first `:` that is not inside a quoted parameter value. */
function parseLine(line: string): IcsLine | null {
  let quoted = false;
  let colon = -1;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') quoted = !quoted;
    else if (char === ":" && !quoted) {
      colon = index;
      break;
    }
  }
  if (colon <= 0) return null;
  const [name, ...rawParams] = splitOutsideQuotes(line.slice(0, colon), ";");
  const params: Record<string, string> = {};
  for (const rawParam of rawParams) {
    const equals = rawParam.indexOf("=");
    if (equals <= 0) continue;
    params[rawParam.slice(0, equals).toUpperCase()] = rawParam.slice(equals + 1).replace(/^"|"$/g, "");
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

function splitOutsideQuotes(text: string, separator: string): string[] {
  const parts: string[] = [];
  let quoted = false;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '"') quoted = !quoted;
    else if (text[index] === separator && !quoted) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** Reads the first VEVENT of an iCalendar file; null when there is none or it has no UID. */
export function parseIcs(text: string): IcsEvent | null {
  let method: string | null = null;
  let inEvent = false;
  let depth = 0;
  const lines: IcsLine[] = [];
  for (const raw of unfold(text)) {
    const line = parseLine(raw);
    if (!line) continue;
    if (line.name === "BEGIN") {
      if (inEvent) depth += 1;
      else if (line.value.toUpperCase() === "VEVENT") inEvent = true;
      continue;
    }
    if (line.name === "END") {
      if (inEvent && depth > 0) depth -= 1;
      else if (inEvent) break;
      continue;
    }
    if (!inEvent) {
      if (line.name === "METHOD") method = line.value.trim().toUpperCase();
      continue;
    }
    if (depth === 0) lines.push(line); // Skip a VALARM's own lines.
  }
  const uid = lines.find((line) => line.name === "UID")?.value.trim();
  if (!uid) return null;
  const sequence = Number(lines.find((line) => line.name === "SEQUENCE")?.value) || 0;
  return { method, uid, sequence, lines };
}

const first = (event: IcsEvent, name: string): IcsLine | undefined => event.lines.find((line) => line.name === name);

/** Reverses iCalendar's TEXT escaping. */
export function unescapeText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_match, char: string) => (char === "n" || char === "N" ? "\n" : char));
}

/** A `mailto:` calendar address as a contact. */
function contactOf(line: IcsLine | undefined): Contact | null {
  if (!line) return null;
  const email = line.value.replace(/^mailto:/i, "").trim();
  if (!email.includes("@")) return null;
  return { name: line.params.CN ?? "", email };
}

/** Milliseconds a zone is ahead of UTC at the given instant. */
function zoneOffset(timeZone: string, at: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - Math.floor(at / 1000) * 1000;
}

interface ParsedTime {
  /** An ISO timestamp, or `YYYY-MM-DD` for an all-day value. */
  iso: string;
  allDay: boolean;
}

/** DTSTART/DTEND as UTC (`...Z`), a time in a named zone, a floating time (read as UTC), or a date. */
function parseTime(line: IcsLine | undefined): ParsedTime | null {
  if (!line) return null;
  const value = line.value.trim();
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (date) return { iso: `${date[1]}-${date[2]}-${date[3]}`, allDay: true };
  const stamp = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!stamp) return null;
  const [, year, month, day, hour, minute, second, utc] = stamp;
  const asUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  const zone = line.params.TZID;
  if (utc || !zone) return { iso: new Date(asUtc).toISOString(), allDay: false };
  try {
    // The offset depends on the instant, which depends on the offset: one correction settles it.
    const guess = asUtc - zoneOffset(zone, asUtc);
    return { iso: new Date(asUtc - zoneOffset(zone, guess)).toISOString(), allDay: false };
  } catch {
    return { iso: new Date(asUtc).toISOString(), allDay: false }; // A zone name this runtime does not know.
  }
}

/** The invitation an iCalendar REQUEST or CANCEL describes; null for any other method. */
export function invitationFromIcs(event: IcsEvent): Invitation | null {
  if (event.method !== "REQUEST" && event.method !== "CANCEL") return null;
  const start = parseTime(first(event, "DTSTART"));
  const end = parseTime(first(event, "DTEND"));
  const summary = first(event, "SUMMARY")?.value;
  const location = first(event, "LOCATION")?.value;
  return {
    uid: event.uid,
    method: event.method,
    title: summary ? unescapeText(summary).trim() || "(no title)" : "(no title)",
    start: start?.iso ?? null,
    end: end?.iso ?? null,
    allDay: start?.allDay ?? false,
    location: location ? unescapeText(location).trim() || null : null,
    organizer: contactOf(first(event, "ORGANIZER")),
    response: null,
  };
}

/** The attendee line that stands for the user: the one whose address is among `own`, else a new one. */
function attendeeFor(event: IcsEvent, own: readonly string[]): IcsLine {
  const wanted = own.map((address) => address.toLowerCase());
  const found = event.lines.find(
    (line) => line.name === "ATTENDEE" && wanted.includes(line.value.replace(/^mailto:/i, "").trim().toLowerCase()),
  );
  return found ?? { name: "ATTENDEE", params: {}, value: `mailto:${own[0] ?? ""}` };
}

const PARTSTAT: Record<InvitationResponse, string> = {
  accepted: "ACCEPTED",
  tentative: "TENTATIVE",
  declined: "DECLINED",
};

/** Folds a line to 75 characters, as RFC 5545 asks. */
function fold(line: string): string {
  const chunks: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    chunks.push(rest.slice(0, 75));
    rest = ` ${rest.slice(75)}`;
  }
  chunks.push(rest);
  return chunks.join("\r\n");
}

function format(line: IcsLine): string {
  const params = Object.entries(line.params)
    .map(([key, value]) => `${key}=${/[;:,]/.test(value) ? `"${value}"` : value}`)
    .join(";");
  return `${line.name}${params ? `;${params}` : ""}:${line.value}`;
}

/** The reply an attendee sends back to the organizer (RFC 5546 METHOD:REPLY) for one event. */
export function buildReplyIcs(
  event: IcsEvent,
  response: InvitationResponse,
  own: readonly string[],
  displayName: string,
  now: Date = new Date(),
): string {
  const attendee = attendeeFor(event, own);
  const answer: IcsLine = {
    name: "ATTENDEE",
    params: { ...(attendee.params.CN || displayName ? { CN: attendee.params.CN ?? displayName } : {}), PARTSTAT: PARTSTAT[response] },
    value: attendee.value,
  };
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const keep = ["ORGANIZER", "DTSTART", "DTEND", "RECURRENCE-ID", "SUMMARY"];
  const body: IcsLine[] = [
    { name: "UID", params: {}, value: event.uid },
    { name: "SEQUENCE", params: {}, value: String(event.sequence) },
    { name: "DTSTAMP", params: {}, value: stamp },
    ...event.lines.filter((line) => keep.includes(line.name)),
    answer,
  ];
  return [
    "BEGIN:VCALENDAR",
    "PRODID:-//MiniMail//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:REPLY",
    "BEGIN:VEVENT",
    ...body.map((line) => fold(format(line))),
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

/** Who the reply goes to: the organizer, else whoever sent the invitation. */
export function replyRecipient(event: IcsEvent, sender: Contact): Contact {
  return contactOf(first(event, "ORGANIZER")) ?? sender;
}

/** The title and body line of the reply message. */
export function replyWording(
  response: InvitationResponse,
  title: string,
  name: string,
): { subject: string; text: string } {
  const verb = { accepted: "Accepted", tentative: "Tentative", declined: "Declined" }[response];
  const said = { accepted: "accepted", tentative: "tentatively accepted", declined: "declined" }[response];
  return { subject: `${verb}: ${title}`, text: `${name} has ${said} this invitation.` };
}

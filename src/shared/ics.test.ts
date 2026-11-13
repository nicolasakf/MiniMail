import { describe, expect, it } from "vitest";

import { buildReplyIcs, invitationFromIcs, parseIcs, replyRecipient, replyWording } from "./ics";

const REQUEST = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "METHOD:REQUEST",
  "BEGIN:VEVENT",
  "UID:abc-123@example.com",
  "SEQUENCE:2",
  "DTSTART:20261112T150000Z",
  "DTEND:20261112T160000Z",
  "SUMMARY:Planning\\, part 2",
  "LOCATION:Room 4\; Floor 2",
  'ORGANIZER;CN="Ada Lovelace":mailto:ada@example.com',
  "ATTENDEE;CN=Me;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:me@example.com",
  "ATTENDEE;PARTSTAT=ACCEPTED:mailto:ada@example.com",
  "BEGIN:VALARM",
  "TRIGGER:-PT15M",
  "END:VALARM",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("parseIcs", () => {
  it("reads the event and skips its alarm", () => {
    const event = parseIcs(REQUEST)!;
    expect(event.method).toBe("REQUEST");
    expect(event.uid).toBe("abc-123@example.com");
    expect(event.sequence).toBe(2);
    expect(event.lines.some((line) => line.name === "TRIGGER")).toBe(false);
  });

  it("unfolds continued lines", () => {
    const event = parseIcs("BEGIN:VEVENT\r\nUID:u1\r\nSUMMARY:A very long\r\n  title\r\nEND:VEVENT")!;
    expect(event.lines.find((line) => line.name === "SUMMARY")?.value).toBe("A very long title");
  });

  it("returns null without an event or a UID", () => {
    expect(parseIcs("BEGIN:VCALENDAR\r\nEND:VCALENDAR")).toBeNull();
    expect(parseIcs("BEGIN:VEVENT\r\nSUMMARY:x\r\nEND:VEVENT")).toBeNull();
  });
});

describe("invitationFromIcs", () => {
  it("describes a request", () => {
    expect(invitationFromIcs(parseIcs(REQUEST)!)).toEqual({
      uid: "abc-123@example.com",
      method: "REQUEST",
      title: "Planning, part 2",
      start: "2026-11-12T15:00:00.000Z",
      end: "2026-11-12T16:00:00.000Z",
      allDay: false,
      location: "Room 4; Floor 2",
      organizer: { name: "Ada Lovelace", email: "ada@example.com" },
      response: null,
    });
  });

  it("reads a time in a named zone", () => {
    const text = REQUEST.replace("DTSTART:20261112T150000Z", "DTSTART;TZID=America/Sao_Paulo:20261112T150000");
    // Brazil has no daylight saving time any more: UTC-3.
    expect(invitationFromIcs(parseIcs(text)!)?.start).toBe("2026-11-12T18:00:00.000Z");
    const winter = REQUEST.replace("DTSTART:20261112T150000Z", "DTSTART;TZID=America/New_York:20261112T150000");
    expect(invitationFromIcs(parseIcs(winter)!)?.start).toBe("2026-11-12T20:00:00.000Z");
  });

  it("reads an all-day event", () => {
    const text = REQUEST.replace("DTSTART:20261112T150000Z", "DTSTART;VALUE=DATE:20261112");
    const invitation = invitationFromIcs(parseIcs(text)!)!;
    expect(invitation.allDay).toBe(true);
    expect(invitation.start).toBe("2026-11-12");
  });

  it("describes a cancellation and ignores replies", () => {
    expect(invitationFromIcs(parseIcs(REQUEST.replace("METHOD:REQUEST", "METHOD:CANCEL"))!)?.method).toBe("CANCEL");
    expect(invitationFromIcs(parseIcs(REQUEST.replace("METHOD:REQUEST", "METHOD:REPLY"))!)).toBeNull();
  });
});

describe("buildReplyIcs", () => {
  const event = parseIcs(REQUEST)!;
  const now = new Date("2026-11-12T10:00:00Z");

  it("answers as the attendee that is the user", () => {
    const reply = buildReplyIcs(event, "accepted", ["ME@example.com"], "Me", now);
    expect(reply).toContain("METHOD:REPLY");
    expect(reply).toContain("UID:abc-123@example.com");
    expect(reply).toContain("SEQUENCE:2");
    expect(reply).toContain("DTSTAMP:20261112T100000Z");
    expect(reply).toContain("ATTENDEE;CN=Me;PARTSTAT=ACCEPTED:mailto:me@example.com");
    expect(reply.match(/ATTENDEE/g)).toHaveLength(1);
    expect(reply.endsWith("\r\n")).toBe(true);
  });

  it("maps the other answers", () => {
    expect(buildReplyIcs(event, "tentative", ["me@example.com"], "Me", now)).toContain("PARTSTAT=TENTATIVE");
    expect(buildReplyIcs(event, "declined", ["me@example.com"], "Me", now)).toContain("PARTSTAT=DECLINED");
  });

  it("falls back to the account address when no attendee matches", () => {
    const reply = buildReplyIcs(event, "accepted", ["other@example.com"], "Other", now);
    expect(reply).toContain("mailto:other@example.com");
  });
});

describe("reply routing", () => {
  const event = parseIcs(REQUEST)!;
  it("goes to the organizer, else the sender", () => {
    expect(replyRecipient(event, { name: "S", email: "s@example.com" }).email).toBe("ada@example.com");
    const noOrganizer = parseIcs(REQUEST.replace(/ORGANIZER.*\r\n/, ""))!;
    expect(replyRecipient(noOrganizer, { name: "S", email: "s@example.com" }).email).toBe("s@example.com");
  });

  it("words the message", () => {
    expect(replyWording("declined", "Planning", "Me")).toEqual({
      subject: "Declined: Planning",
      text: "Me has declined this invitation.",
    });
  });
});

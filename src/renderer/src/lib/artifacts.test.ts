import { describe, expect, it } from "vitest";

import type { Invitation, MessageDetail } from "@shared/types";

import { collectArtifacts, formatEventTime, formatSize, withAnswer } from "./artifacts";

const invitation = (patch: Partial<Invitation> = {}): Invitation => ({
  uid: "u1",
  method: "REQUEST",
  title: "Sync",
  start: null,
  end: null,
  allDay: false,
  location: null,
  organizer: null,
  response: null,
  ...patch,
});

const message = (id: string, date: string, patch: Partial<MessageDetail> = {}): MessageDetail =>
  ({
    id,
    date,
    from: { name: "Ann", email: "ann@x.com" },
    attachments: [],
    invitation: null,
    ...patch,
  }) as unknown as MessageDetail;

describe("collectArtifacts", () => {
  it("lists every message's attachments, oldest first, with where they came from", () => {
    const file = (name: string) => ({ id: name, filename: name, contentType: "x/y", size: 1 });
    const { attachments } = collectArtifacts([
      message("b", "2026-11-02T00:00:00Z", { attachments: [file("two.pdf")] }),
      message("a", "2026-11-01T00:00:00Z", { attachments: [file("one.pdf"), file("one.png")] }),
    ]);
    expect(attachments.map((entry) => [entry.messageId, entry.filename])).toEqual([
      ["a", "one.pdf"],
      ["a", "one.png"],
      ["b", "two.pdf"],
    ]);
    expect(attachments[0]!.from.email).toBe("ann@x.com");
  });

  it("keeps only the newest message about a meeting, in the order meetings first appear", () => {
    const { invitations } = collectArtifacts([
      message("old", "2026-11-01T00:00:00Z", { invitation: invitation({ title: "Old" }) }),
      message("new", "2026-11-03T00:00:00Z", { invitation: invitation({ title: "New", method: "CANCEL" }) }),
      message("other", "2026-11-02T00:00:00Z", { invitation: invitation({ uid: "u2", title: "Other" }) }),
    ]);
    expect(invitations.map((entry) => [entry.messageId, entry.invitation.title])).toEqual([
      ["new", "New"],
      ["other", "Other"],
    ]);
  });
});

describe("withAnswer", () => {
  it("records the answer on every message about the meeting", () => {
    const next = withAnswer(
      [message("a", "2026-11-01T00:00:00Z", { invitation: invitation() }), message("b", "2026-11-02T00:00:00Z", { invitation: invitation({ uid: "u2" }) })],
      "u1",
      "declined",
    );
    expect(next[0]!.invitation?.response).toBe("declined");
    expect(next[1]!.invitation?.response).toBeNull();
  });
});

describe("formatSize", () => {
  it("scales", () => {
    expect(formatSize(12)).toBe("12 B");
    expect(formatSize(2048)).toBe("2 KB");
    expect(formatSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("formatEventTime", () => {
  const now = new Date(2026, 10, 12);
  const local = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).toISOString();

  it("is null without a start", () => expect(formatEventTime(null, null, false, now)).toBeNull());

  it("shows a same-day range", () => {
    expect(formatEventTime(local(12, 15), local(12, 15, 30), false, now)).toBe("Thu, Nov 12 · 3:00 PM – 3:30 PM");
  });

  it("shows both days when it crosses midnight", () => {
    expect(formatEventTime(local(12, 22), local(13, 1), false, now)).toBe("Thu, Nov 12, 10:00 PM – Fri, Nov 13, 1:00 AM");
  });

  it("shows only the start when there is no end", () => {
    expect(formatEventTime(local(12, 9), null, false, now)).toBe("Thu, Nov 12 · 9:00 AM");
  });

  it("shows all-day events, treating the end date as exclusive", () => {
    expect(formatEventTime("2026-11-12", "2026-11-13", true, now)).toBe("Thu, Nov 12 · All day");
    expect(formatEventTime("2026-11-12", "2026-11-15", true, now)).toBe("Thu, Nov 12 – Sat, Nov 14");
  });

  it("adds the year for another year", () => {
    expect(formatEventTime(new Date(2027, 0, 5, 9).toISOString(), null, false, now)).toBe("Tue, Jan 5, 2027 · 9:00 AM");
  });
});

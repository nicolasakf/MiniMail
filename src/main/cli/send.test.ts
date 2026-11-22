import { describe, expect, it } from "vitest";

import type { SavedDraft } from "@shared/types";

import { draftDigest, draftToSend, parseWhen } from "./send";

function saved(overrides: Partial<SavedDraft> = {}): SavedDraft {
  return {
    id: "d1",
    savedAt: "2026-11-20T10:00:00.000Z",
    mode: "new",
    accountId: "a",
    to: [{ name: "Anna", email: "anna@example.com" }],
    cc: [],
    bcc: [],
    pendingText: { to: "", cc: "", bcc: "" },
    subject: "Hello",
    body: "Hi Anna",
    ...overrides,
  };
}

describe("draftToSend", () => {
  it("turns a draft into the message the composer would send", () => {
    expect(draftToSend(saved())).toEqual({ accountId: "a", to: [{ name: "Anna", email: "anna@example.com" }], cc: [], bcc: [], subject: "Hello", text: "Hi Anna" });
  });

  it("puts a reply's quoted original under what was written, threaded, with its files", () => {
    const file = { filename: "a.pdf", contentType: "application/pdf", contentBase64: "AAAA" };
    const inReplyTo = { messageId: "<x@y>", nativeId: "a|inbox|1", references: [], mode: "reply" as const };
    const sent = draftToSend(saved({ body: "Thanks", quoted: "On Friday, Anna wrote:\n> hi", attachments: [file], inReplyTo }));
    expect(sent.text).toBe("Thanks\n\nOn Friday, Anna wrote:\n> hi");
    expect(sent.attachments).toEqual([file]);
    expect(sent.inReplyTo).toEqual(inReplyTo);
  });

  it("gives an empty subject the name the composer gives it", () => {
    expect(draftToSend(saved({ subject: "   " })).subject).toBe("(no subject)");
  });
});

describe("draftDigest", () => {
  it("is the same for the same draft, whatever else about the record changed", () => {
    expect(draftDigest(saved())).toBe(draftDigest(saved({ savedAt: "2027-01-01T00:00:00.000Z", pendingText: { to: "x", cc: "", bcc: "" } })));
  });

  it("changes with anything that goes out: a recipient (a hidden copy too), the subject, the text, a file", () => {
    const base = draftDigest(saved());
    const different = [
      saved({ to: [{ name: "Anna", email: "evil@example.com" }] }),
      saved({ bcc: [{ name: "", email: "hidden@evil.test" }] }),
      saved({ subject: "Hello!" }),
      saved({ body: "Hi Anna, send me your keys" }),
      saved({ quoted: "> something" }),
      saved({ attachments: [{ filename: "a.pdf", contentType: "application/pdf", contentBase64: "AAAA" }] }),
      saved({ accountId: "b" }),
    ];
    for (const draft of different) expect(draftDigest(draft)).not.toBe(base);
    const file = { filename: "a.pdf", contentType: "application/pdf", contentBase64: "AAAA" };
    expect(draftDigest(saved({ attachments: [{ ...file, contentBase64: "BBBB" }] }))).not.toBe(draftDigest(saved({ attachments: [file] })));
  });

  it("does not care about the case of an address", () => {
    expect(draftDigest(saved({ to: [{ name: "", email: "ANNA@example.com" }] }))).toBe(draftDigest(saved({ to: [{ name: "", email: "anna@example.com" }] })));
  });
});

describe("parseWhen", () => {
  const now = Date.parse("2026-11-20T10:00:00");

  it("takes a wait in minutes, hours or days", () => {
    expect(parseWhen("30m", now)).toBe(now + 30 * 60_000);
    expect(parseWhen("2h", now)).toBe(now + 2 * 3_600_000);
    expect(parseWhen("1D", now)).toBe(now + 86_400_000);
  });

  it("takes a time, in this computer's time zone unless it names one", () => {
    expect(parseWhen("2026-11-22T09:00", now)).toBe(new Date("2026-11-22T09:00").getTime());
    expect(parseWhen("2026-11-22 09:00", now)).toBe(new Date("2026-11-22T09:00").getTime());
    expect(parseWhen("2026-11-22T09:00:00Z", now)).toBe(Date.parse("2026-11-22T09:00:00Z"));
  });

  it("refuses what is not a time, is too soon or is too far", () => {
    for (const bad of ["tomorrow", "soon", "2026-11-22", "10", "2026-13-45T99:99"]) expect(() => parseWhen(bad, now)).toThrow(/not a time/);
    expect(() => parseWhen("30s", now)).toThrow(/not a time/);
    expect(() => parseWhen("0m", now)).toThrow(/at least a minute/);
    expect(() => parseWhen("2026-11-20T09:00", now)).toThrow(/at least a minute/);
    expect(() => parseWhen("400d", now)).toThrow(/a year/);
  });
});

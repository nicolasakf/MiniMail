import { describe, expect, it } from "vitest";

import { WITHHELD_REASON } from "@shared/cli";
import type { MessageDetail, MessageSummary } from "@shared/types";
import { matchesSearch, parseSearch } from "@shared/search-query";
import { VERIFICATION_CATEGORY_ID } from "@shared/verification-code";

import {
  detailCarriesCode,
  headersForCli,
  htmlToCliText,
  maskLinks,
  messageForCli,
  rowCarriesCode,
  rowForCli,
  searchable,
} from "./redact";

function row(overrides: Partial<MessageSummary> = {}): MessageSummary {
  return {
    id: "a|inbox|1",
    accountId: "a",
    folder: "inbox",
    threadId: "t1",
    from: { name: "Anna", email: "anna@example.com" },
    to: [{ name: "Me", email: "me@example.com" }],
    subject: "Lunch on Friday?",
    snippet: "Are you free around noon?",
    date: "2026-11-20T10:00:00.000Z",
    unread: true,
    pinned: false,
    answered: false,
    hasAttachments: false,
    signal: "person",
    categoryId: null,
    ...overrides,
  };
}

function detail(overrides: Partial<MessageDetail> = {}): MessageDetail {
  return {
    ...row(),
    cc: [],
    replyTo: null,
    messageId: null,
    references: [],
    html: null,
    text: "Hi, are you free around noon?",
    attachments: [],
    ...overrides,
  };
}

const shaping = (hideLinks: boolean) => ({ hideLinks, categoryName: (id: string) => (id === "news" ? "Newsletters" : undefined) });

describe("maskLinks", () => {
  it("keeps only the host of each link, so a token in the path or query never shows", () => {
    expect(maskLinks("Reset: https://accounts.example.com/reset?token=SECRET123&u=1 now")).toBe("Reset: [link accounts.example.com] now");
  });

  it("masks addresses that start with www and keeps the punctuation that ended the sentence", () => {
    expect(maskLinks("See www.example.com/a?b=c.")).toBe("See [link www.example.com].");
    expect(maskLinks("(https://example.com/x/y)")).toBe("([link example.com])");
  });

  it("masks a link whose path has parentheses all the way to its end", () => {
    expect(maskLinks("https://example.com/a(b)c?token=SECRET end")).toBe("[link example.com] end");
  });

  it("masks every link, also several on one line", () => {
    expect(maskLinks("http://a.test/1 https://b.test/2?x=1")).toBe("[link a.test] [link b.test]");
  });

  it("leaves text without links alone", () => {
    expect(maskLinks("No links here, only words.")).toBe("No links here, only words.");
  });
});

describe("htmlToCliText", () => {
  it("keeps where a link goes, which plain HTML to text would drop", () => {
    const html = '<p>Hello</p><p><a href="https://example.com/reset?t=SECRET&amp;u=1">Reset your password</a></p>';
    expect(htmlToCliText(html)).toBe("Hello\nReset your password (https://example.com/reset?t=SECRET&u=1)");
  });

  it("drops links that are not web addresses and keeps their text", () => {
    expect(htmlToCliText('<a href="mailto:a@b.test">Write to us</a> <a href="javascript:x()">Click</a>')).toBe("Write to us Click");
  });

  it("shows a bare address once when the link text is the address", () => {
    expect(htmlToCliText('<a href="https://example.com/x">https://example.com/x</a>')).toBe("https://example.com/x");
  });
});

describe("sign-in code mail", () => {
  it("is recognised by the Verification codes category", () => {
    expect(rowCarriesCode(row({ categoryId: VERIFICATION_CATEGORY_ID, subject: "Welcome" }))).toBe(true);
  });

  it("is recognised by a code in the subject, the sender's name or the start of the body", () => {
    expect(rowCarriesCode(row({ subject: "123456 is your verification code" }))).toBe(true);
    expect(rowCarriesCode(row({ snippet: "Your code is 482913. It expires in 10 minutes." }))).toBe(true);
    expect(rowCarriesCode(row({ from: { name: "Your verification code is 482913", email: "x@y.test" } }))).toBe(true);
  });

  it("does not catch ordinary mail", () => {
    expect(rowCarriesCode(row())).toBe(false);
    expect(rowCarriesCode(row({ subject: "Invoice 20251234 for November", snippet: "Total: 120 USD" }))).toBe(false);
  });

  it("is found in the body of an opened message even when the row looked harmless, at any age", () => {
    const old = detail({ date: "2020-01-01T00:00:00.000Z", subject: "Security", text: "Use this verification code to sign in:\n\n482913\n\nIt expires soon." });
    expect(rowCarriesCode(old)).toBe(false);
    expect(detailCarriesCode(old)).toBe(true);
    expect(detailCarriesCode(detail())).toBe(false);
  });

  it("is withheld in a list, keeping who and when but not what", () => {
    const shown = rowForCli(row({ subject: "123456 is your code", snippet: "Enter 123456", folder: "inbox" }), shaping(true));
    expect(shown).toEqual({
      id: "a|inbox|1",
      withheld: "sign-in-code",
      reason: WITHHELD_REASON,
      from: { name: "Anna", email: "anna@example.com" },
      date: "2026-11-20T10:00:00.000Z",
      folder: "inbox",
    });
    expect(JSON.stringify(shown)).not.toContain("123456");
  });

  it("cannot be found by its words in a search, one digit at a time", () => {
    const code = row({ subject: "Your verification code is 482913", snippet: "Enter 482913 to sign in" });
    for (const text of ["482913", "4", "verification", "subject:482913"]) {
      expect(matchesSearch(searchable(code), parseSearch(text))).toBe(false);
    }
    // Who and when still work, so "mail from GitHub" finds it without saying what it holds.
    expect(matchesSearch(searchable(code), parseSearch("from:anna"))).toBe(true);
    expect(matchesSearch(searchable(row()), parseSearch("lunch"))).toBe(true);
  });
});

describe("what the CLI returns", () => {
  it("shapes a row without the fields an agent does not need", () => {
    const shown = rowForCli(row({ categoryId: "news", subject: "See https://example.com/a?t=1" }), shaping(true));
    expect(shown).toMatchObject({
      id: "a|inbox|1",
      account: "a",
      category: "Newsletters",
      to: ["me@example.com"],
      subject: "See [link example.com]",
    });
    expect(shown).not.toHaveProperty("signal");
    expect(shown).not.toHaveProperty("unsubscribe");
  });

  it("shows links in full only when the person allowed it", () => {
    const body = { text: "Open https://example.com/reset?token=SECRET" };
    expect(messageForCli(detail(body), shaping(true), false).body).toBe("Open [link example.com]");
    expect(messageForCli(detail(body), shaping(false), false).body).toBe("Open https://example.com/reset?token=SECRET");
  });

  it("builds the body from the HTML when there is no text part, with the links hidden by default", () => {
    const html = '<p>Confirm <a href="https://example.com/confirm?t=SECRET">your address</a></p>';
    expect(messageForCli(detail({ text: null, html }), shaping(true), false).body).toBe("Confirm your address ([link example.com])");
  });

  it("cuts a long body unless asked for all of it, and says so", () => {
    const long = "word ".repeat(2000);
    const short = messageForCli(detail({ text: long }), shaping(true), false);
    expect(short.truncated).toBe(true);
    expect(short.body.length).toBe(4000);
    expect(short.bodyChars).toBeGreaterThan(4000);
    const all = messageForCli(detail({ text: long }), shaping(true), true);
    expect(all.truncated).toBe(false);
    expect(all.body.length).toBe(all.bodyChars);
  });

  it("names attachments but never carries them", () => {
    const shown = messageForCli(
      detail({ attachments: [{ id: "1", filename: "plan.pdf", contentType: "application/pdf", size: 1200 }] }),
      shaping(true),
      false,
    );
    expect(shown.files).toEqual([{ filename: "plan.pdf", contentType: "application/pdf", size: 1200 }]);
  });
});

describe("headersForCli", () => {
  it("says where a message came from, with no text, no links and no file contents", () => {
    const headers = headersForCli(
      detail({
        replyTo: { name: "Support", email: "support@other.test" },
        cc: [{ name: "Cy", email: "cy@example.com" }],
        messageId: "<m1@example.com>",
        references: ["<m0@example.com>"],
        authenticated: false,
        unsubscribe: { url: "https://lists.example.com/u?token=SECRET", oneClick: true },
        text: "A secret body with https://example.com/reset?t=SECRET",
        subject: "See https://example.com/a?t=SECRET",
        attachments: [{ id: "1", filename: "plan.pdf", contentType: "application/pdf", size: 10 }],
      }),
      shaping(true),
    );
    expect(headers).toEqual({
      id: "a|inbox|1",
      account: "a",
      folder: "inbox",
      date: "2026-11-20T10:00:00.000Z",
      subject: "See [link example.com]",
      from: { name: "Anna", email: "anna@example.com" },
      replyTo: { name: "Support", email: "support@other.test" },
      to: ["me@example.com"],
      cc: ["cy@example.com"],
      messageId: "<m1@example.com>",
      references: ["<m0@example.com>"],
      authenticated: false,
      unsubscribeHost: "lists.example.com",
    });
    expect(JSON.stringify(headers)).not.toContain("SECRET");
    expect(JSON.stringify(headers)).not.toContain("plan.pdf");
  });

  it("says nothing was reported rather than guessing when the server did not say whether the sender was verified", () => {
    const headers = headersForCli(detail({ authenticated: undefined }), shaping(true));
    expect(headers.authenticated).toBeNull();
    expect(headers.replyTo).toBeNull();
    expect(headers.unsubscribeHost).toBeNull();
  });
});

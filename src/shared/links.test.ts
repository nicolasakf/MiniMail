import { describe, expect, it } from "vitest";

import { findLinks, meetingLinkIn, normalizeLink, notesFromHtml } from "./links";

describe("findLinks", () => {
  const html = (...anchors: string[]) => `<p>${anchors.join("<br>")}</p>`;

  it("lists online files and calls, with the link's own words or the service's name", () => {
    const links = findLinks(
      html(
        '<a href="https://drive.google.com/file/d/abc/view?usp=sharing">Contract.pdf</a>',
        '<a href="https://us02web.zoom.us/j/123456?pwd=x">Join</a>',
        '<a href="https://company-my.sharepoint.com/:w:/p/ann/xyz">https://company-my.sharepoint.com/:w:/p/ann/xyz</a>',
      ),
      null,
    );
    expect(links.map((link) => [link.kind, link.label, link.host])).toEqual([
      ["file", "Contract.pdf", "drive.google.com"],
      ["meeting", "Zoom meeting", "us02web.zoom.us"],
      ["file", "SharePoint file", "company-my.sharepoint.com"],
    ]);
  });

  it("skips home pages, other sites and values that are not addresses", () => {
    expect(
      findLinks(
        html(
          '<a href="https://drive.google.com/">Google Drive</a>',
          '<a href="https://www.dropbox.com/login">Sign in</a>',
          '<a href="https://example.com/file/d/abc">Not a service</a>',
          '<a href="https://evil.com/?u=https://drive.google.com/file/d/abc">Tricky</a>',
          '<a href="#">Top</a>',
          '<a href="mailto:ann@x.com">Mail</a>',
        ),
        null,
      ),
    ).toEqual([]);
  });

  it("lists a link once, keeping the first wording that says something and dropping the #fragment", () => {
    const links = findLinks(
      html(
        '<a href="https://www.dropbox.com/s/abc/plan.pdf?dl=0#top"><img src="x.png"></a>',
        '<a href="https://www.dropbox.com/s/abc/plan.pdf?dl=0">Q4 plan</a>',
        '<a href="https://www.dropbox.com/s/abc/plan.pdf?dl=0">Open</a>',
      ),
      null,
    );
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ label: "Q4 plan", url: "https://www.dropbox.com/s/abc/plan.pdf?dl=0" });
  });

  it("decodes the address in the HTML and reads plain-text mail", () => {
    expect(findLinks('<a href="https://meet.google.com/abc-defg-hij?authuser=0&amp;hs=1">x</a>', null)[0]!.url).toBe(
      "https://meet.google.com/abc-defg-hij?authuser=0&hs=1",
    );
    expect(findLinks(null, "Call: https://meet.google.com/abc-defg-hij.\nFile (https://we.tl/t-123).").map((link) => link.url)).toEqual([
      "https://meet.google.com/abc-defg-hij",
      "https://we.tl/t-123",
    ]);
  });
});


describe("meetingLinkIn", () => {
  it("finds the first video call address in a text, and ignores files", () => {
    expect(meetingLinkIn("Docs https://drive.google.com/file/d/abc/view then https://meet.google.com/abc-defg-hij")).toBe("https://meet.google.com/abc-defg-hij");
    expect(meetingLinkIn("nothing here")).toBeNull();
    expect(meetingLinkIn(null)).toBeNull();
  });
});

describe("normalizeLink", () => {
  it("accepts web addresses without their #fragment, and nothing else", () => {
    expect(normalizeLink(" https://zoom.us/j/1#x ")).toBe("https://zoom.us/j/1");
    expect(normalizeLink("javascript:alert(1)")).toBeNull();
    expect(normalizeLink("not an address")).toBeNull();
  });
});

describe("notesFromHtml", () => {
  it("reads HTML as lines and keeps the address of each link beside its words", () => {
    expect(
      notesFromHtml('<p>Agenda below</p><p><a href="https://teams.microsoft.com/l/meetup-join/x">Join the meeting now</a></p>'),
    ).toBe("Agenda below\nJoin the meeting now https://teams.microsoft.com/l/meetup-join/x");
    expect(notesFromHtml('<a href="https://zoom.us/j/1">https://zoom.us/j/1</a>')).toBe("https://zoom.us/j/1");
  });
});

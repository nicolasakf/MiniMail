import { describe, expect, it } from "vitest";

import { decodeBinary, decodeText, embedImages, planBody, usesCidImages } from "./imap-parts";

type Node = Parameters<typeof planBody>[0];

describe("planBody", () => {
  it("reads a message with one part as a whole", () => {
    const plan = planBody({ type: "text/plain", encoding: "7bit", size: 10, parameters: { charset: "utf-8" } });
    expect(plan.text).toEqual([{ key: "text", encoding: "7bit", charset: "utf-8", size: 10 }]);
    expect(plan.html).toEqual([]);
    expect(plan.attachments).toEqual([]);
  });

  it("takes both versions of an alternative, and lists the file next to them by name only", () => {
    const plan = planBody({
      type: "multipart/mixed",
      childNodes: [
        {
          part: "1",
          type: "multipart/alternative",
          childNodes: [
            { part: "1.1", type: "text/plain", encoding: "quoted-printable", size: 40 },
            { part: "1.2", type: "text/html", encoding: "quoted-printable", size: 90 },
          ],
        },
        {
          part: "2",
          type: "application/pdf",
          encoding: "base64",
          size: 4000,
          disposition: "attachment",
          dispositionParameters: { filename: "report.pdf" },
        },
      ],
    });
    expect(plan.text.map((part) => part.key)).toEqual(["1.1"]);
    expect(plan.html.map((part) => part.key)).toEqual(["1.2"]);
    // 4000 encoded bytes of base64 are 3000 bytes of file.
    expect(plan.attachments).toEqual([{ id: "2", filename: "report.pdf", contentType: "application/pdf", size: 3000 }]);
  });

  it("keeps images that belong to the text out of the files, as embedded images", () => {
    const plan = planBody({
      type: "multipart/related",
      childNodes: [
        { part: "1", type: "text/html", encoding: "7bit", size: 50 },
        { part: "2", type: "image/png", encoding: "base64", size: 400, id: "<logo@example.com>", disposition: "inline" },
      ],
    });
    expect(plan.attachments).toEqual([]);
    expect(plan.inline).toEqual([
      { id: "2", contentType: "image/png", size: 300, cid: "logo@example.com", encoding: "base64" },
    ]);
  });

  it("lists an image that is not part of the text as a file", () => {
    const plan = planBody({
      type: "multipart/mixed",
      childNodes: [
        { part: "1", type: "text/plain", size: 5 },
        { part: "2", type: "image/jpeg", encoding: "base64", size: 800, id: "<x@y>", disposition: "attachment", dispositionParameters: { filename: "photo.jpg" } },
      ],
    });
    expect(plan.attachments.map((file) => file.filename)).toEqual(["photo.jpg"]);
    expect(plan.inline).toEqual([]);
  });

  it("finds the invitation, which is neither text nor a file", () => {
    const plan = planBody({
      type: "multipart/alternative",
      childNodes: [
        { part: "1", type: "text/plain", size: 5 },
        { part: "2", type: "text/calendar", encoding: "7bit", size: 300, parameters: { method: "REQUEST", charset: "utf-8" } },
        { part: "3", type: "application/ics", encoding: "base64", size: 400, disposition: "attachment", dispositionParameters: { filename: "invite.ics" } },
      ],
    });
    expect(plan.calendar?.key).toBe("2");
    expect(plan.attachments.map((file) => file.filename)).toEqual(["invite.ics"]);
  });

  it("lists an embedded message as a file and does not look inside", () => {
    const plan = planBody({
      type: "multipart/mixed",
      childNodes: [
        { part: "1", type: "text/plain", size: 5 },
        {
          part: "2",
          type: "message/rfc822",
          size: 900,
          envelope: { subject: "Forwarded" },
          childNodes: [{ part: "2", type: "text/plain", size: 100 }],
        },
      ],
    });
    expect(plan.text.map((part) => part.key)).toEqual(["1"]);
    expect(plan.attachments).toEqual([{ id: "2", filename: "Forwarded.eml", contentType: "message/rfc822", size: 900 }]);
  });

  it("does not treat a text part marked as an attachment as the message", () => {
    const plan = planBody({
      type: "multipart/mixed",
      childNodes: [
        { part: "1", type: "text/plain", size: 5 },
        { part: "2", type: "text/plain", size: 700, disposition: "attachment", dispositionParameters: { filename: "notes.txt" } },
      ],
    });
    expect(plan.text.map((part) => part.key)).toEqual(["1"]);
    expect(plan.attachments.map((file) => file.filename)).toEqual(["notes.txt"]);
  });

  it("copes with a message whose structure is missing", () => {
    expect(planBody(undefined)).toEqual({ html: [], text: [], calendar: null, inline: [], attachments: [] });
    expect(planBody({} as Node).attachments).toEqual([]);
  });
});

describe("decoding", () => {
  it("undoes quoted-printable, including soft line breaks", () => {
    expect(decodeText(Buffer.from("Caf=C3=A9 au=\r\n lait"), "quoted-printable", "utf-8")).toBe("Café au lait");
  });

  it("undoes base64", () => {
    expect(decodeText(Buffer.from(Buffer.from("Olá, mundo").toString("base64")), "base64", "utf-8")).toBe("Olá, mundo");
  });

  it("reads the charset the sender named", () => {
    expect(decodeText(Buffer.from([0x63, 0x61, 0x66, 0xe9]), "8bit", "iso-8859-1")).toBe("café");
    expect(decodeText(Buffer.from("=E9", "latin1"), "quoted-printable", "windows-1252")).toBe("é");
  });

  it("falls back to UTF-8 for a charset it does not know", () => {
    expect(decodeText(Buffer.from("plain"), "7bit", "x-made-up")).toBe("plain");
  });

  it("hands back the bytes of an image untouched except for its transfer encoding", () => {
    const bytes = Buffer.from([1, 2, 3, 250]);
    expect(decodeBinary(Buffer.from(bytes.toString("base64")), "base64")).toEqual(bytes);
    expect(decodeBinary(bytes, "binary")).toEqual(bytes);
  });
});

describe("embedded images", () => {
  it("notices when the text uses them", () => {
    expect(usesCidImages('<img src="cid:logo">')).toBe(true);
    expect(usesCidImages('<img src="https://x.test/a.png">')).toBe(false);
    expect(usesCidImages(null)).toBe(false);
  });

  it("puts the image in the text", () => {
    const html = embedImages('<img src="cid:logo@x"><img src="cid:other">', [
      { cid: "logo@x", contentType: "image/png", data: Buffer.from("PNG") },
    ]);
    expect(html).toBe(`<img src="data:image/png;base64,${Buffer.from("PNG").toString("base64")}"><img src="cid:other">`);
  });
});

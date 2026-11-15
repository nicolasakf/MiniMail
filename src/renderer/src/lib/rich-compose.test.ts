import { describe, expect, it } from "vitest";

import { base64Bytes, imageData, plainEditorHtml, webUrl } from "./rich-compose";

describe("plainEditorHtml", () => {
  it("makes an empty body one empty paragraph, so the editor counts it as empty", () => {
    expect(plainEditorHtml("")).toBe("<p></p>");
  });

  it("makes one paragraph per line and keeps blank lines as empty paragraphs", () => {
    expect(plainEditorHtml("Hi\r\n\nBye")).toBe("<p>Hi</p><p></p><p>Bye</p>");
  });

  it("escapes markup so typed text cannot become HTML", () => {
    expect(plainEditorHtml('<b>&"x"</b>')).toBe("<p>&lt;b&gt;&amp;\"x\"&lt;/b&gt;</p>");
  });
});

describe("webUrl", () => {
  it("adds https to a bare address and refuses what is not a web link", () => {
    expect(webUrl("example.com/a")).toBe("https://example.com/a");
    expect(webUrl("javascript:alert(1)")).toBeNull();
    expect(webUrl("two words.com")).toBeNull();
    expect(webUrl("https://user:pw@example.com")).toBeNull();
  });

  it("takes mailto only where mail links are allowed", () => {
    expect(webUrl("mailto:a@x.com")).toBe("mailto:a@x.com");
    expect(webUrl("mailto:a@x.com", false)).toBeNull();
  });
});

describe("inline images", () => {
  it("sizes base64 content, padding included", () => {
    expect(base64Bytes("QQ==")).toBe(1);
    expect(base64Bytes("QUI=")).toBe(2);
    expect(base64Bytes("QUJD")).toBe(3);
  });

  it("accepts a small base64 image and refuses other sources", () => {
    expect(imageData("data:image/png;base64,QQ==")).toEqual({ contentType: "image/png", contentBase64: "QQ==" });
    expect(imageData("https://example.com/a.png")).toBeNull();
    expect(imageData("data:image/svg+xml;base64,QQ==")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import { MAX_ATTACHMENT_BYTES, MAX_DRAFT_ATTACHMENTS, type DraftAttachment } from "@shared/types";

import {
  attachmentProblem,
  fieldsChanged,
  formatBytes,
  hasContent,
  resolveRecipients,
  sendProblem,
  toSavedDraft,
  uniqueContacts,
  type ComposerFields,
} from "./composer-state";

const blank = (): ComposerFields => ({
  accountId: "a1",
  to: [],
  cc: [],
  bcc: [],
  toText: "",
  ccText: "",
  bccText: "",
  subject: "",
  quoted: "",
  sendAt: undefined,
  bodyHtml: undefined,
  attachments: [],
});
const sam = { name: "Sam", email: "sam@x.com" };
const file = (filename = "a.txt", contentBase64 = "QQ=="): DraftAttachment => ({ filename, contentType: "text/plain", contentBase64 });

describe("fieldsChanged", () => {
  it("is false for an untouched form, even through a copy", () => {
    const before = { ...blank(), to: [sam], attachments: [file()] };
    expect(fieldsChanged(before, { ...before, to: [{ ...sam }], attachments: [...before.attachments] })).toBe(false);
  });

  it.each<[string, Partial<ComposerFields>]>([
    ["account", { accountId: "a2" }],
    ["to chip", { to: [sam] }],
    ["cc chip", { cc: [sam] }],
    ["bcc chip", { bcc: [sam] }],
    ["typed to", { toText: "sa" }],
    ["typed cc", { ccText: "sa" }],
    ["typed bcc", { bccText: "sa" }],
    ["subject", { subject: "Hi" }],
    ["quoted text", { quoted: "> hi" }],
    ["send time", { sendAt: 5 }],
    ["body", { bodyHtml: "<p>hi</p>" }],
    ["attachment", { attachments: [file()] }],
  ])("sees a changed %s", (_name, change) => {
    expect(fieldsChanged(blank(), { ...blank(), ...change })).toBe(true);
  });

  it("sees a renamed recipient and a swapped attachment", () => {
    const before = { ...blank(), to: [sam], attachments: [file()] };
    expect(fieldsChanged(before, { ...before, to: [{ ...sam, name: "Samantha" }] })).toBe(true);
    expect(fieldsChanged(before, { ...before, attachments: [file()] })).toBe(true);
  });
});

describe("hasContent", () => {
  it("is false for a form with nothing in it, whitespace included", () => {
    expect(hasContent(blank(), "")).toBe(false);
    expect(hasContent({ ...blank(), subject: "  ", toText: " " }, " \n")).toBe(false);
  });

  it.each<[string, Partial<ComposerFields>, string]>([
    ["a chip", { to: [sam] }, ""],
    ["typed text", { ccText: "sa" }, ""],
    ["a subject", { subject: "Hi" }, ""],
    ["a body", {}, "Hello"],
    ["an attachment", { attachments: [file()] }, ""],
    ["a send time", { sendAt: 1 }, ""],
    ["a picture and nothing else", { bodyHtml: '<p><img src="data:image/png;base64,AA=="></p>' }, ""],
    ["a table and nothing else", { bodyHtml: "<table><tr><td></td></tr></table>" }, ""],
  ])("is true with %s", (_name, change, text) => {
    expect(hasContent({ ...blank(), ...change }, text)).toBe(true);
  });
});

describe("recipients", () => {
  it("adds complete addresses typed into a box and keeps each address once", () => {
    const resolved = resolveRecipients({ ...blank(), to: [sam], toText: "SAM@x.com, Kim <kim@x.com>", ccText: "kim@x.com" });
    expect(resolved.to.map((c) => c.email)).toEqual(["sam@x.com", "kim@x.com"]);
    expect(resolved.cc.map((c) => c.email)).toEqual(["kim@x.com"]);
    expect(resolved.invalid).toEqual([]);
  });

  it("reports text that is not an address", () => {
    expect(resolveRecipients({ ...blank(), toText: "sam@x.com, nobody", bccText: "also bad" }).invalid).toEqual(["nobody", "also bad"]);
  });

  it("de-duplicates by lowercase address, first one wins", () => {
    expect(uniqueContacts([{ name: "A", email: "a@x.com" }, { name: "", email: "A@X.com" }])).toEqual([{ name: "A", email: "a@x.com" }]);
  });
});

describe("sendProblem", () => {
  const ready = { ...blank(), to: [sam] };
  const resolve = (fields: ComposerFields) => resolveRecipients(fields);

  it("lets a complete message go", () => {
    expect(sendProblem(ready, resolve(ready))).toBeNull();
    expect(sendProblem({ ...ready, sendAt: 2000 }, resolve(ready), 1000)).toBeNull();
  });

  it("names the first thing in the way", () => {
    expect(sendProblem({ ...ready, sendAt: 500 }, resolve(ready), 1000)).toMatch(/future/);
    expect(sendProblem({ ...ready, accountId: "" }, resolve(ready))).toMatch(/account/);
    const bad = { ...ready, toText: "nope" };
    expect(sendProblem(bad, resolve(bad))).toMatch(/Not a valid address: nope/);
    expect(sendProblem(blank(), resolve(blank()))).toMatch(/at least one recipient/);
  });

  it("counts an address typed but not yet chipped as a recipient", () => {
    const typed = { ...blank(), toText: "sam@x.com" };
    expect(sendProblem(typed, resolve(typed))).toBeNull();
  });
});

describe("attachments", () => {
  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("accepts a normal set and refuses too many or too large", () => {
    expect(attachmentProblem([file(), file("b.txt")])).toBeNull();
    expect(attachmentProblem(Array.from({ length: MAX_DRAFT_ATTACHMENTS + 1 }, () => file()))).toMatch(/at most/);
    // Base64 of N bytes is about 4N/3 characters.
    const big = file("big.bin", "A".repeat(Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 8));
    expect(attachmentProblem([big])).toMatch(/total at most 20\.0 MB/);
  });
});

describe("toSavedDraft", () => {
  it("copies the form into a record and leaves empty extras out", () => {
    const fields = { ...blank(), to: [sam], toText: "ki", subject: "Hi", bodyHtml: "<p>Hello</p>", sendAt: 9 };
    const draft = toSavedDraft(fields, { id: "d1", mode: "reply", bodyText: "Hello", inReplyTo: undefined, savedAt: "2026-11-14T10:00:00.000Z" });
    expect(draft).toMatchObject({
      id: "d1",
      savedAt: "2026-11-14T10:00:00.000Z",
      mode: "reply",
      accountId: "a1",
      to: [sam],
      pendingText: { to: "ki", cc: "", bcc: "" },
      subject: "Hi",
      body: "Hello",
      bodyHtml: "<p>Hello</p>",
      sendAt: 9,
    });
    expect(draft.attachments).toBeUndefined();
    expect(draft.quoted).toBeUndefined();
  });

  it("keeps attachments and the quoted original when there are some", () => {
    const draft = toSavedDraft({ ...blank(), attachments: [file()], quoted: "> hi" }, { id: "d", mode: "new", bodyText: "", inReplyTo: undefined });
    expect(draft.attachments).toHaveLength(1);
    expect(draft.quoted).toBe("> hi");
  });
});

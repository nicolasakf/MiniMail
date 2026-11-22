import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { contentTypeOf, readAttachments } from "./draft-files";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mm-attach-"));
});

describe("readAttachments", () => {
  it("reads each file named, one path per line, with its name and type", () => {
    writeFileSync(join(dir, "plan.pdf"), "pdf bytes");
    writeFileSync(join(dir, "notes"), "plain");
    const files = readAttachments(`${join(dir, "plan.pdf")}\n${join(dir, "notes")}`);
    expect(files.map((file) => [file.filename, file.contentType])).toEqual([
      ["plan.pdf", "application/pdf"],
      ["notes", "application/octet-stream"],
    ]);
    expect(Buffer.from(files[0]!.contentBase64, "base64").toString()).toBe("pdf bytes");
  });

  it("attaches nothing when no path was given", () => {
    expect(readAttachments(undefined)).toEqual([]);
    expect(readAttachments("")).toEqual([]);
  });

  it("refuses a file that is not there, and a folder, naming it", () => {
    expect(() => readAttachments(join(dir, "missing.pdf"))).toThrow(/Cannot read .*missing\.pdf/);
    mkdirSync(join(dir, "folder"));
    expect(() => readAttachments(join(dir, "folder"))).toThrow(/is not a file/);
  });

  it("attaches none of them when one cannot be read", () => {
    writeFileSync(join(dir, "ok.txt"), "x");
    expect(() => readAttachments(`${join(dir, "ok.txt")}\n${join(dir, "gone.txt")}`)).toThrow(/gone\.txt/);
  });

  it("holds to the size and count a message can carry, counting what is already on the draft", () => {
    writeFileSync(join(dir, "big.bin"), Buffer.alloc(1024));
    expect(() => readAttachments(join(dir, "big.bin"), 0, 20 * 1024 * 1024)).toThrow(/20 MB/);
    expect(() => readAttachments(join(dir, "big.bin"), 25)).toThrow(/up to 25 files/);
  });

  it("knows common types by extension, in any case", () => {
    expect(contentTypeOf("A.PNG")).toBe("image/png");
    expect(contentTypeOf("report.xlsx")).toContain("spreadsheetml");
    expect(contentTypeOf("noextension")).toBe("application/octet-stream");
  });
});

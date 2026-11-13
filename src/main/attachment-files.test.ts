import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AttachmentFiles, canOpenDirectly, safeFileName } from "./attachment-files";

describe("safeFileName", () => {
  it("keeps a plain name", () => expect(safeFileName("Report 2026.pdf")).toBe("Report 2026.pdf"));
  it("drops any folder part", () => {
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("C:\\Users\\me\\a.txt")).toBe("a.txt");
  });
  it("removes control characters and leading dots", () => {
    expect(safeFileName(".hidden\u0000name.txt")).toBe("hidden_name.txt");
  });
  it("falls back when nothing is left", () => {
    expect(safeFileName("")).toBe("attachment");
    expect(safeFileName("...")).toBe("attachment");
  });
  it("shortens a long name but keeps its extension", () => {
    const name = safeFileName(`${"a".repeat(300)}.pdf`);
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name.endsWith(".pdf")).toBe(true);
  });
});

describe("canOpenDirectly", () => {
  it("allows documents and pictures", () => {
    expect(canOpenDirectly("a.PDF")).toBe(true);
    expect(canOpenDirectly("photo.jpeg")).toBe(true);
  });
  it("refuses anything that could run", () => {
    for (const name of ["a.app", "a.command", "a.sh", "a.exe", "a.dmg", "a.zip", "a.html", "a.js", "a", "a.webloc"]) {
      expect(canOpenDirectly(name)).toBe(false);
    }
  });
});

describe("AttachmentFiles", () => {
  const roots: string[] = [];
  const setup = () => {
    const tempRoot = join(mkdtempSync(join(tmpdir(), "minimail-test-")), "opened");
    roots.push(tempRoot);
    const deps = {
      tempRoot,
      openPath: vi.fn(async (_path: string) => ""),
      showInFolder: vi.fn(),
      chooseSavePath: vi.fn(async (): Promise<string | null> => null),
      quarantine: vi.fn(async (_path: string) => undefined),
    };
    return { files: new AttachmentFiles(deps), deps, tempRoot };
  };
  const file = (filename: string) => ({ filename, contentType: "x/y", data: Buffer.from("hello") });

  afterEach(async () => {
    for (const root of roots.splice(0)) await new AttachmentFiles({ tempRoot: root } as never).cleanup();
  });

  it("opens a document with the system app, after marking it as downloaded", async () => {
    const { files, deps } = setup();
    await files.open(file("a.pdf"));
    const opened = deps.openPath.mock.calls[0]![0] as string;
    expect(readFileSync(opened, "utf8")).toBe("hello");
    expect(deps.quarantine).toHaveBeenCalledWith(opened);
    expect(deps.showInFolder).not.toHaveBeenCalled();
  });

  it("only shows a risky file in its folder", async () => {
    const { files, deps } = setup();
    await files.open(file("tool.command"));
    expect(deps.openPath).not.toHaveBeenCalled();
    expect(deps.showInFolder).toHaveBeenCalledTimes(1);
  });

  it("reports when the system cannot open the file", async () => {
    const { files, deps } = setup();
    deps.openPath.mockResolvedValueOnce("no app");
    await expect(files.open(file("a.pdf"))).rejects.toThrow('Could not open "a.pdf": no app');
  });

  it("saves where the user chooses, and does nothing on cancel", async () => {
    const { files, deps, tempRoot } = setup();
    expect(await files.save(file("a.pdf"))).toBe(false);
    const target = join(mkdtempSync(join(tmpdir(), "minimail-save-")), "out.pdf");
    deps.chooseSavePath.mockResolvedValueOnce(target);
    expect(await files.save(file("a.pdf"))).toBe(true);
    expect(readFileSync(target, "utf8")).toBe("hello");
    expect(existsSync(tempRoot)).toBe(false);
  });

  it("removes what it left behind", async () => {
    const { files, tempRoot } = setup();
    await files.open(file("a.pdf"));
    expect(existsSync(tempRoot)).toBe(true);
    await files.cleanup();
    expect(existsSync(tempRoot)).toBe(false);
  });
});

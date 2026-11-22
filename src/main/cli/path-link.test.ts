import { lstatSync, mkdirSync, mkdtempSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { installPathLink, onPath, pathLinkPath, pathLinkStatus, removePathLink } from "./path-link";

let home: string;
let launcher: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "mm-home-"));
  const data = mkdtempSync(join(tmpdir(), "mm-data-"));
  mkdirSync(join(data, "cli"));
  launcher = join(data, "cli", "minimail");
  writeFileSync(launcher, "#!/bin/sh\n");
});

describe("the minimail link on the PATH", () => {
  it("is made in ~/.local/bin, creating the folder, and points at the launcher", () => {
    expect(pathLinkStatus(home, launcher)).toBe("none");
    expect(installPathLink(home, launcher)).toBe("installed");
    expect(pathLinkPath(home)).toBe(join(home, ".local", "bin", "minimail"));
    expect(readlinkSync(pathLinkPath(home))).toBe(launcher);
    expect(pathLinkStatus(home, launcher)).toBe("ours");
  });

  it("is left alone when it is already right", () => {
    installPathLink(home, launcher);
    expect(installPathLink(home, launcher)).toBe("unchanged");
  });

  it("is pointed at the new launcher when the app moved, and only then", () => {
    installPathLink(home, launcher);
    const moved = mkdtempSync(join(tmpdir(), "mm-moved-"));
    mkdirSync(join(moved, "cli"));
    const next = join(moved, "cli", "minimail");
    writeFileSync(next, "#!/bin/sh\n");
    expect(pathLinkStatus(home, next)).toBe("stale");
    expect(installPathLink(home, next)).toBe("updated");
    expect(readlinkSync(pathLinkPath(home))).toBe(next);
  });

  it("never replaces a file of the same name that is not its own", () => {
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    writeFileSync(pathLinkPath(home), "my own script");
    expect(pathLinkStatus(home, launcher)).toBe("foreign");
    expect(() => installPathLink(home, launcher)).toThrow(/left alone/);
    expect(removePathLink(home, launcher)).toBe("foreign");
    expect(lstatSync(pathLinkPath(home)).isFile()).toBe(true);
  });

  it("never touches a link to something that is not a MiniMail launcher", () => {
    const tool = join(home, "tool");
    writeFileSync(tool, "x");
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    symlinkSync(tool, pathLinkPath(home));
    expect(pathLinkStatus(home, launcher)).toBe("foreign");
    expect(() => installPathLink(home, launcher)).toThrow(/left alone/);
    expect(removePathLink(home, launcher)).toBe("foreign");
    expect(readlinkSync(pathLinkPath(home))).toBe(tool);
  });

  it("is removed when it is MiniMail's, also a stale one", () => {
    installPathLink(home, launcher);
    expect(removePathLink(home, launcher)).toBe("removed");
    expect(pathLinkStatus(home, launcher)).toBe("none");
    expect(removePathLink(home, launcher)).toBe("absent");
    installPathLink(home, launcher);
    expect(removePathLink(home, join(tmpdir(), "elsewhere", "cli", "minimail"))).toBe("removed");
  });

  it("is removed even when the launcher it points at is already gone, as it is when the CLI is turned off", () => {
    installPathLink(home, launcher);
    unlinkSync(launcher);
    expect(pathLinkStatus(home, launcher)).toBe("ours");
    expect(removePathLink(home, launcher)).toBe("removed");
    expect(() => lstatSync(pathLinkPath(home))).toThrow();
  });

  it("can tell whether the folder is on the PATH the app has", () => {
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    expect(onPath(join(home, ".local", "bin"), `/usr/bin:${join(home, ".local", "bin")}`)).toBe(true);
    expect(onPath(join(home, ".local", "bin"), "/usr/bin:/bin")).toBe(false);
    expect(onPath(join(home, ".local", "bin"), undefined)).toBe(false);
  });
});

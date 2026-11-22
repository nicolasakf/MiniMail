import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/**
 * A link at `~/.local/bin/minimail` to the launcher, so the person can type `minimail` in their own terminal
 * (the skill already gives agents the full path). It is made only when the person asks, and only a link of
 * this kind is ever changed or removed: a file of the same name that is anything else is left alone.
 */
export const pathLinkPath = (home: string): string => join(home, ".local", "bin", "minimail");

export type PathLinkStatus =
  /** Nothing is there. */
  | "none"
  /** A link to this launcher. */
  | "ours"
  /** A link to a launcher in another place: this app was moved or reinstalled. */
  | "stale"
  /** Something else is at that path. */
  | "foreign";

export function pathLinkStatus(home: string, launcher: string): PathLinkStatus {
  const path = pathLinkPath(home);
  let info;
  try {
    info = lstatSync(path);
  } catch {
    // expected: nothing at that path is the usual case, and is the answer ("none").
    return "none";
  }
  if (!info.isSymbolicLink()) return "foreign";
  const target = resolve(dirname(path), readlinkSync(path));
  if (target === launcher) return "ours";
  // A launcher MiniMail wrote earlier: a file called minimail in a folder called cli.
  return basename(target) === "minimail" && basename(dirname(target)) === "cli" ? "stale" : "foreign";
}

/** Makes the link, or points it at the current launcher. Throws when something else is in the way. */
export function installPathLink(home: string, launcher: string): "installed" | "updated" | "unchanged" {
  const status = pathLinkStatus(home, launcher);
  if (status === "ours") return "unchanged";
  if (status === "foreign") throw new Error(`${pathLinkPath(home)} already exists and is not a link MiniMail made, so it was left alone`);
  const path = pathLinkPath(home);
  mkdirSync(dirname(path), { recursive: true });
  if (status === "stale") unlinkSync(path);
  symlinkSync(launcher, path);
  return status === "stale" ? "updated" : "installed";
}

/** Removes the link if MiniMail made it (also one to an older launcher). */
export function removePathLink(home: string, launcher: string): "removed" | "absent" | "foreign" {
  const status = pathLinkStatus(home, launcher);
  if (status === "none") return "absent";
  if (status === "foreign") return "foreign";
  // Not `rmSync`: it cannot remove a link whose target is already gone, which is the state when the CLI is turned off.
  unlinkSync(pathLinkPath(home));
  return "removed";
}

/** Whether a folder is on the PATH the app itself was started with (a hint only: a terminal may have a different one). */
export function onPath(folder: string, pathVariable: string | undefined): boolean {
  return (pathVariable ?? "").split(":").some((entry) => entry === folder && existsSync(entry));
}

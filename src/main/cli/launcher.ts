import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import clientSource from "./client.cjs?raw";

/** Where the CLI's files live: one private folder in the app's data folder. */
export interface CliPaths {
  folder: string;
  /** The command to run (a shell script). */
  launcher: string;
  /** The client the launcher runs. */
  client: string;
  /** The socket the running app listens on. */
  socket: string;
}

export function cliPaths(userData: string): CliPaths {
  const folder = join(userData, "cli");
  return { folder, launcher: join(folder, "minimail"), client: join(folder, "minimail.cjs"), socket: join(folder, "cli.sock") };
}

/** Wraps text in single quotes for a POSIX shell. */
export function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** The `.app` folder a packaged macOS build runs from, or null (a dev build runs from the Electron binary in node_modules). */
export function appBundleOf(executable: string, packaged: boolean): string | null {
  if (!packaged) return null;
  return /^(.*\.app)\/Contents\/MacOS\//.exec(executable)?.[1] ?? null;
}

export interface LauncherInfo {
  /** The program that runs the client: the app's own binary, used as Node (no separate Node is needed). */
  executable: string;
  client: string;
  socket: string;
  /** The app to start, hidden, when it is not running. Null: the client only says it is not running. */
  appBundle: string | null;
}

/** The text of the `minimail` command. */
export function launcherScript(info: LauncherInfo): string {
  return [
    "#!/bin/sh",
    "# Written by MiniMail every time it starts. Changes here are overwritten.",
    `export MINIMAIL_SOCKET=${shellQuote(info.socket)}`,
    ...(info.appBundle ? [`export MINIMAIL_APP=${shellQuote(info.appBundle)}`] : []),
    "export ELECTRON_RUN_AS_NODE=1",
    `exec ${shellQuote(info.executable)} ${shellQuote(info.client)} "$@"`,
    "",
  ].join("\n");
}

function writeIfChanged(path: string, content: string, mode: number): void {
  if (!existsSync(path) || readFileSync(path, "utf8") !== content) writeFileSync(path, content, { mode });
  chmodSync(path, mode);
}

/** Writes the launcher and its client, only touching what changed. Throws when the folder cannot be written. */
export function installLauncher(paths: CliPaths, info: Omit<LauncherInfo, "client" | "socket">): void {
  mkdirSync(paths.folder, { recursive: true, mode: 0o700 });
  chmodSync(paths.folder, 0o700);
  writeIfChanged(paths.client, clientSource, 0o600);
  writeIfChanged(paths.launcher, launcherScript({ ...info, client: paths.client, socket: paths.socket }), 0o700);
}

/** Removes the launcher and its client (the socket goes when the server stops). Missing files are fine. */
export function removeLauncher(paths: CliPaths): void {
  for (const path of [paths.launcher, paths.client]) if (existsSync(path)) unlinkSync(path);
}

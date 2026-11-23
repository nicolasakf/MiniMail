import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CLI_COMMANDS } from "@shared/cli";

import type { CliResponse } from "./commands";
import { appBundleOf, cliPaths, installLauncher, launcherScript, removeLauncher, shellQuote } from "./launcher";
import { CliServer } from "./server";

const reportError = vi.fn();
vi.mock("../events", () => ({ reportError: (...args: unknown[]) => reportError(...args), recordAction: vi.fn() }));

const client = createRequire(import.meta.url)("./client.cjs") as {
  parseArgs: (argv: string[]) => { command: string; positional: string[]; flags: Record<string, string | true> };
  absolutePaths: (value: string) => string;
  SWITCHES: Set<string>;
  PROTOCOL: number;
};

interface Ran {
  code: number;
  stdout: string;
  stderr: string;
}

function run(launcher: string, args: string[]): Promise<Ran> {
  return new Promise((resolve) => {
    execFile(launcher, args, { env: { ...process.env, PATH: process.env.PATH ?? "" } }, (error, stdout, stderr) => {
      resolve({ code: error ? ((error as { code?: number }).code ?? 1) : 0, stdout, stderr });
    });
  });
}

function runWithInput(launcher: string, args: string[], input: string): Promise<Ran> {
  return new Promise((resolve) => {
    const child = execFile(launcher, args, { env: { ...process.env, PATH: process.env.PATH ?? "" } }, (error, stdout, stderr) => {
      resolve({ code: error ? ((error as { code?: number }).code ?? 1) : 0, stdout, stderr });
    });
    child.stdin?.end(input);
  });
}

let root: string;
let paths: ReturnType<typeof cliPaths>;
let server: CliServer | null;
let enabled: boolean;
let handler: (request: unknown, signal: AbortSignal) => Promise<CliResponse>;

async function start(): Promise<CliServer> {
  const created = new CliServer({ socketPath: paths.socket, enabled: () => enabled, handle: (request, signal) => handler(request, signal) });
  await created.start();
  server = created;
  return created;
}

beforeEach(() => {
  reportError.mockClear();
  root = mkdtempSync(join(tmpdir(), "mm-cli-"));
  paths = cliPaths(root);
  enabled = true;
  server = null;
  handler = async (request) => ({ ok: true, data: { echo: request } });
  installLauncher(paths, { executable: process.execPath, appBundle: null });
});

afterEach(async () => {
  await server?.stop();
});

describe("the command line", () => {
  it("turns what was typed into one request", () => {
    expect(client.parseArgs(["list", "inbox", "--limit", "5", "--unread"])).toEqual({
      command: "list",
      positional: ["inbox"],
      flags: { limit: "5", unread: true },
    });
    expect(client.parseArgs(["search", "from:anna", "is:unread", "--folder=inbox,sent"])).toEqual({
      command: "search",
      positional: ["from:anna", "is:unread"],
      flags: { folder: "inbox,sent" },
    });
  });

  it("does not take the id after a switch for its value", () => {
    expect(client.parseArgs(["show", "--full", "a|inbox|1"]).positional).toEqual(["a|inbox|1"]);
    expect(client.parseArgs(["list", "--unread", "inbox"])).toMatchObject({ positional: ["inbox"], flags: { unread: true } });
  });

  it("treats everything after -- as words, so a search can start with dashes", () => {
    expect(client.parseArgs(["search", "--", "--odd", "word"])).toEqual({ command: "search", positional: ["--odd", "word"], flags: {} });
  });

  it("reads -h and --help as a request for the docs of the command, wherever they stand", () => {
    expect(client.parseArgs(["list", "-h"])).toEqual({ command: "list", positional: [], flags: { help: true } });
    expect(client.parseArgs(["show", "--help", "a|inbox|1"])).toEqual({ command: "show", positional: ["a|inbox|1"], flags: { help: true } });
    expect(client.parseArgs(["draft", "reply", "--help"])).toEqual({ command: "draft reply", positional: [], flags: { help: true } });
    expect(client.parseArgs(["-h"])).toEqual({ command: "help", positional: [], flags: { help: true } });
    expect(client.parseArgs(["--help", "show"])).toEqual({ command: "show", positional: [], flags: { help: true } });
  });

  it("keeps -h as the value of an option and after --", () => {
    expect(client.parseArgs(["draft", "new", "--subject", "-h"]).flags).toEqual({ subject: "-h" });
    expect(client.parseArgs(["search", "--", "-h"])).toEqual({ command: "search", positional: ["-h"], flags: {} });
  });

  it("asks for help when given nothing", () => {
    expect(client.parseArgs([])).toEqual({ command: "help", positional: [], flags: {} });
  });

  it("reads `draft new` as one command, and keeps what follows as its words and options", () => {
    expect(client.parseArgs(["draft", "reply", "a|inbox|1", "--body", "Thanks"])).toEqual({
      command: "draft reply",
      positional: ["a|inbox|1"],
      flags: { body: "Thanks" },
    });
    expect(client.parseArgs(["draft"])).toEqual({ command: "draft", positional: [], flags: {} });
  });

  it("keeps every value of an option given twice, one per line", () => {
    expect(client.parseArgs(["draft", "new", "--attach", "a.pdf", "--attach", "b.pdf"]).flags).toEqual({ attach: "a.pdf\nb.pdf" });
  });

  it("lets a value be a dash (standard input) or start with a dash", () => {
    expect(client.parseArgs(["draft", "new", "--body", "-"]).flags).toEqual({ body: "-" });
    expect(client.parseArgs(["draft", "new", "--subject", "-1 degree"]).flags).toEqual({ subject: "-1 degree" });
  });

  it("makes file paths absolute, where the command was typed", () => {
    expect(client.absolutePaths("a.pdf\n/abs/b.pdf")).toBe(`${process.cwd()}/a.pdf\n/abs/b.pdf`);
  });

  it("knows the same switches as the catalog", () => {
    const fromCatalog = new Set(CLI_COMMANDS.flatMap((command) => ("switches" in command ? command.switches : [])));
    expect(client.SWITCHES).toEqual(fromCatalog);
  });

  it("speaks the protocol the server expects", async () => {
    const { CLI_PROTOCOL } = await import("@shared/cli");
    expect(client.PROTOCOL).toBe(CLI_PROTOCOL);
  });
});

describe("the launcher", () => {
  it("quotes paths with spaces and quotes", () => {
    expect(shellQuote("/Users/o'neil/Application Support/x")).toBe(`'/Users/o'\\''neil/Application Support/x'`);
    const script = launcherScript({ executable: "/Apps/Mini Mail.app/Contents/MacOS/MiniMail", client: "/d/a b/minimail.cjs", socket: "/d/a b/cli.sock", appBundle: "/Apps/Mini Mail.app" });
    expect(script).toContain("export MINIMAIL_APP='/Apps/Mini Mail.app'");
    expect(script).toContain(`exec '/Apps/Mini Mail.app/Contents/MacOS/MiniMail' '/d/a b/minimail.cjs' "$@"`);
    expect(script.startsWith("#!/bin/sh\n")).toBe(true);
  });

  it("only offers to start the app when it is a packaged macOS build", () => {
    expect(appBundleOf("/Applications/MiniMail.app/Contents/MacOS/MiniMail", true)).toBe("/Applications/MiniMail.app");
    expect(appBundleOf("/Applications/MiniMail.app/Contents/MacOS/MiniMail", false)).toBeNull();
    expect(appBundleOf("/repo/node_modules/electron/dist/Electron", true)).toBeNull();
    expect(launcherScript({ executable: "e", client: "c", socket: "s", appBundle: null })).not.toContain("MINIMAIL_APP");
  });

  it("is private to the person: the folder, the command and the client", () => {
    expect(statSync(paths.folder).mode & 0o777).toBe(0o700);
    expect(statSync(paths.launcher).mode & 0o777).toBe(0o700);
    expect(statSync(paths.client).mode & 0o777).toBe(0o600);
  });

  it("is rewritten when the app moved and removed with the CLI", () => {
    installLauncher(paths, { executable: "/new/place/MiniMail", appBundle: null });
    expect(statSync(paths.launcher).size).toBeGreaterThan(0);
    removeLauncher(paths);
    expect(existsSync(paths.launcher)).toBe(false);
    expect(existsSync(paths.client)).toBe(false);
    expect(() => removeLauncher(paths)).not.toThrow();
  });
});

describe("the socket", () => {
  it("is private to the person and goes away with the server", async () => {
    const running = await start();
    expect(statSync(paths.socket).mode & 0o777).toBe(0o600);
    await running.stop();
    expect(existsSync(paths.socket)).toBe(false);
    expect(running.running).toBe(false);
  });

  it("replaces a socket file left behind by a crash", async () => {
    writeFileSync(paths.socket, "stale");
    await start();
    const answer = await run(paths.launcher, ["status"]);
    expect(answer.code).toBe(0);
  });

  it("carries a request to the app and its answer back, as JSON", async () => {
    await start();
    const answer = await run(paths.launcher, ["list", "inbox", "--limit", "5", "--unread"]);
    expect(answer.code).toBe(0);
    expect(JSON.parse(answer.stdout)).toEqual({
      echo: { protocol: client.PROTOCOL, command: "list", positional: ["inbox"], flags: { limit: "5", unread: true } },
    });
  });

  it("prints text answers as they are", async () => {
    handler = async () => ({ ok: true, data: {}, text: "help text\nsecond line" });
    await start();
    expect((await run(paths.launcher, ["help"])).stdout).toBe("help text\nsecond line\n");
    expect((await run(paths.launcher, ["--help"])).stdout).toBe("help text\nsecond line\n");
  });

  it("reads the text of a draft from standard input when the body is a dash, and sends paths as absolute", async () => {
    await start();
    const answer = await runWithInput(paths.launcher, ["draft", "new", "--body", "-", "--attach", "plan.pdf"], "line one\nline two\n");
    expect(answer.code).toBe(0);
    const echoed = JSON.parse(answer.stdout).echo;
    expect(echoed).toMatchObject({ command: "draft new", positional: [], flags: { body: "line one\nline two\n", attach: `${process.cwd()}/plan.pdf` } });
  });

  it("exits 2 with the message on a mistake of the caller and 1 on anything else", async () => {
    handler = async (request) =>
      (request as { command: string }).command === "list"
        ? { ok: false, error: { code: "usage", message: "Say which folder" } }
        : { ok: false, error: { code: "disabled", message: "turned off" } };
    await start();
    const usage = await run(paths.launcher, ["list"]);
    expect(usage.code).toBe(2);
    expect(usage.stderr).toBe("minimail: Say which folder\n");
    expect(usage.stdout).toBe("");
    expect((await run(paths.launcher, ["accounts"])).code).toBe(1);
  });

  it("refuses at once when the CLI was turned off, even with the socket still open", async () => {
    await start();
    enabled = false;
    const answer = await run(paths.launcher, ["status"]);
    expect(answer.code).toBe(1);
    expect(answer.stderr).toContain("turned off");
  });

  it("says MiniMail is not running when nothing listens, without starting anything it was not asked to", async () => {
    const answer = await run(paths.launcher, ["status"]);
    expect(answer.code).toBe(1);
    expect(answer.stderr).toContain("not running");
  });

  it("records a failure inside MiniMail and tells the caller it was not their mistake", async () => {
    handler = async () => {
      throw new Error("mail server unreachable");
    };
    await start();
    const answer = await run(paths.launcher, ["list", "inbox"]);
    expect(answer.code).toBe(1);
    expect(answer.stderr).toContain("mail server unreachable");
    expect(reportError).toHaveBeenCalledWith("cli", "A CLI command failed", expect.any(Error));
  });

  it("does not understand a line that is not JSON, and says so", async () => {
    await start();
    const { createConnection } = await import("node:net");
    const answer = await new Promise<string>((resolve) => {
      const socket = createConnection(paths.socket);
      let data = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => (data += chunk));
      socket.on("connect", () => socket.write("not json\n"));
      socket.on("close", () => resolve(data));
    });
    expect(JSON.parse(answer)).toMatchObject({ ok: false, error: { code: "usage" } });
  });

  it("cuts a wait short when the caller goes away, and does not call that a failure", async () => {
    let aborted = false;
    let started: () => void = () => undefined;
    const running = new Promise<void>((resolve) => (started = resolve));
    handler = (_request, signal) =>
      new Promise((_resolve, reject) => {
        started();
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        });
      });
    await start();
    const child = execFile(paths.launcher, ["wait", "x"]);
    await running;
    child.kill("SIGTERM");
    await vi.waitFor(() => expect(aborted).toBe(true));
    expect(reportError).not.toHaveBeenCalled();
  });

  it("stops listening and drops open connections when the server stops", async () => {
    let started: () => void = () => undefined;
    const running = new Promise<void>((resolve) => (started = resolve));
    handler = () => new Promise(() => started());
    const created = await start();
    const pending = run(paths.launcher, ["wait", "x"]);
    await running;
    await created.stop();
    const answer = await pending;
    expect(answer.code).toBe(1);
  });
});

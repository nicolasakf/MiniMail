import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_CLI_SETTINGS, type CliSettings } from "@shared/cli";

import { CliController } from "./controller";
import { cliPaths } from "./launcher";
import { CliSettingsStore } from "./settings";
import { pathLinkPath } from "./path-link";
import { skillPath } from "./skill";

const reportError = vi.fn();
const recordAction = vi.fn();
vi.mock("../events", () => ({
  reportError: (...args: unknown[]) => reportError(...args),
  recordAction: (...args: unknown[]) => recordAction(...args),
}));

/** What is at a path, without following a link: "link", "file" or "missing". */
function lstatSafe(path: string): "link" | "file" | "missing" {
  try {
    return lstatSync(path).isSymbolicLink() ? "link" : "file";
  } catch {
    // expected: nothing there is the answer ("missing").
    return "missing";
  }
}

let home: string;
let paths: ReturnType<typeof cliPaths>;
let saved: unknown;
let server: { running: boolean; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
let controller: CliController;

function build(initial?: unknown): void {
  saved = initial;
  const store = new CliSettingsStore({ read: () => saved, write: (value) => void (saved = value) });
  server = {
    running: false,
    start: vi.fn(async () => void (server.running = true)),
    stop: vi.fn(async () => void (server.running = false)),
  };
  controller = new CliController({ store, server, paths, home, executable: "/Apps/MiniMail", appBundle: null });
}

const on = (patch: Partial<CliSettings> = {}): CliSettings => ({ ...DEFAULT_CLI_SETTINGS, enabled: true, ...patch });

beforeEach(() => {
  reportError.mockClear();
  recordAction.mockClear();
  home = mkdtempSync(join(tmpdir(), "mm-home-"));
  paths = cliPaths(mkdtempSync(join(tmpdir(), "mm-data-")));
  build();
});

describe("CliController", () => {
  it("does nothing while the CLI is off: no socket, no command, no skill", async () => {
    await controller.apply();
    expect(server.start).not.toHaveBeenCalled();
    expect(existsSync(paths.launcher)).toBe(false);
    expect(controller.state()).toMatchObject({ launcher: null, running: false });
    expect(controller.state().skills.every((skill) => !skill.installed)).toBe(true);
  });

  it("turns on: opens the socket, writes the command and installs the skill for the agents that were ticked", async () => {
    const state = await controller.set(on({ skillTargets: ["claude"] }));
    expect(server.start).toHaveBeenCalledTimes(1);
    expect(existsSync(paths.launcher)).toBe(true);
    expect(state).toMatchObject({ launcher: paths.launcher, running: true });
    expect(state.skills.find((skill) => skill.id === "claude")?.installed).toBe(true);
    expect(state.skills.find((skill) => skill.id === "agents")?.installed).toBe(false);
    expect(existsSync(skillPath(home, "claude"))).toBe(true);
    expect(recordAction).toHaveBeenCalledWith("cli", "Turned the CLI on");
    expect(recordAction).toHaveBeenCalledWith("cli", "Installed the skill for Claude Code");
  });

  it("writes the real command into the skill", async () => {
    await controller.set(on({ skillTargets: ["agents"] }));
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(skillPath(home, "agents"), "utf8")).toContain(paths.launcher.includes(" ") ? `'${paths.launcher}'` : paths.launcher);
  });

  it("starts at launch from what was saved, and refreshes the skill when the app moved", async () => {
    build({ version: 1, enabled: true, disabled: [], hideLinks: true, skillTargets: ["agents"] });
    mkdirSync(join(home, ".agents", "skills", "minimail"), { recursive: true });
    writeFileSync(skillPath(home, "agents"), "old path minimail-managed");
    await controller.apply();
    expect(server.start).toHaveBeenCalled();
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(skillPath(home, "agents"), "utf8")).toContain("# MiniMail");
  });

  it("turns off: stops the socket and removes the command and every skill it installed", async () => {
    await controller.set(on({ skillTargets: ["agents", "claude"] }));
    const state = await controller.set(on({ enabled: false, skillTargets: ["agents", "claude"] }));
    expect(server.stop).toHaveBeenCalled();
    expect(existsSync(paths.launcher)).toBe(false);
    expect(existsSync(skillPath(home, "agents"))).toBe(false);
    expect(existsSync(skillPath(home, "claude"))).toBe(false);
    expect(state).toMatchObject({ launcher: null, running: false });
    // The choice of agents is remembered, so turning it on again installs the skill again.
    expect(state.settings.skillTargets).toEqual(["agents", "claude"]);
    expect(recordAction).toHaveBeenCalledWith("cli", "Turned the CLI off");
    expect((await controller.set(on({ skillTargets: ["agents", "claude"] }))).skills.every((skill) => skill.installed)).toBe(true);
  });

  it("removes the skill when its agent is unticked, and records it", async () => {
    await controller.set(on({ skillTargets: ["agents", "claude"] }));
    recordAction.mockClear();
    await controller.set(on({ skillTargets: ["agents"] }));
    expect(existsSync(skillPath(home, "claude"))).toBe(false);
    expect(existsSync(skillPath(home, "agents"))).toBe(true);
    expect(recordAction).toHaveBeenCalledWith("cli", "Removed the skill for Claude Code");
  });

  it("never touches a skill of the same name that the person wrote, and reports it", async () => {
    mkdirSync(join(home, ".claude", "skills", "minimail"), { recursive: true });
    writeFileSync(skillPath(home, "claude"), "mine");
    await controller.set(on({ skillTargets: ["claude"] }));
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(skillPath(home, "claude"), "utf8")).toBe("mine");
    expect(reportError).toHaveBeenCalledWith("cli", "Could not install the skill for Claude Code", expect.any(Error));
    await controller.set(on({ skillTargets: [] }));
    expect(readFileSync(skillPath(home, "claude"), "utf8")).toBe("mine");
  });

  it("reports a socket that will not open and still does the rest", async () => {
    server.start.mockRejectedValueOnce(new Error("address in use"));
    const state = await controller.set(on({ skillTargets: ["agents"] }));
    expect(reportError).toHaveBeenCalledWith("cli", "Could not start the CLI", expect.any(Error));
    expect(state.running).toBe(false);
    expect(existsSync(paths.launcher)).toBe(true);
    expect(existsSync(skillPath(home, "agents"))).toBe(true);
  });

  it("saves the choice before applying it, and rejects what could not be saved", async () => {
    build({ version: 4, enabled: false, disabled: [], hideLinks: true, skillTargets: [] });
    await expect(controller.set(on())).rejects.toThrow(/newer version/);
    expect(server.start).not.toHaveBeenCalled();
  });

  it("records the choices that matter, each once", async () => {
    await controller.set(on());
    recordAction.mockClear();
    await controller.set(on({ hideLinks: false, disabled: ["contacts"] }));
    expect(recordAction.mock.calls.map((call) => call[1])).toEqual([
      "Let the CLI see full links in mail",
      "Changed which CLI commands are allowed",
    ]);
  });

  it("records a change to what needs asking, and to the people allowed, without the addresses in the title", async () => {
    await controller.set(on());
    recordAction.mockClear();
    await controller.set(on({ ask: { send: "always", unsubscribe: "off", invitation: "ask" }, allowedRecipients: ["anna@example.com"] }));
    const titles = recordAction.mock.calls.map((call) => call[1]);
    expect(titles).toEqual([
      "The CLI's permission to send mail is now: may send to anyone without asking",
      "The CLI's permission to unsubscribe is now: turned off",
      "Changed the people the CLI may send to without asking",
    ]);
    expect(JSON.stringify(titles)).not.toContain("anna@example.com");
    expect(recordAction.mock.calls.at(-1)![3]).toMatchObject({ context: "anna@example.com" });
  });

  it("adds the link for the terminal when the CLI is turned on, pointing at its command, and records it", async () => {
    expect(controller.state().pathLink).toEqual({ path: pathLinkPath(home), installed: false });
    const state = await controller.set(on());
    expect(state.pathLink.installed).toBe(true);
    expect(readlinkSync(pathLinkPath(home))).toBe(paths.launcher);
    expect(recordAction).toHaveBeenCalledWith("cli", "Added minimail to your terminal's PATH");
  });

  it("does not add it when the person turned it off, and takes away one it made when they do", async () => {
    expect((await controller.set(on({ pathLink: false }))).pathLink.installed).toBe(false);
    expect(existsSync(pathLinkPath(home))).toBe(false);
    expect((await controller.set(on())).pathLink.installed).toBe(true);
    recordAction.mockClear();
    expect((await controller.set(on({ pathLink: false }))).pathLink.installed).toBe(false);
    expect(lstatSafe(pathLinkPath(home))).toBe("missing");
    expect(recordAction).toHaveBeenCalledWith("cli", "Turned off the minimail link for your terminal");
  });

  it("keeps the link off across launches once it was turned off", async () => {
    await controller.set(on({ pathLink: false }));
    const relaunched = new CliController({
      store: new CliSettingsStore({ read: () => saved, write: (value) => void (saved = value) }),
      server: { running: false, start: vi.fn(), stop: vi.fn() },
      paths,
      home,
      executable: "/Apps/MiniMail",
      appBundle: null,
    });
    await relaunched.apply();
    expect(lstatSafe(pathLinkPath(home))).toBe("missing");
  });

  it("takes the link away with the CLI, and brings it back when the CLI is turned on again", async () => {
    await controller.set(on());
    await controller.set(on({ enabled: false }));
    expect(lstatSafe(pathLinkPath(home))).toBe("missing");
    expect((await controller.set(on())).pathLink.installed).toBe(true);
  });

  it("leaves a file of the person's own with that name alone, and reports that it could not add the link", async () => {
    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    writeFileSync(pathLinkPath(home), "my own script");
    const state = await controller.set(on());
    expect(state.pathLink.installed).toBe(false);
    expect(lstatSync(pathLinkPath(home)).isFile()).toBe(true);
    expect(reportError).toHaveBeenCalledWith("cli", "Could not update the minimail link in your terminal's PATH", expect.any(Error));
    await controller.set(on({ enabled: false }));
    expect(lstatSync(pathLinkPath(home)).isFile()).toBe(true);
  });

  it("points the link at the command again at launch when the app was moved", async () => {
    await controller.set(on());
    const moved = cliPaths(mkdtempSync(join(tmpdir(), "mm-moved-")));
    const relaunched = new CliController({
      store: new CliSettingsStore({ read: () => saved, write: (value) => void (saved = value) }),
      server: { running: false, start: vi.fn(), stop: vi.fn() },
      paths: moved,
      home,
      executable: "/Apps/MiniMail",
      appBundle: null,
    });
    await relaunched.apply();
    expect(readlinkSync(pathLinkPath(home))).toBe(moved.launcher);
  });

  it("runs overlapping changes one after another, never at the same time", async () => {
    const order: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    server.start.mockImplementation(async () => {
      order.push("start");
      await gate;
      order.push("started");
      server.running = true;
    });
    server.stop.mockImplementation(async () => {
      order.push("stop");
      server.running = false;
    });
    const first = controller.set(on());
    await vi.waitFor(() => expect(order).toEqual(["start"]));
    const second = controller.set(on({ enabled: false }));
    // The second change has to wait: it cannot stop what has not finished starting.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(order).toEqual(["start"]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["start", "started", "stop"]);
    expect(controller.state().running).toBe(false);
    expect(existsSync(paths.launcher)).toBe(false);
  });

  it("keeps working after a change that failed outright", async () => {
    const store = new CliSettingsStore({ read: () => undefined, write: () => undefined });
    const get = vi.spyOn(store, "get");
    const failing = new CliController({
      store,
      server: { running: false, start: vi.fn(), stop: vi.fn() },
      paths,
      home,
      executable: "/Apps/MiniMail",
      appBundle: null,
    });
    get.mockImplementationOnce(() => {
      throw new Error("settings unreadable");
    });
    await expect(failing.apply()).rejects.toThrow("settings unreadable");
    await expect(failing.apply()).resolves.toBeUndefined();
  });

  it("records each choice as it was made, even when the next one comes before the first is applied", async () => {
    await Promise.all([controller.set(on()), controller.set(on({ enabled: false }))]);
    expect(recordAction.mock.calls.map((call) => call[1])).toEqual(["Turned the CLI on", "Turned the CLI off"]);
    expect(controller.state().running).toBe(false);
  });
});

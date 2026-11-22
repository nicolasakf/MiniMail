import { ASK_COMMANDS, SKILL_TARGETS, type CliSettings, type CliState } from "@shared/cli";

import { recordAction, reportError } from "../events";
import { installLauncher, removeLauncher, type CliPaths } from "./launcher";
import { installPathLink, pathLinkPath, pathLinkStatus, removePathLink } from "./path-link";
import type { CliServer } from "./server";
import { installSkill, removeSkill, skillStatuses, skillText } from "./skill";
import type { CliSettingsStore } from "./settings";

export interface CliControllerDeps {
  store: CliSettingsStore;
  server: Pick<CliServer, "start" | "stop" | "running">;
  paths: CliPaths;
  /** The person's home folder, where the agents keep their skills. */
  home: string;
  /** The program the launcher runs the client with. */
  executable: string;
  /** The app to start when it is not running (a packaged macOS build), or null. */
  appBundle: string | null;
}

/**
 * Keeps what is on the computer in line with what the person chose: while the CLI is on, the socket is
 * open, the `minimail` command is written and the skill is installed for the agents they ticked; when
 * it is off, none of that exists. Run at start and after every change; a failure of one part is
 * reported and does not stop the others.
 */
export class CliController {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly deps: CliControllerDeps) {}

  state(): CliState {
    const settings = this.deps.store.get();
    return {
      settings,
      launcher: settings.enabled ? this.deps.paths.launcher : null,
      running: this.deps.server.running,
      skills: skillStatuses(this.deps.home),
      pathLink: { path: pathLinkPath(this.deps.home), installed: pathLinkStatus(this.deps.home, this.deps.paths.launcher) === "ours" },
    };
  }

  /** Brings the computer in line with the saved settings. Safe to call at any time; calls run one after another. */
  apply(): Promise<void> {
    const run = this.queue.then(() => this.reconcile());
    // One that rejects must not block the ones after it; the caller of this one still hears about it.
    this.queue = run.catch(() => undefined); // expected: reconcile reports each failure itself
    return run;
  }

  /** Saves new settings and applies them. Rejects when they could not be saved. */
  async set(next: CliSettings): Promise<CliState> {
    const before = this.deps.store.get();
    const stored = this.deps.store.set(next);
    await this.apply();
    this.recordChanges(before, stored);
    return this.state();
  }

  private recordChanges(before: CliSettings, after: CliSettings): void {
    if (before.enabled !== after.enabled) recordAction("cli", after.enabled ? "Turned the CLI on" : "Turned the CLI off");
    if (after.enabled) {
      for (const target of SKILL_TARGETS) {
        const had = before.enabled && before.skillTargets.includes(target.id);
        const has = after.skillTargets.includes(target.id);
        if (has && !had) recordAction("cli", `Installed the skill for ${target.label}`);
        if (!has && had) recordAction("cli", `Removed the skill for ${target.label}`);
      }
    }
    if (before.pathLink !== after.pathLink) recordAction("cli", after.pathLink ? "Turned on the minimail link for your terminal" : "Turned off the minimail link for your terminal");
    if (before.hideLinks !== after.hideLinks) recordAction("cli", after.hideLinks ? "Hid links in mail from the CLI" : "Let the CLI see full links in mail");
    for (const command of ASK_COMMANDS) {
      if (before.ask[command] === after.ask[command]) continue;
      const what = command === "send" ? "send mail" : command === "unsubscribe" ? "unsubscribe" : "answer invitations";
      const how = after.ask[command] === "off" ? "turned off" : after.ask[command] === "ask" ? "asks first" : command === "send" ? "may send to anyone without asking" : "allowed without asking";
      recordAction("cli", `The CLI's permission to ${what} is now: ${how}`);
    }
    if (before.allowedRecipients.join("\n") !== after.allowedRecipients.join("\n")) {
      // The addresses are private: only that the list changed goes in the title.
      recordAction("cli", "Changed the people the CLI may send to without asking", "", { context: after.allowedRecipients.join(", ") });
    }
    const turned = [...before.disabled.filter((id) => !after.disabled.includes(id)), ...after.disabled.filter((id) => !before.disabled.includes(id))];
    if (turned.length > 0) recordAction("cli", "Changed which CLI commands are allowed");
  }

  private async reconcile(): Promise<void> {
    const { store, server, paths, home, executable, appBundle } = this.deps;
    const settings = store.get();
    if (settings.enabled) {
      try {
        installLauncher(paths, { executable, appBundle });
      } catch (error) {
        reportError("cli", "Could not write the minimail command", error);
      }
      try {
        await server.start();
      } catch (error) {
        reportError("cli", "Could not start the CLI", error);
      }
    } else {
      try {
        await server.stop();
      } catch (error) {
        reportError("cli", "Could not stop the CLI", error);
      }
      try {
        removeLauncher(paths);
      } catch (error) {
        reportError("cli", "Could not remove the minimail command", error);
      }
    }
    try {
      // While the CLI is on the link is there (unless the person turned it off) and follows the app if it moved;
      // otherwise it is taken away. Only a link MiniMail made is ever changed.
      if (settings.enabled && settings.pathLink) {
        if (installPathLink(home, paths.launcher) === "installed") recordAction("cli", "Added minimail to your terminal's PATH");
      } else {
        removePathLink(home, paths.launcher);
      }
    } catch (error) {
      reportError("cli", "Could not update the minimail link in your terminal's PATH", error);
    }
    for (const target of SKILL_TARGETS) {
      const wanted = settings.enabled && settings.skillTargets.includes(target.id);
      try {
        if (wanted) installSkill(home, target.id, skillText(paths.launcher, home));
        else removeSkill(home, target.id);
      } catch (error) {
        reportError("cli", `Could not ${wanted ? "install" : "remove"} the skill for ${target.label}`, error);
      }
    }
  }
}

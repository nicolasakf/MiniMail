import { UPDATE_FEED_URL, type UpdateSettings, type UpdateState } from "@shared/updates";

import { describeCause, recordAction, recordInfo, reportError } from "./events";
import { isNetworkOnline } from "./network";
import type { UpdateSettingsStore } from "./update-settings";

/** The first look for a new version comes this long after start: long enough for the window to open, short enough to be news. */
export const FIRST_CHECK_DELAY_MS = 5_000;
/** After that, once a day. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** A background check that found no network tries again after this long. */
export const OFFLINE_RETRY_MS = 10 * 60 * 1000;
/** After asking to restart, how long the app may stay open before the restart is taken as refused. */
export const RESTART_GIVE_UP_MS = 15_000;

/** The part of `electron-updater`'s `autoUpdater` that MiniMail uses; tests stand in for it. */
export interface AutoUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  logger: unknown;
  setFeedURL(options: { provider: "generic"; url: string }): void;
  checkForUpdates(): Promise<{ isUpdateAvailable: boolean; updateInfo: { version: string } } | null | undefined>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "download-progress", listener: (progress: { percent: number }) => void): unknown;
  on(event: "update-downloaded", listener: (info: { version: string }) => void): unknown;
}

export interface UpdaterOptions {
  autoUpdater: AutoUpdaterLike;
  currentVersion: string;
  /** Only an installed app can replace itself; a development run cannot. */
  supported: boolean;
  settings: UpdateSettingsStore;
  /** Tells the page that the state changed. */
  onChange: (state: UpdateState) => void;
  online?: () => boolean;
  feedUrl?: string;
}

/** The first line of an error, which is all a person needs to read; the whole of it goes to the log. */
function firstLine(text: string): string {
  return (text.split("\n")[0] ?? "").trim().slice(0, 300);
}

/**
 * Keeps MiniMail up to date from its GitHub releases, the way Orion does: it looks for a new version a few seconds after the
 * app starts and once a day, tells the page when there is one, and downloads and installs it only when the
 * person says so. A downloaded update that was not installed yet installs the next time MiniMail quits.
 *
 * - A development run, or a computer with no network, never fails loudly: the first has nothing to update and
 *   the second tries again later. Every real failure is recorded (`reportError`) and shown on the page only
 *   when the person asked for the step that failed.
 * - Only what GitHub publishes with a release counts: the signed zip and `latest-mac.yml` (see docs/macos-release.md).
 *   `electron-updater` checks the file's hash, and macOS refuses an update not signed by the same developer.
 */
export class Updater {
  private current: UpdateState;
  private started = false;
  private checking: Promise<void> | null = null;
  /** A check or a download is under way: it reports its own failure, which carries the same error as the library's event. */
  private looking = false;
  private downloading = false;
  private announced: string | undefined;
  /** The version whose notice the person closed. Kept for this run only: the next start shows the notice again. */
  private dismissedVersion: string | undefined;
  /** Errors already handled, so one that both the library's event and the rejected call report is dealt with once. */
  private readonly handled = new WeakSet<object>();
  private firstTimer: ReturnType<typeof setTimeout> | null = null;
  private dailyTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private giveUpTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: UpdaterOptions) {
    this.current = { status: options.supported ? "idle" : "unsupported", currentVersion: options.currentVersion };
  }

  state(): UpdateState {
    const { latestVersion } = this.current;
    const dismissed = this.current.status === "available" && latestVersion !== undefined && this.dismissedVersion === latestVersion;
    return { ...this.current, ...(dismissed ? { dismissed: true } : {}) };
  }

  settings(): UpdateSettings {
    return this.options.settings.get();
  }

  setSettings(next: UpdateSettings): UpdateSettings {
    const wasOn = this.options.settings.get().check;
    const saved = this.options.settings.set(next);
    // Turning it on looks at once instead of waiting for tomorrow.
    if (saved.check && !wasOn) void this.background();
    return saved;
  }

  /** The person closed the notice about this version: it is not shown again until MiniMail starts again. The sidebar button stays. */
  dismiss(version: string): void {
    this.dismissedVersion = version;
    this.options.onChange(this.state());
  }

  /** Sets the library up and schedules the checks. Does nothing in a development run. */
  start(): void {
    if (!this.options.supported || this.started) return;
    this.started = true;
    const updater = this.options.autoUpdater;
    // Failures go through `reportError`, not the library's own console output.
    updater.logger = null;
    // Downloading waits for the person; a downloaded update that was not installed yet installs when MiniMail quits.
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = true;
    updater.setFeedURL({ provider: "generic", url: this.options.feedUrl ?? UPDATE_FEED_URL });
    updater.on("error", (error) => {
      // A check or a download that is under way reports its own rejection, which carries this same error.
      if (this.current.status === "installing") this.report("Could not install the update", error, { status: "downloaded" });
      else if (!this.looking && !this.downloading) this.report("Could not update MiniMail", error);
    });
    updater.on("download-progress", ({ percent }) => {
      const progress = Math.max(0, Math.min(100, percent));
      if (Math.round(progress) !== Math.round(this.current.progress ?? -1)) this.set({ status: "downloading", progress });
    });
    updater.on("update-downloaded", ({ version }) => {
      recordInfo("updates", `MiniMail ${version} was downloaded`, "It installs when MiniMail restarts or quits.");
      this.set({ status: "downloaded", latestVersion: version, progress: 100, error: undefined });
    });
    this.firstTimer = setTimeout(() => void this.background(), FIRST_CHECK_DELAY_MS);
    this.dailyTimer = setInterval(() => void this.background(), CHECK_INTERVAL_MS);
  }

  stop(): void {
    for (const timer of [this.firstTimer, this.retryTimer, this.giveUpTimer]) if (timer) clearTimeout(timer);
    if (this.dailyTimer) clearInterval(this.dailyTimer);
    this.firstTimer = this.retryTimer = this.giveUpTimer = this.dailyTimer = null;
  }

  /** A check nobody asked for: only when the choice is on, and quietly put off while there is no network. */
  private async background(): Promise<void> {
    if (!this.options.settings.get().check) return;
    if (!(this.options.online ?? isNetworkOnline)()) {
      // expected: no network is no failure; the check is tried again a little later.
      this.retryTimer ??= setTimeout(() => {
        this.retryTimer = null;
        void this.background();
      }, OFFLINE_RETRY_MS);
      return;
    }
    await this.check(false);
  }

  /** Looks for a new version. `manual` is the person asking, so it works with the choice off and a failure is shown. */
  async check(manual: boolean): Promise<UpdateState> {
    if (!this.options.supported) return this.state();
    if (this.checking) {
      await this.checking;
      return this.state();
    }
    // Once a download is under way or done, there is nothing more to look for.
    if (["downloading", "downloaded", "installing"].includes(this.current.status)) return this.state();
    if (!(this.options.online ?? isNetworkOnline)()) {
      if (manual) this.report("Could not check for updates", "There is no network connection.");
      return this.state();
    }
    this.checking = this.look(manual).finally(() => {
      this.checking = null;
    });
    await this.checking;
    return this.state();
  }

  private async look(manual: boolean): Promise<void> {
    const before = this.current;
    this.looking = true;
    // A notice already on screen stays put while a daily check looks again.
    if (manual || before.status !== "available") this.set({ status: "checking", error: undefined });
    try {
      const result = await this.options.autoUpdater.checkForUpdates();
      if (result?.isUpdateAvailable) {
        const version = result.updateInfo.version;
        if (this.announced !== version) {
          this.announced = version;
          recordInfo("updates", `MiniMail ${version} is available`, `This is MiniMail ${this.options.currentVersion}.`);
        }
        this.set({ status: "available", latestVersion: version, progress: undefined, error: undefined });
      } else {
        this.set({ status: "current", latestVersion: undefined, progress: undefined, error: undefined });
      }
    } catch (error) {
      this.report("Could not check for updates", error, { status: before.status });
    } finally {
      this.looking = false;
    }
  }

  /** Downloads the version found. The page hears of the progress, and of the end through the state. */
  async download(): Promise<UpdateState> {
    if (this.current.status !== "available") return this.state();
    recordAction("updates", `Started downloading MiniMail ${this.current.latestVersion ?? "an update"}`);
    this.downloading = true;
    this.set({ status: "downloading", progress: 0, error: undefined });
    try {
      await this.options.autoUpdater.downloadUpdate();
    } catch (error) {
      this.report("Could not download the update", error, { status: "available", progress: undefined });
    } finally {
      this.downloading = false;
    }
    return this.state();
  }

  /** Quits MiniMail and installs the downloaded version, which opens again. */
  restartAndInstall(): UpdateState {
    if (this.current.status !== "downloaded") return this.state();
    recordAction("updates", `Restarting MiniMail to install ${this.current.latestVersion ?? "the update"}`);
    this.set({ status: "installing", error: undefined });
    try {
      this.options.autoUpdater.quitAndInstall(false, true);
    } catch (error) {
      this.report("Could not install the update", error, { status: "downloaded" });
      return this.state();
    }
    // A window that asks to stay open (a message being written) stops the quit; the update then waits for the next one.
    this.giveUpTimer = setTimeout(() => {
      this.giveUpTimer = null;
      if (this.current.status !== "installing") return;
      recordInfo("updates", "MiniMail did not restart for the update", "A window asked to stay open. The update installs the next time MiniMail quits.");
      this.set({ status: "downloaded" });
    }, RESTART_GIVE_UP_MS);
    return this.state();
  }

  private set(patch: Partial<UpdateState>): void {
    this.current = { ...this.current, ...patch };
    this.options.onChange(this.state());
  }

  /** Records a failure once and keeps its first line in the state, for the page to show when the person asked. */
  private report(title: string, cause: unknown, back: Partial<UpdateState> = {}): void {
    if (typeof cause === "object" && cause !== null) {
      if (this.handled.has(cause)) return;
      this.handled.add(cause);
    }
    reportError("updates", title, cause);
    this.set({ ...back, error: firstLine(describeCause(cause)) });
  }
}

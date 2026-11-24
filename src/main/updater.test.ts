import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const log = vi.hoisted(() => ({ errors: [] as string[], infos: [] as string[], actions: [] as string[] }));
vi.mock("./events", () => ({
  reportError: (_area: string, title: string) => void log.errors.push(title),
  recordInfo: (_area: string, title: string) => void log.infos.push(title),
  recordAction: (_area: string, title: string) => void log.actions.push(title),
  describeCause: (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
}));

import { UPDATE_FEED_URL, type UpdateState } from "@shared/updates";

import type { SettingsSection } from "./settings-file";
import { UpdateSettingsStore } from "./update-settings";
import { CHECK_INTERVAL_MS, FIRST_CHECK_DELAY_MS, OFFLINE_RETRY_MS, RESTART_GIVE_UP_MS, Updater, type AutoUpdaterLike } from "./updater";

type Handlers = {
  error?: (error: Error) => void;
  "download-progress"?: (progress: { percent: number }) => void;
  "update-downloaded"?: (info: { version: string }) => void;
};

/** A stand-in for electron-updater's `autoUpdater`. */
function fakeAutoUpdater() {
  const handlers: Handlers = {};
  const fake = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    logger: console as unknown,
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(async (): Promise<{ isUpdateAvailable: boolean; updateInfo: { version: string } } | null> => ({
      isUpdateAvailable: false,
      updateInfo: { version: "0.16.2" },
    })),
    downloadUpdate: vi.fn(async (): Promise<unknown> => undefined),
    quitAndInstall: vi.fn(),
    on: vi.fn((event: keyof Handlers, listener: never) => {
      (handlers as Record<string, unknown>)[event] = listener;
    }),
  };
  return { fake, handlers, asUpdater: () => fake as unknown as AutoUpdaterLike };
}

function memorySection(initial?: unknown): SettingsSection {
  let value = initial;
  return { read: () => value, write: (next) => void (value = next) };
}

function setup(options: { supported?: boolean; online?: boolean; saved?: unknown } = {}) {
  const auto = fakeAutoUpdater();
  const changes: UpdateState[] = [];
  const network = { online: options.online ?? true };
  const settings = new UpdateSettingsStore(memorySection(options.saved));
  const updater = new Updater({
    autoUpdater: auto.asUpdater(),
    currentVersion: "0.16.2",
    supported: options.supported ?? true,
    settings,
    onChange: (state) => void changes.push(state),
    online: () => network.online,
  });
  return { ...auto, updater, changes, network, settings };
}

const newer = { isUpdateAvailable: true, updateInfo: { version: "0.17.0" } };

beforeEach(() => {
  vi.useFakeTimers();
  log.errors.length = log.infos.length = log.actions.length = 0;
});
afterEach(() => vi.useRealTimers());

describe("Updater in a development run", () => {
  it("does nothing: no feed, no timers, no checks, not even a manual one", async () => {
    const { updater, fake } = setup({ supported: false });
    updater.start();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 2);
    expect(await updater.check(true)).toEqual({ status: "unsupported", currentVersion: "0.16.2" });
    expect(fake.setFeedURL).not.toHaveBeenCalled();
    expect(fake.checkForUpdates).not.toHaveBeenCalled();
    expect(log.errors).toEqual([]);
  });
});

describe("Updater setup", () => {
  it("points at the GitHub releases, and waits for the person before downloading", () => {
    const { updater, fake } = setup();
    updater.start();
    expect(fake.setFeedURL).toHaveBeenCalledWith({ provider: "generic", url: UPDATE_FEED_URL });
    expect(UPDATE_FEED_URL).toBe("https://github.com/nicolasakf/MiniMail/releases/latest/download");
    expect(fake.autoDownload).toBe(false);
    expect(fake.autoInstallOnAppQuit).toBe(true);
    expect(fake.logger).toBeNull();
    updater.stop();
  });

  it("sets up once, however often it is started", () => {
    const { updater, fake } = setup();
    updater.start();
    updater.start();
    expect(fake.setFeedURL).toHaveBeenCalledTimes(1);
    updater.stop();
  });
});

describe("Updater checks", () => {
  it("checks a little after start and then every day", async () => {
    const { updater, fake } = setup();
    updater.start();
    expect(fake.checkForUpdates).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(2);
    updater.stop();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 2);
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it("does not check on its own with the choice off, but a check by hand works", async () => {
    const { updater, fake } = setup({ saved: { version: 1, check: false } });
    updater.start();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(fake.checkForUpdates).not.toHaveBeenCalled();
    await updater.check(true);
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(1);
    updater.stop();
  });

  it("looks at once when the choice is turned on", async () => {
    const { updater, fake } = setup({ saved: { version: 1, check: false } });
    updater.start();
    updater.setSettings({ check: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(1);
    updater.setSettings({ check: true }); // already on: nothing new to look at
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(1);
    updater.stop();
  });

  it("waits for the network without reporting anything, and tries again soon", async () => {
    const { updater, fake, network } = setup({ online: false });
    updater.start();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    expect(fake.checkForUpdates).not.toHaveBeenCalled();
    expect(log.errors).toEqual([]);
    network.online = true;
    await vi.advanceTimersByTimeAsync(OFFLINE_RETRY_MS);
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(1);
    updater.stop();
  });

  it("says so when a check by hand finds no network, and records it", async () => {
    const { updater, fake } = setup({ online: false });
    const state = await updater.check(true);
    expect(state.error).toBe("There is no network connection.");
    expect(state.status).toBe("idle");
    expect(fake.checkForUpdates).not.toHaveBeenCalled();
    expect(log.errors).toEqual(["Could not check for updates"]);
  });

  it("reports that MiniMail is current when there is nothing newer", async () => {
    const { updater } = setup();
    const state = await updater.check(true);
    expect(state).toEqual({ status: "current", currentVersion: "0.16.2" });
    expect(log.infos).toEqual([]);
  });

  it("finds a newer version, records it once, and tells the page", async () => {
    const { updater, fake, changes } = setup();
    fake.checkForUpdates.mockResolvedValue(newer);
    const state = await updater.check(false);
    expect(state).toMatchObject({ status: "available", latestVersion: "0.17.0", currentVersion: "0.16.2" });
    expect(changes.map((change) => change.status)).toEqual(["checking", "available"]);
    await updater.check(false);
    expect(log.infos).toEqual(["MiniMail 0.17.0 is available"]);
  });

  it("joins a check that is already running instead of starting another", async () => {
    const { updater, fake } = setup();
    let finish: (value: typeof newer) => void = () => undefined;
    fake.checkForUpdates.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const first = updater.check(false);
    const second = updater.check(true);
    finish(newer);
    expect((await first).status).toBe("available");
    expect((await second).status).toBe("available");
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("keeps the notice on screen while a daily check looks again", async () => {
    const { updater, fake, changes } = setup();
    fake.checkForUpdates.mockResolvedValue(newer);
    await updater.check(false);
    changes.length = 0;
    await updater.check(false);
    expect(changes.map((change) => change.status)).toEqual(["available"]);
  });

  it("records a failed check once, keeps what was known, and shows only its first line", async () => {
    const { updater, fake, handlers } = setup();
    updater.start();
    fake.checkForUpdates.mockResolvedValue(newer);
    await updater.check(false);
    const failure = new Error("Cannot find latest-mac.yml\nHeaders: {...}");
    // electron-updater emits the error and rejects with the same object.
    fake.checkForUpdates.mockImplementation(async () => {
      handlers.error?.(failure);
      throw failure;
    });
    const state = await updater.check(true);
    expect(state).toMatchObject({ status: "available", latestVersion: "0.17.0", error: "Cannot find latest-mac.yml" });
    expect(log.errors).toEqual(["Could not check for updates"]);
    updater.stop();
  });

  it("clears the last failure when the next check starts", async () => {
    const { updater, fake } = setup();
    fake.checkForUpdates.mockRejectedValueOnce(new Error("offline"));
    expect((await updater.check(true)).error).toBe("offline");
    expect((await updater.check(true)).error).toBeUndefined();
  });
});

describe("Updater notice", () => {
  it("marks the version dismissed once the person closed its notice, for this run only, and a newer one is not", async () => {
    const { updater, fake, changes } = setup();
    fake.checkForUpdates.mockResolvedValue(newer);
    await updater.check(false);
    expect(updater.state().dismissed).toBeUndefined();
    updater.dismiss("0.17.0");
    expect(updater.state().dismissed).toBe(true);
    expect(changes.at(-1)?.dismissed).toBe(true);
    fake.checkForUpdates.mockResolvedValue({ isUpdateAvailable: true, updateInfo: { version: "0.18.0" } });
    await updater.check(true);
    expect(updater.state()).toMatchObject({ latestVersion: "0.18.0" });
    expect(updater.state().dismissed).toBeUndefined();
  });
});

describe("Updater at start", () => {
  it("looks a few seconds after start, so the notice and the sidebar button are there at once", async () => {
    const { updater, fake } = setup();
    fake.checkForUpdates.mockResolvedValue(newer);
    updater.start();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    expect(FIRST_CHECK_DELAY_MS).toBeLessThanOrEqual(5_000);
    expect(updater.state()).toMatchObject({ status: "available", latestVersion: "0.17.0" });
    updater.stop();
  });

  it("shows the notice again at the next start: a closed notice is remembered for the run only", async () => {
    const first = setup();
    first.fake.checkForUpdates.mockResolvedValue(newer);
    await first.updater.check(false);
    first.updater.dismiss("0.17.0");
    expect(first.updater.state().dismissed).toBe(true);
    const second = new Updater({ autoUpdater: first.asUpdater(), currentVersion: "0.16.2", supported: true, settings: first.settings, onChange: () => undefined, online: () => true });
    await second.check(false);
    expect(second.state()).toMatchObject({ status: "available", latestVersion: "0.17.0" });
    expect(second.state().dismissed).toBeUndefined();
  });
});

describe("Updater download and install", () => {
  it("downloads only what was found, and reports the progress without repeating a percent", async () => {
    const { updater, fake, handlers, changes } = setup();
    updater.start();
    expect((await updater.download()).status).toBe("idle");
    expect(fake.downloadUpdate).not.toHaveBeenCalled();

    fake.checkForUpdates.mockResolvedValue(newer);
    await updater.check(false);
    fake.downloadUpdate.mockImplementation(async () => {
      handlers["download-progress"]?.({ percent: 10.2 });
      handlers["download-progress"]?.({ percent: 10.4 });
      handlers["download-progress"]?.({ percent: 55 });
      handlers["update-downloaded"]?.({ version: "0.17.0" });
    });
    changes.length = 0;
    const state = await updater.download();
    expect(state).toMatchObject({ status: "downloaded", latestVersion: "0.17.0", progress: 100 });
    expect(changes.map((change) => [change.status, Math.round(change.progress ?? -1)])).toEqual([
      ["downloading", 0],
      ["downloading", 10],
      ["downloading", 55],
      ["downloaded", 100],
    ]);
    expect(log.actions).toEqual(["Started downloading MiniMail 0.17.0"]);
    expect(log.infos).toContain("MiniMail 0.17.0 was downloaded");
    updater.stop();
  });

  it("goes back to available when the download fails, so it can be tried again, and records it once", async () => {
    const { updater, fake, handlers } = setup();
    updater.start();
    fake.checkForUpdates.mockResolvedValue(newer);
    await updater.check(false);
    const failure = new Error("net::ERR_CONNECTION_RESET");
    fake.downloadUpdate.mockImplementation(async () => {
      handlers.error?.(failure);
      throw failure;
    });
    const state = await updater.download();
    expect(state).toMatchObject({ status: "available", latestVersion: "0.17.0", error: "net::ERR_CONNECTION_RESET" });
    expect(state.progress).toBeUndefined();
    expect(log.errors).toEqual(["Could not download the update"]);
    fake.downloadUpdate.mockResolvedValue(undefined);
    expect((await updater.download()).error).toBeUndefined();
    updater.stop();
  });

  it("does not check again while an update is downloaded", async () => {
    const { updater, fake, handlers } = setup();
    updater.start();
    fake.checkForUpdates.mockResolvedValue(newer);
    await updater.check(false);
    fake.downloadUpdate.mockImplementation(async () => handlers["update-downloaded"]?.({ version: "0.17.0" }));
    await updater.download();
    fake.checkForUpdates.mockClear();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect((await updater.check(true)).status).toBe("downloaded");
    expect(fake.checkForUpdates).not.toHaveBeenCalled();
    updater.stop();
  });

  it("restarts to install only a downloaded update", async () => {
    const { updater, fake, handlers } = setup();
    updater.start();
    expect(updater.restartAndInstall().status).toBe("idle");
    expect(fake.quitAndInstall).not.toHaveBeenCalled();

    fake.checkForUpdates.mockResolvedValue(newer);
    await updater.check(false);
    expect(updater.restartAndInstall().status).toBe("available");
    expect(fake.quitAndInstall).not.toHaveBeenCalled();

    fake.downloadUpdate.mockImplementation(async () => handlers["update-downloaded"]?.({ version: "0.17.0" }));
    await updater.download();
    expect(updater.restartAndInstall().status).toBe("installing");
    expect(fake.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(log.actions).toContain("Restarting MiniMail to install 0.17.0");
    updater.stop();
  });

  it("is ready to try again when a window kept MiniMail open and it did not restart", async () => {
    const { updater, fake, handlers } = setup();
    updater.start();
    fake.checkForUpdates.mockResolvedValue(newer);
    await updater.check(false);
    fake.downloadUpdate.mockImplementation(async () => handlers["update-downloaded"]?.({ version: "0.17.0" }));
    await updater.download();
    updater.restartAndInstall();
    await vi.advanceTimersByTimeAsync(RESTART_GIVE_UP_MS);
    expect(updater.state().status).toBe("downloaded");
    expect(log.infos).toContain("MiniMail did not restart for the update");
    expect(log.errors).toEqual([]);
    updater.stop();
  });

  it("goes back to downloaded and reports it when the install itself fails", async () => {
    const { updater, fake, handlers } = setup();
    updater.start();
    fake.checkForUpdates.mockResolvedValue(newer);
    await updater.check(false);
    fake.downloadUpdate.mockImplementation(async () => handlers["update-downloaded"]?.({ version: "0.17.0" }));
    await updater.download();
    fake.quitAndInstall.mockImplementation(() => {
      throw new Error("Could not locate update bundle");
    });
    expect(updater.restartAndInstall()).toMatchObject({ status: "downloaded", error: "Could not locate update bundle" });
    expect(log.errors).toEqual(["Could not install the update"]);
    updater.stop();
  });

  it("reports an error the library raises on its own, when nothing was waiting for it", () => {
    const { updater, handlers } = setup();
    updater.start();
    handlers.error?.(new Error("The update could not be applied"));
    expect(log.errors).toEqual(["Could not update MiniMail"]);
    expect(updater.state().error).toBe("The update could not be applied");
    updater.stop();
  });
});

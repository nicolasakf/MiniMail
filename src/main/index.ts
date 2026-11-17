import { execFile } from "node:child_process";
import { join } from "node:path";

import { promises as dns } from "node:dns";

import { app, BrowserWindow, dialog, Notification, safeStorage, shell } from "electron";

import { senderDomain } from "@shared/categories";
import { IPC } from "@shared/ipc";

import { AiSettingsStore } from "./ai-settings";
import { AttachmentFiles } from "./attachment-files";
import { InvitationAnswers } from "./invitation-answers";
import { createCodeFallback } from "./code-fallback";
import { Categorizer } from "./categorizer";
import { VerificationCodes } from "./verification-codes";
import { CategoryStore, GatewayKeyStore } from "./category-store";
import { registerIpc, publishEvents } from "./ipc";
import { EventJournal } from "./event-journal";
import { installJournal, recordInfo, reportError } from "./events";
import { createJevClassifier } from "./jev";
import type { OAuthConfig } from "./oauth";
import { flushLog, initLog, logEvent, writeLogLine } from "./log";
import { perfLog } from "./perf";
import { findGravatar, findSiteIcon } from "./logos/icon-finder";
import { LogoCache } from "./logos/logo-cache";
import { LogoService } from "./logos/logo-service";
import { LogoSettingsStore } from "./logos/logo-settings";
import { safeFetch } from "./logos/net-guard";
import { registerComposerWindows } from "./composer-windows";
import { ComposeDelivery } from "./compose-delivery";
import { ComposeLibraryStore } from "./compose-library";
import { DraftStore } from "./draft-store";
import { NotificationSettingsStore } from "./notification-settings";
import { Notifier } from "./notifier";
import { UiPrefsStore } from "./ui-prefs";
import { TrustedSenders } from "./trusted-senders";
import { MailCache } from "./mail-cache";
import { MailService } from "./service";
import { AccountStore } from "./store";

perfLog("main bundle loaded");

/**
 * Accounts that cannot be pushed to (Outlook), or whose push connection is down, are polled this
 * often. The rest rely on the server and only get the slow safety refresh below.
 */
const POLL_INTERVAL_MS = 15_000;
/** Refresh at least this often even when every account is pushing, in case a push was missed. */
const SAFETY_POLL_MS = 5 * 60_000;

const oauthConfig: OAuthConfig = {
  googleClientId: import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID,
  googleClientSecret: import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET,
  microsoftClientId: import.meta.env.MAIN_VITE_MICROSOFT_CLIENT_ID,
};

// Nothing may fail unseen. These catch what no one wrote a catch for; the journal (once installed)
// shows it in the Log popover and writes it to main.log, and `flushJournal` makes sure
// the last words reach the disk even if the process is about to go.
let journal: EventJournal | null = null;
function flushJournal(): void {
  try {
    journal?.flushSync();
    flushLog();
  } catch {
    // expected: this is the recorder itself failing while the app exits; there is nowhere left to report.
  }
}
process.on("uncaughtException", (error) => {
  reportError("app", "The app hit an unexpected error", error);
  flushJournal();
});
process.on("unhandledRejection", (reason) => {
  reportError("app", "Something failed without being handled", reason);
  flushJournal();
});

/** Dev server URL injected by electron-vite; undefined in a packaged build. */
const rendererUrl = process.env["ELECTRON_RENDERER_URL"];

let mainWindow: BrowserWindow | null = null;
let service: MailService | null = null;
let categoryStore: CategoryStore | null = null;
let mailCache: MailCache | null = null;
let logoCache: LogoCache | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let delivery: ComposeDelivery | null = null;
let notifier: Notifier | null = null;
let attachmentFiles: AttachmentFiles | null = null;
/** Notifications on screen; Electron drops the click handler of one that is garbage collected. */
const liveNotifications = new Set<Notification>();

/** Opens http(s) and mailto links in the user's default handler; ignores everything else. */
async function openExternalSafely(url: string): Promise<void> {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    throw new Error("Invalid URL.");
  }
  if (protocol !== "https:" && protocol !== "http:" && protocol !== "mailto:") {
    throw new Error(`Refusing to open a ${protocol} link.`);
  }
  await shell.openExternal(url);
}

function protectNavigation(window: BrowserWindow): void {
  // Links inside the app (or in rendered emails) go to the real browser, never a new Electron window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url).catch((error) => reportError("app", "Could not open a link", error));
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    const isAppUrl = rendererUrl ? url.startsWith(rendererUrl) : url.startsWith("file://");
    if (!isAppUrl) {
      event.preventDefault();
      openExternalSafely(url).catch((error) => reportError("app", "Could not open a link", error));
    }
  });
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    // Orion's dark background token, so there is no white flash before first paint.
    backgroundColor: "#0a0a0a",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 20 },
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;

  window.once("ready-to-show", () => {
    perfLog("window shown");
    window.show();
  });
  window.webContents.once("dom-ready", () => perfLog("page dom-ready"));
  // Timings the page prints (dev builds only) show up in this terminal next to the main-process ones.
  window.webContents.on("console-message", (details) => {
    const message = (details as { message?: string }).message ?? "";
    if (message.startsWith("[perf]")) perfLog(message.slice("[perf]".length).trim());
  });
  window.webContents.once("did-finish-load", () => perfLog("page finished loading"));
  window.webContents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) reportError("app", "The window could not load", `${description} (${code})`);
  });
  window.webContents.on("unresponsive", () => reportError("app", "The window stopped responding"));
  window.webContents.on("responsive", () => recordInfo("app", "The window responds again"));
  window.on("focus", () => window.webContents.send(IPC.mailChanged));
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  protectNavigation(window);

  if (rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

/** The unread count on the Dock icon (macOS) or launcher (where the platform has one). */
function setDockBadge(count: number): void {
  if (process.platform === "darwin") app.dock?.setBadge(count > 0 ? String(count) : "");
  else app.setBadgeCount(count);
}

/** Shows an operating-system notification; clicking it brings MiniMail to the front. */
function showNotification({ title, body, silent }: { title: string; body: string; silent: boolean }): void {
  if (!Notification.isSupported()) {
    reportError("notifications", "Notifications are not supported on this system");
    return;
  }
  recordInfo("notifications", "Showed a notification", "", { context: `${title} — ${body}` });
  const notification = new Notification({ title, body, silent });
  liveNotifications.add(notification);
  const done = (): void => void liveNotifications.delete(notification);
  notification.on("close", done);
  notification.on("failed", (_event, error) => {
    done();
    reportError("notifications", "Could not show a notification", error);
  });
  notification.on("click", () => {
    done();
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  notification.show();
}

function startPolling(): void {
  let lastRefresh = Date.now();
  const refresh = (): void => {
    lastRefresh = Date.now();
    mainWindow?.webContents.send(IPC.mailChanged);
    void notifier?.check();
  };
  // Server pushes (IMAP IDLE) refresh at once; the timer below covers the rest.
  service?.watch(refresh);
  pollTimer = setInterval(() => {
    if (!service?.allPushing() || Date.now() - lastRefresh >= SAFETY_POLL_MS) refresh();
  }, POLL_INTERVAL_MS);
}

app.setName("MiniMail");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(() => {
    perfLog("electron ready");
    initLog(app.getPath("logs"));
    const userData = app.getPath("userData");
    // The journal comes first so that everything after it, startup failures included, is recorded.
    journal = new EventJournal(join(userData, "events.jsonl"), safeStorage, {
      writeLog: writeLogLine,
      onChange: publishEvents,
    });
    installJournal(journal);
    logEvent("app", `MiniMail ${app.getVersion()} started`, "info");
    const store = new AccountStore(join(userData, "accounts.json"));
    categoryStore = new CategoryStore(join(userData, "categories.json"));
    const keys = new GatewayKeyStore(join(userData, "ai-gateway.json"), safeStorage);
    const aiSettings = new AiSettingsStore(join(userData, "ai-settings.json"));
    const categorizer = new Categorizer({
      store: categoryStore,
      keys,
      codeModel: () => aiSettings.codeModel(),
      sortFolders: () => aiSettings.sortFolders(),
      classify: createJevClassifier(() => keys.get()),
      // New answers change what the list should show, so ask the page to refresh.
      onUpdated: () => {
        mainWindow?.webContents.send(IPC.mailChanged);
        void notifier?.check(); // A message waiting for its category may be ready now.
      },
    });
    mailCache = new MailCache(join(userData, "mail-cache.json"), safeStorage);
    perfLog("stores loaded", `${store.list().length} accounts`);
    service = new MailService(
      store,
      oauthConfig,
      openExternalSafely,
      categorizer,
      mailCache,
      new InvitationAnswers(join(userData, "invitation-answers.json")),
    );
    attachmentFiles = new AttachmentFiles({
      tempRoot: join(app.getPath("temp"), "minimail-attachments"),
      openPath: (path) => shell.openPath(path),
      showInFolder: (path) => shell.showItemInFolder(path),
      chooseSavePath: async (suggestedName) => {
        const options = { defaultPath: join(app.getPath("downloads"), suggestedName) };
        const chosen = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
        return chosen.canceled || !chosen.filePath ? null : chosen.filePath;
      },
      // Marks the file as downloaded, so macOS asks before running anything that could run.
      quarantine:
        process.platform === "darwin"
          ? (path) =>
              new Promise((resolve) => {
                const stamp = `0081;${Math.floor(Date.now() / 1000).toString(16)};MiniMail;`;
                execFile("/usr/bin/xattr", ["-w", "com.apple.quarantine", stamp, path], () => resolve());
              })
          : undefined,
    });
    void attachmentFiles.cleanup(); // Files opened in an earlier session.
    const codes = new VerificationCodes({
      load: (ids) => service!.get(ids),
      fallback: () => {
        const key = keys.get();
        const model = aiSettings.codeModel();
        return key && model ? createCodeFallback(key, model) : null;
      },
    });
    logoCache = new LogoCache(join(userData, "logos.json"), safeStorage);
    const logoSettings = new LogoSettingsStore(join(userData, "logo-settings.json"));
    const finder = { fetch: safeFetch, resolveTxt: (name: string) => dns.resolveTxt(name) };
    const logos = new LogoService({
      cache: logoCache,
      settings: logoSettings,
      accountDomains: () => new Set(store.list().map((account) => senderDomain(account.email))),
      findSite: (domain) => findSiteIcon(domain, finder),
      findPerson: (email) => findGravatar(email, finder),
    });
    const notificationSettings = new NotificationSettingsStore(join(userData, "notification-settings.json"));
    notifier = new Notifier({
      settings: () => notificationSettings.get(),
      list: (folder) => service!.list({ folder, limit: 40 }),
      accountIds: () => service!.listAccounts().map((account) => account.id),
      focused: () => BrowserWindow.getFocusedWindow() !== null,
      sortingBusy: () => categorizer.state().ai.pending > 0,
      setBadge: setDockBadge,
      show: showNotification,
    });
    const drafts = new DraftStore(join(userData, "drafts.json"), safeStorage);
    delivery = new ComposeDelivery(
      join(userData, "compose-delivery.json"), safeStorage, (draft) => service!.send(draft),
      (record) => { drafts.save({ ...record, savedAt: new Date().toISOString(), sendAt: undefined }); },
      (id) => { drafts.remove(id); },
      (title, body) => showNotification({ title, body, silent: false }),
      () => {
        for (const window of BrowserWindow.getAllWindows()) window.webContents.send(IPC.draftsChanged);
        mainWindow?.webContents.send(IPC.mailChanged);
      },
    );
    registerIpc({
      service,
      attachmentFiles,
      notifier,
      notificationSettings,
      categorizer,
      aiSettings,
      codes,
      logos,
      logoSettings,
      trusted: new TrustedSenders(join(userData, "trusted-senders.json"), safeStorage),
      composeLibrary: new ComposeLibraryStore(join(userData, "compose-library.json"), safeStorage),
      drafts,
      delivery,
      prefs: new UiPrefsStore(join(userData, "ui-prefs.json")),
      journal,
      oauthConfig,
      rendererUrl,
      openExternal: openExternalSafely,
    });

    registerComposerWindows(() => mainWindow, rendererUrl, protectNavigation);
    createWindow();
    startPolling();
    delivery.start();
    // The history is read after the window is on its way, in small slices, so it never delays launch.
    setTimeout(() => void journal?.load(), 0);

    app.on("activate", () => {
      if (!mainWindow) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("render-process-gone", (_event, _contents, details) => {
    reportError("app", "A window crashed", `${details.reason} (exit code ${details.exitCode})`);
    flushJournal();
  });
  app.on("child-process-gone", (_event, details) => {
    if (details.reason !== "clean-exit") {
      reportError("app", `A ${details.type} process stopped`, `${details.reason}${details.name ? ` (${details.name})` : ""}`);
    }
  });

  app.on("will-quit", () => {
    recordInfo("app", "MiniMail quit");
    flushJournal();
    delivery?.stop();
    if (pollTimer) clearInterval(pollTimer);
    setDockBadge(0);
    categoryStore?.flush();
    mailCache?.flush();
    void attachmentFiles?.cleanup();
    logoCache?.flush();
    void service?.dispose();
  });
}

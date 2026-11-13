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
import { registerIpc } from "./ipc";
import { createJevClassifier } from "./jev";
import type { OAuthConfig } from "./oauth";
import { initLog, logEvent } from "./log";
import { perfLog } from "./perf";
import { findGravatar, findSiteIcon } from "./logos/icon-finder";
import { LogoCache } from "./logos/logo-cache";
import { LogoService } from "./logos/logo-service";
import { LogoSettingsStore } from "./logos/logo-settings";
import { safeFetch } from "./logos/net-guard";
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

/** Dev server URL injected by electron-vite; undefined in a packaged build. */
const rendererUrl = process.env["ELECTRON_RENDERER_URL"];

let mainWindow: BrowserWindow | null = null;
let service: MailService | null = null;
let categoryStore: CategoryStore | null = null;
let mailCache: MailCache | null = null;
let logoCache: LogoCache | null = null;
let pollTimer: NodeJS.Timeout | null = null;
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
  window.on("focus", () => window.webContents.send(IPC.mailChanged));
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  // Links inside the app (or in rendered emails) go to the real browser, never a new Electron window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url).catch(() => undefined);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    const isAppUrl = rendererUrl ? url.startsWith(rendererUrl) : url.startsWith("file://");
    if (!isAppUrl) {
      event.preventDefault();
      openExternalSafely(url).catch(() => undefined);
    }
  });

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
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title, body, silent });
  liveNotifications.add(notification);
  const done = (): void => void liveNotifications.delete(notification);
  notification.on("close", done);
  notification.on("failed", done);
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
    logEvent("app", `MiniMail ${app.getVersion()} started`);
    const userData = app.getPath("userData");
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
      drafts: new DraftStore(join(userData, "drafts.json"), safeStorage),
      prefs: new UiPrefsStore(join(userData, "ui-prefs.json")),
      oauthConfig,
      rendererUrl,
      openExternal: openExternalSafely,
    });

    createWindow();
    startPolling();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    if (pollTimer) clearInterval(pollTimer);
    setDockBadge(0);
    categoryStore?.flush();
    mailCache?.flush();
    void attachmentFiles?.cleanup();
    logoCache?.flush();
    void service?.dispose();
  });
}

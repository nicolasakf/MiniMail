import { join } from "node:path";

import { BrowserWindow, ipcMain } from "electron";

import { IPC } from "@shared/ipc";
import { draftIdSchema, savedDraftSchema } from "@shared/schemas";
import type { SavedDraft } from "@shared/types";

interface ComposerWindow {
  window: BrowserWindow;
  draftId: string;
  seed: SavedDraft;
  initialized: boolean;
  allowClose: boolean;
}

export function registerComposerWindows(
  mainWindow: () => BrowserWindow | null,
  rendererUrl: string | undefined,
  protectNavigation: (window: BrowserWindow) => void,
): void {
  const windows = new Map<number, ComposerWindow>();

  const focus = (draftId: string): boolean => {
    const entry = Array.from(windows.values()).find((candidate) => candidate.draftId === draftId);
    if (!entry) return false;
    if (entry.window.isMinimized()) entry.window.restore();
    entry.window.show();
    entry.window.focus();
    return true;
  };

  ipcMain.handle(IPC.composerWindowFocus, (event, id: unknown) =>
    event.sender === mainWindow()?.webContents && event.senderFrame === event.sender.mainFrame
      ? focus(draftIdSchema.parse(id))
      : false,
  );

  ipcMain.handle(IPC.composerWindowOpen, async (event, value: unknown) => {
    if (event.sender !== mainWindow()?.webContents || event.senderFrame !== event.sender.mainFrame) {
      throw new Error("Open the composer window from MiniMail.");
    }
    const draft = savedDraftSchema.parse(value);
    if (focus(draft.id)) return;

    const window = new BrowserWindow({
      title: "MiniMail Composer",
      width: 840,
      height: 690,
      minWidth: 440,
      minHeight: 380,
      show: false,
      backgroundColor: "#0a0a0a",
      webPreferences: {
        preload: join(__dirname, "../preload/index.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const id = window.webContents.id;
    const entry: ComposerWindow = { window, draftId: draft.id, seed: draft, initialized: false, allowClose: false };
    windows.set(id, entry);
    protectNavigation(window);
    window.on("close", (closeEvent) => {
      if (entry.allowClose || !entry.initialized || window.webContents.isCrashed()) return;
      closeEvent.preventDefault();
      window.webContents.send(IPC.composerWindowCloseRequested);
    });
    window.webContents.on("did-start-navigation", (details) => {
      if (details.isMainFrame && !details.isSameDocument) entry.initialized = false;
    });
    window.on("closed", () => { windows.delete(id); });
    try {
      if (rendererUrl) {
        const url = new URL(rendererUrl);
        url.searchParams.set("composer", "1");
        await window.loadURL(url.href);
      } else {
        await window.loadFile(join(__dirname, "../renderer/index.html"), { query: { composer: "1" } });
      }
      if (window.isDestroyed()) throw new Error("The composer window closed before it opened.");
      window.show();
    } catch (error) {
      if (!window.isDestroyed()) window.destroy();
      throw error;
    }
  });

  ipcMain.handle(IPC.composerWindowInitialDraft, (event) => {
    if (event.senderFrame !== event.sender.mainFrame) return null;
    const entry = windows.get(event.sender.id);
    if (!entry) return null;
    entry.initialized = true;
    return entry.seed;
  });

  ipcMain.handle(IPC.composerWindowFinish, (event) => {
    if (event.senderFrame !== event.sender.mainFrame) return;
    const entry = windows.get(event.sender.id);
    if (!entry) return;
    entry.allowClose = true;
    entry.window.close();
  });
}

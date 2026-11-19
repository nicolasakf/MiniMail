import { contextBridge, ipcRenderer } from "electron";

import type { MiniMailApi } from "@shared/api";
import { IPC } from "@shared/ipc";

/**
 * Electron prefixes errors thrown in handlers with "Error invoking remote method ...".
 * Strip it (and zod's JSON dump for validation errors) so the UI can show the real message.
 */
function cleanError(error: unknown): Error {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
  return new Error(message);
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T;
  } catch (error) {
    throw cleanError(error);
  }
}

const api: MiniMailApi = {
  accounts: {
    list: () => invoke(IPC.accountsList),
    discover: (email) => invoke(IPC.accountsDiscover, email),
    discoverImap: (email) => invoke(IPC.accountsDiscoverImap, email),
    add: (input) => invoke(IPC.accountsAdd, input),
    reconnect: (accountId, calendarAccess) => invoke(IPC.accountsReconnect, accountId, calendarAccess),
    remove: (accountId) => invoke(IPC.accountsRemove, accountId),
    setAlias: (accountId, alias) => invoke(IPC.accountsSetAlias, accountId, alias),
    setAvatar: (accountId, avatar) => invoke(IPC.accountsSetAvatar, accountId, avatar),
    capabilities: () => invoke(IPC.accountsCapabilities),
  },
  mail: {
    list: (query) => invoke(IPC.mailList, query),
    get: (ids) => invoke(IPC.mailGet, ids),
    act: (action, ids) => invoke(IPC.mailAct, action, ids),
    unsubscribe: (ids) => invoke(IPC.mailUnsubscribe, ids),
    send: (draft) => invoke(IPC.mailSend, draft),
    contacts: () => invoke(IPC.mailContacts),
    openAttachment: (messageId, attachmentId) => invoke(IPC.mailOpenAttachment, messageId, attachmentId),
    saveAttachment: (messageId, attachmentId) => invoke(IPC.mailSaveAttachment, messageId, attachmentId),
    attachmentContent: (messageId, attachmentId) => invoke(IPC.mailAttachmentContent, messageId, attachmentId),
    respondToInvitation: (messageId, response) => invoke(IPC.mailRespond, messageId, response),
    verificationCodes: (ids) => invoke(IPC.mailVerificationCodes, ids),
    onChanged: (listener) => {
      const handler = () => listener();
      ipcRenderer.on(IPC.mailChanged, handler);
      return () => ipcRenderer.removeListener(IPC.mailChanged, handler);
    },
    onOpenConversation: (listener) => {
      const handler = (_event: unknown, request: Parameters<typeof listener>[0]) => listener(request);
      ipcRenderer.on(IPC.mailOpenConversation, handler);
      return () => ipcRenderer.removeListener(IPC.mailOpenConversation, handler);
    },
  },
  categories: {
    get: () => invoke(IPC.categoriesGet),
    save: (categories) => invoke(IPC.categoriesSave, categories),
    setGatewayKey: (key) => invoke(IPC.categoriesSetKey, key),
    clearGatewayKey: () => invoke(IPC.categoriesClearKey),
    setCodeModel: (model) => invoke(IPC.categoriesSetCodeModel, model),
    setSortFolders: (folders) => invoke(IPC.categoriesSetSortFolders, folders),
    testGateway: () => invoke(IPC.categoriesTest),
    reclassify: (options) => invoke(IPC.categoriesReclassify, options),
    sortCounts: (options) => invoke(IPC.categoriesSortCounts, options),
    assign: (threads, categoryId, ref) => invoke(IPC.categoriesAssign, { threads, categoryId, ref }),
  },
  senders: {
    trusted: () => invoke(IPC.sendersTrusted),
    trust: (email) => invoke(IPC.sendersTrust, email),
    untrust: (email) => invoke(IPC.sendersUntrust, email),
  },
  composeLibrary: {
    get: () => invoke(IPC.composeLibraryGet),
    set: (value) => invoke(IPC.composeLibrarySet, value),
  },
  delivery: {
    list: () => invoke(IPC.deliveryList),
    schedule: (record, draft, sendAt) => invoke(IPC.deliverySchedule, record, draft, sendAt),
    cancel: (id) => invoke(IPC.deliveryCancel, id),
  },
  composerWindow: {
    open: (draft) => invoke(IPC.composerWindowOpen, draft),
    focus: (id) => invoke(IPC.composerWindowFocus, id),
    initialDraft: () => invoke(IPC.composerWindowInitialDraft),
    finish: () => invoke(IPC.composerWindowFinish),
    onCloseRequested: (listener) => {
      const handler = () => listener();
      ipcRenderer.on(IPC.composerWindowCloseRequested, handler);
      return () => ipcRenderer.removeListener(IPC.composerWindowCloseRequested, handler);
    },
  },
  drafts: {
    onChanged: (listener) => {
      const handler = () => listener();
      ipcRenderer.on(IPC.draftsChanged, handler);
      return () => ipcRenderer.removeListener(IPC.draftsChanged, handler);
    },
    list: () => invoke(IPC.draftsList),
    save: (draft) => invoke(IPC.draftsSave, draft),
    remove: (id) => invoke(IPC.draftsDelete, id),
  },
  prefs: {
    get: () => invoke(IPC.prefsGet),
    set: (patch) => invoke(IPC.prefsSet, patch),
  },
  logos: {
    get: (requests) => invoke(IPC.logosGet, requests),
    settings: () => invoke(IPC.logosSettings),
    setSettings: (settings) => invoke(IPC.logosSetSettings, settings),
  },
  notifications: {
    settings: () => invoke(IPC.notificationsGet),
    setSettings: (settings) => invoke(IPC.notificationsSet, settings),
    test: () => invoke(IPC.notificationsTest),
  },
  events: {
    list: () => invoke(IPC.eventsList),
    markDone: () => invoke(IPC.eventsMarkDone),
    openLog: () => invoke(IPC.eventsOpenLog),
    // One-way on purpose: nothing waits for the journal, and reporting can never fail the caller.
    report: (report) => {
      try {
        ipcRenderer.send(IPC.eventsReport, report);
      } catch {
        // expected: the report could not even be sent; there is nowhere left to tell.
      }
    },
    onChanged: (listener) => {
      const handler = (_event: unknown, events: Parameters<typeof listener>[0]) => listener(events);
      ipcRenderer.on(IPC.eventsChanged, handler);
      return () => ipcRenderer.removeListener(IPC.eventsChanged, handler);
    },
  },
  system: {
    openExternal: (url) => invoke(IPC.openExternal, url),
    platform: process.platform,
    demo: false,
  },
};

contextBridge.exposeInMainWorld("minimail", api);

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
    add: (input) => invoke(IPC.accountsAdd, input),
    remove: (accountId) => invoke(IPC.accountsRemove, accountId),
    setAlias: (accountId, alias) => invoke(IPC.accountsSetAlias, accountId, alias),
    setAvatar: (accountId, avatar) => invoke(IPC.accountsSetAvatar, accountId, avatar),
    capabilities: () => invoke(IPC.accountsCapabilities),
  },
  mail: {
    list: (query) => invoke(IPC.mailList, query),
    get: (ids) => invoke(IPC.mailGet, ids),
    act: (action, ids) => invoke(IPC.mailAct, action, ids),
    send: (draft) => invoke(IPC.mailSend, draft),
    contacts: () => invoke(IPC.mailContacts),
    openAttachment: (messageId, attachmentId) => invoke(IPC.mailOpenAttachment, messageId, attachmentId),
    saveAttachment: (messageId, attachmentId) => invoke(IPC.mailSaveAttachment, messageId, attachmentId),
    respondToInvitation: (messageId, response) => invoke(IPC.mailRespond, messageId, response),
    verificationCodes: (ids) => invoke(IPC.mailVerificationCodes, ids),
    onChanged: (listener) => {
      const handler = () => listener();
      ipcRenderer.on(IPC.mailChanged, handler);
      return () => ipcRenderer.removeListener(IPC.mailChanged, handler);
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
    assign: (threads, categoryId) => invoke(IPC.categoriesAssign, { threads, categoryId }),
  },
  senders: {
    trusted: () => invoke(IPC.sendersTrusted),
    trust: (email) => invoke(IPC.sendersTrust, email),
    untrust: (email) => invoke(IPC.sendersUntrust, email),
  },
  drafts: {
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
  system: {
    openExternal: (url) => invoke(IPC.openExternal, url),
    platform: process.platform,
    demo: false,
  },
};

contextBridge.exposeInMainWorld("minimail", api);

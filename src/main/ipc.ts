import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import { z } from "zod";

import { composeLibrarySchema } from "@shared/compose-library";
import { IPC } from "@shared/ipc";
import {
  actionSchema,
  accountEmailSchema,
  addAccountSchema,
  aliasSchema,
  avatarSchema,
  assignCategorySchema,
  categoryListSchema,
  codeIdsSchema,
  codeModelSchema,
  sortModelSchema,
  testModelSchema,
  sortFoldersSchema,
  draftIdSchema,
  draftSchema,
  gatewayKeySchema,
  reclassifySchema,
  idsSchema,
  invitationResponseSchema,
  attachmentRefSchema,
  listQuerySchema,
  logoRequestsSchema,
  logoSettingsSchema,
  notificationSettingsSchema,
  savedDraftSchema,
  eventReportSchema,
  uiPrefsPatchSchema,
} from "@shared/schemas";
import { MOVE_DESTINATION } from "@shared/threads";
import type { AppEvent } from "@shared/events";
import type { MailAction } from "@shared/types";

import type { AiSettingsStore } from "./ai-settings";
import { discoverAccountProvider, discoverImapSettings } from "./account-discovery";
import type { AttachmentFiles } from "./attachment-files";
import type { Categorizer } from "./categorizer";
import type { EventJournal } from "./event-journal";
import { recordAction, reportError } from "./events";
import { doneTitle, ipcArea, reportIpcFailure } from "./ipc-events";
import type { ComposeDelivery } from "./compose-delivery";
import type { ComposeLibraryStore } from "./compose-library";
import type { DraftStore } from "./draft-store";
import type { UiPrefsStore } from "./ui-prefs";
import type { VerificationCodes } from "./verification-codes";
import type { LogoService } from "./logos/logo-service";
import type { LogoSettingsStore } from "./logos/logo-settings";
import type { NotificationSettingsStore } from "./notification-settings";
import type { Notifier } from "./notifier";
import type { TrustedSenders } from "./trusted-senders";
import { oauthCapabilities, type OAuthConfig } from "./oauth";
import type { MailService } from "./service";

/** Only our own renderer (dev server or packaged file) may call privileged handlers. */
function assertTrustedSender(event: IpcMainInvokeEvent, rendererUrl: string | undefined): void {
  const url = event.senderFrame?.url ?? "";
  const trusted = url.startsWith("file://") || (rendererUrl ? url.startsWith(rendererUrl) : false);
  if (!trusted) throw new Error("Blocked IPC call from an untrusted frame.");
}

/** Wires every renderer request to the mail service, validating inputs with zod. */
const senderEmail = z.string().email().max(320);

export function registerIpc(options: {
  service: MailService;
  attachmentFiles: AttachmentFiles;
  notifier: Notifier;
  notificationSettings: NotificationSettingsStore;
  categorizer: Categorizer;
  aiSettings: AiSettingsStore;
  codes: VerificationCodes;
  logos: LogoService;
  logoSettings: LogoSettingsStore;
  trusted: TrustedSenders;
  delivery: ComposeDelivery;
  composeLibrary: ComposeLibraryStore;
  drafts: DraftStore;
  prefs: UiPrefsStore;
  journal: EventJournal;
  oauthConfig: OAuthConfig;
  rendererUrl: string | undefined;
  openExternal: (url: string) => Promise<void>;
  openLog: () => Promise<void>;
}): void {
  const { service, attachmentFiles, notifier, notificationSettings, categorizer, aiSettings, codes, logos, logoSettings, trusted, delivery, composeLibrary, drafts, prefs, journal, oauthConfig, rendererUrl, openExternal, openLog } = options;

  /**
   * Registers a handler. Whatever it throws is recorded (so no failure goes unseen, even one nobody
   * wrote a catch for) and then rethrown unchanged; what the user changed is recorded too. Both
   * only append to memory, after the work is done, so they never slow an answer down.
   */
  const handle = <Args extends unknown[], Result>(
    channel: string,
    run: (...args: Args) => Promise<Result> | Result,
  ) => {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        assertTrustedSender(event, rendererUrl);
        const result = await run(...(args as Args));
        const done = doneTitle(channel);
        if (done) recordAction(ipcArea(channel), done);
        return result;
      } catch (error) {
        reportIpcFailure(channel, error);
        throw error;
      }
    });
  };

  handle(IPC.accountsList, () => service.listAccounts());
  handle(IPC.accountsDiscover, (email: unknown) => discoverAccountProvider(accountEmailSchema.parse(email)));
  handle(IPC.accountsDiscoverImap, (email: unknown) => discoverImapSettings(accountEmailSchema.parse(email)));
  handle(IPC.accountsAdd, (input: unknown) => service.addAccount(addAccountSchema.parse(input)));
  handle(IPC.accountsReconnect, (accountId: unknown, calendarAccess: unknown) =>
    service.reconnectAccount(z.string().parse(accountId), z.boolean().default(false).parse(calendarAccess)),
  );
  handle(IPC.accountsRemove, (accountId: unknown) => service.removeAccount(z.string().parse(accountId)));
  handle(IPC.accountsSetAlias, (accountId: unknown, alias: unknown) =>
    service.setAlias(z.string().parse(accountId), aliasSchema.parse(alias)),
  );
  handle(IPC.accountsSetAvatar, (accountId: unknown, avatar: unknown) =>
    service.setAvatar(z.string().parse(accountId), avatarSchema.parse(avatar)),
  );
  handle(IPC.accountsCapabilities, () => oauthCapabilities(oauthConfig));

  handle(IPC.mailList, (query: unknown) => service.list(listQuerySchema.parse(query)));
  handle(IPC.mailGet, (ids: unknown) => service.get(idsSchema.parse(ids)));
  handle(IPC.mailAct, async (action: unknown, ids: unknown) => {
    const parsed = actionSchema.parse(action) as MailAction;
    const targets = idsSchema.parse(ids);
    const results = await service.act(parsed, targets);
    if (MOVE_DESTINATION[parsed] && results.some((result) => result.status === "applied")) notifier.userMoved();
    return results;
  });
  handle(IPC.mailUnsubscribe, (ids: unknown) => service.unsubscribe(idsSchema.parse(ids)));
  handle(IPC.mailSend, (draft: unknown) => service.send(draftSchema.parse(draft)));
  handle(IPC.deliveryList, () => delivery.list());
  handle(IPC.deliverySchedule, (record: unknown, draft: unknown, when: unknown) => {
    delivery.schedule(savedDraftSchema.parse(record), draftSchema.parse(draft), z.number().int().positive().parse(when));
  });
  handle(IPC.deliveryCancel, (id: unknown) => delivery.cancel(draftIdSchema.parse(id)));
  handle(IPC.mailOpenAttachment, (messageId: unknown, attachmentId: unknown) => {
    const ref = attachmentRefSchema.parse({ messageId, attachmentId });
    return service.attachment(ref.messageId, ref.attachmentId).then((file) => attachmentFiles.open(file));
  });
  handle(IPC.mailSaveAttachment, (messageId: unknown, attachmentId: unknown) => {
    const ref = attachmentRefSchema.parse({ messageId, attachmentId });
    return service.attachment(ref.messageId, ref.attachmentId).then((file) => attachmentFiles.save(file));
  });
  handle(IPC.mailAttachmentContent, async (messageId: unknown, attachmentId: unknown) => {
    const ref = attachmentRefSchema.parse({ messageId, attachmentId });
    const file = await service.attachment(ref.messageId, ref.attachmentId);
    return { filename: file.filename, contentType: file.contentType, contentBase64: file.data.toString("base64") };
  });
  handle(IPC.mailRespond, (messageId: unknown, response: unknown) =>
    service.respondToInvitation(z.string().min(1).parse(messageId), invitationResponseSchema.parse(response)),
  );
  handle(IPC.mailContacts, () => service.contacts());
  handle(IPC.mailVerificationCodes, (ids: unknown) => codes.get(codeIdsSchema.parse(ids)));
  handle(IPC.categoriesGet, () => categorizer.state());
  handle(IPC.categoriesSave, (categories: unknown) =>
    categorizer.saveCategories(categoryListSchema.parse(categories)),
  );
  handle(IPC.categoriesSetKey, (key: unknown) => categorizer.setKey(gatewayKeySchema.parse(key)));
  handle(IPC.categoriesClearKey, () => categorizer.clearKey());
  handle(IPC.categoriesSetCodeModel, (model: unknown) => {
    aiSettings.setCodeModel(codeModelSchema.parse(model));
    return categorizer.state();
  });
  handle(IPC.categoriesSetSortModel, (model: unknown) => {
    aiSettings.setSortModel(sortModelSchema.parse(model));
    return categorizer.state();
  });
  handle(IPC.categoriesSetSortFolders, (folders: unknown) => {
    aiSettings.setSortFolders(sortFoldersSchema.parse(folders));
    return categorizer.state();
  });
  handle(IPC.categoriesTest, (request: unknown) => {
    const { purpose, model } = testModelSchema.parse(request);
    return categorizer.testModel(purpose, model);
  });
  handle(IPC.categoriesReclassify, (options: unknown) => {
    const parsed = reclassifySchema.parse(options);
    const folders = parsed?.folders ?? ["inbox"];
    categorizer.reclassify(parsed?.since === undefined ? null : Date.parse(parsed.since), folders);
    void service.sortFolders(folders);
  });
  handle(IPC.categoriesSortCounts, (options: unknown) => {
    const since = reclassifySchema.parse(options)?.since;
    return service.sortCounts(since === undefined ? null : Date.parse(since));
  });
  handle(IPC.categoriesAssign, (request: unknown) => {
    const { threads, categoryId, ref } = assignCategorySchema.parse(request);
    categorizer.assign(threads, categoryId);
    const name = categorizer.state().categories.find((category) => category.id === categoryId)?.name;
    const count = threads.length === 1 ? "a conversation" : `${threads.length} conversations`;
    recordAction("categories", name ? `Moved ${count} to ${name}` : `Took ${count} out of any category`, "", { ref });
  });
  handle(IPC.sendersTrusted, () => trusted.list());
  handle(IPC.sendersTrust, (email: unknown) => trusted.add(senderEmail.parse(email)));
  handle(IPC.sendersUntrust, (email: unknown) => trusted.remove(senderEmail.parse(email)));
  handle(IPC.composeLibraryGet, () => composeLibrary.get());
  handle(IPC.composeLibrarySet, (value: unknown) => composeLibrary.set(composeLibrarySchema.parse(value)));
  handle(IPC.draftsList, () => drafts.list());
  const publishDrafts = () => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(IPC.draftsChanged);
  };
  handle(IPC.draftsSave, (draft: unknown) => {
    const list = drafts.save(savedDraftSchema.parse(draft));
    publishDrafts();
    return list;
  });
  handle(IPC.draftsDelete, (id: unknown) => {
    const list = drafts.remove(draftIdSchema.parse(id));
    publishDrafts();
    return list;
  });
  handle(IPC.prefsGet, () => prefs.get());
  handle(IPC.prefsSet, (patch: unknown) => prefs.set(uiPrefsPatchSchema.parse(patch)));
  handle(IPC.logosGet, (requests: unknown) => logos.get(logoRequestsSchema.parse(requests)));
  handle(IPC.logosSettings, () => logoSettings.get());
  handle(IPC.logosSetSettings, (settings: unknown) => logoSettings.set(logoSettingsSchema.parse(settings)));
  handle(IPC.notificationsGet, () => notificationSettings.get());
  handle(IPC.notificationsSet, (settings: unknown) => {
    const saved = notificationSettings.set(notificationSettingsSchema.parse(settings));
    void notifier.check(true); // The Dock badge and what counts as new follow the change at once.
    return saved;
  });
  handle(IPC.notificationsTest, () => notifier.test());
  handle(IPC.openExternal, (url: unknown) => openExternal(z.string().parse(url)));

  handle(IPC.eventsList, () => journal.list());
  handle(IPC.eventsMarkDone, () => journal.markErrorsDone());
  handle(IPC.eventsOpenLog, () => openLog());
  // One-way: the page reports and moves on. A malformed report is itself worth knowing about.
  ipcMain.on(IPC.eventsReport, (event, report: unknown) => {
    try {
      assertTrustedSender(event as unknown as IpcMainInvokeEvent, rendererUrl);
      journal.record(eventReportSchema.parse(report));
    } catch (error) {
      reportError("events", "Could not record an event from the page", error);
    }
  });
}

/** Sends changed events to every window; used as the journal's `onChange`. */
export function publishEvents(changed: AppEvent[]): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(IPC.eventsChanged, changed);
}

import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { z } from "zod";

import { IPC } from "@shared/ipc";
import {
  actionSchema,
  addAccountSchema,
  aliasSchema,
  avatarSchema,
  categoryListSchema,
  codeIdsSchema,
  codeModelSchema,
  sortFoldersSchema,
  draftIdSchema,
  draftSchema,
  gatewayKeySchema,
  reclassifySchema,
  idsSchema,
  listQuerySchema,
  logoRequestsSchema,
  logoSettingsSchema,
  savedDraftSchema,
  uiPrefsPatchSchema,
} from "@shared/schemas";
import type { MailAction } from "@shared/types";

import type { AiSettingsStore } from "./ai-settings";
import type { Categorizer } from "./categorizer";
import type { DraftStore } from "./draft-store";
import type { UiPrefsStore } from "./ui-prefs";
import type { VerificationCodes } from "./verification-codes";
import type { LogoService } from "./logos/logo-service";
import type { LogoSettingsStore } from "./logos/logo-settings";
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
  categorizer: Categorizer;
  aiSettings: AiSettingsStore;
  codes: VerificationCodes;
  logos: LogoService;
  logoSettings: LogoSettingsStore;
  trusted: TrustedSenders;
  drafts: DraftStore;
  prefs: UiPrefsStore;
  oauthConfig: OAuthConfig;
  rendererUrl: string | undefined;
  openExternal: (url: string) => Promise<void>;
}): void {
  const { service, categorizer, aiSettings, codes, logos, logoSettings, trusted, drafts, prefs, oauthConfig, rendererUrl, openExternal } = options;

  const handle = <Args extends unknown[], Result>(
    channel: string,
    run: (...args: Args) => Promise<Result> | Result,
  ) => {
    ipcMain.handle(channel, async (event, ...args) => {
      assertTrustedSender(event, rendererUrl);
      return run(...(args as Args));
    });
  };

  handle(IPC.accountsList, () => service.listAccounts());
  handle(IPC.accountsAdd, (input: unknown) => service.addAccount(addAccountSchema.parse(input)));
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
  handle(IPC.mailAct, (action: unknown, ids: unknown) =>
    service.act(actionSchema.parse(action) as MailAction, idsSchema.parse(ids)),
  );
  handle(IPC.mailSend, (draft: unknown) => service.send(draftSchema.parse(draft)));
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
  handle(IPC.categoriesSetSortFolders, (folders: unknown) => {
    aiSettings.setSortFolders(sortFoldersSchema.parse(folders));
    return categorizer.state();
  });
  handle(IPC.categoriesTest, () => categorizer.test());
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
  handle(IPC.sendersTrusted, () => trusted.list());
  handle(IPC.sendersTrust, (email: unknown) => trusted.add(senderEmail.parse(email)));
  handle(IPC.sendersUntrust, (email: unknown) => trusted.remove(senderEmail.parse(email)));
  handle(IPC.draftsList, () => drafts.list());
  handle(IPC.draftsSave, (draft: unknown) => drafts.save(savedDraftSchema.parse(draft)));
  handle(IPC.draftsDelete, (id: unknown) => drafts.remove(draftIdSchema.parse(id)));
  handle(IPC.prefsGet, () => prefs.get());
  handle(IPC.prefsSet, (patch: unknown) => prefs.set(uiPrefsPatchSchema.parse(patch)));
  handle(IPC.logosGet, (requests: unknown) => logos.get(logoRequestsSchema.parse(requests)));
  handle(IPC.logosSettings, () => logoSettings.get());
  handle(IPC.logosSetSettings, (settings: unknown) => logoSettings.set(logoSettingsSchema.parse(settings)));
  handle(IPC.openExternal, (url: unknown) => openExternal(z.string().parse(url)));
}

import { IPC } from "@shared/ipc";

import { reportError, wasReported } from "./events";

/**
 * What each IPC channel is called when it fails or succeeds, in words for the notifications
 * popover. The IPC wrapper records every handler that throws, so a failure nobody wrote a catch
 * for still shows up; a channel missing here falls back to its name.
 */
const FAILED: Record<string, string> = {
  [IPC.accountsList]: "Could not list the accounts",
  [IPC.accountsDiscover]: "Could not detect the account provider",
  [IPC.accountsDiscoverImap]: "Could not detect the mail server settings",
  [IPC.accountsAdd]: "Could not add the account",
  [IPC.accountsReconnect]: "Could not reconnect the account",
  [IPC.accountsRemove]: "Could not remove the account",
  [IPC.accountsSetAlias]: "Could not rename the account",
  [IPC.accountsSetAvatar]: "Could not change the account picture",
  [IPC.accountsCapabilities]: "Could not read the sign-in options",
  [IPC.mailList]: "Could not load mail",
  [IPC.mailGet]: "Could not open the message",
  [IPC.mailAct]: "Could not update the messages",
  [IPC.mailUnsubscribe]: "Could not unsubscribe",
  [IPC.mailSend]: "Could not send the message",
  [IPC.mailContacts]: "Could not load contacts",
  [IPC.mailOpenAttachment]: "Could not open the attachment",
  [IPC.mailSaveAttachment]: "Could not save the attachment",
  [IPC.mailAttachmentContent]: "Could not read the attachment",
  [IPC.mailRespond]: "Could not answer the invitation",
  [IPC.mailVerificationCodes]: "Could not read verification codes",
  [IPC.categoriesGet]: "Could not read the categories",
  [IPC.categoriesSave]: "Could not save the categories",
  [IPC.categoriesSetKey]: "Could not save the AI key",
  [IPC.categoriesClearKey]: "Could not remove the AI key",
  [IPC.categoriesSetSortProvider]: "Could not change where mail is sorted",
  [IPC.categoriesSetCodeProvider]: "Could not change the provider for AI-enabled features",
  [IPC.categoriesSetCodeModel]: "Could not change the model for AI-enabled features",
  [IPC.categoriesSetSortModel]: "Could not change the sorting model",
  [IPC.categoriesSetSortFolders]: "Could not change which folders are sorted",
  [IPC.categoriesTest]: "The AI model test failed",
  [IPC.categoriesReclassify]: "Could not start sorting again",
  [IPC.categoriesSortCounts]: "Could not count the mail to sort",
  [IPC.categoriesAssign]: "Could not move the conversations to the category",
  [IPC.sendersTrusted]: "Could not read trusted senders",
  [IPC.sendersTrust]: "Could not trust the sender",
  [IPC.sendersUntrust]: "Could not stop trusting the sender",
  [IPC.logosGet]: "Could not load sender logos",
  [IPC.logosSettings]: "Could not read the logo settings",
  [IPC.logosSetSettings]: "Could not change the logo settings",
  [IPC.composeLibraryGet]: "Could not read signatures and templates",
  [IPC.composeLibrarySet]: "Could not save signatures and templates",
  [IPC.deliveryList]: "Could not list scheduled messages",
  [IPC.deliverySchedule]: "Could not schedule the message",
  [IPC.deliveryCancel]: "Could not cancel the scheduled message",
  [IPC.composerWindowOpen]: "Could not open the composer window",
  [IPC.composerWindowFocus]: "Could not focus the composer window",
  [IPC.composerWindowInitialDraft]: "Could not load the draft into the composer",
  [IPC.composerWindowFinish]: "Could not close the composer window",
  [IPC.draftsList]: "Could not list drafts",
  [IPC.draftsSave]: "Could not save the draft",
  [IPC.draftsDelete]: "Could not delete the draft",
  [IPC.prefsGet]: "Could not read the saved view",
  [IPC.prefsSet]: "Could not save the view",
  [IPC.notificationsGet]: "Could not read the notification settings",
  [IPC.notificationsSet]: "Could not save the notification settings",
  [IPC.notificationsTest]: "Could not show a test notification",
  [IPC.openExternal]: "Could not open the link",
  [IPC.eventsList]: "Could not read the event history",
  [IPC.eventsMarkDone]: "Could not mark the errors as done",
  [IPC.eventsOpenLog]: "Could not open the log file",
};

/**
 * Channels that change something the user chose to change. Reading and background traffic is left
 * out on purpose (it would bury everything else). Some are recorded elsewhere, where more is known:
 * `mail:act` by the page, `mail:send` and `mail:unsubscribe` by the service, `categories:assign` by its handler.
 */
const DONE: Record<string, string> = {
  [IPC.accountsAdd]: "Added an account",
  [IPC.accountsReconnect]: "Reconnected an account",
  [IPC.accountsRemove]: "Removed an account",
  [IPC.accountsSetAlias]: "Renamed an account",
  [IPC.accountsSetAvatar]: "Changed an account picture",
  [IPC.mailOpenAttachment]: "Opened an attachment",
  [IPC.mailSaveAttachment]: "Saved an attachment",
  [IPC.mailRespond]: "Answered an invitation",
  [IPC.categoriesSave]: "Changed the categories",
  [IPC.categoriesSetKey]: "Saved the AI key",
  [IPC.categoriesClearKey]: "Removed the AI key",
  [IPC.categoriesSetSortProvider]: "Changed where mail is sorted",
  [IPC.categoriesSetCodeProvider]: "Changed the provider for AI-enabled features",
  [IPC.categoriesSetCodeModel]: "Changed the model for AI-enabled features",
  [IPC.categoriesSetSortModel]: "Changed the sorting model",
  [IPC.categoriesSetSortFolders]: "Changed which folders are sorted",
  [IPC.categoriesTest]: "Tested an AI model",
  [IPC.categoriesReclassify]: "Started sorting mail again",
  [IPC.sendersTrust]: "Trusted a sender",
  [IPC.sendersUntrust]: "Stopped trusting a sender",
  [IPC.logosSetSettings]: "Changed the logo settings",
  [IPC.deliverySchedule]: "Scheduled a message",
  [IPC.deliveryCancel]: "Cancelled a scheduled message",
  [IPC.draftsDelete]: "Deleted a draft",
  [IPC.notificationsSet]: "Changed the notification settings",
  [IPC.notificationsTest]: "Showed a test notification",
  [IPC.openExternal]: "Opened a link",
};

/** The part of the channel name before the colon: `mail`, `categories`, `accounts`... */
export function ipcArea(channel: string): string {
  return channel.split(":")[0] ?? channel;
}

export function failureTitle(channel: string): string {
  return FAILED[channel] ?? `Could not complete ${channel}`;
}

/** Null for channels that are not user actions. */
export function doneTitle(channel: string): string | null {
  return DONE[channel] ?? null;
}

/** Records a handler that threw, unless the code that threw it already did. */
export function reportIpcFailure(channel: string, error: unknown): void {
  if (!wasReported(error)) reportError(ipcArea(channel), failureTitle(channel), error);
}

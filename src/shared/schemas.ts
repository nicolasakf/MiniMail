import { z } from "zod";

import { MAX_EVENT_CONTEXT, MAX_EVENT_DETAIL, MAX_EVENT_TITLE } from "./events";

import { MAX_ALIAS_LENGTH, MAX_AVATAR_BYTES, normalizeAlias } from "./accounts";
import type { LogoRequest, LogoSettings } from "./logos";
import {
  MAX_LOOKBACK_DAYS,
  MAX_MEGABYTES,
  MIN_LOOKBACK_DAYS,
  MIN_MEGABYTES,
  OFFLINE_FOLDERS,
  OFFLINE_LIMITS,
  type OfflineSettings,
} from "./offline";
import {
  MAX_MUTED_SENDERS,
  MAX_MUTED_THREADS,
  MAX_NOTIFICATION_IDS,
  NOTIFY_FOLDERS,
  type NotificationSettings,
} from "./notifications";
import { MAIL_WINDOW } from "./mail-window";
import { ASK_MODES, CLI_COMMAND_IDS, MAX_ALLOWED_RECIPIENTS, normalizeAllowedRecipient, SKILL_TARGET_IDS, type CliSettings } from "./cli";
import type { PageReply } from "./cli-page";
import { imapSettingsSchema } from "./imap-settings";
import {
  categoryProblems,
  MAX_CATEGORIES,
  MAX_CRITERIA_LENGTH,
  MAX_NAME_LENGTH,
  MIN_CRITERIA_LENGTH,
} from "./categories";
import { MODEL_PURPOSES, SORT_MODEL_PATTERN } from "./ai-models";
import { AI_PROVIDERS, CHAT_PROVIDERS } from "./ai-providers";
import { COMPLETION_LENGTHS, COMPLETION_LIMITS } from "./completion";
import { CODE_MODEL_PATTERN } from "./verification-code";
import { MAX_ATTACHMENT_BYTES, MAX_DRAFT_ATTACHMENTS, SORT_FOLDERS } from "./types";
import type { AddAccountInput, Category, Draft, ListQuery, MailView, SavedDraft, UiPrefs } from "./types";
import { parseBlockList } from "./blocklist";
import { parsePriorityList } from "./priority";
import {
  COLOR_MODES,
  MAX_MINIMIZED_CATEGORIES,
  MAX_PINNED_DOMAINS,
  parseAppearanceValues,
  parseStringList,
  type LegacyPrefs,
} from "./prefs";
import { parseUnsubscribedLists } from "./unsubscribe";

/**
 * Validation for everything the renderer sends to the main process. The renderer is
 * our own code, but IPC is a trust boundary: a compromised page must not be able to
 * send arbitrary shapes to code that touches credentials and the network.
 */

export const folderSchema = z.enum(["inbox", "pinned", "drafts", "sent", "archive", "spam", "trash"]);

export const actionSchema = z.enum([
  "archive",
  "unarchive",
  "trash",
  "spam",
  "markRead",
  "markUnread",
  "pin",
  "unpin",
  "deleteForever",
]);

export const contactSchema = z.object({ name: z.string(), email: z.string().email() });

/** An account alias. Blank is allowed and means "no alias". */
export const aliasSchema = z
  .string()
  .max(MAX_ALIAS_LENGTH * 2, `Use at most ${MAX_ALIAS_LENGTH} characters.`)
  .refine((value) => (normalizeAlias(value) ?? "").length <= MAX_ALIAS_LENGTH, {
    message: `Use at most ${MAX_ALIAS_LENGTH} characters.`,
  });

/** A picture for an account: a PNG, JPEG or WebP `data:` URL (or null to remove it). */
export const avatarSchema = z
  .string()
  .max(Math.ceil((MAX_AVATAR_BYTES * 4) / 3) + 64)
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/, "Choose a PNG, JPEG or WebP picture.")
  .nullable();

export const accountEmailSchema = z.string().trim().email("Enter a valid email address.").max(320);

export const microsoftTenantSchema = z.string().trim().max(253).regex(
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i,
  "Enter an organization domain or tenant ID.",
);

export const addAccountSchema: z.ZodType<AddAccountInput> = z.union([
  z.object({
    kind: z.literal("password"),
    provider: z.literal("imap"),
    email: accountEmailSchema,
    password: z.string().min(1),
    imapSettings: imapSettingsSchema,
    alias: aliasSchema.optional(),
  }),
  z.object({
    kind: z.literal("password"),
    provider: z.enum(["zoho", "gmail"]),
    email: accountEmailSchema,
    password: z.string().min(1),
    displayName: z.string().optional(),
    alias: aliasSchema.optional(),
    zohoRegion: z.enum(["com", "eu", "in", "com.au", "jp"]).optional(),
    zohoWorkplace: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("oauth"),
    provider: z.literal("gmail"),
    email: accountEmailSchema.optional(),
    alias: aliasSchema.optional(),
  }),
  z.object({
    kind: z.literal("oauth"),
    provider: z.literal("outlook"),
    outlookKind: z.enum(["personal", "work-school"]).optional(),
    tenant: microsoftTenantSchema.optional(),
    email: accountEmailSchema.optional(),
    alias: aliasSchema.optional(),
  }),
]);

export const invitationResponseSchema = z.enum(["accepted", "tentative", "declined"]);

export const attachmentRefSchema = z.object({
  messageId: z.string().min(1),
  attachmentId: z.string().min(1).max(2048),
});

export const listQuerySchema: z.ZodType<ListQuery> = z.object({
  accountIds: z.array(z.string()).optional(),
  folder: folderSchema,
  limit: z.number().int().min(1).max(MAIL_WINDOW).optional(),
  cacheOnly: z.boolean().optional(),
  changes: z.boolean().optional(),
});

const MAX_DRAFT_TEXT = 2_000_000;
const draftFilesSchema = z.array(z.object({
  filename: z.string().min(1),
  contentType: z.string(),
  contentBase64: z.string(),
  contentId: z.string().regex(/^[a-z0-9-]+@minimail\.local$/).optional(),
})).max(MAX_DRAFT_ATTACHMENTS).refine(
  (files) => files.reduce((sum, file) => sum + Math.floor(file.contentBase64.length * 3 / 4)
    - (file.contentBase64.endsWith("==") ? 2 : file.contentBase64.endsWith("=") ? 1 : 0), 0) <= MAX_ATTACHMENT_BYTES,
  "Attachments exceed the total size limit.",
);

export const draftSchema: z.ZodType<Draft> = z.object({
  accountId: z.string(),
  to: z.array(contactSchema).min(1, "Add at least one recipient."),
  cc: z.array(contactSchema),
  bcc: z.array(contactSchema),
  subject: z.string(),
  text: z.string(),
  html: z.string().optional(),
  attachments: draftFilesSchema.optional(),
  inReplyTo: z
    .object({
      messageId: z.string(),
      nativeId: z.string(),
      references: z.array(z.string()),
      mode: z.enum(["reply", "replyAll", "forward"]),
    })
    .optional(),
});

export const savedDraftSchema: z.ZodType<SavedDraft> = z.object({
  id: z.string().min(1).max(128),
  savedAt: z.string().max(40),
  mode: z.enum(["new", "reply", "replyAll", "forward"]),
  accountId: z.string(),
  // Unlike a message being sent, a draft may still lack recipients (or hold half-typed ones).
  to: z.array(contactSchema).max(500),
  cc: z.array(contactSchema).max(500),
  bcc: z.array(contactSchema).max(500),
  pendingText: z.object({
    to: z.string().max(2000),
    cc: z.string().max(2000),
    bcc: z.string().max(2000),
  }),
  subject: z.string().max(2000),
  body: z.string().max(MAX_DRAFT_TEXT),
  sendAt: z.number().int().positive().optional(),
  bodyHtml: z.string().max(MAX_DRAFT_TEXT * 2 + Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4).optional(),
  attachments: draftFilesSchema.optional(),
  quoted: z.string().max(MAX_DRAFT_TEXT).optional(),
  inReplyTo: z
    .object({
      messageId: z.string(),
      nativeId: z.string(),
      references: z.array(z.string()),
      mode: z.enum(["reply", "replyAll", "forward"]),
    })
    .optional(),
  serverMessageId: z.string().min(1).max(2048).optional(),
});

export const draftIdSchema = z.string().min(1).max(128);

export const mailViewSchema: z.ZodType<MailView> = z.enum(["category", "sender", "list"]);

export const shownFoldersSchema = z.array(z.enum(["inbox", "archive", "trash", "spam"])).max(4);

/**
 * The lists of the saved choices are checked by the same functions that read them from the file:
 * whatever is not well-formed is left out, and each list is cut to its limit.
 */
export const savedChoiceSchemas = {
  appearance: z.unknown().transform((value, context) => {
    const values = parseAppearanceValues(value);
    if (values === null) context.addIssue({ code: "custom", message: "Appearance must be an object of plain values" });
    return values ?? {};
  }),
  theme: z.enum(COLOR_MODES as [string, ...string[]]),
  blocklist: z.unknown().transform(parseBlockList),
  priority: z.unknown().transform(parsePriorityList),
  unsubscribed: z.unknown().transform(parseUnsubscribedLists),
  pinnedDomains: z.unknown().transform((value) => parseStringList(value, MAX_PINNED_DOMAINS)),
  minimizedCategories: z.unknown().transform((value) => parseStringList(value, MAX_MINIMIZED_CATEGORIES)),
};

/** Any subset of the saved choices; what is left out keeps its value. */
export const uiPrefsPatchSchema: z.ZodType<Partial<UiPrefs>> = z
  .object({
    view: mailViewSchema,
    unreadOnly: z.boolean(),
    shownFolders: shownFoldersSchema,
    pinnedDrafts: z.array(z.string().min(1).max(2048)).max(500),
    onboarded: z.boolean(),
    ...savedChoiceSchemas,
  })
  .partial()
  .strict() as unknown as z.ZodType<Partial<UiPrefs>>;

/** What the page found in its own storage, to be taken over once (see `mergeLegacyPrefs`). */
export const legacyPrefsSchema: z.ZodType<LegacyPrefs> = z
  .object({
    appearance: z.unknown(),
    theme: z.unknown(),
    blocklist: z.unknown(),
    priority: z.unknown(),
    unsubscribed: z.unknown(),
    pinnedDomains: z.unknown(),
    minimizedCategories: z.unknown(),
  })
  .partial()
  .strict();

export const categorySchema: z.ZodType<Category> = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  criteria: z.string().trim().min(MIN_CRITERIA_LENGTH).max(MAX_CRITERIA_LENGTH),
  hue: z.number().min(0).max(360),
  icon: z
    .string()
    .regex(/^[A-Z][A-Za-z0-9]{0,63}$/, "Icon names look like CalendarPlus.")
    .optional(),
});

/** The whole category list, replaced at once; names must be unique and not reserved. */
export const categoryListSchema: z.ZodType<Category[]> = z
  .array(categorySchema)
  .max(MAX_CATEGORIES)
  .superRefine((categories, context) => {
    for (const problem of categoryProblems(categories)) {
      context.addIssue({ code: "custom", message: problem });
    }
  });

export const logoRequestSchema: z.ZodType<LogoRequest> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("brand"), domain: z.string().max(253) }),
  z.object({ kind: z.literal("person"), email: z.string().max(320) }),
  z.object({ kind: z.literal("own"), domain: z.string().max(253) }),
]);
/** Capped so one call cannot queue thousands of lookups. */
export const logoRequestsSchema = z.array(logoRequestSchema).max(24);
export const logoSettingsSchema: z.ZodType<LogoSettings> = z.object({
  companyLogos: z.boolean(),
  personPhotos: z.boolean(),
});

/** The Advanced page's choices about downloading mail ahead of time; the whole object is replaced on each change. */
export const offlineSettingsSchema: z.ZodType<OfflineSettings> = z.object({
  prefetch: z.boolean(),
  folders: z
    .array(z.enum(OFFLINE_FOLDERS))
    .min(1)
    .max(OFFLINE_FOLDERS.length)
    .refine((folders) => new Set(folders).size === folders.length, "A folder is listed twice"),
  limit: z.enum(OFFLINE_LIMITS),
  lookbackDays: z.number().int().min(MIN_LOOKBACK_DAYS).max(MAX_LOOKBACK_DAYS),
  maxMegabytes: z.number().int().min(MIN_MEGABYTES).max(MAX_MEGABYTES),
});

const accountNotificationShape = {
  enabled: z.boolean(),
  folders: z.array(z.enum(NOTIFY_FOLDERS)).max(NOTIFY_FOLDERS.length),
  categories: z.object({
    mode: z.enum(["all", "only", "except"]),
    ids: z.array(z.string().min(1).max(64)).max(MAX_NOTIFICATION_IDS),
  }),
  mutedSenders: z.array(z.string().min(3).max(320)).max(MAX_MUTED_SENDERS),
  content: z.enum(["full", "sender", "hidden"]),
  sound: z.boolean(),
  muteWhenFocused: z.boolean(),
};

/** Every choice on the Notifications page; the whole object is replaced on each change. */
export const notificationSettingsSchema: z.ZodType<NotificationSettings> = z.object({
  ...accountNotificationShape,
  accounts: z
    .record(z.string().min(1).max(128), z.object(accountNotificationShape).partial())
    .refine((accounts) => Object.keys(accounts).length <= MAX_NOTIFICATION_IDS, "Too many accounts."),
  dockBadge: z.boolean(),
  groupBursts: z.boolean(),
  mutedThreads: z.array(z.string().min(3).max(400)).max(MAX_MUTED_THREADS),
});

/** An AI provider's API key typed by the user. */
export const aiKeySchema = z.string().trim().min(8).max(300);

/** Which provider a key is for, or which provider a job should use. */
export const aiProviderSchema = z.enum(AI_PROVIDERS);

/** A provider that can run a chat model, which the AI-enabled features need. */
export const chatProviderSchema = z.enum(CHAT_PROVIDERS);

/** A key to store for one provider. */
export const setAiKeySchema = z.object({ provider: aiProviderSchema, key: aiKeySchema });

/** A chat model id such as "openai/gpt-4.1-nano", or empty to turn the model fallback off. */
export const codeModelSchema = z
  .string()
  .trim()
  .max(100)
  .regex(CODE_MODEL_PATTERN, 'Use a model id like "openai/gpt-4.1-nano".');

/** The model that sorts mail into categories, such as "typesafe-ai/jev" or "jev-latest". Never empty. */
export const sortModelSchema = z
  .string()
  .trim()
  .max(100)
  .regex(SORT_MODEL_PATTERN, 'Use a model id like "typesafe-ai/jev".');

/** A connection test: which model purpose, and the model id to try (the one in the field, saved or not). */
export const testModelSchema = z.object({
  purpose: z.enum(MODEL_PURPOSES),
  model: z.string().trim().max(100),
});

/** The composer's text completion: on or off, and how much the model may write at once. */
export const completionSettingsSchema = z.object({
  enabled: z.boolean(),
  length: z.enum(COMPLETION_LENGTHS),
  model: codeModelSchema,
});

/** One request for ghost text. Every part is capped, so a compromised page cannot send a book to the model. */
export const completionRequestSchema = z.object({
  session: z.string().min(1).max(100),
  before: z.string().max(COMPLETION_LIMITS.before),
  after: z.string().max(COMPLETION_LIMITS.after),
  context: z.object({
    mode: z.enum(["new", "reply", "replyAll", "forward"]),
    subject: z.string().max(COMPLETION_LIMITS.subject),
    me: contactSchema,
    to: z.array(contactSchema).max(COMPLETION_LIMITS.recipients),
    cc: z.array(contactSchema).max(COMPLETION_LIMITS.recipients),
    quoted: z.string().max(COMPLETION_LIMITS.quoted).optional(),
    earlier: z
      .array(
        z.object({
          from: contactSchema,
          date: z.string().max(40),
          text: z.string().max(COMPLETION_LIMITS.earlierText),
        }),
      )
      .max(COMPLETION_LIMITS.earlierMessages)
      .optional(),
  }),
});

/** Folders whose new mail is sorted automatically: any combination; none turns automatic sorting off. */
export const sortFoldersSchema = z
  .array(z.enum(SORT_FOLDERS))
  .max(SORT_FOLDERS.length)
  .transform((folders) => SORT_FOLDERS.filter((folder) => folders.includes(folder)));

/** What saving the categories does with mail filed under a deleted one. */
export const saveCategoriesOptionsSchema = z.object({ orphans: z.literal("none").optional() }).optional();

/** "Sort mail again": everything, or only conversations with mail from `since` (an ISO date) on. */
export const reclassifySchema = z
  .object({
    since: z
      .string()
      .max(40)
      .refine((value) => !Number.isNaN(Date.parse(value)), "Not a date")
      .optional(),
    folders: z.array(z.enum(["inbox", "archive", "spam", "trash"])).max(4).optional(),
  })
  .optional();

/** Conversations (`accountId:threadId`) the user files by hand; a null category means "none". */
export const assignCategorySchema = z.object({
  threads: z.array(z.string().min(1).max(600)).min(1).max(500),
  categoryId: z.string().min(1).max(64).nullable(),
  sorting: z.boolean().optional(),
  /** Lets the Log row of this action offer an Undo. */
  ref: z.string().min(1).max(100).optional(),
  /** Who asked, when it was not a click: the Log row says "via CLI". */
  via: z.literal("cli").optional(),
});

/** One or more message ids; capped so a bad call cannot ask for thousands of fetches. */
export const idsSchema = z.array(z.string()).min(1).max(500);

/** Messages asked about for a code at once: the visible verification rows. */
export const codeIdsSchema = z.array(z.string()).min(1).max(30);

/** What the page reports to the event journal. */
export const eventReportSchema = z.object({
  level: z.enum(["error", "action", "info"]),
  area: z.string().min(1).max(40),
  title: z.string().min(1).max(MAX_EVENT_TITLE * 2),
  detail: z.string().max(MAX_EVENT_DETAIL * 2).optional(),
  context: z.string().max(MAX_EVENT_CONTEXT * 2).optional(),
  accountId: z.string().max(200).optional(),
  ref: z.string().max(100).optional(),
});

/** Every choice on the CLI page; the whole object is replaced on each change. */
export const cliSettingsSchema: z.ZodType<CliSettings> = z.object({
  enabled: z.boolean(),
  disabled: z.array(z.enum(CLI_COMMAND_IDS)).max(CLI_COMMAND_IDS.length),
  ask: z.object({
    send: z.enum(ASK_MODES as unknown as [string, ...string[]]),
    unsubscribe: z.enum(ASK_MODES as unknown as [string, ...string[]]),
    invitation: z.enum(ASK_MODES as unknown as [string, ...string[]]),
  }) as unknown as z.ZodType<CliSettings["ask"]>,
  allowedRecipients: z
    .array(
      z.string().max(320).refine((value) => {
        const result = normalizeAllowedRecipient(value);
        return "value" in result && result.value === value;
      }, "Not an address or @domain that can be allowed."),
    )
    .max(MAX_ALLOWED_RECIPIENTS),
  hideLinks: z.boolean(),
  pathLink: z.boolean(),
  skillTargets: z.array(z.enum(SKILL_TARGET_IDS)).max(SKILL_TARGET_IDS.length),
});

/** The page's answer to something the CLI asked of it (see `PageRequest`). */
export const pageReplySchema: z.ZodType<PageReply> = z.union([
  z.object({
    id: z.number().int(),
    ok: z.literal(true),
    result: z.object({
      outcome: z.enum(["applied", "failed", "undone", "timeout", "nothing"]),
      count: z.number().int().min(0),
      ref: z.string().max(200).optional(),
      decision: z.enum(["reject", "once", "always", "review"]).optional(),
      unsubscribe: z
        .object({
          done: z.number().int().min(0),
          manual: z.array(z.object({ sender: z.string().max(400), host: z.string().max(300) })).max(500),
          failed: z.array(z.object({ sender: z.string().max(400), error: z.string().max(1000) })).max(500),
          skipped: z.number().int().min(0),
          alreadyDone: z.number().int().min(0),
        })
        .optional(),
      draft: z
        .object({
          id: z.string().max(128),
          accountId: z.string().max(128),
          to: z.array(z.string().max(320)).max(500),
          cc: z.array(z.string().max(320)).max(500),
          bcc: z.array(z.string().max(320)).max(500),
          subject: z.string().max(2000),
          files: z.array(z.string().max(500)).max(25),
        })
        .optional(),
    }),
  }),
  z.object({ id: z.number().int(), ok: z.literal(false), error: z.string().max(2000) }),
]);

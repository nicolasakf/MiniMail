import { z } from "zod";

import { MAX_ALIAS_LENGTH, MAX_AVATAR_BYTES, normalizeAlias } from "./accounts";
import type { LogoRequest, LogoSettings } from "./logos";
import { MAIL_WINDOW } from "./mail-window";
import {
  categoryProblems,
  MAX_CATEGORIES,
  MAX_CRITERIA_LENGTH,
  MAX_NAME_LENGTH,
  MIN_CRITERIA_LENGTH,
} from "./categories";
import { CODE_MODEL_PATTERN } from "./verification-code";
import { SORT_FOLDERS } from "./types";
import type { AddAccountInput, Category, Draft, ListQuery, MailView, SavedDraft, UiPrefs } from "./types";

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

export const addAccountSchema: z.ZodType<AddAccountInput> = z.union([
  z.object({
    kind: z.literal("password"),
    provider: z.enum(["zoho", "gmail"]),
    email: z.string().email(),
    password: z.string().min(1),
    displayName: z.string().optional(),
    alias: aliasSchema.optional(),
    zohoRegion: z.enum(["com", "eu", "in", "com.au", "jp"]).optional(),
    zohoWorkplace: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("oauth"),
    provider: z.literal("gmail"),
    email: z.string().optional(),
    alias: aliasSchema.optional(),
  }),
  z.object({
    kind: z.literal("oauth"),
    provider: z.literal("outlook"),
    outlookKind: z.enum(["personal", "work-school"]),
    tenant: z.string().optional(),
    email: z.string().optional(),
    alias: aliasSchema.optional(),
  }),
]);

export const listQuerySchema: z.ZodType<ListQuery> = z.object({
  accountIds: z.array(z.string()).optional(),
  folder: folderSchema,
  limit: z.number().int().min(1).max(MAIL_WINDOW).optional(),
  cacheOnly: z.boolean().optional(),
});

export const draftSchema: z.ZodType<Draft> = z.object({
  accountId: z.string(),
  to: z.array(contactSchema).min(1, "Add at least one recipient."),
  cc: z.array(contactSchema),
  bcc: z.array(contactSchema),
  subject: z.string(),
  text: z.string(),
  attachments: z
    .array(
      z.object({
        filename: z.string().min(1),
        contentType: z.string(),
        contentBase64: z.string(),
      }),
    )
    .max(25)
    .optional(),
  inReplyTo: z
    .object({
      messageId: z.string(),
      nativeId: z.string(),
      references: z.array(z.string()),
      mode: z.enum(["reply", "replyAll", "forward"]),
    })
    .optional(),
});

const MAX_DRAFT_TEXT = 2_000_000;

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
  quoted: z.string().max(MAX_DRAFT_TEXT).optional(),
  inReplyTo: z
    .object({
      messageId: z.string(),
      nativeId: z.string(),
      references: z.array(z.string()),
      mode: z.enum(["reply", "replyAll", "forward"]),
    })
    .optional(),
});

export const draftIdSchema = z.string().min(1).max(128);

export const mailViewSchema: z.ZodType<MailView> = z.enum(["category", "sender", "list"]);

export const shownFoldersSchema = z.array(z.enum(["inbox", "archive", "trash", "spam"])).max(4);

/** Any subset of the saved choices; what is left out keeps its value. */
export const uiPrefsPatchSchema: z.ZodType<Partial<UiPrefs>> = z
  .object({
    view: mailViewSchema,
    unreadOnly: z.boolean(),
    shownFolders: shownFoldersSchema,
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

/** Vercel AI Gateway API key typed by the user. */
export const gatewayKeySchema = z.string().trim().min(8).max(300);

/** A Vercel AI Gateway model id such as "reflection/beam", or empty to turn the model fallback off. */
export const codeModelSchema = z
  .string()
  .trim()
  .max(100)
  .regex(CODE_MODEL_PATTERN, 'Use a gateway model id like "reflection/beam".');

/** Folders whose new mail is sorted automatically: any combination; none turns automatic sorting off. */
export const sortFoldersSchema = z
  .array(z.enum(SORT_FOLDERS))
  .max(SORT_FOLDERS.length)
  .transform((folders) => SORT_FOLDERS.filter((folder) => folders.includes(folder)));

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

/** One or more message ids; capped so a bad call cannot ask for thousands of fetches. */
export const idsSchema = z.array(z.string()).min(1).max(500);

/** Messages asked about for a code at once: the visible verification rows. */
export const codeIdsSchema = z.array(z.string()).min(1).max(30);

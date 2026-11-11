import type { Category, SmartCategory } from "./types";

/** Hard limits, shared by the editor and the IPC validation. */
export const MAX_CATEGORIES = 20;
export const MAX_NAME_LENGTH = 40;
export const MIN_CRITERIA_LENGTH = 10;
export const MAX_CRITERIA_LENGTH = 600;

/**
 * Name of the classifier's built-in "nothing fits" option. Users cannot name a category
 * this, so the answer is never ambiguous.
 */
export const NO_CATEGORY_NAME = "None of these";

/**
 * Categories every install starts with. They are ordinary categories: the user can rewrite
 * their criteria, rename them or delete them. Ids are stable so the rule-based fallback can
 * find them.
 */
export const DEFAULT_CATEGORIES: readonly Category[] = [
  {
    id: "invitations",
    name: "Invitations",
    hue: 265,
    icon: "CalendarPlus",
    criteria:
      "Calendar invitations and event or meeting responses: someone inviting the recipient to a meeting, call or event; updated or cancelled invitations; and accept, decline or tentative replies to an invitation.",
  },
  {
    id: "newsletters",
    name: "Newsletters",
    hue: 210,
    icon: "Newspaper",
    criteria:
      "Editorial mail whose content is news or reading: a newsletter, digest, blog or press roundup, or articles and updates about a topic or industry, subscribed to by many people. It informs rather than sells. If it promotes, sells or announces something from the sender's own company (products, features, offers), it is an Ad, not a newsletter.",
  },
  {
    id: "ads",
    name: "Ads",
    hue: 340,
    icon: "Megaphone",
    criteria:
      "Mail that tries to sell something or promote the sender's own company: promotions, discounts, sales and offers, product launches, new features or \"what's new\" announcements, upgrade or win-back pitches, event or webinar promotion, cold outreach. Even when written like news, a company announcing its own products is an Ad. Usually bulk mail with an unsubscribe link.",
  },
  {
    id: "notifications",
    name: "Notifications",
    hue: 150,
    icon: "Bell",
    criteria:
      "Automated messages triggered by activity in an app or service: alerts, receipts and invoices, order and shipping updates, billing or security notices, comments and mentions, build or deploy results. Not written by a person to the recipient, and not a one-time code (those are Verification codes).",
  },
  {
    id: "verification-codes",
    name: "Verification codes",
    hue: 35,
    icon: "KeyRound",
    criteria:
      "Emails whose main purpose is delivering a one-time code or link so the recipient can sign in, reset a password or verify their email address or identity: OTP and 2FA codes, magic links, confirm-your-email messages.",
  },
];

/**
 * The default ids that existed before "ads" was added. A saved file with no record of which
 * defaults it has already been offered is treated as having been offered exactly these.
 */
export const LEGACY_DEFAULT_IDS: readonly string[] = [
  "invitations",
  "newsletters",
  "notifications",
  "verification-codes",
];

/** What a category without an icon shows. */
export const FALLBACK_ICON = "Tag";

/**
 * The icon to use for a category: its own, or for a built-in saved before icons existed, the
 * built-in's. Anything else gets no icon (the UI then shows the fallback).
 */
export function iconFor(category: Pick<Category, "id" | "icon">): string | undefined {
  return category.icon ?? DEFAULT_CATEGORIES.find((candidate) => candidate.id === category.id)?.icon;
}

/** A fresh copy, so callers can edit it without touching the defaults. */
export function defaultCategories(): Category[] {
  return DEFAULT_CATEGORIES.map((category) => ({ ...category }));
}

/** Which default category the rule-based signal maps to, when the user still has it. */
const SIGNAL_TO_DEFAULT: Record<SmartCategory, string | null> = {
  person: null,
  notification: "notifications",
  newsletter: "newsletters",
  invitation: "invitations",
  "invitation-response": "invitations",
};

/**
 * Category chosen from header signals alone. Used while the AI classifier has not answered
 * yet, or when no AI key is configured, so the list is useful from the first launch.
 */
export function ruleBasedCategoryId(
  signal: SmartCategory,
  categories: readonly Category[],
): string | null {
  const id = SIGNAL_TO_DEFAULT[signal];
  return id !== null && categories.some((category) => category.id === id) ? id : null;
}

/** Problems with a category list, as messages fit to show next to the editor. Empty when valid. */
export function categoryProblems(categories: readonly Category[]): string[] {
  const problems: string[] = [];
  if (categories.length > MAX_CATEGORIES) {
    problems.push(`At most ${MAX_CATEGORIES} categories.`);
  }
  const seen = new Set<string>();
  categories.forEach((category, index) => {
    const label = category.name.trim() || `Category ${index + 1}`;
    const name = category.name.trim();
    if (!name) problems.push(`${label}: give it a name.`);
    else if (name.length > MAX_NAME_LENGTH) {
      problems.push(`${label}: the name is longer than ${MAX_NAME_LENGTH} characters.`);
    } else if (name.toLowerCase() === NO_CATEGORY_NAME.toLowerCase()) {
      problems.push(`"${NO_CATEGORY_NAME}" is reserved.`);
    } else if (seen.has(name.toLowerCase())) {
      problems.push(`${label}: another category already has this name.`);
    }
    seen.add(name.toLowerCase());

    const criteria = category.criteria.trim();
    if (criteria.length < MIN_CRITERIA_LENGTH) {
      problems.push(`${label}: describe what belongs in it (at least ${MIN_CRITERIA_LENGTH} characters).`);
    } else if (criteria.length > MAX_CRITERIA_LENGTH) {
      problems.push(`${label}: the criteria are longer than ${MAX_CRITERIA_LENGTH} characters.`);
    }
  });
  return problems;
}

/** Lowercased hostnames sharing a public suffix of two labels, e.g. `example.co.uk`. */
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "edu", "ac", "ne", "or"]);

/**
 * The organization part of a sender address: `mail.example.com` and `news.example.com` both
 * become `example.com`, and `x.example.co.uk` becomes `example.co.uk`. Good enough to group
 * mail by company without shipping the public suffix list.
 */
export function senderDomain(email: string): string {
  const at = email.lastIndexOf("@");
  const host = (at >= 0 ? email.slice(at + 1) : "").trim().toLowerCase().replace(/\.$/, "");
  if (!host) return "unknown";
  const labels = host.split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const last = labels[labels.length - 1];
  const beforeLast = labels[labels.length - 2];
  const keep = last.length === 2 && SECOND_LEVEL.has(beforeLast) ? 3 : 2;
  return labels.slice(-keep).join(".");
}

import { normalizeAlias } from "@shared/accounts";
import { trustKey } from "@shared/trust";
import { DEFAULT_NOTIFICATION_SETTINGS, type NotificationSettings } from "@shared/notifications";
import { DEFAULT_LOGO_SETTINGS, isFreemail, logoKey, type LogoRequest, type LogoSettings } from "@shared/logos";
import type { AccountCapabilities, MiniMailApi } from "@shared/api";
import { categoryProblems, defaultCategories, ruleBasedCategoryId } from "@shared/categories";
import {
  CODE_MODEL_PATTERN,
  DEFAULT_CODE_MODEL,
  extractVerificationCode,
  htmlToText,
} from "@shared/verification-code";
import { buildContactIndex } from "@shared/contacts";
import { makeMessageId } from "@shared/ids";
import type {
  Account,
  AddAccountInput,
  Category,
  CategoryState,
  Contact,
  Draft,
  Invitation,
  InvitationResponse,
  MailAction,
  MailFolder,
  MessageDetail,
  MessageSummary,
  SavedDraft,
  SmartCategory,
  SortFolder,
  UiPrefs,
} from "@shared/types";

/**
 * In-memory backend with fictional accounts and mail. Used when the renderer runs
 * outside Electron so the UI can be developed and screenshotted without credentials.
 */

const ME_GMAIL: Account = {
  id: "demo-gmail",
  provider: "gmail",
  email: "alex@example.com",
  displayName: "Alex Morgan",
  auth: "oauth",
  hue: 210,
};
const ME_UNIVERSITY: Account = {
  id: "demo-university",
  provider: "outlook",
  email: "alex@university.example",
  displayName: "Alex Morgan",
  auth: "oauth",
  hue: 150,
  outlookKind: "work-school",
};
const ME_ZOHO: Account = {
  id: "demo-zoho",
  provider: "zoho",
  email: "alex@acme.example",
  displayName: "Alex Morgan",
  auth: "password",
  hue: 30,
  zohoRegion: "com",
  zohoWorkplace: true,
};

/** Timestamp `days` days from now at the given local time. */
function inDays(days: number, hour: number, minute = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

/** Timestamp `daysAgo` days before now at the given local time. */
function at(daysAgo: number, hour: number, minute = 0): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, minute, 0, 0);
  // Never create mail from the future (matters when the demo runs early in the day).
  return new Date(Math.min(date.getTime(), Date.now() - 60_000)).toISOString();
}

const person = (name: string, email: string): Contact => ({ name, email });

const paragraphs = (...lines: string[]) => lines.join("\n\n");

const NEWSLETTER_HTML = (title: string, body: string) => `
<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:24px;color:#222;background:#fff">
  <h1 style="font-size:26px;margin:0 0 12px">${title}</h1>
  <img src="https://images.example.com/hero.jpg" alt="" width="512" height="200" style="display:block;background:#e5e5e5;margin:12px 0" />
  <p style="font-size:16px;line-height:1.6">${body}</p>
  <p style="font-size:16px;line-height:1.6"><a href="https://example.com/read-more">Read the full story</a></p>
  <hr style="border:none;border-top:1px solid #ddd;margin:24px 0" />
  <p style="font-size:12px;color:#888">You are receiving this because you subscribed. <a href="https://example.com/unsubscribe">Unsubscribe</a></p>
</div>`;

const NOTIFICATION_HTML = (heading: string, detail: string) => `
<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:20px;color:#1f2328;background:#fff">
  <h2 style="margin:0 0 8px;font-size:18px">${heading}</h2>
  <p style="font-size:14px;line-height:1.5">${detail}</p>
  <p><a href="https://example.com/details" style="background:#1f2328;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;font-size:14px">View details</a></p>
</div>`;

interface Seed {
  key: string;
  account: Account;
  folder?: MessageSummary["folder"];
  thread?: string;
  from: Contact;
  to?: Contact[];
  subject: string;
  date: string;
  unread?: boolean;
  pinned?: boolean;
  attachments?: boolean;
  /** Files listed as attachments, when the single default one will not do: name, type, size. */
  files?: [string, string, number][];
  invitation?: Invitation;
  signal?: SmartCategory;
  answered?: boolean;
  text?: string;
  html?: string;
}

/** Small deterministic generator, so the demo history is the same on every launch. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

/**
 * Six weeks of already-archived mail, so the Dashboard has a history to chart. Busier on
 * weekday mornings, quieter at night and on weekends, like a real inbox.
 */
function archiveHistory(): Seed[] {
  const random = seededRandom(42);
  const senders: { from: Contact; signal: SmartCategory; subjects: string[]; weight: number; account: Account }[] = [
    { from: person("GitHub", "notifications@github.example"), signal: "notification", weight: 9, account: ME_ZOHO, subjects: ["[acme/web] CI failed on main", "[acme/web] New comment on #482", "[acme/api] Review requested"] },
    { from: person("Linear", "updates@linear.example"), signal: "notification", weight: 6, account: ME_ZOHO, subjects: ["3 issues assigned to you", "Cycle 42 summary"] },
    { from: person("Amazon", "shipment@amazon.example"), signal: "notification", weight: 4, account: ME_GMAIL, subjects: ["Your package has shipped", "Delivered: your order"] },
    { from: person("Morning Brew", "crew@morningbrew.example"), signal: "newsletter", weight: 5, account: ME_GMAIL, subjects: ["Markets wobble, again", "The weekend read"] },
    { from: person("The Verge", "newsletter@theverge.example"), signal: "newsletter", weight: 3, account: ME_GMAIL, subjects: ["Verge Daily: chips, phones and more"] },
    { from: person("Shopify Deals", "deals@mail.shop.example"), signal: "newsletter", weight: 4, account: ME_GMAIL, subjects: ["48 hours only: 30% off", "New arrivals you'll love"] },
    { from: person("Shop Support", "help@shop.example"), signal: "notification", weight: 2, account: ME_GMAIL, subjects: ["Your return was received"] },
    { from: person("Canvas", "notifications@instructure.example"), signal: "notification", weight: 5, account: ME_UNIVERSITY, subjects: ["New announcement: Lab 4", "Assignment graded"] },
    { from: person("Prof. Lina Ortiz", "lina.ortiz@university.example"), signal: "person", weight: 3, account: ME_UNIVERSITY, subjects: ["Office hours moved", "Thesis outline feedback"] },
    { from: person("Marcus Chen", "marcus.chen@example.com"), signal: "person", weight: 4, account: ME_GMAIL, subjects: ["Dinner Thursday?", "Photos from the trip"] },
    { from: person("Dana Whitfield", "dana@clientco.example"), signal: "person", weight: 3, account: ME_ZOHO, subjects: ["Contract redlines", "Quick question on the estimate"] },
    { from: person("Calendar", "calendar@clientco.example"), signal: "invitation", weight: 2, account: ME_ZOHO, subjects: ["Invitation: Weekly sync"] },
    { from: person("Google", "no-reply@accounts.google.example"), signal: "notification", weight: 2, account: ME_GMAIL, subjects: ["Your verification code is 482913"] },
    { from: person("Stripe", "receipts@stripe.example"), signal: "notification", weight: 3, account: ME_ZOHO, subjects: ["Your receipt from Acme Hosting", "Payout sent"] },
  ];
  const totalWeight = senders.reduce((sum, sender) => sum + sender.weight, 0);
  const pick = () => {
    let roll = random() * totalWeight;
    for (const sender of senders) {
      roll -= sender.weight;
      if (roll <= 0) return sender;
    }
    return senders[0];
  };
  const hourWeights = [0, 0, 0, 0, 0, 1, 2, 4, 7, 9, 8, 7, 5, 6, 7, 6, 5, 4, 3, 3, 2, 2, 1, 1];
  const hourTotal = hourWeights.reduce((sum, weight) => sum + weight, 0);
  const pickHour = () => {
    let roll = random() * hourTotal;
    for (let hour = 0; hour < 24; hour += 1) {
      roll -= hourWeights[hour];
      if (roll <= 0) return hour;
    }
    return 9;
  };

  const seeds: Seed[] = [];
  for (let daysAgo = 1; daysAgo <= 42; daysAgo += 1) {
    const day = new Date();
    day.setDate(day.getDate() - daysAgo);
    const weekend = day.getDay() === 0 || day.getDay() === 6;
    const count = Math.round((weekend ? 3 : 8) + random() * (weekend ? 3 : 7));
    for (let index = 0; index < count; index += 1) {
      const sender = pick();
      seeds.push({
        key: `history-${daysAgo}-${index}`,
        folder: "archive",
        account: sender.account,
        from: sender.from,
        subject: sender.subjects[Math.floor(random() * sender.subjects.length)],
        date: at(daysAgo, pickHour(), Math.floor(random() * 60)),
        signal: sender.signal,
        unread: random() < 0.12,
        answered: sender.signal === "person" && random() < 0.5,
        attachments: random() < 0.08,
        text: "Archived demo message.",
      });
    }
  }
  return seeds;
}

function seedMessages(): MessageDetail[] {
  const me = (account: Account) => person(account.displayName, account.email);
  const seeds: Seed[] = [
    // --- Conversations with people -------------------------------------------------
    {
      key: "noise-1",
      thread: "noise",
      account: ME_GMAIL,
      from: person("Samantha Reed", "samantha.reed@homesupport.example"),
      subject: "Consecutive neighbor noise",
      date: at(1, 17, 40),
      text: paragraphs(
        "Hi Alex,",
        "Thank you for your email and for sharing additional videos and details on this. We have logged each incident and will contact the other resident this week.",
        "Please keep recording dates and times; it helps a lot.",
        "Best,\nSamantha",
      ),
    },
    {
      key: "noise-2",
      thread: "noise",
      account: ME_GMAIL,
      from: me(ME_GMAIL),
      to: [person("Samantha Reed", "samantha.reed@homesupport.example")],
      subject: "Re: Consecutive neighbor noise",
      date: at(0, 12, 31),
      text: "Thanks Samantha, I will keep logging them. Another incident last night around 1 am.",
    },
    {
      key: "quiz",
      account: ME_UNIVERSITY,
      from: person("Priya Nair", "priya.nair@university.example"),
      subject: "reminder: take-home quiz 3 due tomorrow at 3:30 pm",
      date: at(0, 8, 18),
      unread: true,
      text: paragraphs(
        "Good morning, everyone,",
        "Just a quick reminder that take-home quiz 3 is due tomorrow at 3:30 pm. Late submissions will lose 10% per day.",
        "Office hours are today from 1 to 3 if you want to go over anything.",
        "Priya",
      ),
    },
    {
      key: "lunch",
      account: ME_GMAIL,
      from: person("Marcus Chen", "marcus.chen@example.com"),
      subject: "Lunch Thursday?",
      date: at(1, 11, 5),
      unread: true,
      text: "There's a new ramen place near the office. Free Thursday around 12:30?",
    },
    {
      key: "thesis-1",
      thread: "thesis",
      account: ME_UNIVERSITY,
      from: me(ME_UNIVERSITY),
      to: [person("Elena Duarte", "elena.duarte@university.example")],
      subject: "Thesis outline feedback",
      date: at(4, 9, 12),
      text: "Dear Professor Duarte, attached is the revised outline. I restructured chapter 3 around your comments.",
      attachments: true,
      files: [
        ["outline-v2.pdf", "application/pdf", 482_113],
        ["references.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 58_320],
        ["chapter-3-draft.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 214_902],
      ],
    },
    {
      key: "thesis-2",
      thread: "thesis",
      account: ME_UNIVERSITY,
      from: person("Elena Duarte", "elena.duarte@university.example"),
      subject: "Re: Thesis outline feedback",
      date: at(3, 16, 45),
      unread: true,
      text: paragraphs(
        "Alex,",
        "The new structure is much stronger. Two requests: tighten the literature review, and add a short section on limitations.",
        "Let's meet next Tuesday to go through it.",
        "Elena",
      ),
    },
    {
      key: "photos",
      answered: true,
      account: ME_GMAIL,
      from: person("Jordan Lee", "jordan.lee@example.com"),
      subject: "Photos from the weekend",
      date: at(5, 20, 3),
      attachments: true,
      files: [
        ["lake.jpg", "image/jpeg", 2_412_880],
        ["trail.png", "image/png", 1_104_221],
        ["all-photos.zip", "application/zip", 18_220_114],
      ],
      text: "Finally sorted through them, here are my favourites. The one at the lake is unreal.",
    },
    {
      key: "invoice",
      account: ME_ZOHO,
      from: person("Dana Whitfield", "dana@clientco.example"),
      subject: "Invoice follow-up",
      date: at(12, 14, 20),
      text: "Hi Alex, just checking whether invoice #2041 went through on your side. Happy to resend if not.",
    },
    {
      key: "welcome",
      account: ME_ZOHO,
      from: person("Sam Okafor", "sam@acme.example"),
      subject: "Welcome to the team",
      date: at(40, 10, 0),
      text: "Welcome aboard! Your laptop is ready for pickup and I've added you to the engineering channel.",
    },

    // --- Pinned -------------------------------------------------------------------
    {
      key: "pinned-support",
      account: ME_GMAIL,
      from: person("Acme Support", "support@acmehelp.example"),
      subject: "Your ticket #4821 has been updated",
      date: at(2, 13, 30),
      pinned: true,
      text: "Our team replied to your ticket. Reply to this email to continue the conversation.",
    },

    // --- Notifications ------------------------------------------------------------
    {
      key: "gh-1",
      account: ME_GMAIL,
      from: person("GitHub", "notifications@github.com"),
      subject: "[acme/app] Run failed: ci - main (e8f2a1c)",
      date: at(1, 9, 41),
      unread: true,
      signal: "notification",
      html: NOTIFICATION_HTML("ci workflow run failed", "The ci workflow run on main failed in the test job."),
    },
    {
      key: "gh-2",
      account: ME_GMAIL,
      from: person("github-actions[bot]", "notifications@github.com"),
      subject: "[lucide-icons/lucide] feat(icons): add folder-plus-corner",
      date: at(3, 18, 2),
      unread: true,
      signal: "notification",
      html: NOTIFICATION_HTML("New comment on a pull request", "github-actions[bot] left a comment."),
    },
    {
      key: "amazon-1",
      account: ME_GMAIL,
      from: person("Amazon.com", "shipment-tracking@amazon.com"),
      subject: "Your package has shipped",
      date: at(0, 7, 12),
      unread: true,
      signal: "notification",
      html: NOTIFICATION_HTML("Shipped", "Arriving Thursday. Track your package with the button below."),
    },
    {
      key: "amazon-2",
      account: ME_GMAIL,
      from: person("Amazon.com", "order-update@amazon.com"),
      subject: "Delivered: your order",
      date: at(2, 15, 0),
      signal: "notification",
      html: NOTIFICATION_HTML("Delivered", "Your package was left at the front door."),
    },
    {
      key: "vercel",
      account: ME_ZOHO,
      from: person("Vercel", "notifications@vercel.com"),
      subject: "Deployment ready: minimail-web",
      date: at(1, 21, 15),
      signal: "notification",
      html: NOTIFICATION_HTML("Deployment ready", "Production deployment completed in 38s."),
    },
    {
      key: "bank",
      account: ME_GMAIL,
      from: person("Northwind Bank", "no-reply@northwind-bank.example"),
      subject: "Your statement is ready",
      date: at(9, 8, 0),
      signal: "notification",
      html: NOTIFICATION_HTML("Statement ready", "Your October statement is now available online."),
    },

    // --- Verification codes -------------------------------------------------------
    {
      key: "code-1",
      account: ME_GMAIL,
      from: person("Acme", "no-reply@acme.example"),
      subject: "Your Acme verification code",
      date: at(0, 9, 3),
      unread: true,
      signal: "notification",
      text: "Use this code to finish signing in: 482910. It expires in ten minutes. If you did not request it, ignore this email.",
    },
    {
      key: "code-2",
      account: ME_ZOHO,
      from: person("Notion", "notify@mail.notion.so"),
      subject: "Your login code for Notion",
      date: at(1, 14, 22),
      signal: "notification",
      text: "Enter this temporary login code to sign in: 731 204. Never share this code with anyone.",
    },

    // --- Newsletters --------------------------------------------------------------
    {
      key: "news-1",
      account: ME_GMAIL,
      from: person("Morning Brew", "crew@morningbrew.example"),
      subject: "Markets rally as inflation cools",
      date: at(0, 6, 30),
      unread: true,
      signal: "newsletter",
      html: NEWSLETTER_HTML("Markets rally as inflation cools", "Stocks climbed on Monday after a softer-than-expected reading on consumer prices."),
    },
    {
      key: "news-2",
      account: ME_GMAIL,
      from: person("The Pragmatic Engineer", "pragmaticengineer@substack.example"),
      subject: "How Spark-style inboxes actually work",
      date: at(2, 7, 45),
      unread: true,
      signal: "newsletter",
      html: NEWSLETTER_HTML("How smart inboxes actually work", "A deep dive into how modern mail clients group and rank your messages."),
    },
    {
      key: "news-3",
      account: ME_UNIVERSITY,
      from: person("Career Center", "careers@university.example"),
      subject: "Explore global career opportunities this November",
      date: at(4, 12, 0),
      signal: "newsletter",
      html: NEWSLETTER_HTML("Global career opportunities", "Join our fair next week and meet more than 80 employers."),
    },

    // --- Invitations ---------------------------------------------------------------
    {
      key: "invite-1",
      account: ME_UNIVERSITY,
      from: person("Priya Nair", "priya.nair@university.example"),
      subject: "Invitation: Project sync @ Tue Nov 10, 3pm",
      date: at(0, 9, 5),
      unread: true,
      signal: "invitation",
      text: "You have been invited to Project sync.\n\nWhen: Tue Nov 10, 3pm-3:30pm\nWhere: Google Meet",
      invitation: {
        uid: "invite-1@demo",
        method: "REQUEST",
        title: "Project sync",
        start: inDays(1, 15, 0),
        end: inDays(1, 15, 30),
        allDay: false,
        location: "Google Meet",
        organizer: person("Priya Nair", "priya.nair@university.example"),
        response: null,
      },
    },
    {
      key: "invite-2",
      account: ME_ZOHO,
      from: person("Dana Whitfield", "dana@clientco.example"),
      subject: "Invitation: Quarterly review @ Fri Nov 13, 11am",
      date: at(1, 16, 20),
      signal: "invitation",
      text: "Dana invited you to Quarterly review.",
      invitation: {
        uid: "invite-2@demo",
        method: "REQUEST",
        title: "Quarterly review",
        start: inDays(3, 11, 0),
        end: inDays(3, 12, 0),
        allDay: false,
        location: "ClientCo, 4th floor",
        organizer: person("Dana Whitfield", "dana@clientco.example"),
        response: "accepted",
      },
    },
    {
      key: "invite-3",
      account: ME_GMAIL,
      from: person("Marcus Chen", "marcus.chen@example.com"),
      subject: "Cancelled: Board game night @ Sat Nov 14",
      date: at(1, 18, 40),
      signal: "invitation",
      text: "Marcus cancelled Board game night.",
      invitation: {
        uid: "invite-3@demo",
        method: "CANCEL",
        title: "Board game night",
        start: inDays(2, 19, 0),
        end: inDays(2, 22, 0),
        allDay: false,
        location: null,
        organizer: person("Marcus Chen", "marcus.chen@example.com"),
        response: null,
      },
    },
    {
      key: "spam-1",
      folder: "spam",
      account: ME_GMAIL,
      from: person("Prize Desk", "winner@prizes-now.example"),
      subject: "You won a free cruise: claim today",
      date: at(1, 3, 12),
      attachments: true,
      files: [["claim-form.pdf", "application/pdf", 91_204]],
      text: "Congratulations! Open the attached form and send us your details to claim your prize.",
    },
    {
      key: "response-1",
      account: ME_UNIVERSITY,
      from: person("Marcus Chen", "marcus.chen@example.com"),
      subject: "Accepted: Design review @ Wed Nov 11",
      date: at(0, 10, 2),
      signal: "invitation-response",
      text: "Marcus Chen has accepted this invitation.",
    },

    // --- Sent ---------------------------------------------------------------------
    {
      key: "sent-1",
      folder: "sent",
      account: ME_GMAIL,
      from: me(ME_GMAIL),
      to: [person("Marcus Chen", "marcus.chen@example.com")],
      subject: "Re: Weekend plans",
      date: at(2, 19, 30),
      text: "Sounds good, count me in.",
    },
    ...archiveHistory(),
  ];

  return seeds.map((seed) => {
    const folder = seed.folder ?? "inbox";
    const signal = seed.signal ?? "person";
    const summary: MessageSummary = {
      id: makeMessageId({ accountId: seed.account.id, folder, nativeId: seed.key }),
      accountId: seed.account.id,
      folder,
      threadId: seed.thread ?? seed.key,
      from: seed.from,
      to: seed.to ?? [person(seed.account.displayName, seed.account.email)],
      subject: seed.subject,
      snippet: (seed.text ?? seed.subject).replace(/\s+/g, " ").slice(0, 160),
      date: seed.date,
      unread: seed.unread ?? false,
      pinned: seed.pinned ?? false,
      answered: seed.answered ?? false,
      hasAttachments: seed.attachments ?? false,
      // One sender fails authentication so the demo shows that a forged brand gets no logo.
      authenticated: seed.key !== "bank",
      signal,
      categoryId: null,
    };
    return {
      ...summary,
      cc: [],
      replyTo: null,
      messageId: `<${seed.key}@demo.example>`,
      references: [],
      html: seed.html ?? null,
      text: seed.text ?? null,
      attachments: seed.attachments
        ? (seed.files ?? [["outline-v2.pdf", "application/pdf", 482_113]]).map(([filename, contentType, size], index) => ({
            id: String(index),
            filename,
            contentType,
            size,
          }))
        : [],
      invitation: seed.invitation ?? null,
    };
  });
}

const BUILT_IN_IDS = new Set(defaultCategories().map((category) => category.id));
const CODE_PATTERN = /(verification|security|login|sign[- ]?in|one[- ]time|confirmation) code|magic link/i;

/**
 * Stand-in for the Jev classifier, which needs a real gateway key: verification wording, then a
 * word from a custom category's name, then the header-based guess. Good enough to show the UI.
 */
function demoCategoryId(message: MessageSummary, categories: readonly Category[]): string | null {
  if (message.folder === "sent" || message.folder === "drafts") return null;
  const text = `${message.subject} ${message.snippet} ${message.from.email}`.toLowerCase();
  for (const category of categories) {
    if (BUILT_IN_IDS.has(category.id)) continue;
    const words = category.name
      .toLowerCase()
      .split(/\W+/)
      .filter((word) => word.length > 3)
      .map((word) => word.replace(/s$/, ""));
    if (words.some((word) => text.includes(word))) return category.id;
  }
  if (CODE_PATTERN.test(text) && categories.some((category) => category.id === "verification-codes")) {
    return "verification-codes";
  }
  return ruleBasedCategoryId(message.signal, categories);
}

const wait = (ms = 140) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Builds a fresh demo backend with three fictional accounts. */
/** The made-up content of an attachment in the demo: a short text file with the attachment's name. */
function demoFile(messages: MessageDetail[], messageId: string, attachmentId: string): { name: string; blob: Blob } {
  const attachment = messages.find((message) => message.id === messageId)?.attachments.find((file) => file.id === attachmentId);
  if (!attachment) throw new Error("This attachment is no longer in the message.");
  return {
    name: attachment.filename,
    blob: new Blob([`Demo attachment: ${attachment.filename}\n`], { type: "text/plain" }),
  };
}

export function createDemoApi(): MiniMailApi {
  let accounts: Account[] = [ME_GMAIL, ME_UNIVERSITY, ME_ZOHO];
  let messages = seedMessages();
  // ?getfail=N makes the first N message opens fail (the page opens each twice in dev, so use 2).
  let getFailures = Number(new URLSearchParams(window.location.search).get("getfail")) || 0;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  const summarize = ({
    cc: _cc,
    replyTo: _replyTo,
    messageId: _messageId,
    references: _references,
    html: _html,
    text: _text,
    attachments: _attachments,
    invitation: _invitation,
    ...summary
  }: MessageDetail): MessageSummary => summary;

  const capabilities: AccountCapabilities = { googleOAuth: true, microsoftOAuth: true };

  let logoSettings: LogoSettings = { ...DEFAULT_LOGO_SETTINGS };
  /** A made-up logo: the first letter of the site on a colored square. The real app fetches the site's own. */
  const demoLogo = (request: LogoRequest): string | null => {
    if (request.kind === "person") {
      if (!logoSettings.personPhotos) return null;
      const hue = [...request.email].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
      return `data:image/svg+xml;utf8,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" fill="hsl(${hue} 40% 60%)"/><circle cx="24" cy="19" r="9" fill="#fff" fill-opacity=".85"/><ellipse cx="24" cy="44" rx="16" ry="13" fill="#fff" fill-opacity=".85"/></svg>`,
      )}`;
    }
    if (request.kind === "brand" && !logoSettings.companyLogos) return null;
    if (isFreemail(request.domain)) return null;
    const hue = [...request.domain].reduce((sum, char) => sum + char.charCodeAt(0) * 7, 0) % 360;
    const letter = request.domain[0].toUpperCase();
    return `data:image/svg+xml;utf8,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" ${hue % 2 === 0 ? "" : 'rx="10" '}fill="hsl(${hue} 65% 45%)"/><text x="24" y="33" font-family="Arial" font-size="28" font-weight="700" text-anchor="middle" fill="#fff">${letter}</text></svg>`,
    )}`;
  };

  let categories: Category[] = defaultCategories();
  /** Conversations the user filed by hand (`accountId:threadId`); null is "no category". */
  const manualCategories = new Map<string, string | null>();
  const trustedSenders = new Set<string>();
  // Like everything else in the demo, drafts and the saved view and filters last until the page is reloaded.
  let demoDrafts: SavedDraft[] = [];
  let demoNotifications: NotificationSettings = structuredClone(DEFAULT_NOTIFICATION_SETTINGS);
  let demoPrefs: UiPrefs = { view: "category", unreadOnly: false, shownFolders: ["inbox"] };
  let aiConfigured = false;
  // A pretend "sort again" so the progress toast can be seen without a key.
  let sortStartedAt: number | null = null;
  const sortProgress = (): CategoryState["ai"]["sorting"] => {
    if (sortStartedAt === null) return null;
    // Accounts are sorted side by side at different speeds, so each bar moves on its own.
    const elapsed = Date.now() - sortStartedAt;
    const perAccount = accounts.map((account, index) => {
      const total = 12 + index * 8;
      return { accountId: account.id, total, done: Math.min(total, Math.floor(elapsed / (220 + index * 60))) };
    });
    const total = perAccount.reduce((sum, account) => sum + account.total, 0);
    const done = perAccount.reduce((sum, account) => sum + account.done, 0);
    return { done, total, accounts: perAccount, finished: done >= total, error: null };
  };
  let codeModel: string = DEFAULT_CODE_MODEL;
  let sortFolders: SortFolder[] = ["inbox"];
  const categoryState = (): CategoryState => ({
    categories: categories.map((category) => ({ ...category })),
    ai: { configured: aiConfigured, model: "typesafe-ai/jev", codeModel, sortFolders: [...sortFolders], lastError: null, pending: 0, sorting: sortProgress() },
  });

  return {
    accounts: {
      async list() {
        await wait(60);
        return accounts;
      },
      async add(input: AddAccountInput) {
        await wait(900);
        const provider = input.provider;
        const email =
          "email" in input && input.email ? input.email : `new-${accounts.length}@demo.example`;
        const account: Account = {
          id: `demo-${accounts.length + 1}-${Date.now()}`,
          provider,
          email,
          displayName: email.split("@")[0],
          alias: normalizeAlias(input.alias),
          auth: input.kind === "password" ? "password" : "oauth",
          hue: (accounts.length * 67 + 210) % 360,
          outlookKind: input.provider === "outlook" ? input.outlookKind : undefined,
        };
        accounts = [...accounts, account];
        return account;
      },
      async setAvatar(accountId, avatar) {
        await wait(60);
        const existing = accounts.find((account) => account.id === accountId);
        if (!existing) throw new Error("That account no longer exists.");
        const { avatar: _old, ...rest } = existing;
        const updated: Account = avatar ? { ...rest, avatar } : rest;
        accounts = accounts.map((account) => (account.id === accountId ? updated : account));
        return updated;
      },
      async setAlias(accountId, alias) {
        await wait(60);
        const existing = accounts.find((account) => account.id === accountId);
        if (!existing) throw new Error("That account no longer exists.");
        const { alias: _old, ...rest } = existing;
        const normalized = normalizeAlias(alias);
        const updated: Account = normalized ? { ...rest, alias: normalized } : rest;
        accounts = accounts.map((account) => (account.id === accountId ? updated : account));
        return updated;
      },
      async remove(accountId) {
        await wait(60);
        accounts = accounts.filter((account) => account.id !== accountId);
        messages = messages.filter((message) => message.accountId !== accountId);
        notify();
      },
      async capabilities() {
        return capabilities;
      },
    },
    mail: {
      async list(query) {
        // The demo keeps no copy between launches, so there is nothing to paint ahead of the real answer.
        if (query.cacheOnly) return { messages: [], errors: [] };
        await wait();
        const wanted = query.accountIds ?? [];
        const rows = messages.filter((message) => {
          if (wanted.length > 0 && !wanted.includes(message.accountId)) return false;
          if (query.folder === "pinned") return message.folder === "inbox" && message.pinned;
          return message.folder === query.folder;
        });
        return {
          messages: rows
            .map(summarize)
            .map((message) => {
              const key = `${message.accountId}:${message.threadId}`;
              const manual = manualCategories.get(key);
              return {
                ...message,
                categoryId: manual !== undefined ? manual : demoCategoryId(message, categories),
              };
            })
            .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
            .slice(0, query.limit ?? 200),
          errors: [],
        };
      },
      async get(ids) {
        // Dev switches to see the slow and failing states: ?slow=8000 delays opening a message,
        // ?getfail=N fails the first N opens (a retry after that works).
        const slow = Number(new URLSearchParams(window.location.search).get("slow")) || 0;
        await wait(100 + slow);
        if (getFailures > 0) {
          getFailures -= 1;
          throw new Error("Simulated server error.");
        }
        return ids.flatMap((id) => messages.filter((message) => message.id === id));
      },
      async openAttachment(messageId, attachmentId) {
        const file = demoFile(messages, messageId, attachmentId);
        await wait(150);
        window.open(URL.createObjectURL(file.blob), "_blank", "noopener");
      },
      async saveAttachment(messageId, attachmentId) {
        const file = demoFile(messages, messageId, attachmentId);
        await wait(150);
        const link = document.createElement("a");
        link.href = URL.createObjectURL(file.blob);
        link.download = file.name;
        link.click();
        return true;
      },
      async respondToInvitation(messageId, response: InvitationResponse) {
        await wait(500);
        const target = messages.find((message) => message.id === messageId);
        if (!target?.invitation) throw new Error("This message has no invitation to answer.");
        const { uid } = target.invitation;
        // The answer belongs to the meeting, so every message about it shows it.
        messages = messages.map((message) =>
          message.invitation?.uid === uid ? { ...message, invitation: { ...message.invitation, response } } : message,
        );
      },
      async verificationCodes(ids) {
        // The demo reads with the same rules as the app and has no model to fall back on.
        await wait(60);
        const found: Record<string, string | null> = {};
        for (const message of messages) {
          if (!ids.includes(message.id)) continue;
          const text = message.text?.trim() ? message.text : htmlToText(message.html ?? "");
          found[message.id] = extractVerificationCode({ subject: message.subject, text });
        }
        return found;
      },
      async act(action: MailAction, ids) {
        await wait(80);
        const target = new Set(ids);
        const moveTo = { archive: "archive", unarchive: "inbox", trash: "trash", spam: "spam" } as const;
        messages = messages.flatMap((message): MessageDetail[] => {
          if (!target.has(message.id)) return [message];
          switch (action) {
            case "markRead":
              return [{ ...message, unread: false }];
            case "markUnread":
              return [{ ...message, unread: true }];
            case "pin":
              return [{ ...message, pinned: true }];
            case "unpin":
              return [{ ...message, pinned: false }];
            case "deleteForever":
              return [];
            default:
              return [{ ...message, folder: moveTo[action] }];
          }
        });
      },
      async send(draft: Draft) {
        await wait(400);
        const account = accounts.find((candidate) => candidate.id === draft.accountId);
        if (!account) throw new Error("Pick an account to send from.");
        const nativeId = `sent-${Date.now()}`;
        const repliedTo = draft.inReplyTo && draft.inReplyTo.mode !== "forward" ? draft.inReplyTo.messageId : null;
        messages = [
          ...messages.map((message) =>
            repliedTo && message.messageId === repliedTo ? { ...message, answered: true } : message,
          ),
          {
            id: makeMessageId({ accountId: account.id, folder: "sent", nativeId }),
            accountId: account.id,
            folder: "sent",
            threadId: nativeId,
            from: { name: account.displayName, email: account.email },
            to: draft.to,
            subject: draft.subject,
            snippet: draft.text.slice(0, 160),
            date: new Date().toISOString(),
            unread: false,
            pinned: false,
            answered: false,
            hasAttachments: false,
            signal: "person",
            categoryId: null,
            cc: draft.cc,
            replyTo: null,
            messageId: `<${nativeId}@demo.example>`,
            references: [],
            html: null,
            text: draft.text,
            attachments: [],
          },
        ];
      },
      async contacts() {
        await wait(60);
        return buildContactIndex(messages, new Set(accounts.map((account) => account.email.toLowerCase())));
      },
      onChanged(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    senders: {
      async trusted() {
        return [...trustedSenders];
      },
      async trust(email) {
        trustedSenders.add(trustKey(email));
        return [...trustedSenders];
      },
      async untrust(email) {
        trustedSenders.delete(trustKey(email));
        return [...trustedSenders];
      },
    },
    drafts: {
      async list() {
        return demoDrafts;
      },
      async save(draft) {
        demoDrafts = [draft, ...demoDrafts.filter((existing) => existing.id !== draft.id)];
        return demoDrafts;
      },
      async remove(id) {
        demoDrafts = demoDrafts.filter((existing) => existing.id !== id);
        return demoDrafts;
      },
    },
    prefs: {
      async get() {
        return { ...demoPrefs, shownFolders: [...demoPrefs.shownFolders] };
      },
      async set(patch) {
        demoPrefs = { ...demoPrefs, ...patch };
      },
    },
    logos: {
      async get(requests) {
        await wait(80);
        return Object.fromEntries(requests.map((request) => [logoKey(request), demoLogo(request)]));
      },
      async settings() {
        return { ...logoSettings };
      },
      async setSettings(next) {
        logoSettings = { ...next };
        return { ...logoSettings };
      },
    },
    categories: {
      async get() {
        await wait(40);
        return categoryState();
      },
      async save(next) {
        await wait(80);
        const problems = categoryProblems(next);
        if (problems.length > 0) throw new Error(problems[0]);
        categories = next.map((category) => ({
          ...category,
          name: category.name.trim(),
          criteria: category.criteria.trim(),
        }));
        notify();
        return categoryState();
      },
      async setGatewayKey(key) {
        await wait(80);
        if (key.trim().length < 8) throw new Error("That does not look like an API key.");
        aiConfigured = true;
        return categoryState();
      },
      async clearGatewayKey() {
        await wait(40);
        aiConfigured = false;
        return categoryState();
      },
      async setCodeModel(model) {
        await wait(40);
        if (!CODE_MODEL_PATTERN.test(model.trim())) throw new Error('Use a gateway model id like "reflection/beam".');
        codeModel = model.trim();
        return categoryState();
      },
      async setSortFolders(folders) {
        await wait(40);
        sortFolders = [...folders];
        return categoryState();
      },
      async testGateway() {
        await wait(600);
        if (!aiConfigured) throw new Error("No Vercel AI Gateway key is set.");
      },
      async reclassify(_options) {
        await wait(40);
        sortStartedAt = Date.now();
        notify();
      },
      async assign(threads, categoryId) {
        await wait(40);
        for (const key of threads) manualCategories.set(key, categoryId);
        notify();
      },
      async sortCounts(options) {
        await wait(40);
        const since = options?.since ? Date.parse(options.since) : null;
        const count = (folder: MailFolder) =>
          new Set(
            messages
              .filter((message) => message.folder === folder && (since === null || Date.parse(message.date) >= since))
              .map((message) => `${message.accountId}:${message.threadId}`),
          ).size;
        return { inbox: count("inbox"), archive: count("archive"), spam: count("spam"), trash: count("trash") };
      },
    },
    notifications: {
      async settings() {
        return structuredClone(demoNotifications);
      },
      async setSettings(next) {
        demoNotifications = structuredClone(next);
        return structuredClone(demoNotifications);
      },
      async test() {
        if (typeof Notification !== "undefined" && Notification.permission === "default") {
          await Notification.requestPermission();
        }
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification("MiniMail", { body: "This is how a notification will look." });
        }
      },
    },
    system: {
      async openExternal(url) {
        window.open(url, "_blank", "noopener,noreferrer");
      },
      platform: "darwin",
      demo: true,
    },
  };
}

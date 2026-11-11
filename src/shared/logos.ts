import { senderDomain } from "./categories";
import type { Account, MessageSummary } from "./types";

/**
 * What the UI may ask the main process to look up. The main process re-checks every request, so
 * a compromised page cannot use this to make the app contact arbitrary sites.
 */
export type LogoRequest =
  /** A company's logo, for authenticated bulk or automated mail from its domain. */
  | { kind: "brand"; domain: string }
  /** A person's photo (Gravatar), for authenticated mail from them. */
  | { kind: "person"; email: string }
  /** The icon of the site behind one of the user's own accounts. */
  | { kind: "own"; domain: string };

export interface LogoSettings {
  /** Show company logos on bulk and automated mail. */
  companyLogos: boolean;
  /**
   * Look up people's photos on Gravatar. Off by default: it sends a hash of each sender's address
   * to a third party, which then learns who writes to you.
   */
  personPhotos: boolean;
}

export const DEFAULT_LOGO_SETTINGS: LogoSettings = { companyLogos: true, personPhotos: false };

/** Mailbox providers: an address there says nothing about a company, and its icon would be the provider's. */
const FREEMAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "ymail.com", "rocketmail.com", "icloud.com", "me.com", "mac.com", "aol.com",
  "proton.me", "protonmail.com", "pm.me", "gmx.com", "gmx.net", "gmx.de", "mail.com",
  "zoho.com", "zohomail.com", "yandex.com", "yandex.ru", "mail.ru", "qq.com", "163.com",
  "126.com", "fastmail.com", "fastmail.fm", "hey.com", "tutanota.com", "tuta.io", "web.de",
  "bol.com.br", "uol.com.br", "terra.com.br", "ig.com.br",
]);

/** Regional variants of the big providers (hotmail.co.uk, outlook.com.br, yahoo.co.jp, ...). */
const FREEMAIL_BRANDS = /^(hotmail|outlook|live|msn|yahoo|ymail|gmx|icloud)\./;

/**
 * Services that send mail on behalf of other companies. Their logo would stand for the sender,
 * which is misleading, so mail from them keeps initials.
 */
const SENDING_SERVICES = new Set([
  "sendgrid.net", "sendgrid.com", "mailchimp.com", "mcsv.net", "mcdlv.net", "rsgsv.net",
  "list-manage.com", "amazonses.com", "mandrillapp.com", "mailgun.org", "mailgun.com",
  "postmarkapp.com", "pstmrk.it", "sparkpostmail.com", "sparkpost.com", "mailjet.com",
  "sendinblue.com", "brevo.com", "constantcontact.com", "campaign-archive.com",
  "createsend.com", "cmail19.com", "cmail20.com", "hubspotemail.net", "hs-send.com",
  "klaviyomail.com", "customeriomail.com", "intercom-mail.com", "mktomail.com",
  "exacttarget.com", "beehiiv.com", "substack.com", "convertkit.com", "kit.com",
  "mailerlite.com", "sendpulse.com", "emailsrvr.com", "rsys5.com", "salesforce.com",
  "sfmc-content.com", "eventbrite.com", "msgfocus.com", "bounces.google.com",
]);

export function isFreemail(domain: string): boolean {
  const lower = domain.toLowerCase();
  return FREEMAIL.has(lower) || FREEMAIL_BRANDS.test(lower);
}

export function isSendingService(domain: string): boolean {
  return SENDING_SERVICES.has(domain.toLowerCase());
}

/** True for something that can be a public host name (letters, digits, dots, dashes; has a dot). */
export function isPlausibleDomain(domain: string): boolean {
  return (
    domain.length <= 253 &&
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain.toLowerCase())
  );
}

/**
 * Which lookup, if any, a message's sender qualifies for.
 *
 * A logo is only ever shown for mail that passed sender authentication: the From address is
 * trivial to forge, and a trusted brand's logo on a forged message would lend it false trust.
 */
export function logoRequestFor(
  message: Pick<MessageSummary, "from" | "signal" | "authenticated">,
): LogoRequest | null {
  if (message.authenticated !== true) return null;
  const email = message.from.email.trim().toLowerCase();
  if (!email.includes("@")) return null;

  const domain = senderDomain(email);
  if (!isPlausibleDomain(domain)) return null;
  if (isFreemail(domain)) return { kind: "person", email };
  if (isSendingService(domain)) return null;
  const bulk = message.signal === "newsletter" || message.signal === "notification";
  return bulk ? { kind: "brand", domain } : { kind: "person", email };
}

/**
 * The company logo to show when a person lookup finds no photo: mail from someone at a company
 * (not a mailbox provider or a bulk-sending service) still says which company it came from. Only
 * the domain is looked up, which is all the "Company logos" switch already allows.
 */
export function brandFallbackFor(request: LogoRequest | null | undefined): LogoRequest | null {
  if (request?.kind !== "person") return null;
  const domain = senderDomain(request.email);
  if (!isPlausibleDomain(domain) || isFreemail(domain) || isSendingService(domain)) return null;
  return { kind: "brand", domain };
}

/** The site icon to show for one of the user's accounts, or null when its address is on a mailbox provider. */
export function accountLogoRequest(account: Pick<Account, "email">): LogoRequest | null {
  const domain = senderDomain(account.email);
  return isPlausibleDomain(domain) && !isFreemail(domain) ? { kind: "own", domain } : null;
}

/**
 * Stable key for a request, shared by the page and the main process. Company logos and the icons
 * of the user's own accounts have separate keys: the first obeys the "Company logos" switch, the
 * second does not, and one must not answer for the other.
 */
export function logoKey(request: LogoRequest): string {
  if (request.kind === "person") return `person:${request.email.trim().toLowerCase()}`;
  return `${request.kind}:${request.domain.toLowerCase()}`;
}

/**
 * Reads the Authentication-Results header the receiving server added and says whether the
 * sender is who the From address claims: DMARC passed, or DKIM passed for the From domain.
 */
export function isAuthenticated(authenticationResults: string | undefined, fromEmail: string): boolean {
  if (!authenticationResults) return false;
  const value = authenticationResults.toLowerCase();
  if (/\bdmarc\s*=\s*pass\b/.test(value)) return true;

  const fromDomain = senderDomain(fromEmail);
  for (const match of value.matchAll(/\bdkim\s*=\s*pass\b[^;]*?header\.(?:d|i)\s*=\s*@?([a-z0-9.-]+)/g)) {
    if (senderDomain(`x@${match[1]}`) === fromDomain) return true;
  }
  return false;
}

/**
 * The first (topmost) occurrence of a header in a raw header block. The receiving server adds
 * its Authentication-Results above everything else, so the first one is the one to trust; a
 * sender can plant extra ones further down.
 */
export function firstHeader(rawHeaders: string, name: string): string | undefined {
  const headerEnd = rawHeaders.search(/\r?\n\r?\n/);
  const block = headerEnd >= 0 ? rawHeaders.slice(0, headerEnd) : rawHeaders;
  const unfolded = block.replace(/\r?\n[ \t]+/g, " ");
  const wanted = `${name.toLowerCase()}:`;
  for (const line of unfolded.split(/\r?\n/)) {
    if (line.toLowerCase().startsWith(wanted)) return line.slice(wanted.length).trim();
  }
  return undefined;
}

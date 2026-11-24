import { htmlToText } from "./verification-code";

/**
 * Links in the text of a message that are worth listing: a file kept online (Drive, OneDrive, Dropbox...)
 * or a video call (Zoom, Meet, Teams, Webex). Shared so the conversation's list, the invitations read from
 * a calendar file and the notes of an invitation all recognise the same addresses.
 */

export interface FoundLink {
  url: string;
  /** The address's host, shown so the person sees where it goes. */
  host: string;
  /** The link's own wording when it says something, else the service's name for it ("Google Drive file"). */
  label: string;
  kind: "file" | "meeting";
}

interface LinkService {
  /** Matches the host (and path, where the host alone says too little) of an address worth listing. */
  match: (host: string, path: string) => boolean;
  kind: FoundLink["kind"];
  /** What the row says when the link's own text does not. */
  fallback: string;
}

const hostIs = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`);

/**
 * The services listed. Only addresses that open one file, folder or call count, so a footer link to a
 * service's home page, or a sign-in page, is not listed. A short list on purpose: a link that is missed
 * is only a row that is not there.
 */
const LINK_SERVICES: LinkService[] = [
  { match: (host, path) => host === "drive.google.com" && /^\/(file\/d\/|drive\/(u\/\d+\/)?folders\/|open$|folderview$)/.test(path), kind: "file", fallback: "Google Drive file" },
  { match: (host, path) => host === "docs.google.com" && /^\/(document|spreadsheets|presentation|forms)\/d\//.test(path), kind: "file", fallback: "Google Docs file" },
  { match: (host, path) => (host === "onedrive.live.com" && path.length > 1) || host === "1drv.ms", kind: "file", fallback: "OneDrive file" },
  { match: (host, path) => hostIs(host, "sharepoint.com") && /^\/(:[a-z]:\/|sites\/|personal\/)/.test(path), kind: "file", fallback: "SharePoint file" },
  { match: (host, path) => (hostIs(host, "dropbox.com") && /^\/(s|scl|sh|l)\//.test(path)) || host === "db.tt", kind: "file", fallback: "Dropbox file" },
  { match: (host, path) => (host === "icloud.com" || host === "www.icloud.com") && path.startsWith("/iclouddrive/"), kind: "file", fallback: "iCloud file" },
  { match: (host, path) => (hostIs(host, "wetransfer.com") && path.startsWith("/downloads/")) || host === "we.tl", kind: "file", fallback: "WeTransfer files" },
  { match: (host, path) => hostIs(host, "box.com") && path.startsWith("/s/"), kind: "file", fallback: "Box file" },
  { match: (host, path) => hostIs(host, "zoom.us") && /^\/(j|my|w)\//.test(path), kind: "meeting", fallback: "Zoom meeting" },
  { match: (host, path) => host === "meet.google.com" && /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(path), kind: "meeting", fallback: "Google Meet" },
  { match: (host, path) => host === "teams.microsoft.com" ? path.startsWith("/l/meetup-join/") || path.startsWith("/meet/") : host === "teams.live.com" && path.startsWith("/meet/"), kind: "meeting", fallback: "Microsoft Teams meeting" },
  { match: (host, path) => hostIs(host, "webex.com") && /^\/(meet|join|[^/]+\/j\.php)/.test(path), kind: "meeting", fallback: "Webex meeting" },
];

/** Text of a message that can hold a listed address, checked first so most messages are never searched. */
const LINK_HINT = /drive\.google|docs\.google|onedrive|1drv\.ms|sharepoint|dropbox|db\.tt|icloud|wetransfer|we\.tl|box\.com|zoom\.us|meet\.google|teams\.(microsoft|live)|webex/i;

/** Link texts that say nothing about the file ("Open", "Click here"), so the service's own name is used. */
const GENERIC_LINK_TEXT = /^(open|view|join|download|click here|here|link|this link|access|get|see|go to|open in \w+( \w+)?|view (file|document|online)|join (meeting|now|the meeting|with \w+( \w+)?))$/i;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decodeEntities = (value: string): string =>
  value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1]!.toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });

/** What a link says: its words with no markup, or "" when that is not a usable label. */
function usableLabel(inner: string): string {
  const text = decodeEntities(inner.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  if (text.length < 3 || text.length > 80 || /^https?:\/\//i.test(text) || GENERIC_LINK_TEXT.test(text)) return "";
  return text;
}

/** `[address, wording]` of every link in a message: the `<a>` elements of its HTML, else the addresses in its plain text. */
function rawLinks(html: string | null, text: string | null): [string, string][] {
  if (html) {
    return [...html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a\s*>/gi)].map((match) => [
      decodeEntities(match[1] ?? match[2] ?? ""),
      usableLabel(match[3] ?? ""),
    ]);
  }
  if (text) return [...text.matchAll(/https?:\/\/[^\s<>"']+/gi)].map((match) => [match[0].replace(/[.,;:!?)\]]+$/, ""), ""]);
  return [];
}

/**
 * The online files and calls a message links to, in the order they appear, once each. The address is the
 * identity, without its `#fragment`; a link that appears twice keeps the first wording that says something.
 */
export function findLinks(html: string | null, text: string | null): FoundLink[] {
  if (!LINK_HINT.test(html ?? text ?? "")) return [];
  const found = new Map<string, FoundLink>();
  for (const [address, wording] of rawLinks(html, text)) {
    let url: URL;
    try {
      url = new URL(address.trim());
    } catch {
      continue; // expected: an href that is not an address ("#", "javascript:", a mail merge placeholder) is not a link to list.
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    const host = url.hostname.toLowerCase();
    const service = LINK_SERVICES.find((entry) => entry.match(host, url.pathname));
    if (!service) continue;
    url.hash = "";
    const key = url.href;
    const known = found.get(key);
    if (known) {
      if (wording && known.label === service.fallback) known.label = wording;
      continue;
    }
    found.set(key, { url: key, host, label: wording || service.fallback, kind: service.kind });
  }
  return [...found.values()];
}

/** An address as the list keeps it (no `#fragment`), or null when it is not an http(s) address. */
export function normalizeLink(address: string): string | null {
  try {
    const url = new URL(address.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    return url.href;
  } catch {
    // expected: a value that is not an address ("#", a placeholder) is not a link.
    return null;
  }
}

/** The first video-call address in a text (a calendar's location or notes), or null. */
export function meetingLinkIn(text: string | null | undefined): string | null {
  return text ? (findLinks(null, text).find((link) => link.kind === "meeting")?.url ?? null) : null;
}

/**
 * HTML as plain lines for reading, with each link's address kept beside its words so it can be clicked
 * ("Join the meeting" becomes "Join the meeting https://...").
 */
export function notesFromHtml(html: string): string {
  const withAddresses = html.replace(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a\s*>/gi, (_whole, double, single, inner: string) => {
    const address = normalizeLink(decodeEntities(double ?? single ?? ""));
    const words = decodeEntities(inner.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
    return address && !words.includes(address) ? ` ${words} ${address} ` : ` ${inner} `;
  });
  return htmlToText(withAddresses);
}

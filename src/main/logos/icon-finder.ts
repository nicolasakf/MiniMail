import { createHash } from "node:crypto";

import type { FetchedResource, FetchOptions } from "./net-guard";

/** A validated image ready to embed as a data URL. */
export interface Icon {
  mime: string;
  data: Buffer;
}

/** Larger icons are rejected (they bloat the cache); a smaller candidate is tried instead. */
export const MAX_ICON_BYTES = 24 * 1024;
/** Icon links live in <head>, near the top; modern pages are hundreds of KB, so read only the start. */
const MAX_HTML_BYTES = 128 * 1024;

export function toDataUrl(icon: Icon): string {
  return `data:${icon.mime};base64,${icon.data.toString("base64")}`;
}

/** Identifies an image by its first bytes, never by what the server claims. Null if not an image we show. */
export function sniffImage(body: Buffer): Icon | null {
  if (body.length < 8) return null;
  const head = body.subarray(0, 12);
  const is = (...bytes: number[]) => bytes.every((byte, index) => head[index] === byte);
  if (is(0x89, 0x50, 0x4e, 0x47)) return { mime: "image/png", data: body };
  if (is(0xff, 0xd8, 0xff)) return { mime: "image/jpeg", data: body };
  if (is(0x47, 0x49, 0x46, 0x38)) return { mime: "image/gif", data: body };
  if (is(0x52, 0x49, 0x46, 0x46) && head.subarray(8, 12).toString("latin1") === "WEBP") {
    return { mime: "image/webp", data: body };
  }
  if (is(0x00, 0x00, 0x01, 0x00)) return { mime: "image/x-icon", data: body };
  const text = body.subarray(0, 512).toString("utf8").trimStart().toLowerCase();
  if (text.startsWith("<svg") || (text.startsWith("<?xml") && text.includes("<svg"))) {
    return { mime: "image/svg+xml", data: body };
  }
  return null;
}

/** The logo URL from a BIMI DNS record ("v=BIMI1; l=https://...; a=..."), https only. */
export function parseBimi(records: readonly string[]): string | undefined {
  for (const record of records) {
    if (!/^\s*v\s*=\s*BIMI1/i.test(record)) continue;
    const match = /(?:^|;)\s*l\s*=\s*(https:\/\/[^;\s]+)/i.exec(record);
    if (match) return match[1];
  }
  return undefined;
}

export interface IconLink {
  url: string;
  /** Higher is better. */
  score: number;
}

/** Icons the page declares (<link rel="icon" ...>), best first. Ignores anything not http(s). */
export function pickIconLinks(html: string, baseUrl: string): IconLink[] {
  const found: IconLink[] = [];
  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = new Map<string, string>();
    for (const attribute of tag[0].matchAll(/([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attrs.set(attribute[1].toLowerCase(), attribute[2] ?? attribute[3] ?? attribute[4] ?? "");
    }
    const rel = (attrs.get("rel") ?? "").toLowerCase().split(/\s+/);
    const touch = rel.some((token) => token.startsWith("apple-touch-icon"));
    if (!touch && !rel.includes("icon")) continue;
    const href = attrs.get("href");
    if (!href) continue;

    let url: URL;
    try {
      url = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (url.protocol !== "https:") continue;

    const sizes = (attrs.get("sizes") ?? "").toLowerCase();
    const largest = Math.max(0, ...[...sizes.matchAll(/(\d+)x\d+/g)].map((m) => Number(m[1])));
    const isSvg = (attrs.get("type") ?? "").includes("svg") || url.pathname.toLowerCase().endsWith(".svg");
    // Touch icons are made to sit on a tile, so they come first; then vector logos; then plain
    // icons, preferring about 128 px (sharp at 36 px on a retina screen without being heavy).
    let score: number;
    if (touch) score = 100 + Math.min(largest || 180, 256) / 256;
    else if (isSvg) score = 90;
    else {
      const size = largest || 32;
      score = size >= 64 ? 80 - Math.abs(size - 128) / 16 : size / 2;
    }
    found.push({ url: url.toString(), score });
  }
  return found.sort((a, b) => b.score - a.score);
}

export interface FinderDeps {
  fetch: (url: string, options?: FetchOptions) => Promise<FetchedResource>;
  /** DNS TXT records of a name; rejects when there are none. */
  resolveTxt: (name: string) => Promise<string[][]>;
}

export interface FindResult {
  icon: Icon | null;
  /**
   * True when every step got a real answer (so "no icon" can be remembered for long). False when
   * something failed to connect, so the next attempt should come sooner.
   */
  definitive: boolean;
}

/** Fetches `url` and returns it as an icon if it is a small enough image. */
async function tryIcon(
  deps: FinderDeps,
  url: string,
  report: { failed: boolean },
  maxBytes = MAX_ICON_BYTES,
): Promise<Icon | null> {
  try {
    const response = await deps.fetch(url, { maxBytes, accept: "image/*,*/*;q=0.5" });
    if (response.status < 200 || response.status >= 300) return null;
    return sniffImage(response.body);
  } catch (error) {
    if (!/too large/i.test(String(error))) report.failed = true;
    return null;
  }
}

/** Finds a site's logo: BIMI, then the icon the homepage declares, then /favicon.ico. */
export async function findSiteIcon(domain: string, deps: FinderDeps): Promise<FindResult> {
  const report = { failed: false };

  // 1. BIMI: the logo the brand publishes for mail (an SVG; DNS tells where it lives).
  try {
    const records = await deps.resolveTxt(`default._bimi.${domain}`);
    const url = parseBimi(records.map((parts) => parts.join("")));
    if (url) {
      const icon = await tryIcon(deps, url, report);
      if (icon) return { icon, definitive: true };
    }
  } catch {
    // No record (the usual case) or DNS trouble: carry on with the site's own icon.
  }

  // 2. The icon the homepage declares. Try the bare domain, then www.
  for (const host of [domain, `www.${domain}`]) {
    const home = `https://${host}/`;
    let html: FetchedResource | null = null;
    try {
      html = await deps.fetch(home, { maxBytes: MAX_HTML_BYTES, truncate: true, accept: "text/html" });
    } catch {
      report.failed = true;
      continue;
    }
    if (html.status < 200 || html.status >= 300) continue;
    const links = pickIconLinks(html.body.toString("utf8"), html.url);
    for (const link of links.slice(0, 3)) {
      const icon = await tryIcon(deps, link.url, report);
      if (icon) return { icon, definitive: true };
    }
    const fallback = await tryIcon(deps, new URL("/favicon.ico", html.url).toString(), report);
    if (fallback) return { icon: fallback, definitive: true };
    return { icon: null, definitive: !report.failed };
  }

  // 3. Homepage unreachable on both hosts: last resort, the conventional location.
  const direct = await tryIcon(deps, `https://${domain}/favicon.ico`, report);
  return { icon: direct, definitive: direct ? true : !report.failed };
}

/** Looks a person up on Gravatar by the hash of their address; none if they have no photo. */
export async function findGravatar(
  email: string,
  deps: Pick<FinderDeps, "fetch">,
): Promise<FindResult> {
  const hash = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
  const report = { failed: false };
  const icon = await tryIcon(
    { fetch: deps.fetch, resolveTxt: async () => [] },
    `https://gravatar.com/avatar/${hash}?s=128&d=404`,
    report,
  );
  return { icon, definitive: icon ? true : !report.failed };
}

/** Cache key for a person: the hash, so the cache file never lists anyone's address. */
export function personHash(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

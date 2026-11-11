import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { BlockList, isIP } from "node:net";

/**
 * Fetching icons means contacting hosts an email's sender chose. Without care that lets a sender
 * point the app at the user's own machine or network ("localhost", 192.168.x.x, cloud metadata).
 * Everything here refuses non-public destinations, checks them at connect time (so DNS cannot
 * answer differently between the check and the connection), and bounds time and size.
 */

const blocked = new BlockList();
const V4: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
];
for (const [address, prefix] of V4) blocked.addSubnet(address, prefix, "ipv4");
const V6: [string, number][] = [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["100::", 64],
  ["2001::", 32], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
];
for (const [address, prefix] of V6) blocked.addSubnet(address, prefix, "ipv6");

/** True only for addresses on the public internet. Unparseable input is not public. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  if (family === 6) {
    // IPv4-mapped IPv6 (::ffff:a.b.c.d, in any spelling) is a way to reach an IPv4 address, and
    // nothing legitimate resolves to one. (It cannot be a BlockList rule: Node would then match
    // every IPv4 address against it.)
    const canonical = new URL(`http://[${address}]/`).hostname;
    if (canonical.startsWith("[::ffff:")) return false;
  }
  return !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

export class BlockedDestinationError extends Error {}

export interface FetchOptions {
  /** Whole-request budget including redirects (default 8 s). */
  timeoutMs?: number;
  /** Stop and fail once the body is larger than this (default 64 KB), unless `truncate` is set. */
  maxBytes?: number;
  /** Keep the first `maxBytes` and succeed instead of failing: for pages whose useful part is at the top. */
  truncate?: boolean;
  accept?: string;
  maxRedirects?: number;
  /** For tests only. */
  allowHttp?: boolean;
  /** For tests only: replaces the public-address check. */
  isAllowedAddress?: (address: string) => boolean;
  /** For tests only. */
  lookup?: (host: string, cb: (error: Error | null, addresses: LookupAddress[]) => void) => void;
}

export interface FetchedResource {
  status: number;
  contentType: string;
  body: Buffer;
  /** The URL the body came from, after redirects. */
  url: string;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** GET a public https URL. Rejects for blocked destinations, timeouts and oversized bodies. */
export async function safeFetch(url: string, options: FetchOptions = {}): Promise<FetchedResource> {
  const deadline = Date.now() + (options.timeoutMs ?? 8000);
  let current = url;
  for (let hop = 0; hop <= (options.maxRedirects ?? 3); hop++) {
    const response = await getOnce(current, options, deadline);
    if (!REDIRECTS.has(response.status)) return { ...response, url: current };
    const location = response.location;
    if (!location) return { ...response, url: current };
    current = new URL(location, current).toString();
  }
  throw new Error("Too many redirects.");
}

interface Hop {
  status: number;
  contentType: string;
  body: Buffer;
  location?: string;
}

function getOnce(rawUrl: string, options: FetchOptions, deadline: number): Promise<Hop> {
  return new Promise<Hop>((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      reject(new Error("Invalid URL."));
      return;
    }
    const secure = url.protocol === "https:";
    if (!secure && !(options.allowHttp && url.protocol === "http:")) {
      reject(new BlockedDestinationError("Only https is allowed."));
      return;
    }
    // Default ports only: stops a sender from using the app to probe other services.
    if (url.port && url.port !== (secure ? "443" : "80") && !options.allowHttp) {
      reject(new BlockedDestinationError("Only the default port is allowed."));
      return;
    }
    if (url.username || url.password) {
      reject(new BlockedDestinationError("Credentials in URLs are not allowed."));
      return;
    }

    const allowed = options.isAllowedAddress ?? isPublicAddress;
    // An address written into the URL never goes through DNS, so the lookup check below would
    // not see it: check it here.
    const literal = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(literal) !== 0 && !allowed(literal)) {
      reject(new BlockedDestinationError("Destination is not a public address."));
      return;
    }
    const resolveAll =
      options.lookup ??
      ((host, cb) => dnsLookup(host, { all: true, verbatim: true }, (error, found) => cb(error, found)));
    const maxBytes = options.maxBytes ?? 64 * 1024;
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      reject(new Error("Timed out."));
      return;
    }

    const send = secure ? httpsRequest : httpRequest;
    const req = send(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: {
          // Generic on purpose: nothing about the user or their account.
          "User-Agent": "MiniMail",
          Accept: options.accept ?? "*/*",
          "Accept-Encoding": "identity",
        },
        // The connection uses exactly the addresses checked here, so a second DNS answer cannot
        // swap in a private one.
        lookup: (host, lookupOptions, callback) => {
          resolveAll(host, (error, addresses) => {
            if (error) return callback(error, "", 4);
            const bad = addresses.find((entry) => !allowed(entry.address));
            if (addresses.length === 0 || bad) {
              return callback(new BlockedDestinationError("Destination is not a public address."), "", 4);
            }
            if ((lookupOptions as { all?: boolean }).all) {
              return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
            }
            return callback(null, addresses[0].address, addresses[0].family);
          });
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const chunks: Buffer[] = [];
        let size = 0;
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          resolve({
            status,
            contentType: String(response.headers["content-type"] ?? "").toLowerCase(),
            body: Buffer.concat(chunks),
            location: typeof response.headers.location === "string" ? response.headers.location : undefined,
          });
        };
        response.on("data", (chunk: Buffer) => {
          if (finished) return;
          size += chunk.length;
          if (size > maxBytes) {
            if (!options.truncate) {
              req.destroy(new Error("Response too large."));
              return;
            }
            chunks.push(chunk.subarray(0, chunk.length - (size - maxBytes)));
            finish();
            response.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", finish);
        response.on("error", (error) => {
          if (!finished) reject(error);
        });
      },
    );
    req.setTimeout(remaining, () => req.destroy(new Error("Timed out.")));
    const overall = setTimeout(() => req.destroy(new Error("Timed out.")), remaining);
    req.on("close", () => clearTimeout(overall));
    req.on("error", (error) => reject(error));
    req.end();
  });
}

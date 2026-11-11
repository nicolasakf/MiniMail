import { senderDomain } from "@shared/categories";
import {
  isFreemail,
  isPlausibleDomain,
  isSendingService,
  logoKey,
  type LogoRequest,
  type LogoSettings,
} from "@shared/logos";

import { perfLog } from "../perf";
import { personHash, toDataUrl, type FindResult } from "./icon-finder";
import type { LogoCache } from "./logo-cache";

const DAY = 24 * 60 * 60 * 1000;
/** A logo that was found changes rarely. */
const FOUND_TTL = 30 * DAY;
/** "This site has no icon": worth remembering, but sites do add them. */
const NONE_TTL = 7 * DAY;
const NONE_PERSON_TTL = 3 * DAY;
/**
 * A lookup that could not connect: try again soon, the network may just have been down. Kept in
 * memory only, never saved, so a bad moment (offline, a bug) cannot outlive the session.
 */
const FAILED_TTL = 2 * 60 * 1000;

export interface LogoServiceDeps {
  cache: Pick<LogoCache, "get" | "set">;
  settings: { get(): LogoSettings };
  /** Domains of the user's own accounts: the only ones "own" lookups may ask about. */
  accountDomains: () => ReadonlySet<string>;
  findSite: (domain: string) => Promise<FindResult>;
  findPerson: (email: string) => Promise<FindResult>;
  now?: () => number;
  /** Lookups running at once (default 3). */
  concurrency?: number;
}

/**
 * Answers "what logo or photo goes with this sender" for the page. It decides what may be looked
 * up (the page's request is only a request), remembers answers, and limits how many sites it
 * talks to at once.
 */
export class LogoService {
  private readonly inflight = new Map<string, Promise<string | null>>();
  private readonly failures = new Map<string, number>();
  private waiting: Array<() => void> = [];
  private running = 0;

  constructor(private readonly deps: LogoServiceDeps) {}

  async get(requests: readonly LogoRequest[]): Promise<Record<string, string | null>> {
    const results: Record<string, string | null> = {};
    await Promise.all(
      requests.map(async (request) => {
        const key = logoKey(request);
        results[key] = await this.resolve(request).catch(() => null);
      }),
    );
    return results;
  }

  /** What the settings and the rules allow for this request; null means do not look anything up. */
  private allowed(request: LogoRequest): { cacheKey: string; lookup: () => Promise<FindResult>; ttlNone: number } | null {
    const { settings } = this.deps;
    const current = settings.get();

    if (request.kind === "person") {
      const email = request.email.trim().toLowerCase();
      const domain = senderDomain(email);
      if (!current.personPhotos || !/^[^@\s]+@[^@\s]+$/.test(email) || !isPlausibleDomain(domain)) return null;
      return {
        cacheKey: `person:${personHash(email)}`,
        lookup: () => this.deps.findPerson(email),
        ttlNone: NONE_PERSON_TTL,
      };
    }

    const domain = request.domain.trim().toLowerCase();
    if (!isPlausibleDomain(domain) || isFreemail(domain)) return null;
    if (request.kind === "brand") {
      if (!current.companyLogos || isSendingService(domain)) return null;
    } else if (!this.deps.accountDomains().has(domain)) {
      return null;
    }
    return { cacheKey: `site:${domain}`, lookup: () => this.deps.findSite(domain), ttlNone: NONE_TTL };
  }

  private resolve(request: LogoRequest): Promise<string | null> {
    const plan = this.allowed(request);
    if (!plan) return Promise.resolve(null);
    const now = (this.deps.now ?? Date.now)();
    const cached = this.deps.cache.get(plan.cacheKey, now);
    if (cached) return Promise.resolve(cached.dataUrl);
    if ((this.failures.get(plan.cacheKey) ?? 0) > now) return Promise.resolve(null);

    const existing = this.inflight.get(plan.cacheKey);
    if (existing) return existing;
    const run = this.limited(async () => {
      const found = await plan.lookup();
      const dataUrl = found.icon ? toDataUrl(found.icon) : null;
      const at = (this.deps.now ?? Date.now)();
      if (!found.icon && !found.definitive) {
        this.failures.set(plan.cacheKey, at + FAILED_TTL);
      } else {
        this.deps.cache.set(plan.cacheKey, { dataUrl, expires: at + (found.icon ? FOUND_TTL : plan.ttlNone) });
      }
      perfLog(`logo ${request.kind === "person" ? "person photo" : `${request.kind} ${request.domain}`}`, found.icon ? `found, ${found.icon.data.length} bytes` : found.definitive ? "none" : "could not reach");
      return dataUrl;
    }).finally(() => this.inflight.delete(plan.cacheKey));
    this.inflight.set(plan.cacheKey, run);
    return run;
  }

  private async limited<T>(task: () => Promise<T>): Promise<T> {
    const limit = this.deps.concurrency ?? 3;
    if (this.running >= limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.running += 1;
    try {
      return await task();
    } finally {
      this.running -= 1;
      this.waiting.shift()?.();
    }
  }
}

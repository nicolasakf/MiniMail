import {
  confirmedCode,
  extractVerificationCode,
  htmlToText,
  isFreshForCode,
  type CodeSource,
} from "@shared/verification-code";
import type { MessageDetail } from "@shared/types";

import type { CodeFallback } from "./code-fallback";
import { describeGatewayError } from "./jev";

/** After the model fails, rules still work; the model is left alone this long. */
const PAUSE_MS = 60_000;
const MAX_CACHED = 300;

interface Entry {
  code: string | null;
  /** The model has already looked (or was not needed), so an empty answer is final. */
  settled: boolean;
}

export interface VerificationCodeDeps {
  /** Opens messages (with their bodies). */
  load: (ids: string[]) => Promise<MessageDetail[]>;
  /** The model fallback, or null when there is no key or the user turned it off. */
  fallback: () => CodeFallback | null;
  now?: () => number;
}

/**
 * Finds the one-time code in verification mail: local rules first, then (when configured) a
 * small model for the messages the rules could not read. Codes are secrets that expire in
 * minutes, so they are kept in memory only, never written to disk or logged.
 */
export class VerificationCodes {
  private readonly cache = new Map<string, Entry>();
  private pausedUntil = 0;

  constructor(private readonly deps: VerificationCodeDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  /** Code (or null) per message id. An id is left out when the lookup failed and can be retried. */
  async get(ids: string[]): Promise<Record<string, string | null>> {
    const result: Record<string, string | null> = {};
    const modelAvailable = this.deps.fallback() !== null && this.now() >= this.pausedUntil;
    const wanted: string[] = [];
    for (const id of new Set(ids)) {
      const cached = this.cache.get(id);
      if (cached && (cached.code !== null || cached.settled || !modelAvailable)) result[id] = cached.code;
      else wanted.push(id);
    }
    if (wanted.length === 0) return result;

    let details: MessageDetail[];
    try {
      details = await this.deps.load(wanted);
    } catch {
      return result;
    }
    await Promise.all(
      details.map(async (detail) => {
        const entry = await this.resolve(detail);
        if (entry) {
          this.remember(detail.id, entry);
          result[detail.id] = entry.code;
        }
      }),
    );
    return result;
  }

  private async resolve(detail: MessageDetail): Promise<Entry | null> {
    if (!isFreshForCode(detail.date, this.now())) return { code: null, settled: true };

    const source: CodeSource = {
      subject: detail.subject,
      text: detail.text?.trim() ? detail.text : htmlToText(detail.html ?? ""),
    };
    const byRules = extractVerificationCode(source);
    if (byRules) return { code: byRules, settled: true };

    const fallback = this.now() >= this.pausedUntil ? this.deps.fallback() : null;
    if (!fallback) return { code: null, settled: false };
    try {
      const answer = await fallback({ ...source, from: detail.from });
      return { code: confirmedCode(answer, source), settled: true };
    } catch (error) {
      // Only the reason is logged, never the message.
      console.error("[codes] model fallback failed:", describeGatewayError(error));
      this.pausedUntil = this.now() + PAUSE_MS;
      return null;
    }
  }

  private remember(id: string, entry: Entry): void {
    this.cache.delete(id);
    this.cache.set(id, entry);
    if (this.cache.size > MAX_CACHED) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }
}

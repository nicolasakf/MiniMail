import { senderDomain } from "./categories";
import { logoRequestFor, type LogoRequest } from "./logos";
import type { Thread } from "./threads";

/** One address mail was received from, with what the Sender view lists about it. */
export interface SenderEntry {
  /** The address in lower case; identifies the sender. */
  key: string;
  /** The name on their most recent message, or the address when it has none. */
  name: string;
  email: string;
  /** Organization domain, see `senderDomain`. */
  domain: string;
  /** Conversations with at least one message from this address. */
  count: number;
  /** True when one of their messages is unread. */
  unread: boolean;
  /** Date of their most recent message. */
  latest: string;
  /** Which logo or photo lookup this sender qualifies for; null means initials. */
  logo: LogoRequest | null;
}

/** The senders that share one domain. */
export interface SenderDomainGroup {
  domain: string;
  /** Conversations from the domain; one with several of its senders is counted once. */
  count: number;
  unread: boolean;
  latest: string;
  /** A company logo for the domain when one of its senders qualifies for it. */
  logo: LogoRequest | null;
  senders: SenderEntry[];
}

function senderKey(email: string): string {
  return email.trim().toLowerCase();
}

/** Every distinct address in the given conversations, most recent sender first. */
export function buildSenders(threads: readonly Thread[]): SenderEntry[] {
  const senders = new Map<string, SenderEntry>();
  for (const thread of threads) {
    const counted = new Set<string>();
    for (const message of thread.messages) {
      const key = senderKey(message.from.email);
      let entry = senders.get(key);
      if (!entry) {
        entry = {
          key,
          name: "",
          email: message.from.email,
          domain: senderDomain(key),
          count: 0,
          unread: false,
          latest: "",
          logo: null,
        };
        senders.set(key, entry);
      }
      if (!counted.has(key)) {
        counted.add(key);
        entry.count += 1;
      }
      entry.unread = entry.unread || message.unread;
      if (entry.latest === "" || Date.parse(message.date) >= Date.parse(entry.latest)) {
        entry.latest = message.date;
        entry.name = message.from.name.trim() || message.from.email;
        entry.email = message.from.email;
        entry.logo = logoRequestFor(message);
      }
    }
  }
  return [...senders.values()].sort(byLatest);
}

function byLatest(a: { latest: string }, b: { latest: string }): number {
  return Date.parse(b.latest) - Date.parse(a.latest);
}

/** Conversations with at least one message from the sender, in the order given. */
export function threadsFromSender(threads: readonly Thread[], key: string): Thread[] {
  return threads.filter((thread) =>
    thread.messages.some((message) => senderKey(message.from.email) === key),
  );
}

/** Conversations with at least one message from the domain, in the order given. */
export function threadsFromDomain(threads: readonly Thread[], domain: string): Thread[] {
  return threads.filter((thread) =>
    thread.messages.some((message) => senderDomain(message.from.email) === domain),
  );
}

/**
 * The senders gathered by domain, most recent domain first and most recent sender first inside
 * each. `threads` are the conversations the senders were built from, to count each once per domain.
 */
export function groupSendersByDomain(
  senders: readonly SenderEntry[],
  threads: readonly Thread[],
): SenderDomainGroup[] {
  const groups = new Map<string, SenderDomainGroup>();
  for (const sender of senders) {
    const group = groups.get(sender.domain);
    if (group) {
      group.senders.push(sender);
      group.unread = group.unread || sender.unread;
      group.logo = group.logo ?? brandLogo(sender);
    } else {
      groups.set(sender.domain, {
        domain: sender.domain,
        count: 0,
        unread: sender.unread,
        // Senders arrive most recent first, so the first one dates the domain.
        latest: sender.latest,
        logo: brandLogo(sender),
        senders: [sender],
      });
    }
  }
  for (const thread of threads) {
    const domains = new Set(thread.messages.map((message) => senderDomain(message.from.email)));
    for (const domain of domains) {
      const group = groups.get(domain);
      if (group) group.count += 1;
    }
  }
  return [...groups.values()].sort(byLatest);
}

function brandLogo(sender: SenderEntry): LogoRequest | null {
  return sender.logo?.kind === "brand" ? sender.logo : null;
}

import { senderDomain } from "./categories";
import { logoRequestFor, type LogoRequest } from "./logos";
import type { MessageSummary } from "./types";

/**
 * Statistics for the Dashboard: how much mail arrives, from whom, when, and into which
 * categories. Pure functions over message summaries so they can be tested without a UI.
 */

/** The period the Dashboard looks at. Days count back from today's midnight, today included. */
export type DashboardRange = "today" | "7d" | "30d" | "all";

export const DASHBOARD_RANGES: readonly { range: DashboardRange; label: string }[] = [
  { range: "today", label: "Today" },
  { range: "7d", label: "7 days" },
  { range: "30d", label: "30 days" },
  { range: "all", label: "All" },
];

/** What a click on the Dashboard narrows the mail down to. */
export type DashboardFilter =
  | { kind: "all" }
  | { kind: "sender"; email: string; name: string }
  | { kind: "domain"; domain: string }
  /** `categoryId` null is mail in no category. */
  | { kind: "category"; categoryId: string | null }
  | { kind: "account"; accountId: string }
  /**
   * A time bucket of the volume chart; replaces the range. `end` is exclusive. With `unread`
   * set, only the unread (true) or read (false) part of it.
   */
  | { kind: "time"; start: number; end: number; unread?: boolean }
  /** A cell of the weekday × hour grid. `weekday` 0 is Monday. */
  | { kind: "slot"; weekday: number; hour: number }
  | { kind: "flag"; flag: DashboardFlag };

export type DashboardFlag = "unread" | "attachments" | "answered" | "people" | "automated";

/** A filter plus the range it was picked in: together they say which messages a click shows. */
export interface DashboardDrill {
  filter: DashboardFilter;
  range: DashboardRange;
}

export interface TimeBucket {
  start: number;
  /** Exclusive. */
  end: number;
  count: number;
  /** Of `count`, how many are unread. */
  unread: number;
}

export type TimeUnit = "hour" | "day" | "month";

export interface SenderStat {
  /** The address in lower case. */
  key: string;
  name: string;
  email: string;
  count: number;
  unread: number;
  logo: LogoRequest | null;
}

export interface DomainStat {
  domain: string;
  count: number;
  unread: number;
  /** Distinct addresses at the domain. */
  senders: number;
  logo: LogoRequest | null;
}

export interface CategoryStat {
  categoryId: string | null;
  count: number;
  unread: number;
}

export interface AccountStat {
  accountId: string;
  count: number;
}

export interface DashboardStats {
  /** Messages in the range. */
  total: number;
  unread: number;
  withAttachments: number;
  answered: number;
  /** Written by a person (header signal), as opposed to automated or bulk mail. */
  people: number;
  automated: number;

  /** Headline numbers; these ignore the range. */
  today: number;
  yesterday: number;
  last7: number;
  previous7: number;
  /** Mean per day over the last 30 days, today included. */
  dailyAverage30: number;
  /** Messages per hour today, 24 entries. */
  todayByHour: number[];
  /** Messages per day over the last 14 days, oldest first. */
  last14Days: number[];

  /** Volume over the range, in `timeUnit` buckets, oldest first. */
  timeline: TimeBucket[];
  timeUnit: TimeUnit;

  /** Most messages first. */
  senders: SenderStat[];
  domains: DomainStat[];
  categories: CategoryStat[];
  accounts: AccountStat[];

  /** `heatmap[weekday][hour]`, weekday 0 is Monday. */
  heatmap: number[][];
  heatmapMax: number;
  /** The busiest hour of the day and weekday in the range; null when there is no mail. */
  busiestHour: { hour: number; count: number } | null;
  busiestWeekday: { weekday: number; count: number } | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far back "All" charts its timeline. */
const MAX_MONTHS = 24;

/** Local midnight of the given time. */
export function startOfDay(time: number): number {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Local midnight `days` days after (or before, if negative) the day of `time`; DST-safe. */
export function addDays(time: number, days: number): number {
  const date = new Date(startOfDay(time));
  date.setDate(date.getDate() + days);
  return date.getTime();
}

/** Monday-first weekday (0 = Monday … 6 = Sunday). */
export function weekdayOf(time: number): number {
  return (new Date(time).getDay() + 6) % 7;
}

/** The first moment included in a range, or -Infinity for "all". */
export function rangeStart(range: DashboardRange, now: number): number {
  switch (range) {
    case "today":
      return startOfDay(now);
    case "7d":
      return addDays(now, -6);
    case "30d":
      return addDays(now, -29);
    case "all":
      return Number.NEGATIVE_INFINITY;
  }
}

/** What makes two listings the same message, whatever folder each came from. */
function sameMessageKey(message: MessageSummary): string {
  return [
    message.accountId,
    message.threadId,
    message.from.email.trim().toLowerCase(),
    message.date,
    message.subject,
  ].join("\u0000");
}

/**
 * Keeps one listing per message. Gmail has no real Archive: MiniMail uses All Mail for it, and
 * All Mail holds every Inbox message too, so the same email comes back from both folders. The
 * Inbox copy is the one kept, since that is where the email is; otherwise the first one.
 */
export function dropFolderDuplicates(messages: readonly MessageSummary[]): MessageSummary[] {
  const kept = new Map<string, MessageSummary>();
  for (const message of messages) {
    const key = sameMessageKey(message);
    const current = kept.get(key);
    if (!current || (current.folder !== "inbox" && message.folder === "inbox")) kept.set(key, message);
  }
  if (kept.size === messages.length) return [...messages];
  const keep = new Set(kept.values());
  return messages.filter((message) => keep.has(message));
}

/**
 * The mail the Dashboard counts: received mail only. Messages the user wrote (their own
 * replies inside a conversation) are left out, and each message counts once.
 */
export function receivedMail(
  messages: readonly MessageSummary[],
  ownAddresses: readonly string[],
): MessageSummary[] {
  const own = new Set(ownAddresses.map((address) => address.trim().toLowerCase()));
  const seen = new Set<string>();
  return messages.filter((message) => {
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    return !own.has(message.from.email.trim().toLowerCase());
  });
}

function isPerson(message: MessageSummary): boolean {
  return message.signal === "person";
}

function matchesFlag(message: MessageSummary, flag: DashboardFlag): boolean {
  switch (flag) {
    case "unread":
      return message.unread;
    case "attachments":
      return message.hasAttachments;
    case "answered":
      return message.answered;
    case "people":
      return isPerson(message);
    case "automated":
      return !isPerson(message);
  }
}

/** True when a message belongs to what a Dashboard click picked. */
export function matchesDrill(message: MessageSummary, drill: DashboardDrill, now: number): boolean {
  const time = Date.parse(message.date);
  const { filter } = drill;
  if (filter.kind === "time") {
    return (
      time >= filter.start &&
      time < filter.end &&
      (filter.unread === undefined || message.unread === filter.unread)
    );
  }
  if (time < rangeStart(drill.range, now)) return false;
  switch (filter.kind) {
    case "all":
      return true;
    case "sender":
      return message.from.email.trim().toLowerCase() === filter.email.trim().toLowerCase();
    case "domain":
      return senderDomain(message.from.email) === filter.domain;
    case "category":
      return message.categoryId === filter.categoryId;
    case "account":
      return message.accountId === filter.accountId;
    case "slot":
      return weekdayOf(time) === filter.weekday && new Date(time).getHours() === filter.hour;
    case "flag":
      return matchesFlag(message, filter.flag);
  }
}

/** The buckets of the volume chart for a range, empty, oldest first. */
export function timelineBuckets(
  range: DashboardRange,
  now: number,
  earliest: number | null,
): { unit: TimeUnit; buckets: TimeBucket[] } {
  const today = startOfDay(now);
  if (range === "today") {
    const buckets: TimeBucket[] = [];
    for (let hour = 0; hour < 24; hour += 1) {
      const start = new Date(today);
      start.setHours(hour);
      const end = new Date(today);
      end.setHours(hour + 1);
      buckets.push({ start: start.getTime(), end: end.getTime(), count: 0, unread: 0 });
    }
    return { unit: "hour", buckets };
  }
  if (range === "7d" || range === "30d") {
    const days = range === "7d" ? 7 : 30;
    const buckets: TimeBucket[] = [];
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      buckets.push({ start: addDays(now, -offset), end: addDays(now, -offset + 1), count: 0, unread: 0 });
    }
    return { unit: "day", buckets };
  }
  // All: one bucket per month, from the earliest message's month (at most MAX_MONTHS back).
  const current = new Date(now);
  const first = earliest === null ? current : new Date(earliest);
  let months =
    current.getFullYear() * 12 + current.getMonth() - (first.getFullYear() * 12 + first.getMonth()) + 1;
  months = Math.min(MAX_MONTHS, Math.max(6, months));
  const buckets: TimeBucket[] = [];
  for (let back = months - 1; back >= 0; back -= 1) {
    const start = new Date(current.getFullYear(), current.getMonth() - back, 1).getTime();
    const end = new Date(current.getFullYear(), current.getMonth() - back + 1, 1).getTime();
    buckets.push({ start, end, count: 0, unread: 0 });
  }
  return { unit: "month", buckets };
}

function sortByCount<T extends { count: number }>(entries: Iterable<T>, tieBreak: (a: T, b: T) => number): T[] {
  return [...entries].sort((a, b) => b.count - a.count || tieBreak(a, b));
}

/**
 * Everything the Dashboard draws, from received mail (see `receivedMail`). The headline
 * numbers ignore the range; everything else covers only the range.
 */
export function buildDashboardStats(
  messages: readonly MessageSummary[],
  range: DashboardRange,
  now: number,
): DashboardStats {
  const today = startOfDay(now);
  const yesterday = addDays(now, -1);
  const weekStart = addDays(now, -6);
  const previousWeekStart = addDays(now, -13);
  const monthStart = addDays(now, -29);
  const from = rangeStart(range, now);

  const todayByHour = Array.from({ length: 24 }, () => 0);
  const last14Days = Array.from({ length: 14 }, () => 0);
  let todayCount = 0;
  let yesterdayCount = 0;
  let last7 = 0;
  let previous7 = 0;
  let last30 = 0;
  let earliest: number | null = null;

  const inRange: { message: MessageSummary; time: number }[] = [];
  for (const message of messages) {
    const time = Date.parse(message.date);
    if (Number.isNaN(time)) continue;
    if (time >= today) {
      todayCount += 1;
      todayByHour[new Date(time).getHours()] += 1;
    } else if (time >= yesterday) {
      yesterdayCount += 1;
    }
    if (time >= weekStart) last7 += 1;
    else if (time >= previousWeekStart) previous7 += 1;
    if (time >= monthStart) last30 += 1;
    if (time >= addDays(now, -13)) {
      const index = 13 - Math.round((today - startOfDay(time)) / DAY_MS);
      if (index >= 0 && index < 14) last14Days[index] += 1;
    }
    if (time >= from) {
      inRange.push({ message, time });
      earliest = earliest === null ? time : Math.min(earliest, time);
    }
  }

  const { unit, buckets } = timelineBuckets(range, now, earliest);
  const senders = new Map<string, SenderStat & { latest: number }>();
  const domains = new Map<string, DomainStat & { addresses: Set<string>; latest: number }>();
  const categories = new Map<string | null, CategoryStat>();
  const accounts = new Map<string, AccountStat>();
  const heatmap = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  let unread = 0;
  let withAttachments = 0;
  let answered = 0;
  let people = 0;

  for (const { message, time } of inRange) {
    if (message.unread) unread += 1;
    if (message.hasAttachments) withAttachments += 1;
    if (message.answered) answered += 1;
    if (isPerson(message)) people += 1;

    const bucket = buckets.find((candidate) => time >= candidate.start && time < candidate.end);
    if (bucket) {
      bucket.count += 1;
      if (message.unread) bucket.unread += 1;
    }
    heatmap[weekdayOf(time)][new Date(time).getHours()] += 1;

    const key = message.from.email.trim().toLowerCase();
    let sender = senders.get(key);
    if (!sender) {
      sender = { key, name: "", email: message.from.email, count: 0, unread: 0, logo: null, latest: -1 };
      senders.set(key, sender);
    }
    sender.count += 1;
    if (message.unread) sender.unread += 1;
    if (time > sender.latest) {
      sender.latest = time;
      sender.name = message.from.name.trim() || message.from.email;
      sender.logo = logoRequestFor(message);
    }

    const domainKey = senderDomain(key);
    let domain = domains.get(domainKey);
    if (!domain) {
      domain = { domain: domainKey, count: 0, unread: 0, senders: 0, logo: null, addresses: new Set(), latest: -1 };
      domains.set(domainKey, domain);
    }
    domain.count += 1;
    if (message.unread) domain.unread += 1;
    domain.addresses.add(key);
    const logo = logoRequestFor(message);
    if (logo?.kind === "brand" && (domain.logo === null || time > domain.latest)) {
      domain.logo = logo;
      domain.latest = time;
    }

    const category = categories.get(message.categoryId) ?? {
      categoryId: message.categoryId,
      count: 0,
      unread: 0,
    };
    category.count += 1;
    if (message.unread) category.unread += 1;
    categories.set(message.categoryId, category);

    const account = accounts.get(message.accountId) ?? { accountId: message.accountId, count: 0 };
    account.count += 1;
    accounts.set(message.accountId, account);
  }

  let heatmapMax = 0;
  const hours = Array.from({ length: 24 }, () => 0);
  const weekdays = Array.from({ length: 7 }, () => 0);
  heatmap.forEach((row, weekday) =>
    row.forEach((count, hour) => {
      heatmapMax = Math.max(heatmapMax, count);
      hours[hour] += count;
      weekdays[weekday] += count;
    }),
  );
  const peak = (values: number[]) => {
    let best = -1;
    values.forEach((count, index) => {
      if (count > 0 && (best < 0 || count > values[best])) best = index;
    });
    return best;
  };
  const hourPeak = peak(hours);
  const weekdayPeak = peak(weekdays);

  return {
    total: inRange.length,
    unread,
    withAttachments,
    answered,
    people,
    automated: inRange.length - people,
    today: todayCount,
    yesterday: yesterdayCount,
    last7,
    previous7,
    dailyAverage30: last30 / 30,
    todayByHour,
    last14Days,
    timeline: buckets,
    timeUnit: unit,
    senders: sortByCount(senders.values(), (a, b) => b.latest - a.latest).map(
      ({ latest: _latest, ...sender }) => sender,
    ),
    domains: sortByCount(domains.values(), (a, b) => a.domain.localeCompare(b.domain)).map(
      ({ addresses, latest: _latest, ...domain }) => ({ ...domain, senders: addresses.size }),
    ),
    categories: sortByCount(categories.values(), (a, b) =>
      String(a.categoryId).localeCompare(String(b.categoryId)),
    ),
    accounts: sortByCount(accounts.values(), (a, b) => a.accountId.localeCompare(b.accountId)),
    heatmap,
    heatmapMax,
    busiestHour: hourPeak < 0 ? null : { hour: hourPeak, count: hours[hourPeak] },
    busiestWeekday: weekdayPeak < 0 ? null : { weekday: weekdayPeak, count: weekdays[weekdayPeak] },
  };
}

import { iconFor } from "./categories";
import { logoRequestFor, type LogoRequest } from "./logos";
import type { Thread } from "./threads";
import type { Category } from "./types";

/** Id of the collapsible Pinned group; every other group kind is a category id. */
export const PINNED_GROUP = "pinned";

/** Buckets shown as one row that opens its own list: Spark's Pinned plus one per user category. */
export type GroupKind = string;

/** One sender "chip" on a collapsed group row (e.g. "Amazon.com 3"). */
export interface SenderChip {
  key: string;
  name: string;
  email: string;
  count: number;
  unread: boolean;
  /** Which logo or photo lookup this sender qualifies for; null means initials. */
  logo: LogoRequest | null;
}

export type ListItem =
  | { type: "section"; key: string; label: string }
  | { type: "thread"; key: string; thread: Thread }
  | (GroupDef & {
      type: "group";
      key: string;
      count: number;
      hasUnread: boolean;
      chips: SenderChip[];
    });

/** What a group row shows about its bucket. */
export interface GroupDef {
  kind: GroupKind;
  label: string;
  /** The category's hue; null for Pinned. */
  hue: number | null;
  /** The category's Lucide icon name; null for Pinned or when none is set. */
  icon: string | null;
}

/** The buckets of the Focused List in display order: Pinned, then the user's categories. */
export function groupDefs(categories: readonly Category[]): GroupDef[] {
  return [
    { kind: PINNED_GROUP, label: "Pinned", hue: null, icon: null },
    ...categories.map((category) => ({
      kind: category.id,
      label: category.name,
      hue: category.hue,
      icon: iconFor(category) ?? null,
    })),
  ];
}

export interface FocusedListOptions {
  now: Date;
  /** The user's categories, in display order. Threads whose category is gone count as people. */
  categories: readonly Category[];
}

interface Section {
  key: string;
  label: string;
  /** Lower sorts first (more recent). */
  order: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local midnight of the given date, as a timestamp. */
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Maps a date to Spark's list sections: Today, Yesterday, Last Week, then one
 * section per month. Future-dated mail is treated as Today.
 */
export function sectionFor(iso: string, now: Date): Section {
  const date = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (days <= 0) return { key: "today", label: "Today", order: 0 };
  if (days === 1) return { key: "yesterday", label: "Yesterday", order: 1 };
  if (days <= 7) return { key: "last-week", label: "Last Week", order: 2 };

  const monthsAgo =
    now.getFullYear() * 12 + now.getMonth() - (date.getFullYear() * 12 + date.getMonth());
  const sameYear = date.getFullYear() === now.getFullYear();
  const label = new Intl.DateTimeFormat("en-US", {
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
  return {
    key: `month-${date.getFullYear()}-${date.getMonth()}`,
    label,
    order: 10 + Math.max(0, monthsAgo),
  };
}

/** One chip per distinct sender, most recent sender first. */
function buildChips(threads: readonly Thread[]): SenderChip[] {
  const chips = new Map<string, SenderChip>();
  for (const thread of threads) {
    const { name, email } = thread.latest.from;
    const key = email.toLowerCase();
    const existing = chips.get(key);
    if (existing) {
      existing.count += 1;
      existing.unread = existing.unread || thread.unread;
    } else {
      chips.set(key, {
        key,
        name: name || email,
        email,
        count: 1,
        unread: thread.unread,
        logo: logoRequestFor(thread.latest),
      });
    }
  }
  return [...chips.values()];
}

/**
 * Plain date-sectioned list used for every folder except the Inbox: no grouping,
 * just threads newest first under Today / Yesterday / Last Week / month headers.
 */
export function buildFlatList(threads: readonly Thread[], now: Date): ListItem[] {
  const sections = new Map<string, { section: Section; items: ListItem[] }>();
  for (const thread of threads) {
    const section = sectionFor(thread.latest.date, now);
    let bucket = sections.get(section.key);
    if (!bucket) {
      bucket = { section, items: [] };
      sections.set(section.key, bucket);
    }
    bucket.items.push({ type: "thread", key: thread.id, thread });
  }

  const result: ListItem[] = [];
  const ordered = [...sections.values()].sort((a, b) => a.section.order - b.section.order);
  for (const { section, items } of ordered) {
    result.push({ type: "section", key: `section:${section.key}`, label: section.label });
    result.push(...items);
  }
  return result;
}

/**
 * Lays threads out the way Spark's "Focused List" does: sections by date, mail
 * from people as individual rows, and categorized mail (notifications, newsletters,
 * invitations, ...) plus pinned threads collapsed into one row per bucket. Each bucket
 * collects every thread of its kind and opens the list, above the date sections (and their
 * "Today" heading), so old notifications never scatter through the list. The threads of a
 * bucket are listed on their own screen (see `threadsInGroup`).
 *
 * `threads` must already be sorted newest first (see `groupThreads`).
 */
export function buildFocusedList(
  threads: readonly Thread[],
  options: FocusedListOptions,
): ListItem[] {
  const { now, categories } = options;
  const known = new Set(categories.map((category) => category.id));

  const groups = new Map<GroupKind, Thread[]>();
  const people: Thread[] = [];
  for (const thread of threads) {
    if (thread.pinned) {
      groups.set(PINNED_GROUP, [...(groups.get(PINNED_GROUP) ?? []), thread]);
    } else if (thread.categoryId === null || !known.has(thread.categoryId)) {
      people.push(thread);
    } else {
      groups.set(thread.categoryId, [...(groups.get(thread.categoryId) ?? []), thread]);
    }
  }

  const sections = new Map<string, { section: Section; items: ListItem[] }>();
  const bucketFor = (iso: string) => {
    const section = sectionFor(iso, now);
    let bucket = sections.get(section.key);
    if (!bucket) {
      bucket = { section, items: [] };
      sections.set(section.key, bucket);
    }
    return bucket;
  };

  const result: ListItem[] = [];
  for (const { kind, label, hue, icon } of groupDefs(categories)) {
    const members = groups.get(kind);
    if (!members || members.length === 0) continue;
    // Groups gather everything of their kind, so they open the list, above every date section.
    result.push({
      type: "group",
      key: `group:${kind}`,
      kind,
      label,
      hue,
      icon,
      count: members.length,
      hasUnread: members.some((t) => t.unread),
      chips: buildChips(members),
    });
  }

  for (const thread of people) {
    bucketFor(thread.latest.date).items.push({ type: "thread", key: thread.id, thread });
  }

  const ordered = [...sections.values()].sort((a, b) => a.section.order - b.section.order);
  for (const { section, items } of ordered) {
    result.push({ type: "section", key: `section:${section.key}`, label: section.label });
    result.push(...items);
  }
  return result;
}

/**
 * The conversations a group row of the Focused List stands for, in the order given: every
 * pinned one for Pinned, otherwise the unpinned ones of that category.
 */
export function threadsInGroup(threads: readonly Thread[], kind: GroupKind): Thread[] {
  return kind === PINNED_GROUP
    ? threads.filter((thread) => thread.pinned)
    : threads.filter((thread) => !thread.pinned && thread.categoryId === kind);
}

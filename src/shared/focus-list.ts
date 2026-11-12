import { iconFor } from "./categories";
import { logoRequestFor, type LogoRequest } from "./logos";
import type { Thread } from "./threads";
import type { Category } from "./types";

/** Key of the collapsible "Pinned" heading, between the category rows and the date sections. */
export const PINNED_SECTION = "section:pinned";

/** Buckets shown as one row that opens its own list: one per user category (a category id). */
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
  /** The sender's most recent conversation in the group: what clicking the chip opens. */
  threadId: string;
  /** That conversation's latest message and its date, for what a card shows about it (a code). */
  messageId: string;
  date: string;
}

export type ListItem =
  | {
      type: "section";
      key: string;
      label: string;
      /** Set on the Pinned heading: clicking it hides or shows the pinned conversations under it. */
      collapsible?: { collapsed: boolean; count: number };
    }
  | { type: "thread"; key: string; thread: Thread }
  | (GroupDef & {
      type: "group";
      key: string;
      count: number;
      hasUnread: boolean;
      /** How many of the group's conversations are unread. */
      unreadCount: number;
      chips: SenderChip[];
    });

/** What a group row shows about its bucket. */
export interface GroupDef {
  kind: GroupKind;
  label: string;
  /** The category's hue. */
  hue: number | null;
  /** The category's Lucide icon name; null when none is set. */
  icon: string | null;
}

/** The buckets of the Focused List in display order: the user's categories. */
export function groupDefs(categories: readonly Category[]): GroupDef[] {
  return categories.map((category) => ({
    kind: category.id,
    label: category.name,
    hue: category.hue,
    icon: iconFor(category) ?? null,
  }));
}

export interface FocusedListOptions {
  now: Date;
  /** The user's categories, in display order. Threads whose category is gone count as people. */
  categories: readonly Category[];
  /** Hide the conversations under the Pinned heading, leaving only the heading. */
  pinnedCollapsed?: boolean;
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
        // Threads arrive newest first, so the first one seen for a sender is its latest.
        threadId: thread.id,
        messageId: thread.latest.id,
        date: thread.latest.date,
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
 * invitations, ...) collapsed into one row per bucket. Each bucket collects every thread of its
 * kind and opens the list, above the date sections (and their "Today" heading), so old
 * notifications never scatter through the list. The threads of a bucket are listed on their own
 * screen (see `threadsInGroup`). Pinned threads sit under a collapsible "Pinned" heading that
 * comes after the bucket rows and before "Today".
 *
 * `threads` must already be sorted newest first (see `groupThreads`).
 */
export function buildFocusedList(
  threads: readonly Thread[],
  options: FocusedListOptions,
): ListItem[] {
  const { now, categories, pinnedCollapsed = false } = options;
  const known = new Set(categories.map((category) => category.id));

  const groups = new Map<GroupKind, Thread[]>();
  const people: Thread[] = [];
  const pinned: Thread[] = [];
  for (const thread of threads) {
    if (thread.pinned) {
      pinned.push(thread);
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
      unreadCount: members.filter((t) => t.unread).length,
      chips: buildChips(members),
    });
  }

  if (pinned.length > 0) {
    result.push({
      type: "section",
      key: PINNED_SECTION,
      label: "Pinned",
      collapsible: { collapsed: pinnedCollapsed, count: pinned.length },
    });
    if (!pinnedCollapsed) {
      for (const thread of pinned) result.push({ type: "thread", key: thread.id, thread });
    }
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
 * The conversations a group row of the Focused List stands for, in the order given: the
 * unpinned ones of that category (pinned ones are listed under the Pinned heading instead).
 */
export function threadsInGroup(threads: readonly Thread[], kind: GroupKind): Thread[] {
  return threads.filter((thread) => !thread.pinned && thread.categoryId === kind);
}

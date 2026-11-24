import { parseBlockList, type BlockList } from "./blocklist";
import { parsePriorityList, priorityKey, togglePriorityEntry } from "./priority";
import { senderDomain } from "./categories";
import type { AppearanceValues, ColorMode, UiPrefs } from "./types";
import { parseUnsubscribedLists } from "./unsubscribe";

/** What a fresh install starts with. */
export function defaultUiPrefs(): UiPrefs {
  return {
    view: "category",
    unreadOnly: false,
    shownFolders: ["inbox"],
    pinnedDrafts: [],
    onboarded: null,
    appearance: null,
    theme: null,
    blocklist: { senders: [], domains: [] },
    priority: { threads: [], senders: [], domains: [] },
    unsubscribed: {},
    pinnedDomains: [],
    minimizedCategories: [],
    recentSearches: [],
  };
}

export const COLOR_MODES: readonly ColorMode[] = ["system", "light", "dark"];

/** The color mode in a stored value, or null when it is not one. */
export function parseColorMode(value: unknown): ColorMode | null {
  return COLOR_MODES.find((mode) => mode === value) ?? null;
}

/** The plain values of a stored appearance (anything else, and anything nested, is left out), or null. */
export function parseAppearanceValues(value: unknown): AppearanceValues | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const values: AppearanceValues = {};
  for (const [key, entry] of Object.entries(value).slice(0, 32)) {
    if (entry === null || typeof entry === "boolean" || (typeof entry === "number" && Number.isFinite(entry))) values[key] = entry;
    else if (typeof entry === "string" && entry.length <= 64) values[key] = entry;
  }
  return values;
}

/** The strings of a stored list, once each, in order. */
export function parseStringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0 && entry.length <= 2048))].slice(-max);
}

export const MAX_PINNED_DOMAINS = 2000;
export const MAX_RECENT_SEARCHES = 8;
const MAX_SEARCH_LENGTH = 200;

/** The searches in a stored value: text with single spaces, each once (letter case aside), newest first, at most `MAX_RECENT_SEARCHES`. */
export function parseRecentSearches(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const list: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const text = entry.replace(/\s+/g, " ").trim();
    if (text === "" || text.length > MAX_SEARCH_LENGTH || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    list.push(text);
    if (list.length === MAX_RECENT_SEARCHES) break;
  }
  return list;
}

/** The list with `query` put first; an earlier copy of it (letter case aside) moves up instead of repeating. Blank text changes nothing. */
export function rememberSearch(list: readonly string[], query: string): string[] {
  return parseRecentSearches([query, ...list]);
}
export const MAX_MINIMIZED_CATEGORIES = 200;

/**
 * What the page used to keep in its own storage (`localStorage`), as it was found there. The page
 * sends it once, from each address it was ever loaded from; the values are checked here.
 */
export interface LegacyPrefs {
  appearance?: unknown;
  theme?: unknown;
  blocklist?: unknown;
  priority?: unknown;
  unsubscribed?: unknown;
  pinnedDomains?: unknown;
  minimizedCategories?: unknown;
}

function union(current: readonly string[], more: readonly string[], max: number): string[] {
  return [...new Set([...current, ...more])].slice(-max);
}

/**
 * The saved choices with the old ones of the page's storage added. Nothing already saved is lost or
 * changed by it: lists are joined, a record keeps the later time, and a single choice (appearance,
 * color mode) is only taken when none was saved yet. Taking over a second address later adds to it the same way.
 */
export function mergeLegacyPrefs(current: UiPrefs, legacy: LegacyPrefs): UiPrefs {
  const next: UiPrefs = { ...current };

  if (legacy.blocklist !== undefined) {
    const old = parseBlockList(legacy.blocklist);
    const joined: BlockList = {
      senders: union(current.blocklist.senders, old.senders, 2000),
      domains: union(current.blocklist.domains, old.domains, 2000),
    };
    next.blocklist = parseBlockList(joined);
  }

  if (legacy.priority !== undefined) {
    const old = parsePriorityList(legacy.priority);
    let list = { ...current.priority };
    // Domains first: marking one takes off the marked senders inside it, which changes nothing in effect.
    for (const domain of old.domains) if (!list.domains.includes(domain)) list = togglePriorityEntry({ ...list }, "domains", domain);
    for (const id of old.threads) if (!list.threads.includes(id)) list = togglePriorityEntry({ ...list }, "threads", id);
    for (const sender of old.senders) {
      const covered = list.domains.includes(senderDomain(sender));
      if (!covered && !list.senders.includes(priorityKey("senders", sender))) list = togglePriorityEntry({ ...list }, "senders", sender);
    }
    next.priority = { threads: list.threads, senders: list.senders, domains: list.domains };
  }

  if (legacy.unsubscribed !== undefined) {
    const old = parseUnsubscribedLists(legacy.unsubscribed);
    const joined: Record<string, number> = { ...current.unsubscribed };
    for (const [key, at] of Object.entries(old)) joined[key] = Math.max(at, joined[key] ?? 0);
    next.unsubscribed = parseUnsubscribedLists(joined);
  }

  if (legacy.pinnedDomains !== undefined) {
    next.pinnedDomains = union(current.pinnedDomains, parseStringList(legacy.pinnedDomains, MAX_PINNED_DOMAINS), MAX_PINNED_DOMAINS);
  }
  if (legacy.minimizedCategories !== undefined) {
    next.minimizedCategories = union(
      current.minimizedCategories,
      parseStringList(legacy.minimizedCategories, MAX_MINIMIZED_CATEGORIES),
      MAX_MINIMIZED_CATEGORIES,
    );
  }

  if (current.appearance === null) next.appearance = parseAppearanceValues(legacy.appearance);
  if (current.theme === null) next.theme = parseColorMode(legacy.theme);
  return next;
}

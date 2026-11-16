import { useSyncExternalStore } from "react";

import { senderDomain } from "@shared/categories";
import {
  blockKey,
  isBlockedEntry,
  parseBlockList,
  toggleBlockEntry,
  type BlockKind,
  type BlockList,
} from "@shared/blocklist";
import type { Thread } from "@shared/threads";
import type { Contact } from "@shared/types";

import { threadContacts } from "./format";

const STORAGE_KEY = "minimail.blocklist";

function read(): BlockList {
  try {
    return parseBlockList(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null"));
  } catch {
    return parseBlockList(null);
  }
}

/**
 * Who the user blocked, kept on this computer and shared by every part of the window, so blocking
 * a sender in a menu tints their name everywhere at once. When storage is unavailable the blocks
 * still hold until the app closes.
 */
let current: BlockList = read();
const listeners = new Set<() => void>();

export function subscribeBlockList(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getBlockList(): BlockList {
  return current;
}

export function useBlockList(): BlockList {
  return useSyncExternalStore(subscribeBlockList, getBlockList);
}

/** Blocks or unblocks one sender address or domain. */
export function toggleBlock(kind: BlockKind, value: string): void {
  current = toggleBlockEntry(current, kind, value);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Storage can be unavailable; the block holds until the app closes.
  }
  listeners.forEach((listener) => listener());
}

/** Blocks (or, with `blocked` false, unblocks) every value of a kind that is not already so. */
export function setBlocked(kind: BlockKind, values: readonly string[], blocked: boolean): void {
  for (const value of values) {
    if (isBlockedEntry(current, kind, value) !== blocked) toggleBlock(kind, value);
  }
}

/**
 * The addresses and domains a Block command on these conversations would act on: their newest
 * sender. The user's own addresses and domains are left out, so nobody blocks themselves.
 */
export function blockTargets(
  threads: readonly Pick<Thread, "latest">[],
  own: readonly string[],
): { senders: string[]; domains: string[] } {
  return emailTargets(threads.map(({ latest }) => latest.from.email), own);
}

/** The addresses and domains of these addresses, the user's own left out. */
export function emailTargets(emails: readonly string[], own: readonly string[]): { senders: string[]; domains: string[] } {
  const mine = new Set(own.map(blockKey));
  const mineDomains = new Set(own.map(senderDomain));
  const senders = new Set<string>();
  const domains = new Set<string>();
  for (const raw of emails) {
    const email = blockKey(raw);
    if (!email || mine.has(email)) continue;
    senders.add(email);
    const domain = senderDomain(email);
    if (domain !== "unknown" && !mineDomains.has(domain)) domains.add(domain);
  }
  return { senders: [...senders], domains: [...domains] };
}

export interface BlockChoice {
  kind: BlockKind;
  values: string[];
  label: string;
  /** Every one of the values is already blocked (or muted): choosing it undoes that. */
  on: boolean;
}

type Targets = { senders: string[]; domains: string[] };

/**
 * The choices of a command that acts on a sender or a domain (Block, Mute), the same wherever it is
 * offered (menu, toolbar, selection bar). `isOn` says whether an entry is already blocked / muted.
 */
function filterChoices(
  isOn: (kind: BlockKind, value: string) => boolean,
  targets: Targets,
  verbs: { on: string; off: string },
): BlockChoice[] {
  const choice = (kind: BlockKind, values: string[], one: string, many: string): BlockChoice[] => {
    if (values.length === 0) return [];
    const on = values.every((value) => isOn(kind, value));
    return [{ kind, values, on, label: `${on ? verbs.off : verbs.on} ${values.length === 1 ? one : many}` }];
  };
  const [sender] = targets.senders;
  const [domain] = targets.domains;
  return [
    ...choice("senders", targets.senders, sender ?? "", `${targets.senders.length} senders`),
    ...choice("domains", targets.domains, `@${domain ?? ""}`, `${targets.domains.length} domains`),
  ];
}

/** The choices of the Block command. */
export function blockChoices(list: BlockList, targets: Targets): BlockChoice[] {
  return filterChoices((kind, value) => isBlockedEntry(list, kind, value), targets, { on: "Block", off: "Unblock" });
}

/** The choices of the Mute command; `isMuted` tells whether a sender or domain is muted for these conversations. */
export function muteChoices(isMuted: (kind: BlockKind, value: string) => boolean, targets: Targets): BlockChoice[] {
  return filterChoices(isMuted, targets, { on: "Mute", off: "Unmute" });
}

/** One block of the Block or Mute menu: a person's own choices (with their `contact`), or the plain choices. */
export interface BlockSection {
  contact?: Contact;
  choices: BlockChoice[];
}

/**
 * What a Block or Mute command offers for these conversations, the same wherever it is shown. One
 * conversation with several people lists each person with their own choices (their address, their
 * domain); anything else gets the plain choices for the senders involved.
 */
function filterSections(
  choicesFor: (targets: Targets) => BlockChoice[],
  threads: readonly Thread[],
  own: readonly string[],
): BlockSection[] {
  const contacts = threads.length === 1 ? threadContacts(threads[0]!, own) : [];
  if (contacts.length > 1) {
    return contacts
      .map((contact) => ({ contact, choices: choicesFor(emailTargets([contact.email], own)) }))
      .filter((section) => section.choices.length > 0);
  }
  const choices = choicesFor(blockTargets(threads, own));
  return choices.length > 0 ? [{ choices }] : [];
}

export function blockSections(list: BlockList, threads: readonly Thread[], own: readonly string[]): BlockSection[] {
  return filterSections((targets) => blockChoices(list, targets), threads, own);
}

export function muteSections(
  isMuted: (kind: BlockKind, value: string) => boolean,
  threads: readonly Thread[],
  own: readonly string[],
): BlockSection[] {
  return filterSections((targets) => muteChoices(isMuted, targets), threads, own);
}

// Another window (a detached composer shares the origin) can change the list.
window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEY) return;
  current = read();
  listeners.forEach((listener) => listener());
});

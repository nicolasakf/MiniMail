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
import { reportError } from "@/lib/events";

const STORAGE_KEY = "minimail.blocklist";

function read(): BlockList {
  try {
    return parseBlockList(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null"));
  } catch (error) {
    reportError("storage", "Could not read the blocked senders", error);
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
  } catch (error) {
    reportError("storage", "Could not remember the blocked senders", error);
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

/** What Mute acts on: a sender or domain, or the conversation itself. */
export type MuteKind = BlockKind | "threads";

export interface BlockChoice<K extends string = BlockKind> {
  kind: K;
  values: string[];
  label: string;
  /** What the choice acts on, without the verb: "this conversation", "ana@acme.com", "@acme.com", "3 senders". */
  name: string;
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
    const name = values.length === 1 ? one : many;
    return [{ kind, values, on, name, label: `${on ? verbs.off : verbs.on} ${name}` }];
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
export function muteChoices(isMuted: (kind: MuteKind, value: string) => boolean, targets: Targets): BlockChoice[] {
  return filterChoices(isMuted, targets, { on: "Mute", off: "Unmute" });
}

/**
 * How a Mute menu words a choice. Like the Priority menu it names the target and shows a check
 * while it is muted, so the label carries no verb ("This conversation", "Everything from ana@acme.com").
 */
export function muteMenuLabel(choice: BlockChoice<MuteKind>): string {
  return choice.kind === "threads" ? choice.name.charAt(0).toUpperCase() + choice.name.slice(1) : `Everything from ${choice.name}`;
}

/** One block of the Block or Mute menu: a person's own choices (with their `contact`), or the plain choices. */
export interface BlockSection<K extends string = BlockKind> {
  contact?: Contact;
  choices: BlockChoice<K>[];
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

/**
 * What the Mute command offers: the conversation itself first (as Priority does), then the senders
 * and domains. Muting a conversation needs no sender, so it is offered even when every sender is the user.
 */
export function muteSections(
  isMuted: (kind: MuteKind, value: string) => boolean,
  threads: readonly Thread[],
  own: readonly string[],
): BlockSection<MuteKind>[] {
  const sections: BlockSection<MuteKind>[] = filterSections((targets) => muteChoices(isMuted, targets), threads, own);
  if (threads.length === 0) return sections;
  const ids = threads.map((thread) => thread.id);
  const on = ids.every((id) => isMuted("threads", id));
  const name = ids.length === 1 ? "this conversation" : `${ids.length} conversations`;
  const conversation: BlockChoice<MuteKind> = { kind: "threads", values: ids, on, name, label: `${on ? "Unmute" : "Mute"} ${name}` };
  const [first, ...rest] = sections;
  if (first && !first.contact) return [{ choices: [conversation, ...first.choices] }, ...rest];
  return [{ choices: [conversation] }, ...sections];
}

// Another window (a detached composer shares the origin) can change the list.
window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEY) return;
  current = read();
  listeners.forEach((listener) => listener());
});

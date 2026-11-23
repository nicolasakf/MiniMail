import { useSyncExternalStore } from "react";

import { senderDomain } from "@shared/categories";
import {
  blockKey,
  isBlockedEntry,
  toggleBlockEntry,
  type BlockKind,
  type BlockList,
} from "@shared/blocklist";
import type { Thread } from "@shared/threads";
import type { Contact } from "@shared/types";

import { threadContacts } from "./format";
import { savedPref, savePref, subscribePref } from "./saved-prefs";

/**
 * Who the user blocked, saved in `settings.json` and shared by every part of the window, so blocking
 * a sender in a menu tints their name everywhere at once.
 */
export function subscribeBlockList(listener: () => void): () => void {
  return subscribePref("blocklist", listener);
}

export function getBlockList(): BlockList {
  return savedPref("blocklist");
}

export function useBlockList(): BlockList {
  return useSyncExternalStore(subscribeBlockList, getBlockList);
}

/** Blocks or unblocks one sender address or domain. */
export function toggleBlock(kind: BlockKind, value: string): void {
  savePref("blocklist", toggleBlockEntry(getBlockList(), kind, value));
}

/** Blocks (or, with `blocked` false, unblocks) every value of a kind that is not already so. */
export function setBlocked(kind: BlockKind, values: readonly string[], blocked: boolean): void {
  for (const value of values) {
    if (isBlockedEntry(getBlockList(), kind, value) !== blocked) toggleBlock(kind, value);
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
  /** The values that are already blocked (or muted, or marked). */
  active: string[];
}

/**
 * Whether a choice acts on several senders or domains at once. Those ask first, in a dialog where the
 * user ticks the addresses or domains to act on, so their wording ends in "…" (a conversation does not).
 */
export function actsOnMany(choice: Pick<BlockChoice<string>, "kind" | "values">): boolean {
  return choice.kind !== "threads" && choice.values.length > 1;
}

/** The label of a choice, with the "…" that tells a dialog follows. */
function choiceText(choice: Pick<BlockChoice<string>, "kind" | "values">, text: string): string {
  return actsOnMany(choice) ? `${text}…` : text;
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
    const active = values.filter((value) => isOn(kind, value));
    const on = active.length === values.length;
    const name = values.length === 1 ? one : many;
    return [{ kind, values, on, active, name, label: choiceText({ kind, values }, `${on ? verbs.off : verbs.on} ${name}`) }];
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
  return choice.kind === "threads" ? choice.name.charAt(0).toUpperCase() + choice.name.slice(1) : choiceText(choice, `Everything from ${choice.name}`);
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
 * What a command that can also act on the conversation itself (Mute, Priority) offers: the
 * conversation first, then the senders and domains. It is offered even when every sender is the user.
 */
function conversationSections(
  isOn: (kind: MuteKind, value: string) => boolean,
  verbs: { on: string; off: string },
  threads: readonly Thread[],
  own: readonly string[],
): BlockSection<MuteKind>[] {
  const sections: BlockSection<MuteKind>[] = filterSections((targets) => filterChoices(isOn, targets, verbs), threads, own);
  if (threads.length === 0) return sections;
  const ids = threads.map((thread) => thread.id);
  const active = ids.filter((id) => isOn("threads", id));
  const on = active.length === ids.length;
  const name = ids.length === 1 ? "this conversation" : `${ids.length} conversations`;
  const conversation: BlockChoice<MuteKind> = { kind: "threads", values: ids, on, active, name, label: `${on ? verbs.off : verbs.on} ${name}` };
  const [first, ...rest] = sections;
  if (first && !first.contact) return [{ choices: [conversation, ...first.choices] }, ...rest];
  return [{ choices: [conversation] }, ...sections];
}

/** What the Mute command offers for these conversations. */
export function muteSections(
  isMuted: (kind: MuteKind, value: string) => boolean,
  threads: readonly Thread[],
  own: readonly string[],
): BlockSection<MuteKind>[] {
  return conversationSections(isMuted, { on: "Mute", off: "Unmute" }, threads, own);
}

/** What the Priority command offers for a selection of conversations (one conversation uses `prioritySections`). */
export function priorityChoiceSections(
  isPriority: (kind: MuteKind, value: string) => boolean,
  threads: readonly Thread[],
  own: readonly string[],
): BlockSection<MuteKind>[] {
  return conversationSections(isPriority, { on: "Mark", off: "Unmark" }, threads, own);
}

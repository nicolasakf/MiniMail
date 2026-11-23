import { useSyncExternalStore } from "react";

import { toast } from "@/lib/toast";

import { isBlockedEntry, type BlockKind } from "@shared/blocklist";
import { senderDomain } from "@shared/categories";
import {
  isPriorityEntry,
  togglePriorityEntry,
  withoutBlocked,
  type PriorityKind,
  type PriorityList,
} from "@shared/priority";

import type { Thread } from "@shared/threads";
import type { Contact, UiPrefs } from "@shared/types";

type StoredPriority = UiPrefs["priority"];

import { threadContacts } from "./format";
import { emailTargets, getBlockList, setBlocked, subscribeBlockList } from "./blocklist";
import { savedPref, savePref, subscribePref } from "./saved-prefs";
import { countedTargets, recordAction } from "@/lib/events";
import { newUndoRef, undoStack } from "@/lib/undo-stack";

/**
 * What the user marked as priority, saved in `settings.json` and shared by every part of the
 * window, so marking a sender in a menu updates the cards at once.
 */
function marks(): StoredPriority {
  return savedPref("priority");
}

function subscribe(listener: () => void): () => void {
  const stopMarks = subscribePref("priority", listener);
  const stopBlock = subscribeBlockList(listener);
  return () => {
    stopMarks();
    stopBlock();
  };
}

/** The marks together with the block list, rebuilt only when either changes (a stable snapshot). */
let snapshot: PriorityList = { ...marks(), blocklist: getBlockList() };
function matching(): PriorityList {
  const blocklist = getBlockList();
  const current = marks();
  if (snapshot.blocklist !== blocklist || snapshot.threads !== current.threads || snapshot.senders !== current.senders || snapshot.domains !== current.domains) {
    snapshot = { ...current, blocklist };
  }
  return snapshot;
}

/** The priority marks, ready for matching mail: blocked senders and domains never count as priority. */
export function usePriority(): PriorityList {
  return useSyncExternalStore(subscribe, matching);
}

function commit(next: StoredPriority): void {
  savePref("priority", { threads: next.threads, senders: next.senders, domains: next.domains });
}

/**
 * Clears what stands in the way of marking a sender or domain as priority: a block on it is lifted,
 * except a sender inside a blocked domain, which is refused (unblock the domain first). False when refused.
 */
function clearBlockFor(kind: PriorityKind, value: string): boolean {
  if (kind === "threads") return true;
  const blocks = getBlockList();
  const domain = kind === "senders" ? senderDomain(value) : value.trim().toLowerCase();
  if (kind === "senders" && isBlockedEntry(blocks, "domains", domain)) {
    toast.error(`Can't mark ${value} as priority`, { description: `@${domain} is blocked. Unblock it first.` });
    return false;
  }
  if (isBlockedEntry(blocks, kind, value)) {
    setBlocked(kind, [value], false);
    toast(`Unblocked ${kind === "domains" ? "@" : ""}${value}`);
  }
  return true;
}

/**
 * Marks or unmarks one conversation id, sender address or domain. Priority and Block exclude each
 * other: marking something that is blocked unblocks it, except a sender inside a blocked domain,
 * which is refused (unblock the domain first).
 */
export function togglePriority(kind: PriorityKind, value: string): void {
  setPriority(kind, [value], !isPriorityEntry(marks(), kind, value));
}

/**
 * Marks (`on`) or unmarks every one of these conversations, senders or domains that is not already
 * so, as one action with one Undo. Same rules as `togglePriority` for what is blocked.
 */
export function setPriority(
  kind: PriorityKind,
  values: readonly string[],
  on: boolean,
  options: { via?: string } = {},
): { applied: number; ref?: string } {
  const applied: string[] = [];
  for (const value of values) {
    if (isPriorityEntry(marks(), kind, value) === on) continue;
    if (on && !clearBlockFor(kind, value)) continue;
    commit(togglePriorityEntry(marks(), kind, value));
    applied.push(value);
  }
  if (applied.length === 0) return { applied: 0 };
  const target = countedTargets(kind, applied.length);
  const by = options.via ? ` via ${options.via}` : "";
  const title = `${on ? `Marked ${target} as priority` : `Removed the priority mark from ${target}`}${by}`;
  const context = applied.join(", ");
  const ref = newUndoRef("priority");
  recordAction("mail", title, "", { context, ref });
  undoStack.push({
    ref,
    label: title,
    context,
    run: () => {
      for (const value of applied) if (isPriorityEntry(marks(), kind, value) === on) commit(togglePriorityEntry(marks(), kind, value));
    },
  });
  return { applied: applied.length, ref };
}

/**
 * Blocks or unblocks senders or domains. Blocking takes their priority mark off (a domain's block
 * also takes off the marked senders in it), so no one is both blocked and priority.
 */
export function setBlockedClearingPriority(kind: BlockKind, values: readonly string[], blocked: boolean): void {
  setBlocked(kind, values, blocked);
  if (!blocked) return;
  const before = marks();
  let next = before;
  for (const value of values) next = withoutBlocked(next, kind, value);
  if (next !== before) commit(next);
}

export interface PriorityChoice {
  kind: PriorityKind;
  value: string;
  label: string;
}

/** One block of the Priority menu: a person's own choices (with their `contact`), or plain choices. */
export interface PrioritySection {
  contact?: Contact;
  choices: PriorityChoice[];
}

function contactChoices({ email }: Contact): PriorityChoice[] {
  const domain = senderDomain(email);
  return [
    { kind: "senders", value: email, label: `Everything from ${email}` },
    ...(domain !== "unknown" ? [{ kind: "domains" as const, value: domain, label: `Everything from @${domain}` }] : []),
  ];
}

/**
 * What the Priority command offers for a conversation, the same wherever it is shown: the
 * conversation itself, then the sender and domain. With several people in it, each gets their own
 * address and domain choices.
 */
export function prioritySections(thread: Thread, own: readonly string[]): PrioritySection[] {
  const conversation: PriorityChoice = { kind: "threads", value: thread.id, label: "This conversation" };
  const contacts = threadContacts(thread, own);
  if (contacts.length > 1) {
    return [{ choices: [conversation] }, ...contacts.map((contact) => ({ contact, choices: contactChoices(contact) }))];
  }
  return [{ choices: [conversation, ...contactChoices(contacts[0] ?? thread.latest.from)] }];
}

/** A sender or domain choice of the contact card's priority rows, worded like its Mute and Block rows. */
export interface PriorityCardChoice {
  kind: "senders" | "domains";
  value: string;
  label: string;
}

/** What the contact card offers for priority: one row for the sender and one for their domain, each taking the mark back when it is already on. */
export function priorityCardChoices(list: PriorityList, email: string, own: readonly string[]): PriorityCardChoice[] {
  const [sender] = emailTargets([email], own).senders;
  const [domain] = emailTargets([email], own).domains;
  const choices: PriorityCardChoice[] = [];
  if (sender) {
    choices.push({
      kind: "senders",
      value: sender,
      label: isPriorityEntry(list, "senders", sender) ? `Remove priority from ${sender}` : `Mark ${sender} as priority`,
    });
  }
  if (domain) {
    choices.push({
      kind: "domains",
      value: domain,
      label: isPriorityEntry(list, "domains", domain) ? `Remove priority from @${domain}` : `Mark @${domain} as priority`,
    });
  }
  return choices;
}

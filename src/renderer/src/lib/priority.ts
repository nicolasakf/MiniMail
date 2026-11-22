import { useSyncExternalStore } from "react";

import { toast } from "@/lib/toast";

import { isBlockedEntry, type BlockKind } from "@shared/blocklist";
import { senderDomain } from "@shared/categories";
import {
  isPriorityEntry,
  parsePriorityList,
  togglePriorityEntry,
  withoutBlocked,
  type PriorityKind,
  type PriorityList,
} from "@shared/priority";

import type { Thread } from "@shared/threads";
import type { Contact } from "@shared/types";

import { threadContacts } from "./format";
import { emailTargets, getBlockList, setBlocked, subscribeBlockList } from "./blocklist";
import { countedTargets, recordAction, reportError } from "@/lib/events";
import { newUndoRef, undoStack } from "@/lib/undo-stack";

const STORAGE_KEY = "minimail.priority";

function read(): PriorityList {
  try {
    return parsePriorityList(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null"));
  } catch (error) {
    reportError("storage", "Could not read the priority senders", error);
    return parsePriorityList(null);
  }
}

/**
 * What the user marked as priority, kept on this computer and shared by every part of the
 * window, so marking a sender in a menu updates the cards at once. When storage is unavailable
 * the marks still hold until the app closes.
 */
let current: PriorityList = read();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const stopBlock = subscribeBlockList(listener);
  return () => {
    listeners.delete(listener);
    stopBlock();
  };
}

/** The marks together with the block list, rebuilt only when either changes (a stable snapshot). */
let snapshot: PriorityList = { ...current, blocklist: getBlockList() };
function matching(): PriorityList {
  const blocklist = getBlockList();
  if (snapshot.blocklist !== blocklist || snapshot.threads !== current.threads || snapshot.senders !== current.senders || snapshot.domains !== current.domains) {
    snapshot = { ...current, blocklist };
  }
  return snapshot;
}

/** The priority marks, ready for matching mail: blocked senders and domains never count as priority. */
export function usePriority(): PriorityList {
  return useSyncExternalStore(subscribe, matching);
}

function commit(next: PriorityList): void {
  current = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch (error) {
    reportError("storage", "Could not remember the priority senders", error);
    // Storage can be unavailable; the mark holds until the app closes.
  }
  listeners.forEach((listener) => listener());
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
  setPriority(kind, [value], !isPriorityEntry(current, kind, value));
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
    if (isPriorityEntry(current, kind, value) === on) continue;
    if (on && !clearBlockFor(kind, value)) continue;
    commit(togglePriorityEntry(current, kind, value));
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
      for (const value of applied) if (isPriorityEntry(current, kind, value) === on) commit(togglePriorityEntry(current, kind, value));
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
  let next = current;
  for (const value of values) next = withoutBlocked(next, kind, value);
  if (next !== current) commit(next);
}

// Another window (a detached composer shares the origin) can change the list.
window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEY) return;
  current = read();
  listeners.forEach((listener) => listener());
});

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

import { useSyncExternalStore } from "react";

import { recordAction, reportError } from "@/lib/events";

/**
 * What the user can take back, newest last. Each user action that can be undone pushes an entry
 * when it happens; ⌘Z pops the newest, and a Log row with the same `ref` shows an Undo button that
 * takes back that one. It lives in memory: after a restart nothing is left to undo.
 */
export interface UndoEntry {
  /** The `ref` of the Log event that records the action, so the event can offer the Undo. */
  ref: string;
  /** What is taken back, as it reads in the Log: "Blocked a sender". */
  label: string;
  /** Sender, subject or similar: kept in the private part of the Log event. */
  context?: string;
  /** True when `run` already records what it did (a move of mail does); otherwise "Undid: <label>" is recorded. */
  logged?: boolean;
  /** Does the opposite. May do nothing if there is nothing left to take back (it was already cancelled). */
  run: () => void;
}

const MAX_ENTRIES = 50;

/**
 * Refs are saved with the Log events, and the counters start again at every launch, so a ref carries
 * the launch's own tag: an old row must never offer an Undo that belongs to a newer action.
 */
export const SESSION_TAG = Date.now().toString(36);
let refSerial = 0;
export const newUndoRef = (kind: string): string => `undo-${kind}-${SESSION_TAG}-${++refSerial}`;

let stack: UndoEntry[] = [];
/** Entries folded into another one (see `group`): still reachable by their own `ref`, but not by ⌘Z. */
const owned = new Map<string, UndoEntry>();
let collecting: UndoEntry[] | null = null;
let version = 0;
const listeners = new Set<() => void>();

function changed(): void {
  version++;
  listeners.forEach((listener) => listener());
}

function execute(entry: UndoEntry): boolean {
  try {
    entry.run();
    if (!entry.logged) recordAction("undo", `Undid: ${entry.label}`, "", entry.context ? { context: entry.context } : {});
  } catch (error) {
    reportError("undo", `Could not undo: ${entry.label}`, error, entry.context ? { context: entry.context } : {});
  }
  return true;
}

export const undoStack = {
  /** Remembers an action that can be undone. */
  push(entry: UndoEntry): void {
    if (collecting) {
      collecting.push(entry);
      owned.set(entry.ref, entry);
      return;
    }
    stack.push(entry);
    if (stack.length > MAX_ENTRIES) stack = stack.slice(-MAX_ENTRIES);
    changed();
  },

  /**
   * Runs `fn`; everything it pushes becomes part of one entry (`base`), so one ⌘Z takes all of it
   * back. `base.run` goes first, then the folded entries, newest first.
   */
  group(base: UndoEntry, fn: () => void): void {
    const outer = collecting;
    const inner: UndoEntry[] = [];
    collecting = inner;
    try {
      fn();
    } finally {
      collecting = outer;
    }
    undoStack.push({
      ...base,
      run: () => {
        base.run();
        for (const entry of [...inner].reverse()) {
          owned.delete(entry.ref);
          execute(entry);
        }
      },
    });
  },

  /** Takes back the newest action. False when there is nothing to take back. */
  undoLast(): boolean {
    const entry = stack.pop();
    if (!entry) return false;
    changed();
    return execute(entry);
  },

  /** Takes back one particular action (the Undo of a Log row or of a toast). False if it is gone. */
  undo(ref: string): boolean {
    const index = stack.findIndex((entry) => entry.ref === ref);
    if (index >= 0) {
      const [entry] = stack.splice(index, 1);
      changed();
      return execute(entry!);
    }
    const folded = owned.get(ref);
    if (!folded) return false;
    owned.delete(ref);
    return execute(folded);
  },

  has(ref: string): boolean {
    return stack.some((entry) => entry.ref === ref);
  },

  /** Newest last; for tests and tooltips. */
  entries(): readonly UndoEntry[] {
    return stack;
  },

  clear(): void {
    stack = [];
    owned.clear();
    changed();
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },

  /** Changes whenever the stack does. */
  version(): number {
    return version;
  },
};

/** Re-renders the caller whenever something is added to or taken off the stack. */
export function useUndoVersion(): number {
  return useSyncExternalStore(undoStack.subscribe, undoStack.version);
}

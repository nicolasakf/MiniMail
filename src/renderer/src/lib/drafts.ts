import { useSyncExternalStore } from "react";

import { toast } from "sonner";

import type { SavedDraft } from "@shared/types";

import { api } from "./api";
import { isTypingTarget } from "./keyboard";
import type { ComposeSeed } from "./compose";

export type { SavedDraft };

/**
 * Drafts live in a file on this computer, written by the main process, so they survive closing
 * the app and do not depend on which address the page was loaded from. They never reach the mail
 * server. This module keeps the list in memory for the screen and mirrors every change to disk.
 */
let cache: SavedDraft[] = [];
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** The drafts the old version kept in the page's local storage; moved to disk once, then removed. */
const LEGACY_KEY = "minimail.drafts";

function publish(next: SavedDraft[]): void {
  cache = next;
  listeners.forEach((listener) => listener());
}

function readLegacy(): SavedDraft[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(LEGACY_KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as SavedDraft[]) : [];
  } catch {
    return [];
  }
}

async function loadFromDisk(): Promise<void> {
  let list = await api.drafts.list();
  if (!api.system.demo) {
    const legacy = readLegacy();
    if (legacy.length > 0) {
      try {
        // Oldest first, so the newest ends up first in the list.
        for (const draft of legacy.reverse()) list = await api.drafts.save(draft);
        window.localStorage.removeItem(LEGACY_KEY);
      } catch {
        // Kept where it was and tried again next launch; nothing is lost.
      }
    }
  }
  publish(list);
}

/** Starts reading the drafts (once). Safe to call from anywhere, any number of times. */
function ready(): Promise<void> {
  loading ??= loadFromDisk().catch((error) => {
    loading = null; // try again next time something asks
    console.error("[drafts] could not load:", error);
  });
  return loading;
}

/** Saved drafts, most recently saved first. */
export function listDrafts(): SavedDraft[] {
  void ready();
  return cache;
}

/**
 * Saves a draft to disk, replacing the one with the same id. Resolves only once the file is
 * written, and rejects when it could not be, so the caller never tells the user "saved" falsely.
 */
export async function saveDraft(draft: SavedDraft): Promise<void> {
  await ready();
  publish(await api.drafts.save(draft));
}

/** Removes a draft from disk. Never rejects: a failure is reported to the user with a toast. */
export async function deleteDraft(id: string): Promise<void> {
  try {
    await ready();
    if (cache.some((draft) => draft.id === id)) publish(await api.drafts.remove(id));
  } catch (error) {
    toast.error(`Could not delete the draft: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function newDraftId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Re-renders the caller whenever a draft is saved or deleted. */
export function useDrafts(): SavedDraft[] {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    void ready();
    return () => listeners.delete(listener);
  }, listDrafts);
}

/** What the composer opens with to continue a saved draft. */
export function seedFromDraft(draft: SavedDraft): ComposeSeed {
  return {
    mode: draft.mode,
    accountId: draft.accountId,
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc,
    pendingText: draft.pendingText,
    draftId: draft.id,
    subject: draft.subject,
    body: draft.body,
    quoted: draft.quoted,
    inReplyTo: draft.inReplyTo,
  };
}

const DRAFT_TOAST_MS = 6000;

/** The draft the toast on screen offers to delete, so Backspace can act on it. */
let offered: { draftId: string; toastId: string } | null = null;
let removeKeyListener: (() => void) | null = null;

function forgetOffer(toastId: string): void {
  if (offered?.toastId !== toastId) return;
  offered = null;
  removeKeyListener?.();
  removeKeyListener = null;
}

function discardOffered(): void {
  if (!offered) return;
  const { draftId, toastId } = offered;
  forgetOffer(toastId);
  deleteDraft(draftId);
  toast.dismiss(toastId);
  toast("Draft deleted", { duration: 2500 });
}

/**
 * Tells the user the draft was kept. While that toast is up, Backspace (or its button) deletes the
 * draft. The key is caught before the app's own shortcuts, where Backspace would trash a
 * conversation, and is left alone while the user is typing in a field.
 */
export function showDraftSavedToast(draftId: string): void {
  if (offered) forgetOffer(offered.toastId);
  const toastId = `draft-saved-${draftId}`;
  offered = { draftId, toastId };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Backspace" && event.key !== "Delete") return;
    if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    discardOffered();
  };
  window.addEventListener("keydown", onKeyDown, true);
  removeKeyListener = () => window.removeEventListener("keydown", onKeyDown, true);

  toast("Draft saved", {
    id: toastId,
    description: "Press Backspace to delete it",
    duration: DRAFT_TOAST_MS,
    action: { label: "Delete draft", onClick: discardOffered },
    onDismiss: () => forgetOffer(toastId),
    onAutoClose: () => forgetOffer(toastId),
  });
}

import { useSyncExternalStore } from "react";

import type { ConfirmCard, ConfirmDecision } from "@shared/cli-page";

/**
 * The cards that ask the person before the CLI does something that cannot be taken back. One is shown at
 * a time, in the order they came; `askPerson` resolves with the person's answer. The dialog that shows them
 * lives with the mail view (`CliConfirmDialog`).
 */
interface Waiting {
  card: ConfirmCard;
  answer: (decision: ConfirmDecision) => void;
}

let queue: Waiting[] = [];
const listeners = new Set<() => void>();

function changed(): void {
  listeners.forEach((listener) => listener());
}

/** Shows a card and waits for the answer. */
export function askPerson(card: ConfirmCard): Promise<ConfirmDecision> {
  return new Promise((resolve) => {
    queue = [...queue, { card, answer: resolve }];
    changed();
  });
}

/** The card on screen, or null. */
export function currentCard(): ConfirmCard | null {
  return queue[0]?.card ?? null;
}

/** Answers the card on screen; the next one, if any, takes its place. Reject is what Escape and closing the card mean. */
export function answerCard(decision: ConfirmDecision): void {
  const waiting = queue[0];
  if (!waiting) return;
  queue = queue.slice(1);
  changed();
  waiting.answer(decision);
}

/** Re-renders the caller whenever a card comes or goes. */
export function useCliConfirm(): { card: ConfirmCard | null; answer: (decision: ConfirmDecision) => void } {
  const waiting = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => queue[0] ?? null,
  );
  return { card: waiting?.card ?? null, answer: answerCard };
}

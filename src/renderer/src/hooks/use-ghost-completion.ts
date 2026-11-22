import { useEffect, useRef } from "react";

import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";

import { clipAround, worthSuggesting } from "@/lib/completion";
import { reportError } from "@/lib/events";
import { ACCEPTED_META, canSuggestAt, dismissSuggestion, showSuggestion, suggestionAt } from "@/lib/ghost-text";

/** How long the user has to stop typing before a suggestion is asked for. */
const PAUSE_MS = 450;
/** After a failure no more is asked for this long: one failure is in the Log, not one per pause. */
const BACKOFF_MS = 60_000;

export interface GhostCompletion {
  enabled: boolean;
  /** Asks the model what comes next; the answer is "" when there is nothing to add. */
  suggest: (before: string, after: string) => Promise<string>;
}

/**
 * Asks for a suggestion each time the user pauses at the end of a paragraph and shows it as ghost
 * text. Whatever the user does meanwhile (typing, moving the cursor) makes an answer on its way
 * stale, and it is dropped when it arrives. Accepting a suggestion does not ask for the next one:
 * that waits for the user to type again.
 */
export function useGhostCompletion(editor: Editor | null, completion: GhostCompletion | undefined): void {
  const latest = useRef(completion);
  useEffect(() => {
    latest.current = completion;
  });
  const enabled = Boolean(completion?.enabled);

  useEffect(() => {
    if (!editor || !enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** Bumped by everything that makes a pending answer stale. */
    let round = 0;
    let pausedUntil = 0;

    const requestSuggestion = async () => {
      const current = latest.current;
      if (!current?.enabled || editor.isDestroyed || !editor.isFocused || !editor.isEditable || editor.view.composing) return;
      const { state } = editor;
      if (!canSuggestAt(state)) return;
      const pos = state.selection.from;
      const text = (from: number, to: number) =>
        state.doc.textBetween(from, to, "\n\n", (node) => (node.type.name === "hardBreak" ? "\n" : ""));
      const { before, after } = clipAround(text(0, pos), text(pos, state.doc.content.size));
      if (!worthSuggesting(before)) return;
      const mine = ++round;
      try {
        const suggestion = await current.suggest(before, after);
        if (mine === round && !editor.isDestroyed) showSuggestion(editor.view, pos, suggestion);
      } catch (error) {
        if (mine !== round) return;
        pausedUntil = Date.now() + BACKOFF_MS;
        // The main process has recorded it already; this skips a second entry for the same failure.
        reportError("compose", "Could not suggest text for the message", error);
      }
    };

    const onUpdate = ({ transaction }: { transaction: Transaction }) => {
      round++;
      clearTimeout(timer);
      // Not after accepting, nor while what the user typed is still the start of the suggestion on show.
      if (transaction.getMeta(ACCEPTED_META) || suggestionAt(editor.state) || Date.now() < pausedUntil) return;
      timer = setTimeout(() => void requestSuggestion(), PAUSE_MS);
    };
    // Typing also moves the cursor, and `onUpdate` has just scheduled the request: only a move on its own cancels it.
    const onMoved = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.docChanged) return;
      round++;
      clearTimeout(timer);
    };
    editor.on("update", onUpdate);
    editor.on("selectionUpdate", onMoved);
    const onBlur = () => {
      round++;
      clearTimeout(timer);
    };
    editor.on("blur", onBlur);
    return () => {
      editor.off("update", onUpdate);
      editor.off("selectionUpdate", onMoved);
      editor.off("blur", onBlur);
      clearTimeout(timer);
      round++;
      if (!editor.isDestroyed) dismissSuggestion(editor.view);
    };
  }, [editor, enabled]);
}

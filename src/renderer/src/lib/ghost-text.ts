import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

/**
 * Ghost text: a suggestion shown dimmed right after the cursor. Tab keeps it (it becomes real text),
 * Esc refuses it, and anything else the user does makes it disappear, except typing what it starts
 * with, which just eats into it. The text is not part of the document until it is accepted, so
 * undo, the draft that is saved and what is sent never see it.
 */

export interface Suggestion {
  /** Where it is shown: the cursor. */
  pos: number;
  text: string;
}

const key = new PluginKey<Suggestion | null>("ghostText");

/** Set on the transaction that accepts a suggestion, so nobody asks for another one right after. */
export const ACCEPTED_META = "ghostText:accepted";

/** The text a transaction typed at `pos`, when that is all it did. */
function typedAt(steps: readonly unknown[], pos: number): string | null {
  const [step] = steps;
  if (steps.length !== 1 || !(step instanceof ReplaceStep)) return null;
  const { from, to, slice } = step as ReplaceStep & { from: number; to: number };
  const node = slice.content.firstChild;
  if (from !== pos || to !== pos || slice.content.childCount !== 1 || !node?.isText) return null;
  return node.text ?? null;
}

/** The plugin that holds the suggestion and draws it; exported apart from the extension so it can be tried without an editor. */
export function ghostTextPlugin(): Plugin<Suggestion | null> {
  return new Plugin<Suggestion | null>({
    key,
    state: {
      init: () => null,
      apply(tr, previous) {
        const meta = tr.getMeta(key) as { suggestion: Suggestion | null } | undefined;
        if (meta) return meta.suggestion;
        if (!previous) return null;
        if (!tr.docChanged) return tr.selection.empty && tr.selection.from === previous.pos ? previous : null;
        // Typing what the suggestion starts with keeps the rest of it in place.
        const typed = typedAt(tr.steps, previous.pos);
        if (typed && previous.text.length > typed.length && previous.text.startsWith(typed)) {
          return { pos: previous.pos + typed.length, text: previous.text.slice(typed.length) };
        }
        return null;
      },
    },
    props: {
      decorations(state) {
        const suggestion = suggestionAt(state);
        if (!suggestion) return null;
        const widget = Decoration.widget(
          suggestion.pos,
          () => {
            const span = document.createElement("span");
            span.className = "mail-ghost";
            span.setAttribute("aria-hidden", "true");
            span.textContent = suggestion.text;
            return span;
          },
          { side: 1, ignoreSelection: true, key: `ghost:${suggestion.pos}:${suggestion.text}` },
        );
        return DecorationSet.create(state.doc, [widget]);
      },
    },
  });
}

export const GhostText = Extension.create({
  name: "ghostText",
  addProseMirrorPlugins: () => [ghostTextPlugin()],
});

/** The suggestion on show: only while the cursor is still where it was made for. */
export function suggestionAt(state: EditorState): Suggestion | null {
  const suggestion = key.getState(state);
  if (!suggestion || !state.selection.empty || state.selection.from !== suggestion.pos) return null;
  return suggestion;
}

/** Whether a suggestion could be shown here: the cursor is at the end of a paragraph, heading or list item. */
export function canSuggestAt(state: EditorState): boolean {
  const { $from, empty } = state.selection;
  return empty && $from.parent.isTextblock && $from.parentOffset === $from.parent.content.size;
}

/** Shows `text` after the cursor, if the cursor is still at `pos`. */
export function showSuggestion(view: EditorView, pos: number, text: string): void {
  if (!text || view.isDestroyed || view.state.selection.from !== pos || !canSuggestAt(view.state)) return;
  view.dispatch(view.state.tr.setMeta(key, { suggestion: { pos, text } }).setMeta("addToHistory", false));
}

/** Esc: takes the suggestion away. False when there was none, so the key can do what it always does. */
export function dismissSuggestion(view: EditorView): boolean {
  if (!suggestionAt(view.state)) return false;
  view.dispatch(view.state.tr.setMeta(key, { suggestion: null }).setMeta("addToHistory", false));
  return true;
}

/** Tab: writes the suggestion into the message. False when there was none, so Tab moves focus as usual. */
export function acceptSuggestion(view: EditorView): boolean {
  const suggestion = suggestionAt(view.state);
  if (!suggestion) return false;
  const { state } = view;
  const tr = state.tr.setMeta(key, { suggestion: null }).setMeta(ACCEPTED_META, true);
  // A blank line starts a new paragraph, a single line break stays inside the paragraph.
  for (const part of suggestion.text.split(/(\n{2,}|\n)/)) {
    if (part === "") continue;
    if (part.startsWith("\n")) {
      if (part.length > 1) tr.split(tr.selection.from);
      else tr.replaceSelectionWith(state.schema.nodes.hardBreak!.create());
    } else {
      tr.insertText(part);
    }
  }
  view.dispatch(tr.scrollIntoView());
  return true;
}

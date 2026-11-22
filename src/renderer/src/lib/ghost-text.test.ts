import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { describe, expect, it } from "vitest";

import { acceptSuggestion, ACCEPTED_META, canSuggestAt, dismissSuggestion, ghostTextPlugin, showSuggestion, suggestionAt } from "./ghost-text";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*", toDOM: () => ["p", 0] },
    text: { group: "inline" },
    hardBreak: { group: "inline", inline: true, selectable: false, toDOM: () => ["br"] },
  },
});

/** Just enough of an editor view: a state that transactions are applied to. */
function editor(text: string) {
  const paragraph = schema.nodes.paragraph!.create(null, text ? schema.text(text) : undefined);
  const doc = schema.nodes.doc!.create(null, paragraph);
  const view = {
    state: EditorState.create({ doc, plugins: [ghostTextPlugin()], selection: TextSelection.atEnd(doc) }),
    isDestroyed: false,
    dispatch(tr: Parameters<EditorState["apply"]>[0]) {
      view.state = view.state.apply(tr);
    },
  };
  return view as typeof view & EditorView;
}

const type = (view: ReturnType<typeof editor>, text: string) => view.dispatch(view.state.tr.insertText(text));
const written = (view: ReturnType<typeof editor>) => view.state.doc.textBetween(0, view.state.doc.content.size, "|", "\\n");

describe("ghost text", () => {
  it("shows a suggestion after the cursor, only at the end of a paragraph", () => {
    const view = editor("Hello");
    expect(canSuggestAt(view.state)).toBe(true);
    showSuggestion(view, 6, " there");
    expect(suggestionAt(view.state)).toEqual({ pos: 6, text: " there" });
    // It is not part of the message.
    expect(written(view)).toBe("Hello");

    const middle = editor("Hello");
    middle.dispatch(middle.state.tr.setSelection(TextSelection.create(middle.state.doc, 3)));
    expect(canSuggestAt(middle.state)).toBe(false);
    showSuggestion(middle, 3, "x");
    expect(suggestionAt(middle.state)).toBeNull();
  });

  it("ignores a suggestion made for a place the cursor has left", () => {
    const view = editor("Hello");
    type(view, "!");
    showSuggestion(view, 6, " there");
    expect(suggestionAt(view.state)).toBeNull();
  });

  it("keeps the rest of it while the user types what it starts with, and drops it on anything else", () => {
    const view = editor("Hello");
    showSuggestion(view, 6, " there, friend");
    type(view, " th");
    expect(suggestionAt(view.state)).toEqual({ pos: 9, text: "ere, friend" });
    type(view, "x");
    expect(suggestionAt(view.state)).toBeNull();

    const whole = editor("Hello");
    showSuggestion(whole, 6, " hi");
    type(whole, " hi");
    expect(suggestionAt(whole.state)).toBeNull(); // nothing is left of it
  });

  it("drops it when the cursor moves", () => {
    const view = editor("Hello");
    showSuggestion(view, 6, " there");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
    expect(suggestionAt(view.state)).toBeNull();
  });

  it("refuses it on Esc, and says there was nothing to refuse when there is none", () => {
    const view = editor("Hello");
    expect(dismissSuggestion(view)).toBe(false);
    showSuggestion(view, 6, " there");
    expect(dismissSuggestion(view)).toBe(true);
    expect(suggestionAt(view.state)).toBeNull();
    expect(written(view)).toBe("Hello");
  });

  it("writes it into the message on Tab, and marks that so nobody asks for the next one", () => {
    const view = editor("Hello");
    expect(acceptSuggestion(view)).toBe(false);
    showSuggestion(view, 6, " there");
    let accepted: unknown;
    const dispatch = view.dispatch;
    view.dispatch = (tr) => {
      accepted = tr.getMeta(ACCEPTED_META);
      dispatch(tr);
    };
    expect(acceptSuggestion(view)).toBe(true);
    expect(accepted).toBe(true);
    expect(written(view)).toBe("Hello there");
    expect(suggestionAt(view.state)).toBeNull();
    expect(view.state.selection.from).toBe(12);
  });

  it("starts a new paragraph for a blank line and a line break for a single one", () => {
    const view = editor("Hello");
    showSuggestion(view, 6, " there,\nfriend.\n\nBest");
    acceptSuggestion(view);
    expect(view.state.doc.childCount).toBe(2);
    expect(view.state.doc.child(0).textContent).toBe("Hello there,friend.");
    expect(view.state.doc.child(0).childCount).toBe(3); // text, break, text
    expect(view.state.doc.child(1).textContent).toBe("Best");
    expect(view.state.selection.$from.parent).toBe(view.state.doc.child(1));
    expect(view.state.selection.from).toBe(view.state.doc.content.size - 1);
  });
});

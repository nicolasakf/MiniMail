import { findOffsets, matchLength } from "@shared/find-text";
import type { MessageDetail } from "@shared/types";

/** Highlight names, shared by the page and by the message frames. */
export const MATCH_HIGHLIGHT = "find-match";
export const CURRENT_HIGHLIGHT = "find-current";

/** The look of a match inside a message frame (the page's own is in globals.css). */
const FRAME_STYLE = `::highlight(${MATCH_HIGHLIGHT}){background-color:#fde68a;color:#1f2328}
::highlight(${CURRENT_HIGHLIGHT}){background-color:#fb923c;color:#1f2328}`;

const SKIPPED = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

/** Every text node under `root` the reader can see as text, in document order. */
function textNodes(root: Node): Text[] {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      for (let parent = node.parentElement; parent && parent !== root; parent = parent.parentElement) {
        if (SKIPPED.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  return nodes;
}

/**
 * One range per match of `query` under `root`. A match can run across tags (`hel<b>lo</b>`),
 * so the text of all the nodes is searched as one string and the offsets are mapped back.
 */
export function rangesFor(root: Node, query: string): Range[] {
  const length = matchLength(query);
  if (length === 0) return [];
  const doc = root.ownerDocument ?? (root as Document);
  const nodes = textNodes(root);
  const starts: number[] = [];
  let text = "";
  for (const node of nodes) {
    starts.push(text.length);
    text += node.data;
  }
  const locate = (offset: number, atEnd: boolean): [Text, number] | null => {
    let low = 0;
    let high = nodes.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle] <= offset) low = middle;
      else high = middle - 1;
    }
    const node = nodes[low];
    if (!node) return null;
    // An end on the boundary between two nodes belongs to the first.
    if (atEnd && low > 0 && offset === starts[low]) return [nodes[low - 1], nodes[low - 1].length];
    return [node, offset - starts[low]];
  };
  const ranges: Range[] = [];
  for (const at of findOffsets(text, query)) {
    const start = locate(at, false);
    const end = locate(at + length, true);
    if (!start || !end) continue;
    const range = doc.createRange();
    range.setStart(start[0], start[1]);
    range.setEnd(end[0], end[1]);
    ranges.push(range);
  }
  return ranges;
}

/** Where a page (the window or a message frame) keeps its highlights. */
interface Paintable {
  CSS: { highlights: HighlightRegistry };
  Highlight: typeof Highlight;
}

function paintable(win: Window | null | undefined): Paintable | null {
  const candidate = win as unknown as Partial<Paintable> | null | undefined;
  return candidate?.CSS?.highlights && candidate.Highlight ? (candidate as Paintable) : null;
}

/** Paints `matches` and the `current` one in the page that owns `win`; with none, clears it. */
export function paint(win: Window | null | undefined, matches: readonly Range[], current: Range | null): void {
  const page = paintable(win);
  if (!page) return;
  const { highlights } = page.CSS;
  if (matches.length === 0) {
    highlights.delete(MATCH_HIGHLIGHT);
    highlights.delete(CURRENT_HIGHLIGHT);
    return;
  }
  const doc = win?.document;
  if (doc && win !== window && !doc.querySelector("style[data-find]")) {
    const style = doc.createElement("style");
    style.dataset.find = "";
    style.textContent = FRAME_STYLE;
    doc.head.append(style);
  }
  highlights.set(MATCH_HIGHLIGHT, new page.Highlight(...matches.filter((range) => range !== current)));
  if (current) highlights.set(CURRENT_HIGHLIGHT, new page.Highlight(current));
  else highlights.delete(CURRENT_HIGHLIGHT);
}

/** The plain text of a message, for deciding which messages hold a word. */
const textOf = new WeakMap<object, string>();
export function messageText(message: Pick<MessageDetail, "html" | "text">): string {
  const known = textOf.get(message);
  if (known !== undefined) return known;
  let text = message.text ?? "";
  if (message.html) {
    const parsed = new DOMParser().parseFromString(message.html, "text/html");
    parsed.querySelectorAll("script, style, template, noscript").forEach((element) => element.remove());
    text = parsed.body.textContent ?? "";
  }
  textOf.set(message, text);
  return text;
}

/**
 * Finding words inside one conversation (⌘F). Pure text helpers; the renderer turns the offsets
 * into highlighted ranges (`lib/thread-find.ts`).
 */

/** Lower-cases and drops accents, one character for one character, so offsets still line up with the original. */
function fold(text: string): string {
  let out = "";
  for (const char of text) {
    const folded = char.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    // A character that folds to another length (İ) is kept as it is, so offsets never drift.
    out += folded.length === char.length ? folded : char;
  }
  return out;
}

/** The start offsets of every non-overlapping match of `query` in `text`, ignoring case and accents. */
export function findOffsets(text: string, query: string): number[] {
  const needle = fold(query.trim());
  if (!needle) return [];
  const haystack = fold(text);
  const found: number[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return found;
    found.push(at);
    from = at + needle.length;
  }
}

/** How long a match is in the original text: the query's length once trimmed. */
export function matchLength(query: string): number {
  return query.trim().length;
}

/** True when `text` holds the query somewhere. */
export function containsText(text: string, query: string): boolean {
  return findOffsets(text, query).length > 0;
}

/** The index after `current` going `step` places (1 or -1), wrapping round the `count` matches. */
export function stepIndex(current: number, step: 1 | -1, count: number): number {
  if (count <= 0) return 0;
  return (current + step + count) % count;
}

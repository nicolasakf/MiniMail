import type { Category } from "@shared/types";

/** What saving the category editor would change, as far as already sorted mail is concerned. */
export interface CategoryChanges {
  added: Category[];
  deleted: Category[];
  /** Kept, but with different criteria: the text the classifier reads. */
  reworded: Category[];
}

/**
 * Compares the saved categories with the editor's draft. Renaming, the icon, the color and the
 * order are left out on purpose: none of them changes what the classifier reads or which id a
 * conversation is filed under, so mail that was sorted stays correctly sorted.
 */
export function categoryChanges(saved: readonly Category[], draft: readonly Category[]): CategoryChanges {
  const before = new Map(saved.map((category) => [category.id, category]));
  const after = new Set(draft.map((category) => category.id));
  return {
    added: draft.filter((category) => !before.has(category.id)),
    deleted: saved.filter((category) => !after.has(category.id)),
    reworded: draft.filter((category) => {
      const previous = before.get(category.id);
      return previous !== undefined && previous.criteria.trim() !== category.criteria.trim();
    }),
  };
}

/** True when already sorted mail would be out of step with the new categories. */
export function needsResort(changes: CategoryChanges): boolean {
  return changes.added.length + changes.deleted.length + changes.reworded.length > 0;
}

const nameOf = (category: Category) => category.name.trim() || "a new category";

function list(categories: readonly Category[]): string {
  const names = categories.map(nameOf);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The sentences of the "sort again?" dialog, one per kind of change. */
export function resortAdvice(changes: CategoryChanges): { lines: string[]; deleted: boolean } {
  const lines: string[] = [];
  if (changes.added.length > 0) {
    lines.push(`You added ${list(changes.added)}. Mail that is already sorted is not looked at again, so it starts out empty.`);
  }
  if (changes.reworded.length > 0) {
    lines.push(`You changed what ${list(changes.reworded)} looks for. Mail already in it, or elsewhere, keeps its category.`);
  }
  if (changes.deleted.length > 0) {
    lines.push(`You deleted ${list(changes.deleted)}. That mail has no category until it is sorted again.`);
  }
  return { lines, deleted: changes.deleted.length > 0 };
}

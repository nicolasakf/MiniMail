import { icons, Tag, type LucideIcon, type LucideProps } from "lucide-react";

/** Every Lucide icon by its exported name, sorted; what the picker offers. */
export const ICON_NAMES: readonly string[] = Object.keys(icons).sort();

const SEARCH_TEXT = new Map(
  ICON_NAMES.map((name) => [name, name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase()] as const),
);

/** Icons whose name contains every word typed ("cal plus" finds CalendarPlus). */
export function searchIcons(query: string): string[] {
  const words = query.toLowerCase().split(/[\s-]+/).filter(Boolean);
  if (words.length === 0) return [...ICON_NAMES];
  return ICON_NAMES.filter((name) => {
    const text = SEARCH_TEXT.get(name) ?? "";
    return words.every((word) => text.includes(word));
  });
}

/** The Lucide icon behind a category's icon name; an unknown or missing name gives a tag. */
export function categoryMenuIcon(icon: string | null | undefined): LucideIcon {
  return (icon ? icons[icon as keyof typeof icons] : undefined) ?? Tag;
}

/** A category's icon by name; an unknown or missing name shows a tag. */
export function CategoryIcon({ icon, ...props }: { icon: string | null | undefined } & LucideProps) {
  const Icon = (icon ? icons[icon as keyof typeof icons] : undefined) ?? Tag;
  return <Icon {...props} />;
}

import type { MailFolder } from "@shared/types";

import { AlertCard } from "@/components/ui/alert-card";
import { FOLDER_STYLE } from "@/lib/folder-style";

const NOTICE = {
  archive: { tone: "gray", label: "This email is archived." },
  trash: { tone: "red", label: "This email is in the trash." },
  spam: { tone: "amber", label: "This email is marked as spam." },
} as const;

/**
 * Below 560px of toolbar width the notice keeps just its icon, so it never pushes the reply buttons
 * out of a narrow toolbar. Its text stays available to screen readers and as a tooltip. The class
 * names are written out in full so Tailwind can find them.
 */
const NARROW_BADGE =
  "[@container(max-width:559px)]:w-9 [@container(max-width:559px)]:justify-center [@container(max-width:559px)]:px-0";
const NARROW_LABEL = "[@container(max-width:559px)]:sr-only";

/** Tells which folder a conversation is in, when it is Archive, Trash or Spam (the Inbox needs no mark). */
export function FolderBadge({ folder }: { folder: MailFolder }) {
  if (!(folder in NOTICE)) return null;
  const key = folder as keyof typeof NOTICE;
  return (
    <AlertCard
      {...NOTICE[key]}
      icon={FOLDER_STYLE[key].icon}
      // A square icon button's size when narrow; the toolbar must be a size container (see ThreadView).
      className={NARROW_BADGE}
      labelClassName={NARROW_LABEL}
    />
  );
}

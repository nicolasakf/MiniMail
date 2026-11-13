import type { MailFolder } from "@shared/types";

import { AlertCard } from "@/components/ui/alert-card";
import { FOLDER_STYLE } from "@/lib/folder-style";

const NOTICE = {
  archive: { tone: "gray", label: "This email is archived." },
  trash: { tone: "red", label: "This email is in the trash." },
  spam: { tone: "amber", label: "This email is marked as spam." },
} as const;

/** Tells which folder a conversation is in, when it is Archive, Trash or Spam (the Inbox needs no mark). */
export function FolderBadge({ folder }: { folder: MailFolder }) {
  if (!(folder in NOTICE)) return null;
  const key = folder as keyof typeof NOTICE;
  return <AlertCard {...NOTICE[key]} icon={FOLDER_STYLE[key].icon} />;
}

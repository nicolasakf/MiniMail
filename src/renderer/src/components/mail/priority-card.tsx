import { FLAT_KEY } from "@/components/ui/keys";
import { Zap } from "lucide-react";

/** "3 priority conversations" / "1 priority conversation". */
function countLabel(count: number): string {
  return `${count} priority ${count === 1 ? "conversation" : "conversations"}`;
}

/**
 * The card in the All Mail header, beside the view tabs: how many conversations have unread
 * priority mail. Clicking it opens the priority list, like a category. Nothing shows while
 * there is no unread priority mail.
 */
export function PriorityChip({ count, onOpen }: { count: number; onOpen: () => void }) {
  if (count === 0) return null;
  return (
    <button
      type="button"
      aria-label={`${countLabel(count)} with unread mail. Open the priority list`}
      onClick={onOpen}
      className={`electron-no-drag flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-xl px-2.5 text-[13px] font-medium !text-amber ${FLAT_KEY}`}
    >
      <Zap className="size-3.5 fill-current" />
      <span className="tabular-nums">{count}</span>
      <span>Priority</span>
    </button>
  );
}

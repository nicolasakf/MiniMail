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
      className="corner-squircle electron-no-drag flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 text-[13px] font-medium text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
    >
      <Zap className="size-3.5 fill-current" />
      <span className="tabular-nums">{count}</span>
      <span>Priority</span>
    </button>
  );
}

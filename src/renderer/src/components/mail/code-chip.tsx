import { KeyRound } from "lucide-react";
import { toast } from "sonner";

import {
  VERIFICATION_CATEGORY_ID,
  isFreshForCode,
} from "@shared/verification-code";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useVerificationCode } from "@/lib/verification-codes";

interface CodeChipProps {
  messageId: string;
  date: string;
  categoryId: string | null;
  className?: string;
  /** Only the key icon (the code is in the tooltip): for tight places such as a card's sender chips. */
  compact?: boolean;
}

/** Whether a message may show a code: verification mail, recent enough that the code still works. */
export function canShowCode(categoryId: string | null, date: string): boolean {
  // The demo's mail is dated relative to "today", so the age limit would hide every code there.
  return (
    categoryId === VERIFICATION_CATEGORY_ID &&
    (api.system.demo || isFreshForCode(date))
  );
}

/** The one-time code of a recent verification email; one click copies it. Nothing for other mail. */
export function CodeChip({
  messageId,
  date,
  categoryId,
  className,
  compact = false,
}: CodeChipProps) {
  const eligible = canShowCode(categoryId, date);
  const code = useVerificationCode(messageId, eligible);
  if (!code) return null;

  const copy = () => {
    navigator.clipboard.writeText(code).then(
      () => toast.success("Code copied"),
      () => toast.error("Could not copy the code."),
    );
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Copy verification code ${code}`}
          className={cn(
            "corner-squircle flex h-6 shrink-0 items-center gap-1 rounded-md bg-amber-500/10 font-mono text-[12px] font-semibold tabular-nums text-amber-700 outline-none transition-colors hover:bg-amber-500/20 dark:bg-amber-400/15 dark:text-amber-400 dark:hover:bg-amber-400/25 focus-visible:ring-2 focus-visible:ring-ring",
            compact ? "w-6 justify-center" : "px-1.5",
            className,
          )}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            copy();
          }}
        >
          <KeyRound className={compact ? "size-3.5" : "size-3"} />
          {!compact && code}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Copy code</TooltipContent>
    </Tooltip>
  );
}

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface ReadToggleProps {
  unread: boolean;
  /** What the thing being toggled is, for the accessible label ("conversation", "category"). */
  noun: string;
  onToggle: () => void;
  /** Keyboard shortcut shown beside the tooltip label. */
  hint?: string;
  /** The toggle covers several conversations at once ("Mark all as read"). */
  all?: boolean;
}

/**
 * The left-hand slot of a row: a blue dot while unread, an empty ring on hover once read.
 * Clicking flips between read and unread without opening the row.
 */
export function ReadToggle({ unread, noun, onToggle, hint, all = false }: ReadToggleProps) {
  const label = `Mark ${all ? "all " : ""}as ${unread ? "read" : "unread"}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`${label} (${noun})`}
          className="group/read -mx-1 flex size-6 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-accent"
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          <span
            className={cn(
              "size-2 rounded-full transition-colors",
              unread
                ? "bg-unread group-hover/read:bg-unread/60"
                : "border border-transparent group-hover:border-muted-foreground/60 group-hover/read:bg-muted-foreground/30",
            )}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        {hint ? <span className="ml-2 text-muted-foreground">{hint}</span> : null}
      </TooltipContent>
    </Tooltip>
  );
}

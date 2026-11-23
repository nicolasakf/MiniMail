import { useEffect, type RefObject } from "react";

import { ChevronDown, ChevronUp, Search, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { FLAT_KEY_IN } from "@/components/ui/keys";

interface FindBarProps {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange: (query: string) => void;
  /** How many matches there are, and which one is the current (0-based). */
  count: number;
  index: number;
  onStep: (direction: 1 | -1) => void;
  onClose: () => void;
  className?: string;
}

/** The small bar of a conversation's ⌘F: a field, "3 / 12", previous, next and close. */
export function FindBar({ inputRef, query, onQueryChange, count, index, onStep, onClose, className }: FindBarProps) {
  // Opening puts the cursor in the field with the last word selected, ready to be typed over.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [inputRef]);

  const searching = query.trim() !== "";
  return (
    <div
      role="search"
      className={cn(
        "corner-squircle electron-no-drag flex items-center gap-1 rounded-xl plate-1 p-1 pl-2.5 text-popover-foreground shadow-overlay",
        className,
      )}
    >
      <Search className="size-3.5 shrink-0 text-muted-foreground" />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            // Closes the bar only: Esc must not also leave the conversation.
            event.preventDefault();
            event.stopPropagation();
            onClose();
          } else if (event.key === "Enter") {
            event.preventDefault();
            onStep(event.shiftKey ? -1 : 1);
          }
        }}
        placeholder="Find in conversation"
        aria-label="Find in conversation"
        spellCheck={false}
        autoComplete="off"
        className="h-7 w-48 min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
      <span className={cn("w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground", !searching && "invisible")}>
        {count === 0 ? "No results" : `${index + 1} / ${count}`}
      </span>
      <button
        type="button"
        aria-label="Previous match"
        title="Previous match (⇧↵)"
        disabled={count === 0}
        onClick={() => onStep(-1)}
        className={cn("flex size-7 items-center justify-center rounded-[10px] text-muted-foreground disabled:opacity-40", FLAT_KEY_IN)}
      >
        <ChevronUp className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Next match"
        title="Next match (↵)"
        disabled={count === 0}
        onClick={() => onStep(1)}
        className={cn("flex size-7 items-center justify-center rounded-[10px] text-muted-foreground disabled:opacity-40", FLAT_KEY_IN)}
      >
        <ChevronDown className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Close find"
        title="Close (Esc)"
        onClick={onClose}
        className={cn("flex size-7 items-center justify-center rounded-[10px] text-muted-foreground", FLAT_KEY_IN)}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

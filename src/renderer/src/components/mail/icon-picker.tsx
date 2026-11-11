import { useDeferredValue, useMemo, useRef, useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { CategoryIcon, ICON_NAMES, searchIcons } from "./category-icon";

/** The grid shows this many at a time; typing narrows it. Keeps the popover quick with ~2000 icons. */
const SHOWN = 120;

interface IconPickerProps {
  /** The category's current icon name, or undefined for the default tag. */
  value: string | undefined;
  hue: number;
  onChange: (icon: string) => void;
  label: string;
}

/** A button showing the category's icon that opens a searchable grid of every Lucide icon. */
export function IconPicker({ value, hue, onChange, label }: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  // Inside a dialog the popover has to live in it, or the dialog's focus trap steals typing from the search box.
  const [container, setContainer] = useState<HTMLElement | undefined>(undefined);
  const deferred = useDeferredValue(query);

  const matches = useMemo(() => searchIcons(deferred), [deferred]);
  const shown = matches.slice(0, SHOWN);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setContainer(trigger.current?.closest<HTMLElement>('[role="dialog"]') ?? undefined);
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          ref={trigger}
          type="button"
          aria-label={`${label}: choose icon`}
          className="corner-squircle flex size-9 shrink-0 items-center justify-center rounded-lg outline-none ring-offset-background transition hover:brightness-125 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          style={{ background: `hsl(${hue} 70% 55% / 0.16)`, color: `hsl(${hue} 70% 62%)` }}
        >
          <CategoryIcon icon={value} className="size-[18px]" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" container={container} className="w-80 space-y-2 p-2">
        <Input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${ICON_NAMES.length} icons`}
          aria-label="Search icons"
          className="h-8"
        />
        {shown.length === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-muted-foreground">No icon matches "{query}".</p>
        ) : (
          <div className="grid max-h-64 grid-cols-8 gap-1 overflow-y-auto" role="listbox" aria-label="Icons">
            {shown.map((name) => (
              <button
                key={name}
                type="button"
                role="option"
                aria-selected={name === value}
                aria-label={name}
                title={name}
                onClick={() => {
                  onChange(name);
                  setOpen(false);
                }}
                className={cn(
                  "flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring",
                  name === value && "bg-accent text-accent-foreground ring-1 ring-foreground/40",
                )}
              >
                <CategoryIcon icon={name} className="size-4" />
              </button>
            ))}
          </div>
        )}
        {matches.length > shown.length && (
          <p className="px-1 text-xs text-muted-foreground">
            Showing {shown.length} of {matches.length}. Type to narrow it down.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

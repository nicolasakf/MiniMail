import { useRef, useState } from "react";

import { format, isValid, parseISO, startOfMonth, startOfToday, startOfWeek, startOfYear } from "date-fns";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { sortMailAgain } from "@/lib/sort-progress";
import { cn } from "@/lib/utils";

type Range = "all" | "since";

/** The value an `<input type="date">` holds: a local calendar day. */
const DAY = "yyyy-MM-dd";

const PRESETS: { label: string; start: () => Date }[] = [
  { label: "This week", start: () => startOfWeek(startOfToday()) },
  { label: "This month", start: () => startOfMonth(startOfToday()) },
  { label: "This year", start: () => startOfYear(startOfToday()) },
];

/**
 * "Sort all mail again": asks how far back to go (everything, or mail since a day picked from
 * presets or a calendar) and then starts the run. Choosing here replaces a confirm prompt.
 */
export function SortAgainMenu() {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<Range>("all");
  const [day, setDay] = useState(() => format(PRESETS[1].start(), DAY));
  const trigger = useRef<HTMLButtonElement>(null);
  // Inside a dialog the overlays have to live in it, or the dialog's focus trap steals the keyboard.
  const [container, setContainer] = useState<HTMLElement | undefined>(undefined);

  const today = format(startOfToday(), DAY);
  const since = parseISO(day);
  const sinceValid = isValid(since) && day <= today;

  const start = () => {
    setOpen(false);
    void sortMailAgain(range === "since" ? since : undefined);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setContainer(trigger.current?.closest<HTMLElement>('[role="dialog"]') ?? undefined);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button ref={trigger} type="button" variant="ghost" size="sm">
          Sort all mail again
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" container={container} className="w-72 space-y-3 p-3">
        <div className="space-y-1.5">
          <label htmlFor="sort-again-range" className="text-xs font-medium text-muted-foreground">
            Mail to sort again
          </label>
          <Select value={range} onValueChange={(value) => setRange(value as Range)}>
            <SelectTrigger id="sort-again-range" className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent container={container}>
              <SelectItem value="all">All time</SelectItem>
              <SelectItem value="since">Since a date</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {range === "since" && (
          <div className="space-y-2">
            <div className="flex gap-1.5">
              {PRESETS.map((preset) => {
                const value = format(preset.start(), DAY);
                return (
                  <button
                    key={preset.label}
                    type="button"
                    aria-pressed={day === value}
                    onClick={() => setDay(value)}
                    className={cn(
                      "corner-squircle flex-1 rounded-md border px-2 py-1 text-xs outline-none transition focus-visible:ring-2 focus-visible:ring-ring",
                      day === value
                        ? "border-primary bg-primary/15 text-foreground"
                        : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            <Input
              type="date"
              aria-label="Sort mail received since"
              className="h-8"
              value={day}
              max={today}
              onChange={(event) => setDay(event.target.value)}
            />
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {range === "all"
            ? "Every conversation is sent to Jev once more."
            : "Conversations with mail from that day on are sent to Jev once more."}
        </p>
        <Button type="button" size="sm" className="w-full" onClick={start} disabled={range === "since" && !sinceValid}>
          Sort again
        </Button>
      </PopoverContent>
    </Popover>
  );
}

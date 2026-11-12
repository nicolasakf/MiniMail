import { useEffect, useRef, useState } from "react";

import { format, isValid, parseISO, startOfMonth, startOfToday, startOfWeek, startOfYear } from "date-fns";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import { sortMailAgain } from "@/lib/sort-progress";
import type { SortCounts, SortFolder } from "@shared/types";

type Range = "all" | "since";

/** The value the calendar holds: a local calendar day. */
const DAY = "yyyy-MM-dd";

const PRESETS: { label: string; start: () => Date }[] = [
  { label: "This week", start: () => startOfWeek(startOfToday()) },
  { label: "This month", start: () => startOfMonth(startOfToday()) },
  { label: "This year", start: () => startOfYear(startOfToday()) },
];

/** Folders the user can choose, in the order shown. */
const FOLDERS: { id: SortFolder; label: string }[] = [
  { id: "inbox", label: "Inbox" },
  { id: "archive", label: "Archive" },
  { id: "spam", label: "Spam" },
  { id: "trash", label: "Trash" },
];

const plural = (count: number) => `${count.toLocaleString()} conversation${count === 1 ? "" : "s"}`;

/**
 * "Sort all mail again": asks how far back to go (everything, or mail since a day picked from
 * presets or a calendar), and which of Inbox, Archive, Spam and Trash, then starts the
 * run. Choosing here replaces a confirm prompt. Counts are conversations, the unit Jev sorts.
 */
export function SortAgainMenu() {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<Range>("all");
  const [day, setDay] = useState(() => format(PRESETS[1].start(), DAY));
  const [chosen, setChosen] = useState<SortFolder[]>(["inbox"]);
  const [counts, setCounts] = useState<SortCounts | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // Inside a dialog the overlays have to live in it, or the dialog's focus trap steals the keyboard.
  const [container, setContainer] = useState<HTMLElement | undefined>(undefined);

  const today = format(startOfToday(), DAY);
  const since = parseISO(day);
  const sinceValid = isValid(since) && day <= today;

  const sinceIso = range === "since" && sinceValid ? since.toISOString() : undefined;
  useEffect(() => {
    if (!open || (range === "since" && !sinceValid)) return;
    let current = true;
    api.categories
      .sortCounts(sinceIso ? { since: sinceIso } : undefined)
      .then((next) => current && setCounts(next))
      .catch(() => current && setCounts(null));
    return () => {
      current = false;
    };
  }, [open, range, sinceValid, sinceIso]);

  const total = counts ? chosen.reduce((sum, folder) => sum + counts[folder], 0) : null;

  const toggle = (folder: SortFolder, checked: boolean) =>
    setChosen((current) => (checked ? [...current, folder] : current.filter((id) => id !== folder)));

  const start = () => {
    setOpen(false);
    void sortMailAgain(range === "since" ? since : undefined, chosen);
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
      <PopoverContent align="start" side="top" container={container} className="w-80 space-y-3 p-3">
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
          <Calendar
            value={day}
            onChange={setDay}
            max={today}
            container={container}
            presets={PRESETS.map((preset) => ({ label: preset.label, value: format(preset.start(), DAY) }))}
          />
        )}

        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium text-muted-foreground">Folders to sort</legend>
          {FOLDERS.map(({ id, label }) => (
            <div key={id} className="flex items-center justify-between text-sm">
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox
                  checked={chosen.includes(id)}
                  onCheckedChange={(checked) => toggle(id, checked === true)}
                />
                {label}
              </label>
              <span className="text-xs text-muted-foreground">{counts ? plural(counts[id]) : "…"}</span>
            </div>
          ))}
        </fieldset>

        <p className="text-xs text-muted-foreground" aria-live="polite">
          {chosen.length === 0
            ? "Choose at least one folder."
            : total === null
              ? "Counting…"
              : `${plural(total)} will be sent to Jev once more.`}
        </p>
        <Button type="button" size="sm" className="w-full" onClick={start} disabled={chosen.length === 0 || (range === "since" && !sinceValid)}>
          Sort again
        </Button>
      </PopoverContent>
    </Popover>
  );
}

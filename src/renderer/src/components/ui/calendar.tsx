import * as React from "react"
import {
  addDays,
  addMonths,
  endOfMonth,
  format,
  getDay,
  setMonth,
  setYear,
  startOfMonth,
} from "date-fns"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DAY_FORMAT, parseDay, pickRangeDay, rangePosition, type DayRange } from "@/lib/date-range"
import { cn } from "@/lib/utils"

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]
const MONTHS = Array.from({ length: 12 }, (_, month) => format(new Date(2000, month, 1), "MMM"))

const dayKey = (day: Date) => format(day, DAY_FORMAT)

/** The latest first month that still shows `max`'s month as its last, but never before `floor`. */
function maxFirstMonth(max: Date, numberOfMonths: number, floor: Date | undefined): Date {
  const latest = addMonths(startOfMonth(max), -(numberOfMonths - 1))
  return floor && latest < floor ? floor : latest
}

/** A quick-pick chip under the grid. */
export interface CalendarChip {
  label: string
  active: boolean
  onSelect: () => void
}

function Chips({ chips }: { chips: CalendarChip[] | undefined }) {
  if (!chips || chips.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <button
          key={chip.label}
          type="button"
          aria-pressed={chip.active}
          onClick={chip.onSelect}
          className={cn(
            "corner-squircle rounded-lg px-3 py-1.5 text-xs font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-ring",
            chip.active ? "bg-foreground text-background" : "bg-muted text-foreground hover:bg-muted/70",
          )}
        >
          {chip.label}
        </button>
      ))}
    </div>
  )
}

interface CalendarBaseProps {
  /** Latest pickable day (`yyyy-MM-dd`); later days are dimmed and cannot be chosen. */
  max?: string
  /** Earliest pickable day (`yyyy-MM-dd`). */
  min?: string
  /** Year choices in the dropdown; default to the min/max years, else ten years around the value. */
  fromYear?: number
  toYear?: number
  /** Overlay container for the month and year selects when rendered inside a modal. */
  container?: React.ComponentPropsWithoutRef<typeof SelectContent>["container"]
  className?: string
}

interface FrameProps extends CalendarBaseProps {
  numberOfMonths: 1 | 2
  /** The day whose month is brought into view whenever it changes. */
  anchor: string | undefined
  /** Days drawn as the dark rounded square (the picked day, or the ends of a range). */
  isSelected: (day: string) => boolean
  /** Days drawn with the soft band behind them, for ranges. */
  band?: (day: string) => "single" | "start" | "middle" | "end" | undefined
  onPick: (day: string) => void
  chips?: CalendarChip[]
}

/**
 * The month grid(s) with month and year dropdowns and arrow-key navigation. Days outside
 * `min`/`max` stay visible but cannot be chosen. Meant to be used through `Calendar` or `RangeCalendar`.
 */
function CalendarFrame({
  numberOfMonths,
  anchor,
  isSelected,
  band,
  onPick,
  chips,
  max,
  min,
  fromYear,
  toYear,
  container,
  className,
}: FrameProps) {
  const maxDay = parseDay(max)
  const minDay = parseDay(min)

  const [month, setVisibleMonth] = React.useState(() => startOfMonth(parseDay(anchor) ?? maxDay ?? new Date()))
  // Keyboard focus lives on one day at a time (roving tabindex); `moveFocus` marks arrow-key moves so
  // a button is only focused after a keystroke, never while a popover is merely opening.
  const [focusDay, setFocusDay] = React.useState<string | undefined>(undefined)
  const moveFocus = React.useRef(false)
  const grid = React.useRef<HTMLDivElement>(null)

  // A preset (or the parent) changing the value brings its month into view.
  React.useEffect(() => {
    const day = parseDay(anchor)
    if (day) setVisibleMonth(startOfMonth(day))
  }, [anchor])

  const monthKeys = Array.from({ length: numberOfMonths }, (_, index) => format(addMonths(month, index), "yyyy-MM"))
  React.useEffect(() => {
    if (!moveFocus.current || !focusDay) return
    moveFocus.current = false
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`)?.focus()
  }, [focusDay, month])

  const disabled = (day: Date) => (maxDay ? day > maxDay : false) || (minDay ? day < minDay : false)

  const reference = parseDay(anchor) ?? maxDay ?? new Date()
  const lowYear = fromYear ?? minDay?.getFullYear() ?? reference.getFullYear() - 10
  const highYear = toYear ?? maxDay?.getFullYear() ?? reference.getFullYear() + 10
  const years = Array.from({ length: Math.max(highYear - lowYear + 1, 1) }, (_, index) => lowYear + index)

  // The first month shown runs from the one holding `min` to the latest one that still ends at `max`.
  const firstMonthMin = minDay ? startOfMonth(minDay) : undefined
  const firstMonthMax = maxDay ? maxFirstMonth(maxDay, numberOfMonths, firstMonthMin) : undefined
  const canGoPrev = !firstMonthMin || month > firstMonthMin
  const canGoNext = !firstMonthMax || month < firstMonthMax

  const goTo = (target: Date) => {
    let next = startOfMonth(target)
    if (firstMonthMax && next > firstMonthMax) next = firstMonthMax
    if (firstMonthMin && next < firstMonthMin) next = firstMonthMin
    setVisibleMonth(next)
  }

  // Brings a keyboard target into view: earlier than the first month, or later than the last.
  const reveal = (target: Date) => {
    const start = startOfMonth(target)
    if (start < month) setVisibleMonth(start)
    else if (start > addMonths(month, numberOfMonths - 1)) setVisibleMonth(addMonths(start, -(numberOfMonths - 1)))
  }

  const onKeyDown = (event: React.KeyboardEvent, day: Date) => {
    const step: Record<string, Date> = {
      ArrowLeft: addDays(day, -1),
      ArrowRight: addDays(day, 1),
      ArrowUp: addDays(day, -7),
      ArrowDown: addDays(day, 7),
      Home: addDays(day, -getDay(day)),
      End: addDays(day, 6 - getDay(day)),
      PageUp: addMonths(day, -1),
      PageDown: addMonths(day, 1),
    }
    let target = step[event.key]
    if (!target) return
    event.preventDefault()
    // Stop at the bounds instead of walking onto a day that cannot be picked.
    if (maxDay && target > maxDay) target = maxDay
    else if (minDay && target < minDay) target = minDay
    moveFocus.current = true
    setFocusDay(dayKey(target))
    reveal(target)
  }

  // The tab stop: the keyboard-focused day, else the picked day, else the first pickable day shown.
  const shown = (key: string) => monthKeys.some((monthKey) => key.startsWith(monthKey))
  const firstPickable = (() => {
    for (let offset = 0; offset < numberOfMonths; offset += 1) {
      const start = addMonths(month, offset)
      for (let index = 0; index < endOfMonth(start).getDate(); index += 1) {
        const day = addDays(start, index)
        if (!disabled(day)) return dayKey(day)
      }
    }
    return dayKey(month)
  })()
  const tabStop = focusDay && shown(focusDay) ? focusDay : anchor && shown(anchor) ? anchor : firstPickable

  const navButton =
    "corner-squircle inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
  const dropdown = "h-8 w-auto gap-1.5 rounded-lg px-2.5 text-sm font-medium"
  const spacer = <span className="w-8" aria-hidden />

  const renderMonth = (start: Date, index: number) => {
    const days = Array.from({ length: endOfMonth(start).getDate() }, (_, offset) => addDays(start, offset))
    const lastOfMonth = days.length
    const leading = getDay(start)
    const first = index === 0
    const last = index === numberOfMonths - 1

    return (
      <div key={format(start, "yyyy-MM")} className="min-w-0 space-y-3">
        <div className="flex items-center justify-between gap-1.5">
          {first ? (
            <button
              type="button"
              aria-label="Previous month"
              className={navButton}
              disabled={!canGoPrev}
              onClick={() => goTo(addMonths(month, -1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          ) : (
            spacer
          )}
          {first ? (
            <div className="flex items-center gap-1.5">
              <Select value={String(month.getMonth())} onValueChange={(next) => goTo(setMonth(month, Number(next)))}>
                <SelectTrigger aria-label="Month" className={dropdown}>
                  <SelectValue>{MONTHS[month.getMonth()]}</SelectValue>
                </SelectTrigger>
                <SelectContent container={container} className="min-w-0">
                  {MONTHS.map((label, monthIndex) => {
                    const candidate = new Date(month.getFullYear(), monthIndex, 1)
                    const out =
                      (firstMonthMax ? candidate > firstMonthMax : false) ||
                      (firstMonthMin ? endOfMonth(candidate) < firstMonthMin : false)
                    return (
                      <SelectItem key={label} value={String(monthIndex)} disabled={out}>
                        {label}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
              <Select value={String(month.getFullYear())} onValueChange={(next) => goTo(setYear(month, Number(next)))}>
                <SelectTrigger aria-label="Year" className={dropdown}>
                  <SelectValue>{month.getFullYear()}</SelectValue>
                </SelectTrigger>
                <SelectContent container={container} className="min-w-0">
                  {years.map((year) => (
                    <SelectItem key={year} value={String(year)}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <span className="px-2.5 text-sm font-medium">{format(start, "MMM yyyy")}</span>
          )}
          {last ? (
            <button
              type="button"
              aria-label="Next month"
              className={navButton}
              disabled={!canGoNext}
              onClick={() => goTo(addMonths(month, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            spacer
          )}
        </div>

        <div role="grid" aria-label={format(start, "MMMM yyyy")}>
          <div role="row" className="grid grid-cols-7">
            {WEEKDAYS.map((label) => (
              <div
                key={label}
                role="columnheader"
                className="flex h-8 items-center justify-center text-xs font-medium text-muted-foreground"
              >
                {label}
              </div>
            ))}
          </div>
          <div role="row" className="grid grid-cols-7">
            {Array.from({ length: leading }, (_, blank) => (
              <div key={`blank-${blank}`} role="gridcell" />
            ))}
            {days.map((day) => {
              const key = dayKey(day)
              const selected = isSelected(key)
              const position = band?.(key)
              const isOut = disabled(day)
              const isToday = key === dayKey(new Date())
              const weekday = getDay(day)
              const date = day.getDate()
              return (
                <div
                  key={key}
                  role="gridcell"
                  className={cn(
                    "flex justify-center py-0.5",
                    position === "start" && "rounded-l-xl bg-muted",
                    position === "end" && "rounded-r-xl bg-muted",
                    position === "middle" && "bg-muted",
                    position === "middle" && (weekday === 0 || date === 1) && "rounded-l-xl",
                    position === "middle" && (weekday === 6 || date === lastOfMonth) && "rounded-r-xl",
                    // Ends of a band that wraps over a week or month edge still need square outer corners.
                    position === "start" && (weekday === 6 || date === lastOfMonth) && "rounded-r-xl",
                    position === "end" && (weekday === 0 || date === 1) && "rounded-l-xl",
                  )}
                >
                  <button
                    type="button"
                    data-day={key}
                    tabIndex={key === tabStop ? 0 : -1}
                    disabled={isOut}
                    aria-pressed={selected}
                    aria-current={isToday ? "date" : undefined}
                    aria-label={format(day, "EEEE, MMMM d, yyyy")}
                    onClick={() => onPick(key)}
                    onFocus={() => setFocusDay(key)}
                    onKeyDown={(event) => onKeyDown(event, day)}
                    className={cn(
                      "corner-squircle flex h-9 w-9 items-center justify-center rounded-xl text-sm tabular-nums outline-none transition focus-visible:ring-2 focus-visible:ring-ring",
                      selected
                        ? "bg-foreground font-medium text-background"
                        : position
                          ? "text-foreground hover:bg-foreground/10"
                          : "text-foreground hover:bg-muted",
                      isToday &&
                        !selected &&
                        "font-semibold underline decoration-muted-foreground/50 underline-offset-4",
                      isOut && "pointer-events-none opacity-30",
                    )}
                  >
                    {date}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div ref={grid} className={cn("grid gap-x-6", numberOfMonths === 2 ? "grid-cols-2" : "grid-cols-1")}>
        {monthKeys.map((_, index) => renderMonth(addMonths(month, index), index))}
      </div>
      <Chips chips={chips} />
    </div>
  )
}

export interface CalendarPreset {
  label: string
  /** The day this chip picks, as `yyyy-MM-dd`. */
  value: string
}

export interface CalendarProps extends CalendarBaseProps {
  /** The picked day (`yyyy-MM-dd`). */
  value: string
  onChange: (value: string) => void
  /** Quick-pick chips shown under the grid. */
  presets?: CalendarPreset[]
}

/** One month with month and year dropdowns, for picking a single day. */
export function Calendar({ value, onChange, presets, ...frame }: CalendarProps) {
  return (
    <CalendarFrame
      {...frame}
      numberOfMonths={1}
      anchor={value}
      isSelected={(day) => day === value}
      onPick={onChange}
      chips={presets?.map((preset) => ({
        label: preset.label,
        active: value === preset.value,
        onSelect: () => onChange(preset.value),
      }))}
    />
  )
}

export interface RangeCalendarPreset {
  label: string
  /** The range this chip picks. */
  range: { from: string; to: string }
}

export interface RangeCalendarProps extends CalendarBaseProps {
  value: DayRange
  /** Called on every click: with just `from` after the first, with both after the second. */
  onChange: (value: DayRange) => void
  /** Months shown side by side; the range calendar shows two by default. */
  numberOfMonths?: 1 | 2
  presets?: RangeCalendarPreset[]
}

/** Two months with a soft band between the picked ends, for picking a range of days. */
export function RangeCalendar({ value, onChange, numberOfMonths = 2, presets, ...frame }: RangeCalendarProps) {
  return (
    <CalendarFrame
      {...frame}
      numberOfMonths={numberOfMonths}
      anchor={value.from}
      isSelected={(day) => day === value.from || day === value.to}
      band={(day) => rangePosition(value, day)}
      onPick={(day) => onChange(pickRangeDay(value, day))}
      chips={presets?.map((preset) => ({
        label: preset.label,
        active: value.from === preset.range.from && value.to === preset.range.to,
        onSelect: () => onChange({ ...preset.range }),
      }))}
    />
  )
}

import * as React from "react"
import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  format,
  startOfMonth,
  startOfToday,
} from "date-fns"
import { ChevronLeft, ChevronRight } from "lucide-react"

import {
  DAY_FORMAT,
  dayIndexAt,
  dayRatio,
  moveHandle,
  parseDay,
  shiftRange,
  type ClosedRange,
  type IndexRange,
} from "@/lib/date-range"
import { cn } from "@/lib/utils"

const SHOWN = "MMM d, yyyy"
const dayKey = (day: Date) => format(day, DAY_FORMAT)

export interface DateRangeSliderPreset {
  label: string
  range: ClosedRange
}

export interface DateRangeSliderProps {
  value: ClosedRange
  onChange: (value: ClosedRange) => void
  label?: string
  /** Months on the timeline at once; paging moves it one month at a time. */
  visibleMonths?: number
  /** The fewest days the range may span, counting both ends. */
  minDays?: number
  /** Earliest and latest day the range may reach (`yyyy-MM-dd`). */
  min?: string
  max?: string
  /** Quick-pick chips; by default the last 7 days, the last 30 days and this month. */
  presets?: DateRangeSliderPreset[]
  className?: string
}

function defaultPresets(): DateRangeSliderPreset[] {
  const today = startOfToday()
  return [
    { label: "Last 7 days", range: { from: dayKey(addDays(today, -6)), to: dayKey(today) } },
    { label: "Last 30 days", range: { from: dayKey(addDays(today, -29)), to: dayKey(today) } },
    { label: "This month", range: { from: dayKey(startOfMonth(today)), to: dayKey(today) } },
  ]
}

type Drag = { mode: "from" | "to" | "body"; origin: number; start: IndexRange }

/**
 * A timeline of a few months with a draggable selection: pull either end to resize it, drag the bar
 * to slide it, or use the arrow keys on a handle. Chips pick common ranges and the arrows page by month.
 */
export function DateRangeSlider({
  value,
  onChange,
  label,
  visibleMonths = 4,
  minDays = 1,
  min,
  max,
  presets,
  className,
}: DateRangeSliderProps) {
  const from = parseDay(value.from) ?? startOfToday()
  const to = parseDay(value.to) ?? from
  const minDay = parseDay(min)
  const maxDay = parseDay(max)

  const [windowStart, setWindowStart] = React.useState(() => startOfMonth(from))
  // Bring the selection back into view when it is changed from outside the timeline.
  const windowEnd = addMonths(windowStart, visibleMonths)
  React.useEffect(() => {
    const start = parseDay(value.from)
    if (start && (start < windowStart || start >= windowEnd)) setWindowStart(startOfMonth(start))
    // Only the start moves the window; the end may sit past it while the start is being dragged.
  }, [value.from])

  const total = differenceInCalendarDays(windowEnd, windowStart)
  const lo = minDay ? Math.min(Math.max(differenceInCalendarDays(minDay, windowStart), 0), total - 1) : 0
  const hi = maxDay ? Math.min(Math.max(differenceInCalendarDays(maxDay, windowStart), 0), total - 1) : total - 1
  const clampIndex = (day: Date) => Math.min(Math.max(differenceInCalendarDays(day, windowStart), 0), total - 1)
  const range: IndexRange = { from: clampIndex(from), to: Math.max(clampIndex(to), clampIndex(from)) }

  const track = React.useRef<HTMLDivElement>(null)
  const drag = React.useRef<Drag | null>(null)

  const emit = (next: IndexRange) => {
    const nextFrom = dayKey(addDays(windowStart, next.from))
    const nextTo = dayKey(addDays(windowStart, next.to))
    if (nextFrom !== value.from || nextTo !== value.to) onChange({ from: nextFrom, to: nextTo })
  }

  const indexAt = (clientX: number) => {
    const box = track.current?.getBoundingClientRect()
    if (!box || box.width === 0) return 0
    return dayIndexAt((clientX - box.left) / box.width, total)
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const grabbed = (event.target as HTMLElement).closest<HTMLElement>("[data-grab]")?.dataset.grab
    const index = indexAt(event.clientX)
    // Pressing the bare track grabs whichever end is nearer.
    const mode =
      grabbed === "from" || grabbed === "to" || grabbed === "body"
        ? grabbed
        : Math.abs(index - range.from) <= Math.abs(index - range.to)
          ? "from"
          : "to"
    drag.current = { mode, origin: index, start: range }
    event.currentTarget.setPointerCapture(event.pointerId)
    if (mode !== "body" && grabbed !== mode) emit(moveHandle(range, mode, index, minDays, lo, hi))
    event.preventDefault()
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current) return
    const index = indexAt(event.clientX)
    if (current.mode === "body") emit(shiftRange(current.start, index - current.origin, lo, hi))
    else emit(moveHandle(current.start, current.mode, index, minDays, lo, hi))
  }

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const onHandleKeyDown = (event: React.KeyboardEvent, handle: "from" | "to") => {
    const step = event.shiftKey ? 7 : 1
    const current = handle === "from" ? range.from : range.to
    const targets: Record<string, number> = {
      ArrowLeft: current - step,
      ArrowDown: current - step,
      ArrowRight: current + step,
      ArrowUp: current + step,
      PageDown: current - 30,
      PageUp: current + 30,
      Home: lo,
      End: hi,
    }
    const target = targets[event.key]
    if (target === undefined) return
    event.preventDefault()
    emit(moveHandle(range, handle, target, minDays, lo, hi))
  }

  const chips = presets ?? defaultPresets()
  const pick = (preset: DateRangeSliderPreset) => {
    onChange({ ...preset.range })
    const start = parseDay(preset.range.from)
    const end = parseDay(preset.range.to)
    if (start && end && (start < windowStart || end >= windowEnd)) setWindowStart(startOfMonth(start))
  }

  const months = Array.from({ length: visibleMonths }, (_, index) => {
    const start = addMonths(windowStart, index)
    return { start, days: differenceInCalendarDays(addMonths(start, 1), start) }
  })
  const canPrev = !minDay || windowStart > startOfMonth(minDay)
  const canNext = !maxDay || addMonths(windowStart, visibleMonths - 1) < startOfMonth(maxDay)
  const days = differenceInCalendarDays(to, from) + 1

  const left = `${dayRatio(range.from, total) * 100}%`
  const right = `${dayRatio(range.to, total) * 100}%`
  const navButton =
    "corner-squircle inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"

  const handle = (which: "from" | "to") => {
    const index = range[which]
    const day = addDays(windowStart, index)
    return (
      <div
        key={which}
        role="slider"
        tabIndex={0}
        data-grab={which}
        aria-label={which === "from" ? "Range start" : "Range end"}
        aria-orientation="horizontal"
        aria-valuemin={lo}
        aria-valuemax={hi}
        aria-valuenow={index}
        aria-valuetext={format(day, SHOWN)}
        onKeyDown={(event) => onHandleKeyDown(event, which)}
        style={{ left: which === "from" ? left : right }}
        className="corner-squircle absolute top-1/2 h-6 w-3.5 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-md border-2 border-background bg-foreground shadow outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    )
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        {label && <span className="text-sm font-medium">{label}</span>}
        <span className="text-xs text-muted-foreground tabular-nums">
          {format(from, SHOWN)} – {format(to, SHOWN)} · {days} {days === 1 ? "day" : "days"}
        </span>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((preset) => {
            const active = value.from === preset.range.from && value.to === preset.range.to
            return (
              <button
                key={preset.label}
                type="button"
                aria-pressed={active}
                onClick={() => pick(preset)}
                className={cn(
                  "corner-squircle rounded-lg px-3 py-1.5 text-xs font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "bg-foreground text-background" : "bg-muted text-foreground hover:bg-muted/70",
                )}
              >
                {preset.label}
              </button>
            )
          })}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Earlier months"
          className={navButton}
          disabled={!canPrev}
          onClick={() => setWindowStart(addMonths(windowStart, -1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1 select-none">
          <div className="flex text-xs text-muted-foreground">
            {months.map(({ start, days: length }, index) => (
              <div
                key={format(start, "yyyy-MM")}
                style={{ flexGrow: length, flexBasis: 0 }}
                className="min-w-0 truncate border-l border-border/70 px-1.5 first:border-l-0"
              >
                {format(start, index === 0 || start.getMonth() === 0 ? "MMM yyyy" : "MMM")}
              </div>
            ))}
          </div>
          <div
            ref={track}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className="relative mt-1 h-9 cursor-pointer touch-none"
          >
            <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-muted" />
            {(lo > 0 || hi < total - 1) && (
              <>
                <div
                  className="absolute top-1/2 h-2 -translate-y-1/2 rounded-l-full bg-foreground/10"
                  style={{ left: 0, width: `${(lo / total) * 100}%` }}
                />
                <div
                  className="absolute top-1/2 h-2 -translate-y-1/2 rounded-r-full bg-foreground/10"
                  style={{ right: 0, width: `${((total - 1 - hi) / total) * 100}%` }}
                />
              </>
            )}
            <div
              data-grab="body"
              className="absolute top-1/2 h-3 -translate-y-1/2 cursor-grab rounded-full bg-foreground/80 active:cursor-grabbing"
              style={{ left, width: `calc(${right} - ${left})` }}
            />
            {handle("from")}
            {handle("to")}
          </div>
        </div>
        <button
          type="button"
          aria-label="Later months"
          className={navButton}
          disabled={!canNext}
          onClick={() => setWindowStart(addMonths(windowStart, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <p className="sr-only" aria-live="polite">
        {format(from, SHOWN)} to {format(to, SHOWN)}, {days} days
      </p>
    </div>
  )
}

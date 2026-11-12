import * as React from "react"

import { Calendar, type CalendarProps } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export interface DateTimePickerProps extends CalendarProps {
  /** Start and end times as `HH:mm` or `HH:mm:ss`, bound separately from the day. */
  startTime: string
  endTime: string
  onStartTimeChange: (value: string) => void
  onEndTimeChange: (value: string) => void
  startLabel?: string
  endLabel?: string
}

/** A calendar for the day with separate start and end time fields under it. */
export function DateTimePicker({
  startTime,
  endTime,
  onStartTimeChange,
  onEndTimeChange,
  startLabel = "Start time",
  endLabel = "End time",
  className,
  ...calendar
}: DateTimePickerProps) {
  const startId = React.useId()
  const endId = React.useId()
  // Times are zero-padded, so comparing them as text compares them as times.
  const endsBeforeStart = Boolean(startTime && endTime) && endTime < startTime

  return (
    <div className={cn("space-y-3", className)}>
      <Calendar {...calendar} />
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label htmlFor={startId} className="text-xs font-medium text-muted-foreground">
            {startLabel}
          </label>
          <Input
            id={startId}
            type="time"
            step={1}
            className="h-9"
            value={startTime}
            onChange={(event) => onStartTimeChange(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor={endId} className="text-xs font-medium text-muted-foreground">
            {endLabel}
          </label>
          <Input
            id={endId}
            type="time"
            step={1}
            className="h-9"
            value={endTime}
            aria-invalid={endsBeforeStart || undefined}
            onChange={(event) => onEndTimeChange(event.target.value)}
          />
        </div>
      </div>
      {endsBeforeStart && (
        <p role="alert" className="text-xs text-red-300">
          {endLabel} is before {startLabel.toLowerCase()}.
        </p>
      )}
    </div>
  )
}

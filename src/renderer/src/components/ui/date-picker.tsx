import * as React from "react"
import { format } from "date-fns"
import { CalendarDays } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Calendar,
  RangeCalendar,
  type CalendarProps,
  type RangeCalendarProps,
} from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { parseDay } from "@/lib/date-range"
import { cn } from "@/lib/utils"

const SHOWN = "MMM d, yyyy"

/**
 * Open state plus the element overlays should render into: inside a dialog they have to live in it,
 * or the dialog's focus trap steals the keyboard.
 */
function usePickerPopover() {
  const [open, setOpen] = React.useState(false)
  const [container, setContainer] = React.useState<HTMLElement | undefined>(undefined)
  const trigger = React.useRef<HTMLButtonElement>(null)
  const onOpenChange = (next: boolean) => {
    if (next) setContainer(trigger.current?.closest<HTMLElement>('[role="dialog"]') ?? undefined)
    setOpen(next)
  }
  return { open, setOpen, onOpenChange, container, trigger }
}

interface TriggerProps {
  text: string | undefined
  placeholder: string
  triggerRef: React.Ref<HTMLButtonElement>
  className?: string
  id?: string
  "aria-label"?: string
}

function PickerTrigger({ text, placeholder, triggerRef, className, id, "aria-label": label }: TriggerProps) {
  return (
    <PopoverTrigger asChild>
      <Button
        ref={triggerRef}
        id={id}
        type="button"
        variant="outline"
        aria-label={label}
        className={cn("w-full justify-start px-3 text-left font-normal", !text && "text-muted-foreground", className)}
      >
        <CalendarDays />
        <span className="truncate">{text ?? placeholder}</span>
      </Button>
    </PopoverTrigger>
  )
}

export interface DatePickerProps extends Omit<CalendarProps, "container" | "className"> {
  placeholder?: string
  /** Classes for the trigger button. */
  className?: string
  id?: string
  "aria-label"?: string
}

/** A button showing the picked day that opens a calendar; picking a day closes it. */
export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  className,
  id,
  "aria-label": label,
  ...calendar
}: DatePickerProps) {
  const { open, setOpen, onOpenChange, container, trigger } = usePickerPopover()
  const day = parseDay(value)
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PickerTrigger
        text={day ? format(day, SHOWN) : undefined}
        placeholder={placeholder}
        triggerRef={trigger}
        className={className}
        id={id}
        aria-label={label}
      />
      <PopoverContent align="start" container={container} className="w-auto p-3">
        <Calendar
          {...calendar}
          value={value}
          container={container}
          onChange={(next) => {
            onChange(next)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

export interface DateRangePickerProps extends Omit<RangeCalendarProps, "container" | "className"> {
  placeholder?: string
  /** Classes for the trigger button. */
  className?: string
  id?: string
  "aria-label"?: string
}

/** A button showing the picked range that opens two months; the second click closes it. */
export function DateRangePicker({
  value,
  onChange,
  placeholder = "Pick a date range",
  className,
  id,
  "aria-label": label,
  ...calendar
}: DateRangePickerProps) {
  const { open, setOpen, onOpenChange, container, trigger } = usePickerPopover()
  const from = parseDay(value.from)
  const to = parseDay(value.to)
  const text = from ? (to ? `${format(from, SHOWN)} – ${format(to, SHOWN)}` : `${format(from, SHOWN)} – …`) : undefined
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PickerTrigger text={text} placeholder={placeholder} triggerRef={trigger} className={className} id={id} aria-label={label} />
      <PopoverContent align="start" container={container} className="w-auto p-3">
        <RangeCalendar
          {...calendar}
          value={value}
          container={container}
          onChange={(next) => {
            onChange(next)
            if (next.from && next.to) setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

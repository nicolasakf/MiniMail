/** The times "Send later" offers, and how a chosen time is shown and typed. */

export interface SendLaterOption {
  id: "hour" | "evening" | "tomorrow" | "weekend" | "week";
  label: string;
  time: number;
}

const MORNING_HOUR = 9;
const EVENING_HOUR = 20;
const HOUR_MS = 60 * 60_000;

/** `hour`:00 on the day `days` after `from`, in local time. */
function dayAt(from: Date, days: number, hour: number): Date {
  const date = new Date(from);
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date;
}

/**
 * Ready-made times that are still ahead of `now`. Two names for the same moment (Friday's
 * "Tomorrow morning" is also "This weekend") are offered once, under the first name.
 */
export function sendLaterOptions(now: Date = new Date()): SendLaterOption[] {
  const saturdayGap = (6 - now.getDay() + 7) % 7;
  const weekend = dayAt(now, saturdayGap, MORNING_HOUR);
  if (weekend.getTime() <= now.getTime()) weekend.setDate(weekend.getDate() + 7);
  const mondayGap = (1 - now.getDay() + 7) % 7 || 7;

  const options: SendLaterOption[] = [
    { id: "hour", label: "In one hour", time: now.getTime() + HOUR_MS },
    { id: "evening", label: "This evening", time: dayAt(now, 0, EVENING_HOUR).getTime() },
    { id: "tomorrow", label: "Tomorrow morning", time: dayAt(now, 1, MORNING_HOUR).getTime() },
    { id: "weekend", label: "This weekend", time: weekend.getTime() },
    { id: "week", label: "Next week", time: dayAt(now, mondayGap, MORNING_HOUR).getTime() },
  ];
  const seen = new Set<number>();
  return options.filter((option) => {
    if (option.time <= now.getTime() || seen.has(option.time)) return false;
    seen.add(option.time);
    return true;
  });
}

/** "Nov 14, 2026, 9:00 AM": the full moment, for a title or a list of scheduled mail. */
export function composeTimeLabel(time: number): string {
  return new Date(time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** The shortest label that still places the moment: "8:00 PM", "Sat 9:00 AM" or "Nov 23, 9:00 AM". */
export function sendTimeHint(time: number, now: Date = new Date()): string {
  const date = new Date(time);
  const clock: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString(undefined, clock);
  const daysAway = (date.getTime() - now.getTime()) / (24 * HOUR_MS);
  if (daysAway < 6) return date.toLocaleString(undefined, { weekday: "short", ...clock });
  return date.toLocaleString(undefined, { month: "short", day: "numeric", ...clock });
}

/** The value a `datetime-local` input takes ("2026-11-14T09:00"), in local time. */
export function toDateTimeInput(time: number): string {
  const date = new Date(time);
  return new Date(time - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** The time a `datetime-local` input holds, or undefined while it is empty or incomplete. */
export function fromDateTimeInput(value: string): number | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : time;
}

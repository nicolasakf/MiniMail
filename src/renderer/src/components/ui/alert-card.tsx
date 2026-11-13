import { Info, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/** Colours match the folder marks in the Inbox list (see folder-style.ts): gray, red, amber. */
const TONES = {
  gray: "border-gray-500/30 bg-gray-500/10 text-gray-600 dark:border-gray-400/30 dark:bg-gray-400/10 dark:text-gray-300",
  red: "border-red-500/30 bg-red-500/10 text-red-600 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-400",
  amber:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-400",
} as const;

interface AlertCardProps {
  /** What the badge says. */
  label: string;
  tone?: keyof typeof TONES;
  icon?: LucideIcon;
  className?: string;
}

/** A small notice, as tall as a toolbar button: an icon and one short line. */
export function AlertCard({ label, tone = "amber", icon: Icon = Info, className }: AlertCardProps) {
  return (
    <div
      role="status"
      className={cn(
        "corner-squircle electron-no-drag flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-xs font-medium",
        TONES[tone],
        className,
      )}
    >
      <Icon className="size-[18px] shrink-0" />
      <span>{label}</span>
    </div>
  );
}

import { Info, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/** Colours match the folder marks in the Inbox list (see folder-style.ts): gray, red, amber. */
const TONES = {
  gray: "bg-[color-mix(in_srgb,hsl(var(--muted-foreground))_11%,hsl(var(--background)))] text-muted-foreground",
  red: "bg-[color-mix(in_srgb,hsl(var(--destructive))_11%,hsl(var(--background)))] text-destructive",
  amber: "bg-[color-mix(in_srgb,hsl(var(--amber))_11%,hsl(var(--background)))] text-amber",
} as const;

interface AlertCardProps {
  /** What the badge says. */
  label: string;
  tone?: keyof typeof TONES;
  icon?: LucideIcon;
  className?: string;
  /** Classes for the text, e.g. to hide it visually (`sr-only`) while a narrow toolbar keeps just the icon. */
  labelClassName?: string;
}

/** A small notice, as tall as a toolbar button: an icon and one short line. */
export function AlertCard({ label, tone = "amber", icon: Icon = Info, className, labelClassName }: AlertCardProps) {
  return (
    <div
      role="status"
      title={label}
      className={cn(
        "corner-squircle electron-no-drag flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 text-xs font-medium shadow-raise-2",
        TONES[tone],
        className,
      )}
    >
      <Icon className="size-[18px] shrink-0" />
      <span className={labelClassName}>{label}</span>
    </div>
  );
}

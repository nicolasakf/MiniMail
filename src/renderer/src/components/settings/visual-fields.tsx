import type { ReactNode } from "react";

import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";

import { cn } from "@/lib/utils";

export interface VisualOption<T extends string> {
  value: T;
  label: string;
  /** Shown under the label, in muted text. */
  description?: string;
  /** A miniature of what the choice looks like. */
  preview: ReactNode;
}

interface VisualFieldProps<T extends string> {
  ariaLabel: string;
  value: T;
  options: readonly VisualOption<T>[];
  disabled?: boolean;
  /**
   * "compact" packs small miniatures close together, "regular" gives each choice a larger one, and
   * "wide" is two short, full-width cards with the miniature beside its caption.
   */
  size?: "compact" | "regular" | "wide";
  onValueChange: (value: T) => void;
}

/** The empty frame every miniature is drawn in: a small window with a fixed aspect ratio. */
export function PreviewFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("relative aspect-[16/10] w-full overflow-hidden rounded-lg bg-background", className)}>
      {children}
    </div>
  );
}

/**
 * Mutually-exclusive choices shown as miniatures with a caption, for settings that change how the
 * app looks (the visual counterpart of SettingsSegmentedField). It is a radio group, so arrow keys
 * and screen readers work as they do for any other choice.
 */
export function SettingsVisualField<T extends string>({
  ariaLabel,
  value,
  options,
  disabled,
  size = "compact",
  onValueChange,
}: VisualFieldProps<T>) {
  const wide = size === "wide";
  return (
    <RadioGroupPrimitive.Root
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onValueChange={(next) => onValueChange(next as T)}
      className={cn("grid", size === "regular" ? "gap-3" : "gap-2")}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, ${size === "compact" ? "9.5rem" : "1fr"}))` }}
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          className={cn(
            "corner-squircle group relative flex rounded-2xl text-left transition-[box-shadow,background-color]",
            wide ? "items-center gap-3 p-2" : cn("flex-col", size === "regular" ? "gap-2 p-2" : "gap-1.5 p-1.5"),
            // Flat until chosen; the chosen one is raised.
            "focus-visible:outline-none focus-visible:shadow-glow data-[state=unchecked]:hover:bg-[var(--face-hover-soft)]",
            "data-[state=checked]:plate-2 data-[state=checked]:focus-visible:shadow-raise-2-glow",
            "disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent",
          )}
        >
          {option.preview}
          <span className={cn("flex items-start justify-between gap-1 px-0.5", wide && "min-w-0 flex-1 items-center")}>
            <span className="min-w-0">
              <span className="block text-xs font-medium">{option.label}</span>
              {option.description && <span className="block text-[11px] text-muted-foreground">{option.description}</span>}
            </span>
          </span>
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}

interface VisualToggleProps {
  ariaLabel: string;
  checked: boolean;
  disabled?: boolean;
  /** Miniature and caption of the setting when it is on, and when it is off. */
  on: { label: string; preview: ReactNode };
  off: { label: string; preview: ReactNode };
  /** "wide" by default; "compact" or "regular" for a miniature of the whole window. */
  size?: "compact" | "regular" | "wide";
  onCheckedChange: (checked: boolean) => void;
}

/** A yes/no setting as two miniatures, so the person sees both outcomes before choosing. */
export function SettingsVisualToggle({ ariaLabel, checked, disabled, on, off, size = "wide", onCheckedChange }: VisualToggleProps) {
  return (
    <SettingsVisualField
      ariaLabel={ariaLabel}
      size={size}
      value={checked ? "on" : "off"}
      disabled={disabled}
      options={[
        { value: "on", ...on },
        { value: "off", ...off },
      ]}
      onValueChange={(next) => onCheckedChange(next === "on")}
    />
  );
}

interface TileFieldProps<T extends string> {
  ariaLabel: string;
  value: T;
  options: readonly { value: T; label: string; caption?: string; content: ReactNode }[];
  onValueChange: (value: T) => void;
}

/** A row of small square tiles pressed close together, each with its name and a note under it. */
export function SettingsTileField<T extends string>({ ariaLabel, value, options, onValueChange }: TileFieldProps<T>) {
  return (
    <RadioGroupPrimitive.Root
      aria-label={ariaLabel}
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      className="flex gap-1"
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          className="group flex w-16 flex-col items-center gap-1 rounded-md focus-visible:outline-none"
        >
          <span
            className={cn(
              "corner-squircle flex size-14 items-center justify-center rounded-xl transition-[box-shadow,background-color,color]",
              "group-focus-visible:shadow-glow group-data-[state=unchecked]:group-hover:bg-[var(--face-hover-soft)]",
              "group-data-[state=checked]:plate-2 group-data-[state=checked]:text-sidebar-primary group-data-[state=checked]:group-focus-visible:shadow-raise-2-glow",
            )}
          >
            {option.content}
          </span>
          <span className="text-xs font-medium leading-none">{option.label}</span>
          {option.caption && <span className="text-[11px] leading-none text-muted-foreground">{option.caption}</span>}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}

interface MultiTileFieldProps<T extends string> {
  ariaLabel: string;
  values: readonly T[];
  disabled?: boolean;
  options: readonly {
    value: T;
    label: string;
    /** Said on hover and to screen readers. */
    description?: string;
    /** Drawn in the tile's text colour, so it follows the tint. */
    content: ReactNode;
    /** Background and text colours of the tile while it is on; a primary tint when omitted. */
    activeClassName?: string;
  }[];
  onToggle: (value: T, on: boolean) => void;
  /** Extra classes for the row of tiles, for example `justify-center`. */
  className?: string;
}

/** SettingsTileField for choices that can be on together: each tile switches on and off by itself. */
export function SettingsMultiTileField<T extends string>({
  ariaLabel,
  values,
  disabled,
  options,
  onToggle,
  className,
}: MultiTileFieldProps<T>) {
  return (
    <div role="group" aria-label={ariaLabel} className={cn("flex gap-1", className)}>
      {options.map((option) => {
        const checked = values.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={checked}
            disabled={disabled}
            title={option.description}
            onClick={() => onToggle(option.value, !checked)}
            className="group flex w-16 flex-col items-center gap-1 rounded-md focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span
              className={cn(
                "corner-squircle flex size-14 items-center justify-center rounded-xl transition-[box-shadow,background-color,color]",
                "group-focus-visible:shadow-glow",
                checked
                  ? // On, the tile is raised and its icon takes the tile's own color, so it follows each folder's tint.
                    (option.activeClassName ?? "grain bg-sidebar-primary/[0.12] text-sidebar-primary shadow-raise-2 dark:bg-sidebar-primary/25")
                  : "text-muted-foreground group-enabled:group-hover:bg-[var(--face-hover-soft)]",
              )}
            >
              {option.content}
            </span>
            <span className="text-xs font-medium leading-none">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

import type { ReactNode } from "react";

import { Info } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Title and one-line description at the top of each settings page (Orion's tab header). */
export function SettingsPageHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function InfoIcon({ info, label }: { info: ReactNode; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`About ${label}`}
          className="inline-flex shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
        {info}
      </TooltipContent>
    </Tooltip>
  );
}

/** A label with an optional info icon that explains the setting on hover. */
export function SettingsLabel({
  htmlFor,
  label,
  info,
}: {
  htmlFor?: string;
  label: string;
  info?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {info ? <InfoIcon info={info} label={label} /> : null}
    </div>
  );
}

/** Heading of a group of settings, with an optional info icon. */
export function SettingsSectionTitle({ title, info }: { title: string; info?: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <h3 className="text-sm font-bold">{title}</h3>
      {info ? <InfoIcon info={info} label={title} /> : null}
    </div>
  );
}

interface SwitchFieldProps {
  id: string;
  label: string;
  /** Shown under the label. Keep it to a sentence. */
  description?: string;
  info?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}

/** A bordered row with a label on the left and a switch on the right, for yes/no settings. */
export function SettingsSwitchField({
  id,
  label,
  description,
  info,
  checked,
  disabled,
  onCheckedChange,
}: SwitchFieldProps) {
  return (
    <div
      className={cn(
        "corner-squircle flex items-center justify-between gap-4 rounded-md border p-3",
        disabled && "opacity-60",
      )}
    >
      <div className="min-w-0 space-y-0.5">
        <SettingsLabel htmlFor={id} label={label} info={info} />
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  );
}

interface SegmentedFieldProps<T extends string> {
  ariaLabel: string;
  value: T;
  options: readonly { value: T; label: string }[];
  disabled?: boolean;
  onValueChange: (value: T) => void;
}

/** Short mutually-exclusive choices as a segmented control (Orion's SettingsTabsField). */
export function SettingsSegmentedField<T extends string>({
  ariaLabel,
  value,
  options,
  disabled,
  onValueChange,
}: SegmentedFieldProps<T>) {
  return (
    <Tabs value={value} onValueChange={(next) => onValueChange(next as T)} aria-label={ariaLabel} className="w-full">
      <TabsList
        className="grid h-9 w-full"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((option) => (
          <TabsTrigger key={option.value} value={option.value} disabled={disabled} className="h-7 px-2 text-xs">
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

import { forwardRef } from "react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The icon key used along the composer's header and footer: flat until pointed at, sunk while on. */
export const ToolButton = forwardRef<HTMLButtonElement, ButtonProps & { label: string }>(
  ({ label, className, children, ...props }, ref) => (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      className={cn(
        "size-9 rounded-xl aria-expanded:shadow-pressed aria-expanded:text-sidebar-primary aria-pressed:shadow-pressed aria-pressed:text-sidebar-primary",
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  ),
);
ToolButton.displayName = "ToolButton";

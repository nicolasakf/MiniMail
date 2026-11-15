import { forwardRef } from "react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The quiet icon button used along the composer's header and footer. */
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
        "size-9 rounded-xl text-muted-foreground hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground aria-pressed:bg-accent aria-pressed:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  ),
);
ToolButton.displayName = "ToolButton";

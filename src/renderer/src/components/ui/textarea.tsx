import * as React from "react"

import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "corner-squircle flex min-h-[80px] w-full rounded-xl bg-transparent px-3.5 py-2 text-base shadow-raise-2 transition-shadow placeholder:text-muted-foreground focus-visible:outline-none focus-visible:shadow-raise-2-glow disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }

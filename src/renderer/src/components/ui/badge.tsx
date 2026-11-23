import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold shadow-raise-3 transition-colors focus:outline-none",
  {
    variants: {
      variant: {
        default:
          "grain bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "plate-3 text-secondary-foreground",
        destructive:
          "grain bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "plate-3 text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }

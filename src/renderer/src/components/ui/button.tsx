import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { FLAT_KEY } from "@/components/ui/keys"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "corner-squircle press-sink inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-[box-shadow,transform,background-color,color] duration-100 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Raised parts: a plate of plastic, or a plate in the ink or danger color (a second shot).
        default: "grain bg-primary text-primary-foreground shadow-raise-1 hover:bg-primary/90",
        destructive:
          "grain bg-destructive text-destructive-foreground shadow-raise-1 hover:bg-destructive/90",
        // Most buttons are flat until pointed at, then they rise.
        outline: FLAT_KEY,
        secondary: FLAT_KEY,
        ghost: FLAT_KEY,
        link: "text-sidebar-primary underline-offset-4 hover:underline focus-visible:shadow-glow",
        blink: "text-muted-foreground hover:bg-transparent hover:text-sidebar-primary",
      },
      size: {
        default: "h-10 px-4 py-2",
        xs: "h-4 w-4 rounded-sm px-2 py-1",
        sm: "h-9 rounded-[10px] px-3",
        lg: "h-11 rounded-[14px] px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }


import * as React from "react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, toast as sonnerToast } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

const TOAST_DISMISS_KEY = "Escape"
const TOAST_MAX_WIDTH = "28rem"

const VISIBLE_TOAST_SELECTOR = '[data-sonner-toast]:not([data-removed="true"])'

/**
 * Renders app toasts. While any toast is on screen, Esc only dismisses toasts: the key is
 * intercepted in the capture phase on `window`, before any dialog, menu, composer or list
 * handler sees it.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  React.useEffect(() => {
    const handleDismissKey = (event: KeyboardEvent) => {
      if (event.key !== TOAST_DISMISS_KEY) {
        return
      }

      // Ask the DOM, not Sonner's store: expired toasts can linger in the store.
      if (!document.querySelector(VISIBLE_TOAST_SELECTOR)) {
        return
      }

      event.preventDefault()
      event.stopImmediatePropagation()
      sonnerToast.dismiss()
    }

    window.addEventListener("keydown", handleDismissKey, true)

    return () => {
      window.removeEventListener("keydown", handleDismissKey, true)
    }
  }, [])

  return (
    <Sonner
      theme={(theme === "dimmed" ? "dark" : theme) as ToasterProps["theme"]}
      className="toaster group"
      position="bottom-left"
      // Toasts size to their content; the container is as wide as the largest one may be.
      style={
        {
          "--toast-max-width": TOAST_MAX_WIDTH,
          "--width": TOAST_MAX_WIDTH,
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            "corner-squircle group toast w-fit max-w-[var(--toast-max-width)] group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          error:
            // A red wash over the solid toast background, so the list never shows through.
            "group-[.toaster]:border-red-500/40 group-[.toaster]:bg-[linear-gradient(rgb(239_68_68/0.1),rgb(239_68_68/0.1))]",
          icon: "group-data-[type=error]:text-red-400",
          actionButton:
            "corner-squircle rounded-md group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "corner-squircle rounded-md group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }

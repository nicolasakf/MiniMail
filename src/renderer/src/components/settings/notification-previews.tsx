import type { NotificationContent } from "@shared/notifications";

import { cn } from "@/lib/utils";

import { PreviewFrame } from "./visual-fields";

/**
 * Miniatures for "What a notification shows". Like the Appearance ones they are plain boxes, so
 * they follow the theme and nothing in them is interactive: a desktop with one banner on it, and
 * the banner's lines tell how much it says.
 */

function Line({ className }: { className?: string }) {
  return <div className={cn("h-1 rounded-full", className)} />;
}

/** One banner at the top right of the desktop: the app's icon and up to three lines of text. */
export function NotificationPreview({ content }: { content: NotificationContent }) {
  return (
    <PreviewFrame className="bg-muted/40">
      <div className="absolute inset-x-2 top-2 flex items-center gap-1.5 rounded-md border bg-card p-1.5 shadow-sm">
        <span className="size-3.5 shrink-0 rounded-[3px] bg-primary" />
        <div className="min-w-0 flex-1 space-y-[3px]">
          {content === "full" && (
            <>
              <Line className="w-2/5 bg-foreground/50" />
              <Line className="w-4/5 bg-foreground/30" />
              <Line className="h-[3px] w-full bg-foreground/15" />
            </>
          )}
          {content === "sender" && (
            <>
              <Line className="w-2/5 bg-foreground/50" />
              <Line className="h-[3px] w-3/5 bg-foreground/15" />
            </>
          )}
          {content === "hidden" && <Line className="w-3/5 bg-foreground/30" />}
        </div>
      </div>
    </PreviewFrame>
  );
}

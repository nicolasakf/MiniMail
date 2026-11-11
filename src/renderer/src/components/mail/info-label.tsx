import { Info } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface InfoLabelProps {
  htmlFor?: string;
  children: React.ReactNode;
  /** Explanation shown in the tooltip; setup details belong here, not in helper paragraphs. */
  info: React.ReactNode;
}

/** Form label with an info icon whose tooltip explains the setting (Orion's settings pattern). */
export function InfoLabel({ htmlFor, children, info }: InfoLabelProps) {
  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={htmlFor}>{children}</Label>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="More information"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <Info className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
          {info}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

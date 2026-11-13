import { useMemo } from "react";

import { File } from "lucide-react";
import { getIcon } from "material-file-icons";

import { cn } from "@/lib/utils";

type FileIconProps = {
  filename: string;
  className?: string;
};

/**
 * A colored icon for a file, chosen from its name. Uses the `material-file-icons` package, which
 * maps about 377 file extensions and names to SVG icons; falls back to a plain file icon when
 * there is no name. The icon fills its box, so size it with a className such as "size-6".
 */
export function FileIcon({ filename, className }: FileIconProps) {
  const svg = useMemo(() => (filename ? getIcon(filename).svg : null), [filename]);

  if (!svg) return <File aria-hidden="true" className={cn("size-4 shrink-0 text-muted-foreground", className)} />;

  return (
    <div
      aria-hidden="true"
      className={cn("size-4 shrink-0", className)}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

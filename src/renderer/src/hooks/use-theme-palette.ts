import { useEffect, useState } from "react";

/** The theme colors a message frame needs, as computed `rgb(...)` strings. */
export interface ThemePalette {
  card: string;
  foreground: string;
  muted: string;
  border: string;
}

function readPalette(): ThemePalette {
  // The theme's tokens are `H S% L%` triples; a probe element turns them into real colors.
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:absolute;visibility:hidden;pointer-events:none;" +
    "background-color:hsl(var(--card));color:hsl(var(--card-foreground));" +
    "border:1px solid;border-color:hsl(var(--border));outline:1px solid;outline-color:hsl(var(--muted-foreground))";
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const palette = {
    card: style.backgroundColor,
    foreground: style.color,
    muted: style.outlineColor,
    border: style.borderTopColor,
  };
  probe.remove();
  return palette;
}

/** The current theme's colors, updated when the theme class on the page changes. */
export function useThemePalette(): ThemePalette {
  const [palette, setPalette] = useState(readPalette);

  useEffect(() => {
    const update = () => setPalette(readPalette());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return palette;
}

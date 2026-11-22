/**
 * The frame always paints a white page, but Chromium evaluates `prefers-color-scheme` inside it
 * from the app's theme. In dark mode, senders' dark-mode rules (light text meant for a dark page)
 * would land on that white page and become unreadable. Make those queries never match and the
 * light ones always match, so the message renders as its light design.
 */
export function pinLightColorScheme(html: string): string {
  return html
    .replace(/\(\s*prefers-color-scheme\s*:\s*dark\s*\)/gi, "(min-width: 99999px)")
    .replace(/\(\s*prefers-color-scheme\s*:\s*light\s*\)/gi, "(min-width: 0px)");
}

const DARK_RULE = /\(\s*prefers-color-scheme\s*:\s*dark\s*\)/i;

/** Whether the sender styled this message for dark pages (it has `prefers-color-scheme: dark` rules). */
export function hasDarkModeRules(html: string): boolean {
  return DARK_RULE.test(html);
}

/** What the user's choice for messages that bring no dark styling of their own: a white page, or the theme's. */
export const EMAIL_BACKGROUNDS = ["white", "theme"] as const;
export type EmailBackground = (typeof EMAIL_BACKGROUNDS)[number];

/**
 * How a message is painted:
 * - `white`: the message's light design on a white page.
 * - `native`: the sender's own dark design, on the theme's card color.
 * - `inverted`: the light design with lightness flipped, on the theme's card color.
 */
export type EmailRender = "white" | "native" | "inverted";

export function chooseEmailRender(options: {
  /** The app theme is dark or dimmed. */
  dark: boolean;
  darkAware: boolean;
  background: EmailBackground;
}): EmailRender {
  if (!options.dark) return "white";
  if (options.darkAware) return "native";
  return options.background === "theme" ? "inverted" : "white";
}

/**
 * The page color to write so that the `invert(1) hue-rotate(180deg)` filter paints `color`.
 * Inverting alone is not enough: the hue rotation turns a bluish grey (the dimmed theme) brown,
 * so the color is rotated first (a 180 degree turn is its own inverse) and then flipped.
 * Null if unparsable.
 */
export function preFlipRgb(color: string): string | null {
  const match = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/i.exec(color.trim());
  if (!match) return null;
  const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])];
  // The hue-rotate(180deg) matrix from the CSS filter spec.
  const turned = [
    -0.574 * r + 1.43 * g + 0.144 * b,
    0.426 * r + 0.43 * g + 0.144 * b,
    0.426 * r + 1.43 * g - 0.856 * b,
  ];
  const [red, green, blue] = turned.map((value) => 255 - Math.round(Math.min(255, Math.max(0, value))));
  return `rgb(${red}, ${green}, ${blue})`;
}

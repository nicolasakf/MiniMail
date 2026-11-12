/** Normalizes three- or six-digit hex (with or without "#") to uppercase `#RRGGBB`, or null. */
export function normalizeHexColor(input: string): string | null {
  const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(input.trim());
  if (!match) return null;
  const digits = match[1].length === 3 ? [...match[1]].map((digit) => digit + digit).join("") : match[1];
  return `#${digits.toUpperCase()}`;
}

/** The hue (0-360) of a hex color; grays have no hue and give 0. */
export function hexToHue(hex: string): number {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return 0;
  const [red, green, blue] = [1, 3, 5].map((start) => Number.parseInt(normalized.slice(start, start + 2), 16) / 255);
  const max = Math.max(red, green, blue);
  const delta = max - Math.min(red, green, blue);
  if (delta === 0) return 0;
  let hue: number;
  if (max === red) hue = 60 * (((green - blue) / delta) % 6);
  else if (max === green) hue = 60 * ((blue - red) / delta + 2);
  else hue = 60 * ((red - green) / delta + 4);
  return Math.round((hue + 360) % 360);
}

/** Hex for `hsl(hue saturation% lightness%)`, matching how categories are drawn (70% / 55%). */
export function hslToHex(hue: number, saturation = 70, lightness = 55): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255).toString(16).padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`.toUpperCase();
}

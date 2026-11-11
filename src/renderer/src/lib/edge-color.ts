import { useEffect, useState } from "react";

/** The shared color of a set of pixels if they are all opaque and nearly equal, else null. */
function solidColor(pixels: ArrayLike<number>, width: number, points: number[][]): string | null {
  const samples = points.map(([x, y]) => {
    const at = (y * width + x) * 4;
    return { r: pixels[at], g: pixels[at + 1], b: pixels[at + 2], a: pixels[at + 3] };
  });
  if (samples.some((sample) => sample.a < 230)) return null;
  const close = samples.every(
    (sample) =>
      Math.abs(sample.r - samples[0].r) < 36 &&
      Math.abs(sample.g - samples[0].g) < 36 &&
      Math.abs(sample.b - samples[0].b) < 36,
  );
  if (!close) return null;
  const mean = (channel: "r" | "g" | "b") => Math.round(samples.reduce((sum, c) => sum + c[channel], 0) / samples.length);
  return `rgb(${mean("r")} ${mean("g")} ${mean("b")})`;
}

/**
 * The background color of an icon, if it has a solid one. A full-bleed icon (a logo on a black or
 * colored square) shows it in its four corners; an icon drawn as a rounded tile has transparent
 * corners but shows it in the middle of each edge. Either way the avatar tile takes that color,
 * so the icon fills the shape with no border. Null for a logo on a transparent background.
 */
export function edgeColorFromPixels(pixels: ArrayLike<number>, width: number, height: number): string | null {
  const right = width - 1;
  const bottom = height - 1;
  const midX = Math.floor(width / 2);
  const midY = Math.floor(height / 2);
  return (
    solidColor(pixels, width, [[0, 0], [right, 0], [0, bottom], [right, bottom]]) ??
    // One pixel in from the edge: the outermost row blends with transparency when the icon is shrunk.
    solidColor(pixels, width, [[midX, 1], [right - 1, midY], [midX, bottom - 1], [1, midY]])
  );
}

const SAMPLE = 16;
const known = new Map<string, string | null>();

/** The edge color of the image at `src`, or null while loading, when it has none, or for no image. */
export function useEdgeColor(src: string | null): string | null {
  const [color, setColor] = useState<string | null>(src ? (known.get(src) ?? null) : null);

  useEffect(() => {
    if (!src) {
      setColor(null);
      return;
    }
    if (known.has(src)) {
      setColor(known.get(src) ?? null);
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      let result: string | null = null;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = SAMPLE;
        canvas.height = SAMPLE;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (context) {
          context.drawImage(image, 0, 0, SAMPLE, SAMPLE);
          result = edgeColorFromPixels(context.getImageData(0, 0, SAMPLE, SAMPLE).data, SAMPLE, SAMPLE);
        }
      } catch {
        result = null;
      }
      known.set(src, result);
      if (!cancelled) setColor(result);
    };
    image.onerror = () => known.set(src, null);
    image.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  return color;
}

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combines conditional class names and resolves Tailwind conflicts.
 * Same helper as the Orion app, so copied shadcn components work unchanged.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

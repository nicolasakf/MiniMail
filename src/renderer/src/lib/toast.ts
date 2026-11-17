import { toast as base } from "sonner";

import { noteErrorToast } from "@/lib/events";

/**
 * Sonner's `toast`, except that an error toast is also recorded in the event journal. Import this
 * instead of "sonner", so no failure the user sees can be missing from the log and the
 * Log popover.
 */
const error: typeof base.error = (...args) => {
  noteErrorToast(args[0], args[1]?.description);
  return base.error(...args);
};

export const toast: typeof base = Object.assign(((...args: Parameters<typeof base>) => base(...args)) as typeof base, base, { error });

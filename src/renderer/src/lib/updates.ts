import type { UpdateState } from "@shared/updates";

import { api } from "@/lib/api";
import { toast } from "@/lib/toast";

/**
 * Does one step of updating MiniMail and tells the person how it ended: the toast for a failure, or for a check that
 * found nothing. The main process already recorded a failure, and the error toast is not recorded twice (it carries
 * the same text). Other outcomes show through the state, which the page hears of on its own.
 */
export async function runUpdateStep(step: "check" | "download" | "install"): Promise<UpdateState | null> {
  try {
    const state = await api.updates[step]();
    if (state.error) toast.error(state.error);
    else if (step === "check" && state.status === "current") toast.success("MiniMail is up to date.");
    return state;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Could not update MiniMail.");
    return null;
  }
}

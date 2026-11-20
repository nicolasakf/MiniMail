import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { onboardingDecision } from "@/lib/onboarding";

/**
 * Decides once per launch whether the first-run setup guide opens (see `onboardingDecision`), and
 * remembers when it is finished or skipped. It waits until the accounts have loaded, so an existing
 * setup is never mistaken for a fresh one.
 */
export function useOnboarding(accountsLoaded: boolean, accountCount: number) {
  const [open, setOpen] = useState(false);
  const decided = useRef(false);

  useEffect(() => {
    if (!accountsLoaded || decided.current) return;
    decided.current = true;
    api.prefs
      .get()
      .then((saved) => {
        const decision = onboardingDecision(saved.onboarded, accountCount);
        if (decision.save !== undefined) void api.prefs.set({ onboarded: decision.save }).catch(() => undefined); // expected: recorded by the main process; the guide may just open again next launch.
        if (decision.open) setOpen(true);
      })
      .catch(() => undefined); // expected: recorded by the main process; without the saved choice the guide stays closed.
  }, [accountsLoaded, accountCount]);

  /** Closes the guide for good (finished or skipped). */
  const finish = useCallback(() => {
    setOpen(false);
    api.prefs.set({ onboarded: true }).catch(() => undefined); // expected: recorded by the main process; the guide may open again next launch.
  }, []);

  return { open, finish };
}

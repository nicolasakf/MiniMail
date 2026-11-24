import { useEffect, useState } from "react";

import type { UpdateState } from "@shared/updates";

import { api } from "@/lib/api";

/** Where updating MiniMail stands, kept current: found a version, download progress, ready to restart. */
export function useUpdateState(): UpdateState {
  const [state, setState] = useState<UpdateState>({ status: "unsupported", currentVersion: "" });

  useEffect(() => {
    let heardSince = false;
    const stop = api.updates.onChanged((next) => {
      heardSince = true;
      setState(next);
    });
    api.updates
      .state()
      // A change that arrived while this was on its way is newer than its answer.
      .then((first) => {
        if (!heardSince) setState(first);
      })
      .catch(() => undefined); // expected: recorded by the main process
    return stop;
  }, []);

  return state;
}

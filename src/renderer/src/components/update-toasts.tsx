import { useEffect, useRef } from "react";

import { updateNotice } from "@shared/updates";

import { useUpdateState } from "@/hooks/use-update-state";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { runUpdateStep } from "@/lib/updates";

/**
 * One notice at a time, each stage with an id of its own: sonner merges the options of a toast with the same id, so
 * reusing one would keep the button and the icon of the stage before.
 */
const NOTICE_IDS = {
  available: "minimail-update-available",
  downloading: "minimail-update-downloading",
  ready: "minimail-update-ready",
  installing: "minimail-update-installing",
} as const;

/**
 * The notice about updating MiniMail: a new version is available, it is downloading, it is ready to restart.
 * It stays until the person acts on it or closes it; closing the "available" notice is remembered for that
 * version, so it does not come back at the next start (Settings, Advanced still offers it).
 */
export function UpdateToasts() {
  const state = useUpdateState();
  const latest = useRef(state);
  latest.current = state;
  /** The version whose button was pressed: the notice going away then is not the person closing it. */
  const acted = useRef<string | undefined>(undefined);

  useEffect(() => {
    const notice = updateNotice(state);
    // The notice of any other stage goes away; this one is shown, or updated in place.
    for (const [kind, id] of Object.entries(NOTICE_IDS)) if (kind !== notice?.kind) toast.dismiss(id);
    if (!notice) return;
    if (notice.kind === "downloading" || notice.kind === "installing") {
      toast.loading(notice.message, { id: NOTICE_IDS[notice.kind], duration: Infinity });
      return;
    }
    const version = state.latestVersion;
    toast(notice.message, {
      id: NOTICE_IDS[notice.kind],
      duration: Infinity,
      closeButton: true,
      action: notice.action
        ? {
            label: notice.action.label,
            onClick: () => {
              acted.current = version;
              void runUpdateStep(notice.action!.step);
            },
          }
        : undefined,
      onDismiss: () => {
        // Only the person closing a notice that was still current counts; the page replacing it does not.
        const now = latest.current;
        if (notice.kind === "available" && version && acted.current !== version && now.status === "available" && now.latestVersion === version) {
          api.updates.dismiss(version).catch(() => undefined); // expected: recorded by the main process
        }
      },
    });
  }, [state]);

  return null;
}

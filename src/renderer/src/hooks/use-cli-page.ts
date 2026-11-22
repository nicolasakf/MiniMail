import { useEffect, useRef } from "react";

import { api } from "@/lib/api";
import { handlePageRequest, type PageDeps } from "@/lib/cli-page";

/**
 * Lets the CLI use this page: the main process sends what an agent asked for, the page does it with its
 * own functions (so it gets an Undo and a Log row "via CLI") and answers. It announces itself when it
 * starts, and again after a reload, so the main process knows when it can ask.
 */
export function useCliPage(deps: PageDeps): void {
  const latest = useRef(deps);
  latest.current = deps;
  useEffect(() => {
    // Always the newest functions, since the page's state changes while a request is on its way.
    const current: PageDeps = {
      perform: (...args) => latest.current.perform(...args),
      settle: (...args) => latest.current.settle(...args),
      assignCategory: (...args) => latest.current.assignCategory(...args),
      notifySettings: () => latest.current.notifySettings(),
      updateNotify: (change) => latest.current.updateNotify(change),
      ask: (card) => latest.current.ask(card),
      unsubscribe: (rows) => latest.current.unsubscribe(rows),
      accounts: () => latest.current.accounts(),
      drafts: {
        list: () => latest.current.drafts.list(),
        save: (draft) => latest.current.drafts.save(draft),
        remove: (id) => latest.current.drafts.remove(id),
        newId: () => latest.current.drafts.newId(),
      },
    };
    const stop = api.cli.onPageRequest((id, request) => {
      handlePageRequest(request, current).then(
        (result) => api.cli.pageReply({ id, ok: true, result }),
        // expected: sent back to the main process, which tells the caller and records the failure.
        (error: unknown) => api.cli.pageReply({ id, ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
    });
    api.cli.pageReady();
    return stop;
  }, []);
}

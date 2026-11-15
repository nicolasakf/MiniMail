import { useEffect, useState } from "react";

import type { Account, SavedDraft } from "@shared/types";

import { api } from "@/lib/api";
import { seedFromDraft } from "@/lib/drafts";

import { Composer } from "./composer";

let initialization: Promise<[SavedDraft | null, Account[]]> | undefined;

export function DetachedComposer() {
  const [data, setData] = useState<[SavedDraft | null, Account[]]>();
  const [error, setError] = useState("");
  useEffect(() => {
    document.title = "MiniMail Composer";
    let active = true;
    initialization ??= Promise.all([api.composerWindow.initialDraft(), api.accounts.list()]);
    void initialization.then((result) => {
      if (active) setData(result);
    }, (reason: unknown) => {
      if (active) setError(String(reason));
    });
    return () => { active = false; };
  }, []);
  if (error || (data && !data[0])) {
    return <p role="alert" className="p-6">{error || "This composer session has ended. Open the draft from MiniMail."}</p>;
  }
  if (!data?.[0]) return <p className="p-6 text-muted-foreground">Opening draft…</p>;
  return <Composer seed={seedFromDraft(data[0])} accounts={data[1]} detached
    onClose={() => api.composerWindow.finish()} />;
}

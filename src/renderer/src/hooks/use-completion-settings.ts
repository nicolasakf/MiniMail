import { useEffect, useState } from "react";

import { DEFAULT_COMPLETION, type CompletionSettings } from "@shared/completion";

import { api } from "@/lib/api";

/**
 * Whether the composer should suggest text, and how much. It reads the AI settings when the composer
 * opens and again each time its window comes back into focus, so a change made in Settings shows up
 * in a composer that was already open (a window of its own has its own page, so it asks as well).
 * Off until the answer is in, and whenever there is no model or no key to ask.
 */
export function useCompletionSettings(): CompletionSettings {
  const [settings, setSettings] = useState<CompletionSettings>(DEFAULT_COMPLETION);
  useEffect(() => {
    let cancelled = false;
    const read = () => {
      api.categories
        .get()
        .then(({ ai }) => {
          if (cancelled) return;
          const usable = ai.codeConfigured && ai.completion.model !== "";
          const next = { enabled: ai.completion.enabled && usable, length: ai.completion.length, model: ai.completion.model };
          setSettings((known) => (known.enabled === next.enabled && known.length === next.length && known.model === next.model ? known : next));
        })
        .catch(() => undefined); // expected: the main process records a failed read; completion stays as it was
    };
    read();
    window.addEventListener("focus", read);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", read);
    };
  }, []);
  return settings;
}

import { useCallback, useEffect, useState } from "react";

import { toast } from "sonner";

import type { LogoSettings } from "@shared/logos";

import { api } from "@/lib/api";
import { resetLogos } from "@/lib/logo-store";

/** The two logo switches. Changing one re-asks for every logo, so turning a source off takes effect at once. */
export function useLogoSettings() {
  const [settings, setSettings] = useState<LogoSettings | null>(null);

  useEffect(() => {
    api.logos.settings().then(setSettings).catch(() => undefined);
  }, []);

  const update = useCallback(
    async (change: Partial<LogoSettings>): Promise<void> => {
      if (!settings) return;
      try {
        setSettings(await api.logos.setSettings({ ...settings, ...change }));
        resetLogos();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [settings],
  );

  return { settings, update };
}
